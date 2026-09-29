/** Demo-only product catalogue and which demo SP campaigns advertise which ASINs. */
export const DEMO_PRODUCTS = [
  { asin: "B0ARVONI01", sku: "ARV-ONION-OIL-200", title: "Aravi Onion Hair Oil 200ml", group: "Hair Care", mrp: 499, price: 449, cost: 118 },
  { asin: "B0ARVROS01", sku: "ARV-ROSE-OIL-100", title: "Aravi Rosemary Hair Oil 100ml", group: "Hair Care", mrp: 549, price: 499, cost: 135 },
  { asin: "B0ARVROS02", sku: "ARV-ROSE-WTR-100", title: "Aravi Rosemary Water Hair Spray 100ml", group: "Hair Care", mrp: 399, price: 349, cost: 95 },
  { asin: "B0ARVSHA01", sku: "ARV-ONION-SHAMP-250", title: "Aravi Red Onion Shampoo 250ml", group: "Hair Care", mrp: 449, price: 399, cost: 110 },
  { asin: "B0ARVBHR01", sku: "ARV-BHRING-OIL-200", title: "Aravi Bhringraj Hair Oil 200ml", group: "Hair Care", mrp: 449, price: 399, cost: 105 },
  { asin: "B0ARVCMB01", sku: "ARV-HAIR-COMBO", title: "Aravi Hair Care Combo – Onion Oil + Shampoo", group: "Hair Care", mrp: 999, price: 899, cost: 230 },
  { asin: "B0ARVVTC01", sku: "ARV-VITC-SER-30", title: "Aravi Vitamin C Face Serum 30ml", group: "Skin Care", mrp: 699, price: 599, cost: 140 },
  { asin: "B0ARVNIA01", sku: "ARV-NIAC-SER-30", title: "Aravi Niacinamide 10% Face Serum 30ml", group: "Skin Care", mrp: 649, price: 549, cost: 125 },
  { asin: "B0ARVKUM01", sku: "ARV-KUMKUM-OIL-30", title: "Aravi Kumkumadi Face Oil 30ml", group: "Skin Care", mrp: 899, price: 799, cost: 190 },
  { asin: "B0ARVALO01", sku: "ARV-ALOE-GEL-200", title: "Aravi Aloe Vera Gel 200g", group: "Skin Care", mrp: 349, price: 299, cost: 70 },
  { asin: "B0ARVUBT01", sku: "ARV-UBTAN-FW-100", title: "Aravi Ubtan Face Wash 100ml", group: "Skin Care", mrp: 399, price: 349, cost: 85 },
  // No unit cost on purpose: shows how the catalogue flags missing costs.
  { asin: "B0ARVSUN01", sku: "ARV-SUN-SPF50-50", title: "Aravi Sunscreen SPF 50 Gel 50g", group: "Skin Care", mrp: 499, price: 449, cost: null },
];

/** ASINs a demo SP campaign advertises, from its name. */
export function demoCampaignAsins(name: string): string[] {
  const n = name.toLowerCase();
  if (n.includes("brand defense")) return ["B0ARVONI01", "B0ARVROS01", "B0ARVVTC01"];
  if (n.includes("competitor asin")) return ["B0ARVONI01", "B0ARVROS01"];
  const rules: [string, string][] = [
    ["onion shampoo", "B0ARVSHA01"], ["onion hair oil", "B0ARVONI01"], ["rosemary", "B0ARVROS01"], ["vitamin c", "B0ARVVTC01"],
    ["niacinamide", "B0ARVNIA01"], ["kumkumadi", "B0ARVKUM01"], ["aloe", "B0ARVALO01"], ["ubtan", "B0ARVUBT01"],
    ["sunscreen", "B0ARVSUN01"], ["bhringraj", "B0ARVBHR01"], ["combo", "B0ARVCMB01"],
  ];
  const hit = rules.find(([k]) => n.includes(k));
  return hit ? [hit[1]] : [];
}
