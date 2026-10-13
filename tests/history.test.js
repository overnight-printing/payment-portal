import test from 'node:test';
import assert from 'node:assert/strict';
import { historyRange } from '../src/lib/history.js';
import { dashboardQuery } from '../shared/validation.js';

test('recent history uses 30 inclusive Seattle calendar dates across midnight, DST and year boundaries', () => {
  for (const [now, start, end] of [
    ['2026-10-13T01:00:00Z', '2026-09-13', '2026-10-12'],
    ['2026-10-13T07:00:00Z', '2026-09-14', '2026-10-13'],
    ['2026-03-09T06:59:59Z', '2026-02-07', '2026-03-08'],
    ['2026-11-02T07:59:59Z', '2026-10-03', '2026-11-01'],
    ['2026-01-01T08:00:00Z', '2025-12-03', '2026-01-01'],
    ['2028-03-01T08:00:00Z', '2028-02-01', '2028-03-01'],
  ]) assert.deepEqual(historyRange(new URLSearchParams(), new Date(now)), { mode: '30', start, end });
});

test('all-time, explicit custom and open date URLs reuse bounded dashboard queries', () => {
  const now = new Date('2026-10-13T18:00:00Z');
  assert.deepEqual(historyRange(new URLSearchParams('range=all&start=2026-01-01'), now), { mode: 'all', start: '', end: '' });
  for (const query of ['start=2026-01-01&end=2026-01-31', 'range=custom&start=2026-01-01&end=2026-01-31']) {
    assert.deepEqual(historyRange(new URLSearchParams(query), now), { mode: 'custom', start: '2026-01-01', end: '2026-01-31' });
  }
  assert.deepEqual(historyRange(new URLSearchParams('end=2026-01-31'), now), { mode: 'custom', start: '', end: '2026-01-31' });
  assert.deepEqual(historyRange(new URLSearchParams('range=custom'), now), { mode: 'custom', start: '', end: '' });
  assert.equal(historyRange(new URLSearchParams('range=30&start=2026-01-01'), now).start, '2026-09-14');
  const { start, end } = historyRange(new URLSearchParams(), now);
  for (const limit of [10, 25, 50]) {
    const query = dashboardQuery(new URLSearchParams({ start, end, limit: String(limit), offset: String(limit) }));
    assert.equal(query.start, start); assert.equal(query.end, end); assert.equal(query.limit, limit); assert.equal(query.offset, limit);
  }
  for (const value of ['start=2026-02-30', 'start=2026-10-13&end=2026-01-01']) {
    const { start, end } = historyRange(new URLSearchParams(value), now);
    assert.equal(dashboardQuery(new URLSearchParams({ start, end })), null);
  }
});
