// A TARIC duty expression, read into parts that can be applied to a consignment.
//
// TARIC prints a measure's duty as text: "12.000 %", "167.100 EUR DTN", "6.400 % + 20.100 EUR DTN",
// "0.000 % MIN 1.300 EUR DTN", "FREE". The unit after EUR is a measurement-unit code, not a slash
// form: DTN is 100 kg, KGM a kilogram, LTR a litre, NAR a number of items. The old parser only knew
// "EUR/100 kg" and read every specific duty as duty free (2026-10-10, found by the ELP tool when a
// cheese line came back at 0%).
//
// Used by /api/taric to describe a measure and by landed-cost.mjs to charge it. No network, no React.

/** TARIC measurement-unit codes, to the quantity they want and how many of it make one unit. */
export const UNITS = {
  DTN: { basis: "kg", per: 100, label: "100 kg" },
  KGM: { basis: "kg", per: 1, label: "kg" },
  TNE: { basis: "kg", per: 1000, label: "tonne" },
  GRM: { basis: "kg", per: 0.001, label: "gram" },
  LTR: { basis: "l", per: 1, label: "litre" },
  HLT: { basis: "l", per: 100, label: "hectolitre" },
  MTQ: { basis: "m3", per: 1, label: "m³" },
  MTK: { basis: "m2", per: 1, label: "m²" },
  MTR: { basis: "m", per: 1, label: "metre" },
  NAR: { basis: "items", per: 1, label: "item" },
  NPR: { basis: "items", per: 1, label: "pair" },
  CEN: { basis: "items", per: 100, label: "100 items" },
  MIL: { basis: "items", per: 1000, label: "1 000 items" },
  /* Litre of pure alcohol: the litres times the strength; asked for as its own quantity. */
  LPA: { basis: "lpa", per: 1, label: "litre of pure alcohol" },
  /* Kilogram net drained weight, kilogram of dry matter and so on: weights by another name. */
  KGD: { basis: "kg", per: 1, label: "kg (drained)" },
  KMA: { basis: "kg", per: 1, label: "kg (dry matter)" },
  KNS: { basis: "kg", per: 1, label: "kg (named substance)" },
  KSD: { basis: "kg", per: 1, label: "kg (dry 90%)" },
};

/**
 * One duty expression, read.
 *   adValorem   percent of the customs value, or null when the expression has none
 *   specifics   [{ amount, unit, basis, per, label }]: euros per unit of a quantity
 *   min / max   the same two fields again, for a "MIN …" or "MAX …" clause
 *   type        "duty_free" | "ad_valorem" | "specific" | "compound" | "unknown"
 *   complete    false when some part of the text was not understood; the raw text is then the answer
 */
export function parseDutyRate(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/\s+/g, " ").trim();
  if (!s) return null;
  /* "NIHIL" is how TARIC writes a nil rate on a named exporter's anti-dumping measure (Giant, 2026-10-10). */
  if (/^(FREE|NIHIL|0(\.0+)?\s*%)$/i.test(s)) return { adValorem: 0, specifics: [], min: null, max: null, type: "duty_free", complete: true, raw: s };

  /* Split off MIN and MAX clauses first; what is left is the main expression. */
  let main = s;
  let min = null;
  let max = null;
  const clauses = [...s.matchAll(/\b(MIN|MAX)\b([^]*?)(?=\bMIN\b|\bMAX\b|$)/gi)];
  if (clauses.length) {
    main = s.slice(0, clauses[0].index).trim();
    for (const c of clauses) {
      const part = parseParts(c[2]);
      if (c[1].toUpperCase() === "MIN") min = part; else max = part;
    }
  }
  const body = parseParts(main);
  const adValorem = body.adValorem;
  const specifics = body.specifics;
  const complete = body.complete && (!min || min.complete) && (!max || max.complete);

  let type = "unknown";
  if (complete) {
    if (adValorem != null && adValorem > 0 && specifics.length) type = "compound";
    else if (adValorem != null && adValorem > 0) type = "ad_valorem";
    else if (specifics.length) type = "specific";
    else if (adValorem === 0 && (min || max)) type = min?.specifics.length || max?.specifics.length ? "compound" : "duty_free";
    else type = "duty_free";
  }
  return { adValorem, specifics, min, max, type, complete, raw: s };
}

/** "6.400 % + 20.100 EUR DTN" → the percent and the per-unit amounts in it. */
function parseParts(text) {
  let adValorem = null;
  const specifics = [];
  let complete = true;
  const pieces = text.split("+").map((p) => p.trim()).filter(Boolean);
  for (const piece of pieces) {
    const pct = /^(\d+(?:\.\d+)?)\s*%$/.exec(piece);
    if (pct) { adValorem = (adValorem ?? 0) + parseFloat(pct[1]); continue; }
    const eur = /^(\d+(?:\.\d+)?)\s*EUR\s*\/?\s*([A-Z]{3})\b(.*)$/i.exec(piece);
    if (eur) {
      const unit = eur[2].toUpperCase();
      const known = UNITS[unit];
      /* A qualifier after the unit ("DTN E" for a entry-price, "HLT X") is more than this reads. */
      if (!known || eur[3].trim()) { complete = false; specifics.push({ amount: parseFloat(eur[1]), unit, basis: known?.basis ?? null, per: known?.per ?? null, label: known?.label ?? unit }); continue; }
      specifics.push({ amount: parseFloat(eur[1]), unit, basis: known.basis, per: known.per, label: known.label });
      continue;
    }
    /* The older "44.0 EUR/100 kg" spelling, from before TARIC's unit codes were used here. */
    const slash = /^(\d+(?:\.\d+)?)\s*EUR\s*\/\s*(100\s*kg|kg|l|hl|1000\s*kg|t)\b/i.exec(piece);
    if (slash) {
      const u = slash[2].replace(/\s+/g, "").toLowerCase();
      const unit = u === "100kg" ? "DTN" : u === "kg" ? "KGM" : u === "l" ? "LTR" : u === "hl" ? "HLT" : "TNE";
      specifics.push({ amount: parseFloat(slash[1]), unit, ...UNITS[unit] });
      continue;
    }
    complete = false;
  }
  return { adValorem, specifics, complete };
}

/**
 * The duty a parsed expression comes to, in euros, on a customs value and the quantities declared.
 * `quantities` is { kg, l, lpa, items, m2, m3, m } with whatever is known. Returns null when a
 * specific part needs a quantity that was not given, so the caller can ask rather than guess.
 */
export function applyDuty(parsed, customsValue, quantities = {}) {
  if (!parsed) return null;
  const part = (p) => {
    if (!p) return null;
    let sum = (p.adValorem ?? 0) / 100 * customsValue;
    for (const sp of p.specifics) {
      if (!sp.basis || sp.per == null) return null;
      const q = quantities[sp.basis];
      if (!(typeof q === "number" && Number.isFinite(q))) return null;
      sum += sp.amount * (q / sp.per);
    }
    return sum;
  };
  let duty = part(parsed);
  if (duty == null) return null;
  if (parsed.min) { const m = part(parsed.min); if (m == null) return null; duty = Math.max(duty, m); }
  if (parsed.max) { const m = part(parsed.max); if (m == null) return null; duty = Math.min(duty, m); }
  return duty;
}

/** Which quantities a parsed expression needs beyond the value: ["kg"], ["l","lpa"], []. */
export function quantitiesNeeded(parsed) {
  if (!parsed) return [];
  const bases = new Set();
  for (const p of [parsed, parsed.min, parsed.max]) for (const sp of p?.specifics ?? []) if (sp.basis) bases.add(sp.basis);
  return [...bases];
}
