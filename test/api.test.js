const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../server/db');
const { createApp, lifecycle } = require('../server/app');

let server, base;

beforeEach(async () => {
  const app = createApp({ db: open(':memory:') });
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
afterEach(() => server.close());

const api = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};
const batteries = async () => (await api('GET', '/api/parts')).body.find(p => p.equipment_id === 'BS-A1');

test('previous lifespan triggers Due before the rated end of life, with a reason', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const part = { installed_on: '2024-01-01', service_life_days: 1500, quantity: 1, spares_on_hand: 0 };
  assert.equal(lifecycle(part, now).status, 'ok');
  assert.equal(lifecycle(part, now).days_until_previous_failure, null);

  const nearing = lifecycle({ ...part, previous_lifespan_days: 760 }, now);
  assert.equal(nearing.days_until_previous_failure, 29);
  assert.equal(nearing.status, 'replace_soon');
  assert.equal(nearing.due_reason, 'previous_service_life');

  const farOff = lifecycle({ ...part, previous_lifespan_days: 1200 }, now);
  assert.equal(farOff.status, 'ok', 'history far in the future only informs');
  assert.equal(farOff.due_reason, null);

  const ratedSooner = lifecycle({ ...part, service_life_days: 750, previous_lifespan_days: 760 }, now);
  assert.equal(ratedSooner.due_reason, 'rated_end_of_life', 'the sooner trigger is the reason');
});

test('lifecycle derives status from install date, service life and spares', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const part = { installed_on: '2025-01-01', service_life_days: 400, quantity: 4, spares_on_hand: 0 };
  assert.equal(lifecycle(part, now).days_remaining, 35);
  assert.equal(lifecycle(part, now).status, 'replace_soon');
  assert.equal(lifecycle({ ...part, spares_on_hand: 4 }, now).status, 'due_spares_on_hand');
  assert.equal(lifecycle({ ...part, service_life_days: 300 }, now).status, 'expired');
  assert.equal(lifecycle({ ...part, service_life_days: 1000 }, now).status, 'ok');
});

test('seeded parts expose computed lifecycle fields', async () => {
  const { body } = await api('GET', '/api/parts');
  assert.deepEqual(body.map(p => p.status), ['replace_soon', 'due_spares_on_hand', 'due_spares_on_hand', 'ok', 'replace_soon', 'ok']);
  assert.equal(body[0].days_remaining, 62);
});

test('full flow: request quotes, then place an order, with audit trail', async () => {
  const part = await batteries();
  const created = await api('POST', `/api/parts/${part.id}/requests`, { actor: 'R. Hosokawa' });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'open');
  assert.equal(created.body.quotes.length, 3);
  const quote = created.body.quotes[1];
  assert.equal(quote.total_gbp, quote.unit_price_gbp * part.quantity);
  assert.equal((await batteries()).open_request.status, 'open');

  const ordered = await api('POST', `/api/requests/${created.body.id}/orders`,
    { actor: 'A. Engineer', quote_id: quote.id, po_reference: 'PO-123', notes: ' weekday delivery ' });
  assert.equal(ordered.status, 201);
  assert.equal(ordered.body.status, 'ordered');
  assert.equal(ordered.body.order.quote_id, quote.id);
  assert.equal(ordered.body.order.total_gbp, quote.total_gbp);
  assert.equal(ordered.body.order.expected_delivery, quote.expected_delivery);
  assert.equal(ordered.body.order.delivery_site, 'Demo Site LHR-1, Hall A');
  assert.equal(ordered.body.order.notes, 'weekday delivery');
  assert.deepEqual(ordered.body.audit.map(a => [a.action, a.actor]), [
    ['quotes requested', 'R. Hosokawa'],
    ['order placed', 'A. Engineer'],
  ]);
});

test('rejects invalid orders and missing actor', async () => {
  const part = await batteries();
  assert.equal((await api('POST', `/api/parts/${part.id}/requests`, {})).status, 400);

  const { body: request } = await api('POST', `/api/parts/${part.id}/requests`, { actor: 'R' });
  assert.equal((await api('POST', `/api/parts/${part.id}/requests`, { actor: 'R' })).status, 409, 'one open request per part');
  assert.equal((await api('POST', `/api/requests/${request.id}/orders`, { actor: 'R', quote_id: 9999 })).status, 400);
  assert.equal((await api('POST', `/api/requests/${request.id}/orders`, { quote_id: request.quotes[0].id })).status, 400);

  await api('POST', `/api/requests/${request.id}/orders`, { actor: 'R', quote_id: request.quotes[0].id });
  assert.equal((await api('POST', `/api/requests/${request.id}/orders`, { actor: 'R', quote_id: request.quotes[0].id })).status, 409, 'cannot order twice');
  assert.equal((await api('POST', `/api/requests/${request.id}/cancel`, { actor: 'R' })).status, 409, 'cannot cancel after ordering');
});

test('any part can be ordered, including ones not yet due', async () => {
  const { body } = await api('GET', '/api/parts');
  const ok = body.find(p => p.status === 'ok');
  const created = await api('POST', `/api/parts/${ok.id}/requests`, { actor: 'R' });
  assert.equal(created.status, 201);
  assert.match(created.body.scope, /^Order 6 × DC capacitor bank/);
});

test('cancelling frees the part for a new request; reset restores seed data', async () => {
  const part = await batteries();
  const { body: draft } = await api('POST', `/api/parts/${part.id}/requests`, { actor: 'R' });
  assert.equal((await api('POST', `/api/requests/${draft.id}/cancel`, { actor: 'R' })).body.status, 'cancelled');
  assert.equal((await batteries()).open_request, null);
  assert.equal((await api('POST', `/api/parts/${part.id}/requests`, { actor: 'R' })).status, 201);

  assert.equal((await api('POST', '/api/demo/reset')).status, 204);
  assert.equal((await batteries()).open_request, null);
  assert.equal((await api('GET', `/api/requests/${draft.id}`)).status, 404);
});

test('quotes show the last purchase price and flag the previous supplier', async () => {
  const part = await batteries();
  const { body: request } = await api('POST', `/api/parts/${part.id}/requests`, { actor: 'R' });
  assert.equal(request.last_purchase.supplier, 'Volta Critical Supply');
  assert.equal(request.last_purchase.unit_price_gbp, 165);
  assert.deepEqual(request.quotes.filter(x => x.previous_supplier).map(x => x.supplier), ['Volta Critical Supply']);
  const volta = request.quotes.find(x => x.previous_supplier);
  assert.equal(volta.change_vs_last_gbp, volta.unit_price_gbp - 165);

  // An order becomes the new last purchase for the part.
  const cellstock = request.quotes.find(x => x.supplier === 'Cellstock Direct');
  await api('POST', `/api/requests/${request.id}/orders`, { actor: 'R', quote_id: cellstock.id });
  const { body: after } = await api('GET', `/api/requests/${request.id}`);
  assert.equal(after.last_purchase.supplier, 'Cellstock Direct');
  assert.equal(after.last_purchase.unit_price_gbp, cellstock.unit_price_gbp);
});

test('already purchased closes the request so it cannot be ordered', async () => {
  const part = await batteries();
  const { body: request } = await api('POST', `/api/parts/${part.id}/requests`, { actor: 'R' });
  assert.equal((await api('POST', `/api/requests/${request.id}/already-purchased`, {})).status, 400);

  const marked = await api('POST', `/api/requests/${request.id}/already-purchased`, { actor: 'R' });
  assert.equal(marked.body.status, 'purchased');
  assert.equal(marked.body.audit.at(-1).action, 'marked already purchased');
  assert.equal((await batteries()).open_request, null);
  assert.equal((await batteries()).last_order.status, 'purchased');
  assert.equal((await api('POST', `/api/requests/${request.id}/orders`, { actor: 'R', quote_id: request.quotes[0].id })).status, 409);
  assert.equal((await api('POST', `/api/parts/${part.id}/requests`, { actor: 'R' })).status, 201, 'can order the part again later');
});

test('orders list and activity log cover every part', async () => {
  const { body: parts } = await api('GET', '/api/parts');
  const { body: batteryRequest } = await api('POST', `/api/parts/${parts[0].id}/requests`, { actor: 'R' });
  await api('POST', `/api/requests/${batteryRequest.id}/orders`, { actor: 'R', quote_id: batteryRequest.quotes[2].id, po_reference: 'PO-1' });
  const { body: fanRequest } = await api('POST', `/api/parts/${parts[1].id}/requests`, { actor: 'S' });
  await api('POST', `/api/requests/${fanRequest.id}/already-purchased`, { actor: 'S' });
  await api('POST', `/api/parts/${parts[2].id}/requests`, { actor: 'T' });

  const { body: orders } = await api('GET', '/api/orders');
  assert.deepEqual(orders.map(o => [o.part, o.source]), [
    ['Fan kit F-210', 'purchased_elsewhere'],
    ['VRLA jars BS-12', 'ordered'],
  ]);
  assert.equal(orders[1].supplier, batteryRequest.quotes[2].supplier);
  assert.equal(orders[1].po_reference, 'PO-1');

  const { body: audit } = await api('GET', '/api/audit');
  assert.deepEqual(audit.map(a => [a.part, a.action]), [
    ['Air filters G4', 'quotes requested'],
    ['Fan kit F-210', 'marked already purchased'],
    ['Fan kit F-210', 'quotes requested'],
    ['VRLA jars BS-12', 'order placed'],
    ['VRLA jars BS-12', 'quotes requested'],
  ]);
});

test('equipment groups its parts and reports the most urgent status', async () => {
  const { body } = await api('GET', '/api/equipment');
  const byId = Object.fromEntries(body.map(e => [e.id, e]));
  assert.deepEqual(Object.keys(byId).sort(), ['BS-A1', 'CRAH-3', 'GEN-1', 'UPS-A']);
  assert.equal(byId['BS-A1'].status, 'replace_soon');
  assert.equal(byId['CRAH-3'].status, 'due_spares_on_hand');
  assert.equal(byId['UPS-A'].status, 'ok');
  assert.deepEqual(byId['GEN-1'].parts.map(p => p.name), ['Starter batteries 24V', 'Fuel filters']);
});

test('ordering or buying a due part resolves it; ok parts keep their status', async () => {
  const part = await batteries();
  const { body: request } = await api('POST', `/api/parts/${part.id}/requests`, { actor: 'R' });
  assert.equal((await batteries()).status, 'replace_soon', 'requesting quotes alone does not resolve it');

  await api('POST', `/api/requests/${request.id}/orders`, { actor: 'R', quote_id: request.quotes[0].id });
  const after = await batteries();
  assert.equal(after.status, 'replacement_ordered');
  assert.equal(after.lifecycle_status, 'replace_soon');
  assert.equal(after.last_order.status, 'ordered');

  const { body: equipment } = await api('GET', '/api/equipment');
  assert.equal(equipment.find(e => e.id === 'BS-A1').status, 'replacement_ordered');

  const { body: parts } = await api('GET', '/api/parts');
  const starter = parts.find(p => p.name === 'Starter batteries 24V');
  const { body: starterRequest } = await api('POST', `/api/parts/${starter.id}/requests`, { actor: 'R' });
  await api('POST', `/api/requests/${starterRequest.id}/already-purchased`, { actor: 'R' });
  assert.equal((await api('GET', '/api/parts')).body.find(p => p.id === starter.id).status, 'replacement_ordered');

  const healthy = parts.find(p => p.status === 'ok');
  const { body: healthyRequest } = await api('POST', `/api/parts/${healthy.id}/requests`, { actor: 'R' });
  await api('POST', `/api/requests/${healthyRequest.id}/orders`, { actor: 'R', quote_id: healthyRequest.quotes[0].id });
  assert.equal((await api('GET', '/api/parts')).body.find(p => p.id === healthy.id).status, 'ok');
});

test('destroying a part marks it failed until a replacement is ordered', async () => {
  const { body: parts } = await api('GET', '/api/parts');
  const fan = parts.find(p => p.name === 'Fan kit F-210');
  assert.equal((await api('POST', `/api/parts/${fan.id}/destroy`, {})).status, 400, 'needs an actor');

  const destroyed = await api('POST', `/api/parts/${fan.id}/destroy`, { actor: 'R' });
  assert.equal(destroyed.body.status, 'failed');
  assert.equal(destroyed.body.end_of_life, new Date().toISOString().slice(0, 10), 'end of life moves to the failure date');
  assert.equal(destroyed.body.days_remaining, 0);
  assert.equal(destroyed.body.rated_end_of_life, fan.end_of_life, 'rated end of life is kept');
  assert.equal(destroyed.body.days_short_of_rating, fan.days_remaining);
  assert.equal((await api('POST', `/api/parts/${fan.id}/destroy`, { actor: 'R' })).status, 409, 'cannot destroy twice');

  const { body: equipment } = await api('GET', '/api/equipment');
  assert.equal(equipment.find(e => e.id === 'CRAH-3').status, 'failed');
  const { body: audit } = await api('GET', '/api/audit');
  assert.deepEqual([audit[0].action, audit[0].part, audit[0].request_id], ['destroyed (demo)', 'Fan kit F-210', null]);

  const { body: request } = await api('POST', `/api/parts/${fan.id}/requests`, { actor: 'R' });
  assert.match(request.scope, /^Replace failed 1 × Fan kit F-210/);
  await api('POST', `/api/requests/${request.id}/orders`, { actor: 'R', quote_id: request.quotes[0].id });
  assert.equal((await api('GET', '/api/parts')).body.find(p => p.id === fan.id).status, 'replacement_ordered');

  await api('POST', '/api/demo/reset');
  assert.equal((await api('GET', '/api/parts')).body.find(p => p.name === 'Fan kit F-210').status, fan.status, 'reset restores it');
});

test('seeded fan kit is due because it is nearing the age the last one failed at', async () => {
  const { body } = await api('GET', '/api/parts');
  const fan = body.find(p => p.name === 'Fan kit F-210');
  assert.equal(fan.status, 'due_spares_on_hand');
  assert.equal(fan.due_reason, 'previous_service_life');
  assert.equal(fan.days_until_previous_failure, 30);
  const { body: request } = await api('POST', `/api/parts/${fan.id}/requests`, { actor: 'R' });
  assert.match(request.scope, /age the previous unit failed at \(700 days\)/);

  const ups = body.find(p => p.name === 'DC capacitor bank');
  assert.equal(ups.status, 'ok');
  assert.equal(ups.days_until_previous_failure, 445);
});
