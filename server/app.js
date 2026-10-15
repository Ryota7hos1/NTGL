const express = require('express');
const path = require('node:path');
const { reset } = require('./db');
const { recommend } = require('./recommend');
const { buildProcedure } = require('./procedure');

const DAY = 86400000;
const WARN_DAYS = 90;              // due this close to the rated end of life
const DELIVERY_MARGIN_DAYS = 30;   // or when the previous supplier's delivery would land this close
const DEFAULT_LEAD_DAYS = 14;      // lead time assumed when the previous supplier is unknown
const DEFAULT_SITE = 'Demo Site LHR-1, Hall A';

// Site documents cited as evidence on a request, by equipment.
const EVIDENCE = {
  'BS-A1': ['BAT-DS rev 2', 'SLD-101 rev C'],
  'CRAH-3': ['CRAH-3 O&M manual rev 1'],
  'UPS-A': ['MAN-UPSX rev 4', 'SLD-101 rev C'],
  'GEN-1': ['GEN-1 O&M manual rev 2'],
};

// Simulated supplier quotes, created with each request. Suppliers are fictional; each unit price
// is the part's last purchase price scaled by a per-supplier factor. `match` says whether the
// supplier offers the exact OEM part or a compatible alternative.
const QUOTE_TEMPLATES = [
  { supplier: 'Northbank Power Services', included: 'Supply, install, disposal', excluded: 'Load bank test', lead_time_days: 21, factor: 1.27, match: 'exact' },
  { supplier: 'Volta Critical Supply', included: 'Supply, install', excluded: 'Disposal, testing', lead_time_days: 14, factor: 1.09, match: 'exact' },
  { supplier: 'Cellstock Direct', included: 'Supply only', excluded: 'Install, disposal', lead_time_days: 5, factor: 0.85, match: 'equivalent' },
  { supplier: 'Meridian Express Spares', included: 'Supply only, express courier', excluded: 'Install, disposal', lead_time_days: 2, factor: 1.45, match: 'exact' },
];
const FALLBACK_UNIT_PRICE = 100;

// Buying happens on the supplier's own site. The suppliers are fictional, so these are placeholder
// links on example.com (a domain reserved for examples) rather than real stores.
const supplierUrl = (supplier, partName) =>
  `https://example.com/demo-supplier/${supplier.toLowerCase().replace(/[^a-z0-9]+/g, '-')}?part=${encodeURIComponent(partName)}`;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const isoDate = d => d.toISOString().slice(0, 10);

// End of life and replacement status are derived from install date and service life, never stored.
// A failed part's life ended the day it failed: end_of_life moves to the failure date and
// days_remaining counts back from it, while rated_end_of_life keeps the date it was rated for.
function lifecycle(part, now, leadDays = DEFAULT_LEAD_DAYS) {
  const ratedEnd = new Date(Date.parse(part.installed_on) + part.service_life_days * DAY);
  if (part.failed_at) {
    const failed = new Date(part.failed_at);
    return {
      end_of_life: isoDate(failed), rated_end_of_life: isoDate(ratedEnd),
      days_remaining: -Math.floor((now - failed) / DAY) || 0,
      days_short_of_rating: Math.max(0, Math.ceil((ratedEnd - failed) / DAY)),
      status: 'failed',
    };
  }
  const daysRemaining = Math.ceil((ratedEnd - now) / DAY);
  const previousEnd = part.previous_lifespan_days ? new Date(Date.parse(part.installed_on) + part.previous_lifespan_days * DAY) : null;
  const daysUntilPrevious = previousEnd && Math.ceil((previousEnd - now) / DAY);

  // Due triggers. A part is due when:
  //  - it is within 90 days of its rated end of life, or
  //  - ordering today from the previous supplier would arrive within 30 days of the rated end of life, or
  //  - ordering today from the previous supplier would arrive within 30 days of the age the last unit failed at.
  // The last two are what make the supplier's delivery time matter: a slow supplier makes a part due sooner.
  const ratedDue = daysRemaining <= WARN_DAYS || daysRemaining - leadDays <= DELIVERY_MARGIN_DAYS;
  const previousDue = previousEnd !== null && daysUntilPrevious - leadDays <= DELIVERY_MARGIN_DAYS;
  let status = 'ok', dueReason = null;
  if (daysRemaining < 0) { status = 'expired'; dueReason = 'rated_end_of_life'; }
  else if (ratedDue || previousDue) {
    status = part.spares_on_hand >= part.quantity ? 'due_spares_on_hand' : 'replace_soon';
    dueReason = previousDue && (!ratedDue || daysUntilPrevious < daysRemaining) ? 'previous_service_life' : 'rated_end_of_life';
  }
  // The date the part became due, used to decide which orders resolve it.
  const dueFrom = dueReason === 'previous_service_life'
    ? previousEnd - (DELIVERY_MARGIN_DAYS + leadDays) * DAY
    : ratedEnd - Math.max(WARN_DAYS, DELIVERY_MARGIN_DAYS + leadDays) * DAY;
  return {
    end_of_life: isoDate(ratedEnd), rated_end_of_life: isoDate(ratedEnd), days_remaining: daysRemaining,
    previous_lifespan_days: part.previous_lifespan_days ?? null,
    days_until_previous_failure: daysUntilPrevious ?? null,
    previous_supplier_lead_days: leadDays,
    due_reason: dueReason, due_window_start: isoDate(new Date(dueFrom)),
    status,
  };
}

function createApp({ db, now = () => new Date() }) {
  const app = express();
  app.use(express.json());

  const q = {
    parts: db.prepare('SELECT * FROM parts ORDER BY id'),
    equipment: db.prepare('SELECT * FROM equipment ORDER BY id'),
    part: db.prepare('SELECT * FROM parts WHERE id = ?'),
    equipmentById: db.prepare('SELECT * FROM equipment WHERE id = ?'),
    openRequest: db.prepare(`SELECT id, status FROM supplier_requests WHERE part_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1`),
    lastOrder: db.prepare(`SELECT id, status, created_at FROM supplier_requests WHERE part_id = ? AND status IN ('ordered','purchased') ORDER BY id DESC LIMIT 1`),
    lastPurchase: db.prepare('SELECT supplier, unit_price_gbp, quantity, purchased_on FROM purchase_history WHERE part_id = ? ORDER BY purchased_on DESC, id DESC LIMIT 1'),
    insertPurchase: db.prepare('INSERT INTO purchase_history (part_id, supplier, unit_price_gbp, quantity, purchased_on) VALUES (?, ?, ?, ?, ?)'),
    request: db.prepare('SELECT * FROM supplier_requests WHERE id = ?'),
    insertRequest: db.prepare(`INSERT INTO supplier_requests (part_id, scope, evidence, status, created_at) VALUES (?, ?, ?, 'open', ?)`),
    setStatus: db.prepare('UPDATE supplier_requests SET status = ? WHERE id = ?'),
    quotes: db.prepare('SELECT * FROM quotes WHERE request_id = ? ORDER BY id'),
    insertQuote: db.prepare('INSERT INTO quotes (request_id, supplier, included, excluded, lead_time_days, unit_price_gbp, match, offered_part) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    order: db.prepare('SELECT * FROM orders WHERE request_id = ?'),
    insertOrder: db.prepare(`INSERT INTO orders (request_id, quote_id, supplier, quantity, total_gbp, delivery_site, po_reference, notes, expected_delivery, placed_by, placed_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    audit: db.prepare('SELECT action, actor, detail, at FROM audit_log WHERE request_id = ? ORDER BY id'),
    log: db.prepare('INSERT INTO audit_log (part_id, request_id, action, actor, detail, at) VALUES (?, ?, ?, ?, ?, ?)'),
    failPart: db.prepare('UPDATE parts SET failed_at = ? WHERE id = ?'),
    // Orders placed here plus requests closed as bought elsewhere, newest first.
    allOrders: db.prepare(`
      SELECT r.id AS request_id, CASE r.status WHEN 'purchased' THEN 'purchased_elsewhere' ELSE 'ordered' END AS source,
             o.id AS order_id, p.name AS part, p.equipment_id, o.quantity, o.supplier, o.total_gbp,
             o.expected_delivery, o.po_reference, o.placed_by AS actor, o.placed_at AS at,
             printf('MOP-%03d', r.id) AS procedure_id
        FROM orders o JOIN supplier_requests r ON r.id = o.request_id JOIN parts p ON p.id = r.part_id
       ORDER BY o.placed_at DESC, o.id DESC`),
    allAudit: db.prepare(`
      SELECT a.id, a.request_id, a.action, a.actor, a.detail, a.at, p.name AS part, p.equipment_id
        FROM audit_log a JOIN parts p ON p.id = a.part_id
       ORDER BY a.id DESC`),
  };

  // How long the part's previous supplier takes to deliver, used by the Due triggers.
  const leadFor = partId => {
    const supplier = q.lastPurchase.get(partId)?.supplier;
    return QUOTE_TEMPLATES.find(t => t.supplier === supplier)?.lead_time_days ?? DEFAULT_LEAD_DAYS;
  };
  const lifecycleOf = (part, at = now()) => ({ ...lifecycle(part, at, leadFor(part.id)), previous_supplier: q.lastPurchase.get(part.id)?.supplier ?? null });

  const transaction = fn => {
    db.exec('BEGIN');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (err) { db.exec('ROLLBACK'); throw err; }
  };

  const text = (body, key) => typeof body?.[key] === 'string' ? body[key].trim() : '';

  const deliveryDate = (body, fallback) => {
    const date = text(body, 'expected_delivery') || fallback;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || Number.isNaN(Date.parse(date))) throw new HttpError(400, 'expected_delivery must be a date (YYYY-MM-DD)');
    return date;
  };

  const requireActor = body => {
    const actor = text(body, 'actor');
    if (!actor) throw new HttpError(400, 'enter your name: every change is recorded against the engineer who made it (actor)');
    return actor;
  };

  const loadRequest = id => {
    const request = q.request.get(Number(id));
    if (!request) throw new HttpError(404, 'request not found');
    return request;
  };

  const requestView = request => {
    const part = q.part.get(request.part_id);
    const at = now();
    const lastPurchase = q.lastPurchase.get(part.id) ?? null;
    const quotes = q.quotes.all(request.id).map(quote => ({
      ...quote,
      previous_supplier: quote.supplier === lastPurchase?.supplier,
      change_vs_last_gbp: lastPurchase ? quote.unit_price_gbp - lastPurchase.unit_price_gbp : null,
      quantity: part.quantity,
      total_gbp: quote.unit_price_gbp * part.quantity,
      expected_delivery: isoDate(new Date(at.getTime() + quote.lead_time_days * DAY)),
      supplier_url: supplierUrl(quote.supplier, part.name),
    }));
    const partView = { ...part, ...lifecycleOf(part, at) };
    return {
      ...request,
      evidence: JSON.parse(request.evidence),
      part: partView,
      quotes,
      recommendation: recommend(partView, quotes, at),
      last_purchase: lastPurchase,
      order: q.order.get(request.id) ?? null,
      audit: q.audit.all(request.id),
    };
  };

  // A due part counts as resolved once a replacement was ordered (or bought elsewhere) inside its
  // current warning window; `lifecycle_status` keeps the raw end-of-life status.
  const partState = p => {
    const life = lifecycleOf(p);
    const lastOrder = q.lastOrder.get(p.id) ?? null;
    // A failure starts a new window: only orders made after the part broke resolve it.
    const windowStart = p.failed_at ? Date.parse(p.failed_at) : Date.parse(life.due_window_start);
    const resolved = life.status !== 'ok' && lastOrder && Date.parse(lastOrder.created_at) >= windowStart;
    return {
      ...p, ...life, lifecycle_status: life.status,
      status: resolved ? 'replacement_ordered' : life.status,
      open_request: q.openRequest.get(p.id) ?? null,
      last_order: lastOrder && { id: lastOrder.id, status: lastOrder.status },
    };
  };

  app.get('/api/parts', (req, res) => {
    res.json(q.parts.all().map(partState));
  });

  app.post('/api/parts/:id/requests', (req, res) => {
    const actor = requireActor(req.body);
    const part = q.part.get(Number(req.params.id));
    if (!part) throw new HttpError(404, 'part not found');
    const { status, due_reason: dueReason } = lifecycleOf(part);
    if (q.openRequest.get(part.id)) throw new HttpError(409, 'part already has an open request');

    const id = transaction(() => {
      const what = `${part.quantity} × ${part.name} on ${part.equipment_id}`;
      const scope = status === 'failed' ? `Replace failed ${what}.`
        : dueReason === 'previous_service_life' ? `Replace ${what} before it reaches the age the previous unit failed at (${part.previous_lifespan_days} days).`
        : dueReason ? `Replace ${what} before end of service life.`
        : `Order ${part.quantity} × ${part.name} for ${part.equipment_id}.`;
      const evidence = JSON.stringify(EVIDENCE[part.equipment_id] ?? []);
      const { lastInsertRowid } = q.insertRequest.run(part.id, scope, evidence, now().toISOString());
      const last = q.lastPurchase.get(part.id);
      const base = last?.unit_price_gbp ?? FALLBACK_UNIT_PRICE;
      for (const t of QUOTE_TEMPLATES) {
        // The supplier that provided the part last time can supply the exact same part again.
        const match = t.supplier === last?.supplier ? 'exact' : t.match;
        const offered = match === 'exact' ? `${part.name} (OEM)` : `${part.name}-compatible alternative`;
        q.insertQuote.run(lastInsertRowid, t.supplier, t.included, t.excluded, t.lead_time_days, Math.round(base * t.factor / 5) * 5 || 1, match, offered);
      }
      q.log.run(part.id, lastInsertRowid, 'quotes requested', actor, `${QUOTE_TEMPLATES.length} suppliers`, now().toISOString());
      return lastInsertRowid;
    });
    res.status(201).json(requestView(loadRequest(id)));
  });

  // Equipment with its parts and the most urgent part status, for the site view.
  const URGENCY = ['ok', 'replacement_ordered', 'due_spares_on_hand', 'replace_soon', 'expired', 'failed'];
  app.get('/api/equipment', (req, res) => {
    const parts = q.parts.all().map(p => {
      const { id, name, quantity, equipment_id, end_of_life, rated_end_of_life, days_remaining, days_short_of_rating,
        previous_lifespan_days, days_until_previous_failure, due_reason, status } = partState(p);
      return { id, name, quantity, equipment_id, end_of_life, rated_end_of_life, days_remaining, days_short_of_rating,
        previous_lifespan_days, days_until_previous_failure, due_reason, status };
    });
    res.json(q.equipment.all().map(e => {
      const own = parts.filter(p => p.equipment_id === e.id);
      const status = own.reduce((worst, p) => URGENCY.indexOf(p.status) > URGENCY.indexOf(worst) ? p.status : worst, 'ok');
      return { ...e, status, parts: own };
    }));
  });

  app.get('/api/orders', (req, res) => {
    res.json(q.allOrders.all());
  });

  app.get('/api/audit', (req, res) => {
    res.json(q.allAudit.all());
  });

  app.get('/api/requests/:id', (req, res) => {
    res.json(requestView(loadRequest(req.params.id)));
  });

  // The replacement procedure that goes with a request, drafted from its part, machine and order.
  app.get('/api/requests/:id/procedure', (req, res) => {
    const view = requestView(loadRequest(req.params.id));
    res.json(buildProcedure(view, q.equipmentById.get(view.part.equipment_id)));
  });

  app.post('/api/requests/:id/orders', (req, res) => {
    const actor = requireActor(req.body);
    const request = loadRequest(req.params.id);
    if (request.status !== 'open') throw new HttpError(409, `cannot order on a request that is ${request.status}`);
    const quote = requestView(request).quotes.find(qt => qt.id === Number(req.body.quote_id));
    if (!quote) throw new HttpError(400, 'quote_id must be a quote on this request');
    const site = text(req.body, 'delivery_site') || DEFAULT_SITE;
    // The order itself was placed on the supplier's site; this records it. Expected delivery
    // defaults to the quote's and can be corrected to what the supplier confirmed.
    const delivery = deliveryDate(req.body, quote.expected_delivery);
    if (delivery < isoDate(now())) throw new HttpError(400, 'expected_delivery cannot be in the past');

    transaction(() => {
      q.insertOrder.run(request.id, quote.id, quote.supplier, quote.quantity, quote.total_gbp, site,
        text(req.body, 'po_reference') || null, text(req.body, 'notes') || null,
        delivery, actor, now().toISOString());
      q.setStatus.run('ordered', request.id);
      q.insertPurchase.run(request.part_id, quote.supplier, quote.unit_price_gbp, quote.quantity, isoDate(now()));
      q.log.run(request.part_id, request.id, 'order recorded', actor, `${quote.supplier}, £${quote.total_gbp.toLocaleString('en-GB')}, due ${delivery}`, now().toISOString());
    });
    res.status(201).json(requestView(loadRequest(request.id)));
  });

  // Closes a request when the part was bought outside this flow, so nobody orders it twice.
  // Records it like an order: supplier and delivery date are required, the total paid is optional.
  // The delivery date may be in the past, since a part bought elsewhere may already have arrived.
  app.post('/api/requests/:id/already-purchased', (req, res) => {
    const actor = requireActor(req.body);
    const request = loadRequest(req.params.id);
    if (request.status !== 'open') throw new HttpError(409, `cannot mark a request that is ${request.status} as purchased`);
    const supplier = text(req.body, 'supplier');
    if (!supplier) throw new HttpError(400, 'supplier is required: who was it bought from?');
    const delivery = deliveryDate(req.body, null);
    const rawTotal = req.body?.total_gbp;
    const total = rawTotal === undefined || rawTotal === null || rawTotal === '' ? null : Number(rawTotal);
    if (total !== null && !(Number.isInteger(total) && total > 0)) throw new HttpError(400, 'total_gbp must be a whole number of pounds above 0');
    const part = q.part.get(request.part_id);

    transaction(() => {
      q.insertOrder.run(request.id, null, supplier, part.quantity, total, DEFAULT_SITE,
        text(req.body, 'po_reference') || null, null, delivery, actor, now().toISOString());
      q.setStatus.run('purchased', request.id);
      // With a price, it becomes the part's last purchase (last price and previous supplier).
      if (total !== null) q.insertPurchase.run(part.id, supplier, Math.round(total / part.quantity), part.quantity, isoDate(now()));
      q.log.run(part.id, request.id, 'marked already purchased', actor,
        `${supplier}${total !== null ? `, £${total.toLocaleString('en-GB')}` : ''}, delivery ${delivery}`, now().toISOString());
    });
    res.json(requestView(loadRequest(request.id)));
  });

  app.post('/api/requests/:id/cancel', (req, res) => {
    const actor = requireActor(req.body);
    const request = loadRequest(req.params.id);
    if (request.status !== 'open') throw new HttpError(409, `cannot cancel a request that is ${request.status}`);
    transaction(() => {
      q.setStatus.run('cancelled', request.id);
      q.log.run(request.part_id, request.id, 'cancelled', actor, null, now().toISOString());
    });
    res.json(requestView(loadRequest(request.id)));
  });

  // Demo only: break a part so the replacement flow can be shown on demand.
  app.post('/api/parts/:id/destroy', (req, res) => {
    const actor = requireActor(req.body);
    const part = q.part.get(Number(req.params.id));
    if (!part) throw new HttpError(404, 'part not found');
    if (part.failed_at) throw new HttpError(409, 'part has already failed');
    transaction(() => {
      q.failPart.run(now().toISOString(), part.id);
      q.log.run(part.id, null, 'destroyed (demo)', actor, `${part.name} on ${part.equipment_id} failed`, now().toISOString());
    });
    res.json(partState(q.part.get(part.id)));
  });

  // Lets reviewers replay the demo from a clean state.
  app.post('/api/demo/reset', (req, res) => {
    transaction(() => reset(db));
    res.status(204).end();
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON body' });
    if (!err.status) console.error(err);
    res.status(err.status ?? 500).json({ error: err.status ? err.message : 'internal error' });
  });

  return app;
}

module.exports = { createApp, lifecycle, DEFAULT_SITE };
