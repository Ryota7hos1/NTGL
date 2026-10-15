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
  assert.deepEqual(body.map(p => p.status), ['replace_soon', 'ok', 'due_spares_on_hand']);
  assert.equal(body[0].days_remaining, 62);
});

test('full flow: draft, send, award, with audit trail', async () => {
  const part = await batteries();
  const draft = await api('POST', `/api/parts/${part.id}/requests`, { actor: 'R. Hosokawa' });
  assert.equal(draft.status, 201);
  assert.equal(draft.body.status, 'draft');
  assert.deepEqual(draft.body.bids, []);

  const sent = await api('POST', `/api/requests/${draft.body.id}/send`, { actor: 'A. Engineer' });
  assert.equal(sent.body.status, 'sent');
  assert.equal(sent.body.bids.length, 3);

  const bid = sent.body.bids[1];
  const awarded = await api('POST', `/api/requests/${draft.body.id}/award`, { actor: 'A. Engineer', bid_id: bid.id });
  assert.equal(awarded.body.status, 'awarded');
  assert.equal(awarded.body.bids.find(b => b.awarded).id, bid.id);
  assert.deepEqual(awarded.body.audit.map(a => [a.action, a.actor]), [
    ['drafted', 'R. Hosokawa'],
    ['approved and sent', 'A. Engineer'],
    ['awarded', 'A. Engineer'],
  ]);
});

test('rejects invalid transitions and missing actor', async () => {
  const part = await batteries();
  assert.equal((await api('POST', `/api/parts/${part.id}/requests`, {})).status, 400);

  const { body: draft } = await api('POST', `/api/parts/${part.id}/requests`, { actor: 'R' });
  assert.equal((await api('POST', `/api/parts/${part.id}/requests`, { actor: 'R' })).status, 409, 'one open request per part');
  assert.equal((await api('POST', `/api/requests/${draft.id}/award`, { actor: 'R', bid_id: 1 })).status, 409, 'cannot award a draft');

  await api('POST', `/api/requests/${draft.id}/send`, { actor: 'R' });
  assert.equal((await api('POST', `/api/requests/${draft.id}/send`, { actor: 'R' })).status, 409, 'cannot send twice');
  assert.equal((await api('POST', `/api/requests/${draft.id}/award`, { actor: 'R', bid_id: 9999 })).status, 400);
});

test('parts that do not need replacing cannot get a request', async () => {
  const { body } = await api('GET', '/api/parts');
  const ok = body.find(p => p.status === 'ok');
  assert.equal((await api('POST', `/api/parts/${ok.id}/requests`, { actor: 'R' })).status, 409);
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
