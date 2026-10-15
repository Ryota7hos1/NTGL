const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recommend } = require('../server/recommend');

const now = new Date('2026-01-01T00:00:00Z');
const quote = (id, lead, total, match) => ({
  id, lead_time_days: lead, total_gbp: total, match,
  expected_delivery: new Date(now.getTime() + lead * 86400000).toISOString().slice(0, 10),
});
const quotes = [
  quote(1, 21, 8000, 'exact'),      // slow, mid price, exact
  quote(2, 3, 9500, 'exact'),       // fast, expensive, exact
  quote(3, 5, 5000, 'equivalent'),  // fast, cheap, not exact
];
const winner = part => recommend(part, quotes, now).ranked[0].quote_id;

test('a failed part prioritises delivery speed', () => {
  assert.equal(winner({ status: 'failed', end_of_life: '2026-01-01' }), 2);
});

test('a planned purchase prioritises exact match and price', () => {
  assert.equal(winner({ status: 'ok', end_of_life: '2027-06-01', due_reason: null }), 1);
});

test('a due part needs delivery before its needed-by date', () => {
  // Needed in 10 days: the 21-day quote misses it and drops behind the exact part that arrives in time.
  const result = recommend({ status: 'replace_soon', due_reason: 'rated_end_of_life', end_of_life: '2026-01-11' }, quotes, now);
  assert.equal(result.need.needed_by, '2026-01-11');
  assert.equal(result.ranked[0].quote_id, 2);
  const slow = result.ranked.find(r => r.quote_id === 1);
  assert.equal(slow.on_time, false);
  assert.equal(slow.factors.delivery, 0);
  assert.match(slow.reasons[0], /after it is needed/);
});

test('previous-lifespan due date is used as the needed-by date', () => {
  const result = recommend({ status: 'due_spares_on_hand', due_reason: 'previous_service_life', days_until_previous_failure: 30, end_of_life: '2027-12-01' }, quotes, now);
  assert.equal(result.need.needed_by, '2026-01-31');
});

test('exact matches beat equivalents when everything else is equal', () => {
  const tie = [quote(1, 7, 5000, 'equivalent'), quote(2, 7, 5000, 'exact')];
  assert.equal(recommend({ status: 'ok', end_of_life: '2027-01-01' }, tie, now).ranked[0].quote_id, 2);
});

test('every ranked quote explains itself', () => {
  for (const r of recommend({ status: 'failed', end_of_life: '2026-01-01' }, quotes, now).ranked) {
    assert.equal(r.reasons.length, 3);
    assert.ok(r.score >= 0 && r.score <= 100);
  }
});

const due = { status: 'replace_soon', due_reason: 'rated_end_of_life', end_of_life: '2028-01-01' };

test('on-time deliveries score the same however fast they are', () => {
  const result = recommend(due, [quote(1, 4, 5000, 'exact'), quote(2, 30, 5000, 'exact')], now);
  assert.deepEqual(result.ranked.map(r => r.factors.delivery), [1, 1]);
  assert.equal(result.ranked[0].score, result.ranked[1].score);
});

test('a slower on-time delivery wins on price', () => {
  // 30 days vs 4 days is under 10x and under a year longer, so the cheaper slow quote ranks first.
  const result = recommend(due, [quote(1, 4, 6000, 'exact'), quote(2, 30, 5000, 'exact')], now);
  assert.equal(result.ranked[0].quote_id, 2);
});

test('lead time alone does not count: 2 days vs 21 days are both comfortably before end of life', () => {
  const result = recommend(due, [quote(1, 2, 6000, 'exact'), quote(2, 21, 5000, 'exact')], now);
  assert.deepEqual(result.ranked.map(r => r.factors.delivery), [1, 1]);
  assert.equal(result.ranked[0].quote_id, 2, 'cheaper wins');
});

test('a margin of a tenth or less of the best other margin counts against it', () => {
  // Needed in 60 days: arriving in 3 days leaves 57 days, arriving in 55 days leaves only 5.
  const tight = { status: 'replace_soon', due_reason: 'rated_end_of_life', end_of_life: '2026-03-02' };
  const result = recommend(tight, [quote(1, 3, 6000, 'exact'), quote(2, 55, 5000, 'exact'), quote(3, 5, 7000, 'exact')], now);
  const close = result.ranked.find(r => r.quote_id === 2);
  assert.equal(close.factors.delivery, 0);
  assert.match(close.reasons[0], /only 5 days before it is needed; others leave up to 57 days/);
  assert.equal(result.ranked[0].quote_id, 1);
});

test('a margin more than a year smaller than the best other margin counts against it', () => {
  const planned = { status: 'ok', end_of_life: '2030-01-01' };
  const result = recommend(planned, [quote(1, 60, 6000, 'exact'), quote(2, 430, 5000, 'exact')], now);
  assert.equal(result.ranked.find(r => r.quote_id === 2).factors.delivery, 0);
  // 240 days less margin out of ~1400 is neither a year nor 10x: still neutral.
  const close = recommend(planned, [quote(1, 60, 6000, 'exact'), quote(2, 300, 5000, 'exact')], now);
  assert.equal(close.ranked.find(r => r.quote_id === 2).factors.delivery, 1);
});

test('a failed part still ranks purely on speed', () => {
  const result = recommend({ status: 'failed', end_of_life: '2026-01-01' }, [quote(1, 4, 9000, 'exact'), quote(2, 30, 5000, 'exact')], now);
  assert.equal(result.ranked[0].quote_id, 1);
});

test('among exact, on-time quotes with no one cutting it close, the cheapest wins', () => {
  // Needed in a year: all three arrive with plenty of margin, so only price separates them.
  const exactOnTime = [quote(1, 2, 9600, 'exact'), quote(2, 21, 8400, 'exact'), quote(3, 14, 7200, 'exact')];
  for (const part of [due, { status: 'ok', end_of_life: '2027-01-01' }]) {
    assert.deepEqual(recommend(part, exactOnTime, now).ranked.map(r => r.quote_id), [3, 2, 1]);
  }
});

test('a price difference too small to change the rounded score still decides the order', () => {
  const nearTie = [quote(1, 2, 10000, 'exact'), quote(2, 21, 9999, 'exact'), quote(3, 14, 5000, 'equivalent')];
  const ranked = recommend(due, nearTie, now).ranked;
  assert.equal(ranked[0].score, ranked[1].score);
  assert.equal(ranked[0].quote_id, 2, 'the £1 cheaper exact quote wins, not the faster one');
});
