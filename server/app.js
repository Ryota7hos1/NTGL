const express = require('express');
const path = require('node:path');
const { reset } = require('./db');

const DAY = 86400000;
const WARN_DAYS = 90;

// Site documents cited as evidence on a request, by equipment.
const EVIDENCE = {
  'BS-A1': ['BAT-DS rev 2', 'SLD-101 rev C'],
  'CRAH-3': ['CRAH-3 O&M manual rev 1'],
};

// Simulated supplier responses, created when a request is sent. Prices are illustrative.
const BID_TEMPLATES = [
  { supplier: 'Supplier A', included: 'Supply, install, disposal', excluded: 'Load bank test', lead_time_days: 21, unit: 210 },
  { supplier: 'Supplier B', included: 'Supply, install', excluded: 'Disposal, testing', lead_time_days: 14, unit: 180 },
  { supplier: 'Supplier C', included: 'Supply only', excluded: 'Install, disposal', lead_time_days: 5, unit: 140 },
];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// End of life and replacement status are derived from install date and service life, never stored.
function lifecycle(part, now) {
  const endOfLife = new Date(Date.parse(part.installed_on) + part.service_life_days * DAY);
  const daysRemaining = Math.ceil((endOfLife - now) / DAY);
  let status = 'ok';
  if (daysRemaining < 0) status = 'expired';
  else if (daysRemaining <= WARN_DAYS) status = part.spares_on_hand >= part.quantity ? 'due_spares_on_hand' : 'replace_soon';
  return { end_of_life: endOfLife.toISOString().slice(0, 10), days_remaining: daysRemaining, status };
}

function createApp({ db, now = () => new Date() }) {
  const app = express();
  app.use(express.json());

  const q = {
    parts: db.prepare('SELECT * FROM parts ORDER BY id'),
    part: db.prepare('SELECT * FROM parts WHERE id = ?'),
    openRequest: db.prepare(`SELECT id, status FROM supplier_requests WHERE part_id = ? AND status IN ('draft','sent','awarded') ORDER BY id DESC LIMIT 1`),
    request: db.prepare('SELECT * FROM supplier_requests WHERE id = ?'),
    insertRequest: db.prepare(`INSERT INTO supplier_requests (part_id, scope, evidence, status, created_at) VALUES (?, ?, ?, 'draft', ?)`),
    setStatus: db.prepare('UPDATE supplier_requests SET status = ? WHERE id = ?'),
    bids: db.prepare('SELECT * FROM bids WHERE request_id = ? ORDER BY id'),
    insertBid: db.prepare('INSERT INTO bids (request_id, supplier, included, excluded, lead_time_days, price_gbp) VALUES (?, ?, ?, ?, ?, ?)'),
    awardBid: db.prepare('UPDATE bids SET awarded = 1 WHERE id = ? AND request_id = ?'),
    audit: db.prepare('SELECT action, actor, detail, at FROM audit_log WHERE request_id = ? ORDER BY id'),
    log: db.prepare('INSERT INTO audit_log (request_id, action, actor, detail, at) VALUES (?, ?, ?, ?, ?)'),
  };

  const transaction = fn => {
    db.exec('BEGIN');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (err) { db.exec('ROLLBACK'); throw err; }
  };

  const requireActor = body => {
    const actor = typeof body?.actor === 'string' ? body.actor.trim() : '';
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
    return {
      ...request,
      evidence: JSON.parse(request.evidence),
      part: { ...part, ...lifecycle(part, now()) },
      bids: q.bids.all(request.id).map(b => ({ ...b, awarded: Boolean(b.awarded) })),
      audit: q.audit.all(request.id),
    };
  };

  app.get('/api/parts', (req, res) => {
    res.json(q.parts.all().map(p => ({ ...p, ...lifecycle(p, now()), open_request: q.openRequest.get(p.id) ?? null })));
  });

  app.post('/api/parts/:id/requests', (req, res) => {
    const actor = requireActor(req.body);
    const part = q.part.get(Number(req.params.id));
    if (!part) throw new HttpError(404, 'part not found');
    const { status } = lifecycle(part, now());
    if (status !== 'replace_soon' && status !== 'expired') throw new HttpError(409, `part does not need a supplier request (status: ${status})`);
    if (q.openRequest.get(part.id)) throw new HttpError(409, 'part already has an open request');

    const id = transaction(() => {
      const scope = `Replace ${part.quantity} × ${part.name} on ${part.equipment_id} before end of service life.`;
      const evidence = JSON.stringify(EVIDENCE[part.equipment_id] ?? []);
      const { lastInsertRowid } = q.insertRequest.run(part.id, scope, evidence, now().toISOString());
      q.log.run(lastInsertRowid, 'drafted', actor, null, now().toISOString());
      return lastInsertRowid;
    });
    res.status(201).json(requestView(loadRequest(id)));
  });

  app.get('/api/requests/:id', (req, res) => {
    res.json(requestView(loadRequest(req.params.id)));
  });

  app.post('/api/requests/:id/send', (req, res) => {
    const actor = requireActor(req.body);
    const request = loadRequest(req.params.id);
    if (request.status !== 'draft') throw new HttpError(409, `only a draft can be sent (status: ${request.status})`);
    const part = q.part.get(request.part_id);

    transaction(() => {
      q.setStatus.run('sent', request.id);
      q.log.run(request.id, 'approved and sent', actor, `${BID_TEMPLATES.length} suppliers`, now().toISOString());
      for (const t of BID_TEMPLATES) {
        q.insertBid.run(request.id, t.supplier, t.included, t.excluded, t.lead_time_days, t.unit * part.quantity);
      }
    });
    res.json(requestView(loadRequest(request.id)));
  });

  app.post('/api/requests/:id/award', (req, res) => {
    const actor = requireActor(req.body);
    const request = loadRequest(req.params.id);
    if (request.status !== 'sent') throw new HttpError(409, `only a sent request can be awarded (status: ${request.status})`);
    const bid = q.bids.all(request.id).find(b => b.id === Number(req.body.bid_id));
    if (!bid) throw new HttpError(400, 'bid_id must be a bid on this request');

    transaction(() => {
      q.awardBid.run(bid.id, request.id);
      q.setStatus.run('awarded', request.id);
      q.log.run(request.id, 'awarded', actor, `${bid.supplier}, £${bid.price_gbp.toLocaleString('en-GB')}`, now().toISOString());
    });
    res.json(requestView(loadRequest(request.id)));
  });

  app.post('/api/requests/:id/cancel', (req, res) => {
    const actor = requireActor(req.body);
    const request = loadRequest(req.params.id);
    if (request.status === 'awarded' || request.status === 'cancelled') throw new HttpError(409, `cannot cancel a request that is ${request.status}`);
    transaction(() => {
      q.setStatus.run('cancelled', request.id);
      q.log.run(request.id, 'cancelled', actor, null, now().toISOString());
    });
    res.json(requestView(loadRequest(request.id)));
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

module.exports = { createApp, lifecycle };
