import type { Range } from "./types";

const DAY = 86_400_000;
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => iso(new Date(parse(s).getTime() + n * DAY));
export const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / DAY) + 1;

export type PresetKey = "7d" | "14d" | "30d" | "60d" | "90d" | "mtd" | "lastMonth" | "custom";

export const PRESETS: { key: Exclude<PresetKey, "custom">; label: string }[] = [
  { key: "7d", label: "Last 7 days" },
  { key: "14d", label: "Last 14 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "60d", label: "Last 60 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "mtd", label: "Month to date" },
  { key: "lastMonth", label: "Last month" },
];

/** Presets are anchored to the latest day that has data, not "today" — a stale sync shouldn't show an empty chart. */
export function presetRange(key: Exclude<PresetKey, "custom">, anchor: string): Range {
  const n = { "7d": 7, "14d": 14, "30d": 30, "60d": 60, "90d": 90 }[key as "7d"];
  if (n) return { from: addDays(anchor, -(n - 1)), to: anchor };
  if (key === "mtd") return { from: `${anchor.slice(0, 7)}-01`, to: anchor };
  const firstThis = parse(`${anchor.slice(0, 7)}-01`);
  const lastPrev = new Date(firstThis.getTime() - DAY);
  return { from: `${iso(lastPrev).slice(0, 7)}-01`, to: iso(lastPrev) };
}

export function matchPreset(r: Range, anchor: string): PresetKey {
  for (const p of PRESETS) {
    const pr = presetRange(p.key, anchor);
    if (pr.from === r.from && pr.to === r.to) return p.key;
  }
  return "custom";
}

export function yesterday(): string {
  return iso(new Date(Date.now() - DAY));
}
