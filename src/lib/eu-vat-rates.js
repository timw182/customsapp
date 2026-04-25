// EU VAT rates by member state — sourced from the European Commission's
// "VAT rates applied in the Member States of the European Union" report
// (DG TAXUD, 2026 edition). Update annually or whenever the Commission
// publishes a new TEDB extract.
//
// Each entry covers:
//   standard       — the headline rate for goods/services without exception
//   reduced        — array of reduced rates (one or two per country)
//   superReduced   — the third-tier rate (only ~6 member states use one)
//   parking        — historical "parking" rate (Article 109 derogation)
//   zero           — true if the country applies a 0% rate to certain goods
//
// Reduced-rate eligibility per HS chapter is *always* a domestic-law
// matter and changes frequently. The categoryHints map below is the
// best-effort heuristic — it tags HS chapters with a likely reduced
// category, so the lookup can suggest "may qualify for reduced 6%".
// The user must always confirm in the UI.
//
// Reference: https://taxation-customs.ec.europa.eu/document/download/...
//            (DG TAXUD VAT rates database snapshot 2026-01)

export const EU_VAT_RATES = {
  // ── BENELUX ──────────────────────────────────────────────────────
  BE: {
    name: "Belgium",
    standard: 21,
    reduced: [6, 12],
    superReduced: null,
    parking: 12,
    zero: true,
    notes: "6% applies to foodstuffs, water, books, pharmaceuticals, hotel; 12% to restaurant, social housing.",
  },
  NL: {
    name: "Netherlands",
    standard: 21,
    reduced: [9],
    superReduced: null,
    parking: null,
    zero: false,
    notes: "9% applies to foodstuffs, water, books, pharmaceuticals, agricultural inputs.",
  },
  LU: {
    name: "Luxembourg",
    standard: 17,
    reduced: [8],
    superReduced: 3,
    parking: 14,
    zero: false,
    notes: "3% super-reduced applies to foodstuffs, books, pharmaceuticals, children's clothing; 8% to wine, hairdressing.",
  },

  // ── REST OF EU27 ─────────────────────────────────────────────────
  AT: { name: "Austria",    standard: 20, reduced: [10, 13], superReduced: null, parking: 13, zero: false, notes: "10% foodstuffs/books; 13% wine, cultural events." },
  BG: { name: "Bulgaria",   standard: 20, reduced: [9],      superReduced: null, parking: null, zero: false, notes: "9% accommodation only." },
  HR: { name: "Croatia",    standard: 25, reduced: [5, 13],  superReduced: null, parking: null, zero: false, notes: "5% bread, milk, books; 13% food services, hotels." },
  CY: { name: "Cyprus",     standard: 19, reduced: [5, 9],   superReduced: null, parking: null, zero: true,  notes: "5% essentials; 9% restaurant/hotel." },
  CZ: { name: "Czechia",    standard: 21, reduced: [12],     superReduced: null, parking: null, zero: false, notes: "12% combined reduced rate (food, books, water, pharma)." },
  DK: { name: "Denmark",    standard: 25, reduced: [],       superReduced: null, parking: null, zero: true,  notes: "No reduced rate; 0% applies to newspapers." },
  EE: { name: "Estonia",    standard: 22, reduced: [9, 13],  superReduced: null, parking: null, zero: false, notes: "9% books, pharma, accommodation; 13% press from 2025." },
  FI: { name: "Finland",    standard: 25.5, reduced: [10, 14], superReduced: null, parking: null, zero: true, notes: "14% foodstuffs/restaurant; 10% books, pharma, transport." },
  FR: { name: "France",     standard: 20, reduced: [5.5, 10], superReduced: 2.1, parking: null, zero: false, notes: "2.1% medicines reimbursed by social security; 5.5% essentials; 10% restaurant." },
  DE: { name: "Germany",    standard: 19, reduced: [7],      superReduced: null, parking: null, zero: false, notes: "7% foodstuffs, books, public transport, hotel." },
  GR: { name: "Greece",     standard: 24, reduced: [6, 13],  superReduced: null, parking: null, zero: false, notes: "6% pharma, books; 13% foodstuffs, water, hotel." },
  HU: { name: "Hungary",    standard: 27, reduced: [5, 18],  superReduced: null, parking: null, zero: false, notes: "5% pharma, books, district heating; 18% foodstuffs, hotel." },
  IE: { name: "Ireland",    standard: 23, reduced: [9, 13.5], superReduced: 4.8, parking: 13.5, zero: true, notes: "0% essentials, books; 4.8% livestock; 9% hotel/news; 13.5% energy/restaurant." },
  IT: { name: "Italy",      standard: 22, reduced: [5, 10],  superReduced: 4,   parking: null, zero: false, notes: "4% essentials; 5% select foodstuffs; 10% pharma, hotel, restaurant." },
  LV: { name: "Latvia",     standard: 21, reduced: [5, 12],  superReduced: null, parking: null, zero: false, notes: "5% fruit/veg; 12% pharma, books, accommodation." },
  LT: { name: "Lithuania",  standard: 21, reduced: [5, 9],   superReduced: null, parking: null, zero: false, notes: "5% pharma, disability aids; 9% books, accommodation, public transport." },
  MT: { name: "Malta",      standard: 18, reduced: [5, 7, 12], superReduced: null, parking: null, zero: true, notes: "5% pharma, books, electricity; 7% accommodation; 12% certain services." },
  PL: { name: "Poland",     standard: 23, reduced: [5, 8],   superReduced: null, parking: null, zero: false, notes: "5% essentials, books; 8% pharma, hotel, restaurant." },
  PT: { name: "Portugal",   standard: 23, reduced: [6, 13],  superReduced: null, parking: 13,  zero: false, notes: "6% essentials, pharma; 13% wine, restaurant." },
  RO: { name: "Romania",    standard: 19, reduced: [5, 9],   superReduced: null, parking: null, zero: false, notes: "5% books, social housing; 9% foodstuffs, pharma, hotel." },
  SK: { name: "Slovakia",   standard: 23, reduced: [5, 19],  superReduced: null, parking: null, zero: false, notes: "5% essentials, books, pharma; 19% rate effective 2025." },
  SI: { name: "Slovenia",   standard: 22, reduced: [5, 9.5], superReduced: null, parking: null, zero: false, notes: "5% books; 9.5% foodstuffs, pharma, hotel." },
  ES: { name: "Spain",      standard: 21, reduced: [10],     superReduced: 4,   parking: null, zero: false, notes: "4% essentials, books, pharma; 10% foodstuffs, hotel, restaurant." },
  SE: { name: "Sweden",     standard: 25, reduced: [6, 12],  superReduced: null, parking: null, zero: true,  notes: "6% books, news, sport; 12% foodstuffs, hotel, restaurant." },
};

// HS chapter → likely reduced-rate category. Returned hint is informational
// only — the user must always confirm. Categories are loose buckets that
// most member states recognise in some form.
//
// Coverage focuses on chapters where reduced rates are most commonly applied:
//   01–24  foodstuffs / agricultural / beverages
//   28–30  pharmaceuticals
//   49     books, press
//   90.21  medical / orthopaedic
//
// We deliberately do NOT try to second-guess narrow domestic exceptions
// (e.g. children's clothing in LU, e-books across EU). Those need either a
// per-country lookup table or a Claude prompt with the destination's TEDB
// excerpt — out of scope here.
export const HS_REDUCED_HINTS = {
  // Live animals & animal products (food chain)
  "01": { category: "foodstuff", strength: "likely" },
  "02": { category: "foodstuff", strength: "likely" },
  "03": { category: "foodstuff", strength: "likely" },
  "04": { category: "foodstuff", strength: "likely" },
  "05": { category: "foodstuff", strength: "possible" },
  // Vegetable products
  "06": { category: "foodstuff", strength: "possible" }, // live plants — split
  "07": { category: "foodstuff", strength: "likely" },
  "08": { category: "foodstuff", strength: "likely" },
  "09": { category: "foodstuff", strength: "likely" },
  "10": { category: "foodstuff", strength: "likely" },
  "11": { category: "foodstuff", strength: "likely" },
  "12": { category: "foodstuff", strength: "likely" },
  "13": { category: "foodstuff", strength: "possible" },
  "14": { category: "foodstuff", strength: "possible" },
  // Animal/vegetable fats & oils
  "15": { category: "foodstuff", strength: "likely" },
  // Prepared foodstuffs
  "16": { category: "foodstuff", strength: "likely" },
  "17": { category: "foodstuff", strength: "likely" },
  "18": { category: "foodstuff", strength: "likely" },
  "19": { category: "foodstuff", strength: "likely" },
  "20": { category: "foodstuff", strength: "likely" },
  "21": { category: "foodstuff", strength: "likely" },
  // Beverages — alcohol typically EXCLUDED from reduced rate
  "22": { category: "beverage", strength: "split", note: "Non-alcoholic typically reduced; spirits/wine/beer at standard rate (subject to excise)." },
  // Tobacco — standard rate everywhere
  "24": { category: "tobacco", strength: "standard", note: "Always standard VAT plus excise." },
  // Inorganic / organic chemicals — fertilisers & pharma in some countries
  "28": { category: "pharma", strength: "possible" },
  "29": { category: "pharma", strength: "possible" },
  "30": { category: "pharma", strength: "likely", note: "Pharmaceutical products typically reduced or super-reduced." },
  // Fertilisers
  "31": { category: "agricultural", strength: "possible" },
  // Books, newspapers, printed matter
  "49": { category: "book", strength: "likely", note: "Books and newspapers typically reduced or zero-rated." },
  // Children's items (textiles/clothing chapters — country-specific)
  "61": { category: "clothing-children", strength: "split", note: "Adult clothing standard; children's clothing reduced in IE, LU, UK." },
  "62": { category: "clothing-children", strength: "split", note: "Adult clothing standard; children's clothing reduced in IE, LU, UK." },
  // Medical devices
  "90": { category: "medical-device", strength: "possible", note: "Heading 9021 (orthopaedic) commonly reduced." },
};

// Resolve a destination + HS code into a structured VAT recommendation.
// Returns { country, standard, suggested, alternatives, hint, reasoning, source }.
//   suggested  — the rate we lead with (reduced if hint says "likely", else standard)
//   alternatives — every applicable rate the country uses, for the override picker
export function resolveVat({ dest, hs }) {
  const country = EU_VAT_RATES[String(dest || "").toUpperCase()];
  if (!country) {
    return {
      error: `Unknown destination "${dest}". Must be an EU27 ISO2 code.`,
    };
  }

  const chapter = String(hs || "").replace(/\D/g, "").slice(0, 2);
  const hint = chapter ? HS_REDUCED_HINTS[chapter] || null : null;

  const allRates = [
    country.standard,
    ...(country.reduced || []),
    ...(country.superReduced != null ? [country.superReduced] : []),
    ...(country.parking != null ? [country.parking] : []),
    ...(country.zero ? [0] : []),
  ];
  // De-dupe + sort descending so standard appears first in the override list
  const alternatives = [...new Set(allRates)].sort((a, b) => b - a);

  // Lead with the standard rate. Reduced is *suggested as alternative* only
  // when the hint says "likely" AND the country has a reduced rate. We never
  // lead with reduced because the determination requires confirming the
  // goods description matches the domestic legal definition.
  const suggested = country.standard;
  const reducedCandidate =
    hint && (hint.strength === "likely" || hint.strength === "split") && country.reduced.length > 0
      ? Math.min(...country.reduced)
      : null;

  const reasoning = hint
    ? `HS chapter ${chapter} is typically classified as "${hint.category}" — ${
        hint.note ||
        (hint.strength === "likely"
          ? `${country.name} commonly applies the reduced rate to this category.`
          : hint.strength === "split"
          ? `Treatment varies; check the domestic VAT rules.`
          : `Standard VAT applies.`)
      }`
    : "No reduced-rate hint for this HS chapter — the standard rate applies unless your goods fall under a specific domestic exception.";

  return {
    country: { code: dest.toUpperCase(), name: country.name, notes: country.notes },
    standard: country.standard,
    suggested,
    reducedCandidate,
    alternatives,
    hint: hint
      ? { category: hint.category, strength: hint.strength, note: hint.note || null }
      : null,
    reasoning,
    source:
      "European Commission · DG TAXUD VAT rates database (2026 snapshot). Domestic exceptions may apply — confirm with the importer of record.",
  };
}
