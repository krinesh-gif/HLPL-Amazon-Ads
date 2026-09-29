/**
 * Demo-only: invents a keyword/target/search-term structure under each fake campaign and
 * splits each campaign-day's totals down to targets and search terms, so every level of
 * the dashboard adds up exactly like real Amazon data does.
 */

export interface DemoTerm {
  term: string;
  w: number; // share of traffic
  conv: number; // conversion multiplier vs the parent's average
}
export interface DemoTarget {
  id: string;
  kind: "keyword" | "product" | "auto";
  text: string;
  matchType: "exact" | "phrase" | "broad" | null;
  bid: number | null;
  w: number;
  conv: number;
  cpcm: number;
  terms: DemoTerm[];
}

type Rand = () => number;

const PRODUCT_TERMS: Record<string, string[]> = {
  "onion hair oil": ["onion oil for hair growth", "red onion hair oil", "onion hair oil for hair fall", "organic onion hair oil", "onion hair oil for women", "onion oil 200ml"],
  "rosemary hair oil": ["rosemary oil for hair growth", "rosemary water for hair", "rosemary hair oil for women", "pure rosemary oil", "rosemary oil hair regrowth"],
  "vitamin c serum": ["vitamin c face serum", "vitamin c serum for glowing skin", "vit c serum for pigmentation", "vitamin c serum for oily skin", "face serum for dark spots"],
  "niacinamide serum": ["niacinamide 10 serum", "niacinamide serum for acne marks", "face serum for open pores", "niacinamide zinc serum"],
  "kumkumadi oil": ["kumkumadi tailam", "kumkumadi face oil", "ayurvedic face oil", "kumkumadi oil for glowing skin"],
  "aloe vera gel": ["aloe vera gel for face", "pure aloe vera gel", "aloe vera gel for hair", "aloe gel organic"],
  "ubtan face wash": ["ubtan face wash for tan removal", "haldi face wash", "ubtan face wash for glowing skin", "tan removal face wash"],
  "red onion shampoo": ["onion shampoo for hair fall", "red onion shampoo", "sulphate free onion shampoo", "hair fall shampoo"],
  "sunscreen spf 50": ["sunscreen spf 50 for oily skin", "sunscreen for face", "matte sunscreen", "sunscreen gel spf 50 pa++++"],
  "bhringraj oil": ["bhringraj hair oil", "bhringraj oil for hair growth", "ayurvedic hair oil"],
  "hair care combo": ["hair oil and shampoo combo", "hair care kit", "onion hair care combo"],
  "hair oils": ["hair oil for hair growth", "best hair oil", "hair oil for dandruff", "hair fall control oil"],
  aravi: ["aravi", "aravi organic", "aravi onion hair oil", "aravi hair oil", "aravi serum"],
};
// Irrelevant traffic every discovery campaign picks up — the negative-keyword candidates.
const JUNK = ["free hair oil sample", "hair oil for men under 100", "onion", "coconut oil", "mustard oil 1 litre", "face wash for men"];
const AUTO_GROUPS = ["close-match", "loose-match", "substitutes", "complements"];

let idSeq = 400000000000000;
const nextId = () => String((idSeq += 104729));
const asin = (rand: Rand) => "b0" + Array.from({ length: 8 }, () => "0123456789abcdefghjkmnpqrstvwxyz"[Math.floor(rand() * 32)]).join("");

function termsFor(product: string, rand: Rand, withJunk: boolean, withAsins: boolean): DemoTerm[] {
  const pool = [product, ...(PRODUCT_TERMS[product] ?? [])];
  const terms: DemoTerm[] = pool.map((term, i) => ({
    term,
    w: i === 0 ? 3 : 0.6 + rand() * 1.4,
    // A couple of long-tail terms convert much better — the harvest candidates.
    conv: i === 0 ? 1.1 : i % 3 === 1 ? 1.6 : 0.5 + rand() * 0.8,
  }));
  if (withJunk) {
    for (let k = 0; k < 2; k++) terms.push({ term: JUNK[Math.floor(rand() * JUNK.length)], w: 0.5 + rand(), conv: 0 });
  }
  if (withAsins) for (let k = 0; k < 3; k++) terms.push({ term: asin(rand), w: 0.4 + rand() * 0.6, conv: k === 0 ? 1.5 : 0.4 });
  // de-dupe (junk picks can repeat)
  return terms.filter((t, i) => terms.findIndex((x) => x.term === t.term) === i);
}

/** Builds the ad-group contents for a campaign from its name ("SP | Product | Type"). */
export function buildDemoTargets(campaignName: string, cpc: number, rand: Rand): DemoTarget[] {
  const [, productRaw = "", typeRaw = ""] = campaignName.split("|").map((s) => s.trim());
  const product = productRaw.toLowerCase().replace(/^competitor asin$/, "hair oils").replace(/^brand defense$/, "aravi");
  const type = typeRaw.toLowerCase();
  const bid = (m: number) => Math.round(cpc * m * 1.25 * 100) / 100;
  const variants = [...new Set([product, ...(PRODUCT_TERMS[product] ?? [])])];

  if (campaignName.includes("Competitor ASIN")) {
    return [0, 1, 2].map((i) => {
      const a = asin(rand);
      return { id: nextId(), kind: "product", text: `asin="${a.toUpperCase()}"`, matchType: null, bid: bid(1),
        w: 1 + rand(), conv: i === 0 ? 1.8 : 0.5, cpcm: 1, terms: [{ term: a, w: 1, conv: 1 }] };
    });
  }
  if (type === "auto") {
    return AUTO_GROUPS.map((g, i) => ({
      id: nextId(), kind: "auto", text: g, matchType: null, bid: i < 2 ? null : bid(0.8),
      w: [3, 1.5, 1, 0.6][i], conv: [1.2, 0.8, 1, 0.6][i], cpcm: [1.1, 0.9, 1, 0.8][i],
      terms: termsFor(product, rand, i === 1, i >= 2),
    }));
  }
  const match = (type.includes("exact") || type === "aravi" ? "exact" : type.includes("phrase") ? "phrase" : "broad") as DemoTarget["matchType"];
  const count = match === "exact" ? 3 : 2;
  return variants.slice(0, count).map((text, i) => ({
    id: nextId(), kind: "keyword", text, matchType: match, bid: bid(i === 0 ? 1.1 : 0.9),
    w: i === 0 ? 3 : 1, conv: i === 0 ? 1 : 0.8 + rand() * 0.6, cpcm: i === 0 ? 1.1 : 0.9,
    terms: match === "exact"
      ? [{ term: text, w: 1, conv: 1 }]
      : termsFor(product, rand, true, false).filter((t) => match === "broad" || t.term.includes(text.split(" ")[0]) || t.conv === 0),
  }));
}

/** Integer split of `n` units by weight (multinomial draws; proportional for large n). */
export function splitInt(n: number, weights: number[], rand: Rand): number[] {
  const out = weights.map(() => 0);
  const total = weights.reduce((a, b) => a + b, 0);
  if (n <= 0 || total <= 0) return out;
  if (n > 5000) {
    let left = n;
    weights.forEach((w, i) => { if (i < weights.length - 1) { out[i] = Math.round((n * w) / total); left -= out[i]; } });
    out[weights.length - 1] = Math.max(0, left);
    return out;
  }
  for (let k = 0; k < n; k++) {
    let r = rand() * total;
    let i = 0;
    while (r > weights[i] && i < weights.length - 1) r -= weights[i++];
    out[i]++;
  }
  return out;
}

export interface DayTotals {
  impressions: number;
  clicks: number;
  cost: number;
  sales: number;
  orders: number;
}

/**
 * Splits one day's totals across children with traffic weights `w`, conversion multipliers
 * `conv` and CPC multipliers `cpcm`. The children always sum back to the parent.
 */
export function splitDay(t: DayTotals, kids: { w: number; conv: number; cpcm?: number }[], rand: Rand): DayTotals[] {
  const clicks = splitInt(t.clicks, kids.map((k) => k.w), rand);
  const orders = splitInt(t.orders, kids.map((k, i) => clicks[i] * k.conv), rand);
  const costW = kids.map((k, i) => clicks[i] * (k.cpcm ?? 1));
  const costTotal = costW.reduce((a, b) => a + b, 0);
  const impressions = splitInt(t.impressions, kids.map((k, i) => clicks[i] + k.w * 2), rand);
  return kids.map((_, i) => ({
    impressions: Math.max(impressions[i], clicks[i]),
    clicks: clicks[i],
    cost: costTotal ? Math.round(((t.cost * costW[i]) / costTotal) * 100) / 100 : 0,
    sales: t.orders ? Math.round(((t.sales * orders[i]) / t.orders) * 100) / 100 : 0,
    orders: orders[i],
  }));
}
