/**
 * Amazon's v3 reporting API caps one report at 31 days. Splits "the last N days"
 * (ending yesterday — today is still incomplete) into consecutive windows of at most 31 days.
 */
export function reportWindows(daysBack: number, maxDays = 31): { start: string; end: string }[] {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (daysBack - 1));

  const windows: { start: string; end: string }[] = [];
  for (let s = new Date(start); s <= end; ) {
    const e = new Date(s);
    e.setUTCDate(e.getUTCDate() + maxDays - 1);
    const wEnd = e < end ? e : end;
    windows.push({ start: fmt(s), end: fmt(wEnd) });
    s = new Date(wEnd);
    s.setUTCDate(s.getUTCDate() + 1);
  }
  return windows;
}
