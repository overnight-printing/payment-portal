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
