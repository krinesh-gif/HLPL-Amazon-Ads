/**
 * Small RFC-4180-ish CSV reader for uploads: quoted fields, "" escapes, CRLF, a UTF-8 BOM,
 * and comma / semicolon / tab delimiters (auto-detected from the header line).
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.indexOf("\n") === -1 ? src.length : src.indexOf("\n"));
  const delim = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/** "(Child) ASIN" → "childasin", "Sessions - Total" → "sessionstotal". */
export const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/** "₹1,23,456.00", "1,234", "12.5%", "INR 99" → number; blank → null; junk → NaN. */
export function parseNumber(v: string | undefined): number | null {
  if (v == null) return null;
  const s = v.replace(/₹|inr|rs\.?|%|\s/gi, "").replace(/,/g, "");
  if (s === "" || s === "-" || s === "—") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
