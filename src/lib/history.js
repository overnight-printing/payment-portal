export function historyRange(params, now = new Date()) {
  if (params.get('range') === 'all') return { mode: 'all', start: '', end: '' };
  if (params.get('range') !== '30' && (params.get('range') === 'custom' || params.has('start') || params.has('end'))) {
    return { mode: 'custom', start: params.get('start') || '', end: params.get('end') || '' };
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(({ type, value }) => [type, value]));
  const end = `${parts.year}-${parts.month}-${parts.day}`;
  // Subtract calendar days rather than Seattle hours across daylight-saving changes.
  const start = new Date(`${end}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 29);
  return { mode: '30', start: start.toISOString().slice(0, 10), end };
}

export function paginationPages(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const first = Math.max(2, Math.min(current - 1, total - 3));
  const last = first + 2;
  return [1, ...(first > 2 ? ['…'] : []), first, first + 1, last, ...(last < total - 1 ? ['…'] : []), total];
}
