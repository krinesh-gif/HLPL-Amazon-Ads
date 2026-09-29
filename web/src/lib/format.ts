const intFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const dec = (d: number) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Indian-style compact: 1.2K, 3.4L (lakh), 1.1Cr (crore). */
function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e7) return `${trim(n / 1e7)}Cr`;
  if (a >= 1e5) return `${trim(n / 1e5)}L`;
  if (a >= 1e3) return `${trim(n / 1e3)}K`;
  return intFmt.format(n);
}
const trim = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2)).replace(/\.?0+$/, "");

export const DASH = "—";

export function fmtINR(v: number | null | undefined, compactForm = false, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  return `₹${compactForm ? compact(v) : digits ? dec(digits).format(v) : intFmt.format(v)}`;
}
export function fmtCount(v: number | null | undefined, compactForm = false): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  return compactForm ? compact(v) : intFmt.format(v);
}
export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  return `${(v * 100).toFixed(digits)}%`;
}
export function fmtRatio(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  return `${v.toFixed(2)}×`;
}
export function fmtChange(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  const pct = v * 100;
  return `${pct > 0 ? "+" : ""}${Math.abs(pct) >= 100 ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtDay(iso: string, withYear = false): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
}
export function fmtRange(from: string, to: string): string {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${fmtDay(from, !sameYear)} – ${fmtDay(to, true)}`;
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
