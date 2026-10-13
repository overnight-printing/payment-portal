import test from 'node:test';
import assert from 'node:assert/strict';
import { historyRange, paginationPages } from '../src/lib/history.js';
import { dashboardQuery } from '../shared/validation.js';

test('numbered pagination keeps small lists complete and large lists bounded with the current page and endpoints', () => {
  assert.deepEqual(paginationPages(1, 1), [1]);
  assert.deepEqual(paginationPages(3, 4), [1, 2, 3, 4]);
  assert.deepEqual(paginationPages(1, 10), [1, 2, 3, 4, '…', 10]);
  assert.deepEqual(paginationPages(5, 10), [1, '…', 4, 5, 6, '…', 10]);
  assert.deepEqual(paginationPages(10, 10), [1, '…', 7, 8, 9, 10]);
  for (const total of [7, 8, 40, 10001]) {
    for (const current of [1, 2, Math.ceil(total / 2), total - 1, total]) {
      const pages = paginationPages(current, total), numbers = pages.filter(Number.isInteger);
      assert(pages.length <= 7); assert(numbers.includes(current));
      assert.equal(numbers[0], 1); assert.equal(numbers.at(-1), total);
      assert.deepEqual(numbers, [...new Set(numbers)].sort((a, b) => a - b));
    }
  }
});

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
