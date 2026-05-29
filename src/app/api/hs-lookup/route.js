import { NextResponse } from "next/server";
import { normalizeDescription, callClaude, extractAttributes, narrowHeadings, pickFromCandidates } from "@/lib/hs-pipeline.mjs";
import { requireUser } from "@/lib/apiAuth";
import { FREE_SONNET_LIMIT } from "@/lib/limits";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
export const maxDuration = 60;

// One push per completed classification. Confidence < 60% (mapped from the
// model's "low" label) routes to the lowConfidence channel so the user's
// category toggle can separate review-worthy results from routine ones.
// Fire-and-forget: never block the classify response on the push.
function firePushForResult(userId, result) {
  const code = result?.cn8 || result?.cn10 || result?.hs6;
  if (!code) return;                           // unresolved — nothing to notify
  if (result.needsMoreInfo || result.error) return;

  const pct = typeof result.confidencePct === "number" ? result.confidencePct : null;
  const title = result.description
    ? `${code.replace(/\s+/g, "")} · ${result.description.slice(0, 40)}`
    : `Classified → ${code}`;
  const body = result.rationale?.slice(0, 120) ?? "Tap to review the full breakdown.";

  const category = pct != null && pct < 60 ? "lowConfidence" : "newResults";
  sendPushToUser({
    userId,
    category,
    title: category === "lowConfidence" ? `Low confidence — ${code}` : title,
    body,
    data: { hs6: result.hs6, cn8: result.cn8, cn10: result.cn10 },
  }).catch(() => {});
}

// CN/TARIC leaf codes are very often the bare residual "Other" (the meaning lives
// in parent levels of the nomenclature). When that's all the declarable code gives
// us, fall back to the model's shortLabel — a meaningful 2-3 word product label —
// so the result never surfaces just "Other". Only the truly-bare residual is
// replaced; "Other, of cotton" etc. carry real info and are kept as-is.
function meaningfulDescription(description, shortLabel) {
  const d = (description || "").trim();
  const bareOther = /^others?[\s:.,;-]*$/i.test(d) || /^n\.?\s*e\.?\s*s\.?$/i.test(d);
  const label = (shortLabel || "").trim();
  if ((!d || bareOther) && label) return label;
  return description;
}

// Cache entries older than 180 days are considered stale (CN codes update annually)
const CACHE_MAX_AGE_DAYS = 180;

const TARIC_SOAP_URL = "https://ec.europa.eu/taxation_customs/dds2/taric/services/goods";
const TARIC_TREE_BASE = "https://ec.europa.eu/taxation_customs/dds2/taric/nomenclaturetree";

const classifySchema = z.object({
  type: z.literal("classify"),
  description: z.string().min(1).max(1000),
  // Client-side preference for how verbose the rationale should be.
  // "detailed" is Pro-only and is silently downgraded to "medium" for free
  // users until the plan check is wired.
  explanationLevel: z.enum(["short", "medium", "detailed"]).optional(),
  // When false, skip the TARIC SOAP verification + sibling probe entirely.
  // Results are faster but marked `taricVerified: false`. Defaults to true.
  autoTaricValidation: z.boolean().optional(),
  // Marks this call as a re-classify after the user picked a disambiguation
  // pill on the previous result. Skips the "ask the user" branch on low
  // confidence — they've already disambiguated — and escalates to Opus as
  // last resort instead. Prevents an infinite question loop.
  disambiguated: z.boolean().optional(),
  // When false, skip writing an hsSearchHistory row for this call. Set by the
  // mobile app when a user re-opens an existing history entry so the lookup
  // isn't duplicated in their history. Cache writes still happen. Defaults true.
  recordHistory: z.boolean().optional(),
});

const rateSchema = z.object({
  type: z.literal("rate"),
  code: z.string().min(4).max(14),
});

// Pro-only image classification. Mobile sends a base64 JPEG/PNG/WEBP
// (resized to ≤1568 px on the longest edge by expo-image-manipulator) plus
// an optional hint string. Server runs Sonnet vision to derive a structured
// product description, then funnels into the existing classification flow so
// cache + TARIC + sensitive-goods checks stay uniform with text-based runs.
const imageSchema = z.object({
  type: z.literal("classify-image"),
  // Cap at ~7 MB base64 (~5 MB binary) — Anthropic vision hard limit.
  imageBase64: z.string().min(100).max(7_500_000),
  imageMediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  hint: z.string().max(500).optional(),
  explanationLevel: z.enum(["short", "medium", "detailed"]).optional(),
  autoTaricValidation: z.boolean().optional(),
});

const bodySchema = z.discriminatedUnion("type", [classifySchema, rateSchema, imageSchema]);

// ── TARIC SOAP helpers ────────────────────────────────────────────────────────

function makeSoap(operation, params) {
  const inner = Object.entries(params)
    .map(([k, v]) => v != null ? `<tns:${k}>${v}</tns:${k}>` : "")
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="http://goodsNomenclatureForWS.ws.taric.dds.s/">
  <soapenv:Header/>
  <soapenv:Body><tns:${operation}>${inner}</tns:${operation}></soapenv:Body>
</soapenv:Envelope>`;
}

function xmlText(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : null;
}

function xmlBlocks(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  const out = []; let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function parseDutyRate(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s.toUpperCase() === "FREE" || s === "0%") return { adValorem: 0, type: "duty_free", raw: s };
  const av = s.match(/^(\d+(?:\.\d+)?)\s*%/);
  const sp = s.match(/(\d+(?:\.\d+)?)\s+(EUR\/[^\s+]+(?:\s+[^\s+]+)?)/i);
  const adValorem = av ? parseFloat(av[1]) : 0;
  const specific = sp ? { amount: parseFloat(sp[1]), unit: sp[2].trim() } : null;
  let type = "duty_free";
  if (adValorem > 0 && specific) type = "compound";
  else if (adValorem > 0) type = "ad_valorem";
  else if (specific) type = "specific";
  return { adValorem, specific, type, raw: s };
}

const MFN_TYPES = new Set(["103"]);
const PREF_TYPES = new Set(["141","142","143","145","146","147"]);
const PROHIBITION_TYPES = new Set(["277", "278"]);
const LICENSING_TYPES = new Set(["750", "755", "717", "718", "760", "761", "762"]);

// Static chapter-level sensitivity map — used when TARIC has no explicit prohibition/licensing measure
const SENSITIVE_CHAPTERS = {
  "01": { category: "Live animals", warning: "Protected species require a CITES permit under the Convention on International Trade in Endangered Species.", licenceAuthority: "CITES Management Authority", regulations: ["CITES Appendix I/II/III", "EU Wildlife Trade Regulation 338/97"] },
  "02": { category: "Meat and edible offal", warning: "Requires veterinary health certificate; may be subject to import bans based on origin-country disease status.", regulations: ["EU Regulation 853/2004", "Veterinary import conditions"] },
  "03": { category: "Fish and seafood", warning: "Protected species require CITES permit. EU imports require an IUU catch certificate (Regulation 1005/2008).", licenceAuthority: "Fisheries authority / CITES Management Authority", regulations: ["EU IUU Regulation 1005/2008", "CITES"] },
  "05": { category: "Animal products", warning: "Health certificates required; parts of protected species require a CITES permit.", regulations: ["CITES", "EU Wildlife Trade Regulation 338/97"] },
  "06": { category: "Live trees and plants", warning: "Phytosanitary certificate required. Protected plant species need a CITES permit.", licenceAuthority: "Phytosanitary authority / CITES Management Authority", regulations: ["EU Phytosanitary Regulation 2016/2031", "CITES"] },
  "28": { category: "Inorganic chemicals", warning: "Certain substances are regulated drug precursors under EU Regulation 2019/1148; export authorisation may be required.", regulations: ["EU Regulation 2019/1148", "UN Convention against Illicit Traffic in Narcotic Drugs"] },
  "29": { category: "Organic chemicals", warning: "May be scheduled drug precursors under EU Regulation 2019/1148. Pre-export notification or licence required for certain substances.", licenceAuthority: "National competent authority", regulations: ["EU Regulation 2019/1148", "UN Drug Conventions (1961/1971/1988)"] },
  "30": { category: "Pharmaceutical products", warning: "Narcotics and psychotropic substances require import/export authorisation. Medicinal products require marketing authorisation.", licenceAuthority: "National medicines agency / narcotics bureau", regulations: ["UN Single Convention on Narcotic Drugs 1961", "EU Directive 2001/83/EC"] },
  "36": { category: "Explosives and pyrotechnics", warning: "Subject to strict import/export controls. Import licence required in most jurisdictions. Civilian use is heavily restricted.", licenceAuthority: "National explosives authority", regulations: ["EU Directive 2014/28/EU", "EU Regulation 2019/1148 on explosives precursors"], consequences: "Unlicensed import may result in immediate seizure and criminal prosecution." },
  "38": { category: "Miscellaneous chemical products", warning: "Some products are dual-use or regulated as precursors. Verify against the EU Dual-Use Regulation and precursor lists.", regulations: ["EU Dual-Use Regulation 2021/821", "EU Regulation 2019/1148"] },
  "44": { category: "Wood and wood articles", warning: "Subject to EU Deforestation Regulation (EUDR) — due diligence statement required. FLEGT timber licence needed from certain origins.", licenceAuthority: "Competent authority under EUDR", regulations: ["EU Deforestation Regulation 2023/1115", "FLEGT Regulation 995/2010"] },
  "87": { category: "Vehicles", warning: "Armoured and military vehicles are subject to EU Dual-Use export controls and may require individual export authorisation.", regulations: ["EU Dual-Use Regulation 2021/821", "Arms Trade Treaty"] },
  "88": { category: "Aircraft and spacecraft", warning: "Military aircraft require export authorisation. Subject to Wassenaar Arrangement controls.", licenceAuthority: "National export control authority", regulations: ["EU Dual-Use Regulation 2021/821", "Wassenaar Arrangement"] },
  "89": { category: "Ships and floating structures", warning: "Warships and naval vessels are subject to strict arms export controls.", regulations: ["EU Dual-Use Regulation 2021/821", "Arms Trade Treaty"] },
  "93": { category: "Arms and ammunition", warning: "Firearms and ammunition require import authorisation under EU Firearms Directive. Prohibited in many civilian contexts.", licenceAuthority: "National firearms authority", regulations: ["EU Firearms Directive 91/477/EEC (amended 2017/853)", "Arms Trade Treaty", "UN Programme of Action on Small Arms"], consequences: "Import without authorisation will result in seizure. Criminal penalties apply in most jurisdictions." },
  "97": { category: "Works of art and antiques", warning: "Import of cultural goods from certain regions requires proof of lawful export. Items containing CITES-listed materials (ivory, coral, tortoiseshell) require permits.", regulations: ["EU Regulation 2019/880 on import of cultural goods", "CITES", "UNESCO Convention 1970"] },
};

function buildSensitiveGoods(hs6, bestMatch) {
  const chapter = (hs6 || "").slice(0, 2);

  if (bestMatch?.prohibited) {
    const base = SENSITIVE_CHAPTERS[chapter] ?? {};
    return {
      category: base.category ?? "Prohibited goods",
      warning: "This product is subject to an EU import prohibition (TARIC measure 277). Import is not permitted.",
      licenceAuthority: "EU Customs / National competent authority",
      regulations: base.regulations ?? [],
      consequences: "Goods will be seized at customs. Criminal penalties may apply.",
    };
  }

  if (bestMatch?.licensing?.length > 0) {
    const base = SENSITIVE_CHAPTERS[chapter] ?? {};
    const isCITES = bestMatch.licensing.includes("755");
    return {
      category: base.category ?? "Licence-controlled goods",
      warning: isCITES
        ? "This product requires a CITES permit for import into the EU."
        : `Import licence required (TARIC measure type ${bestMatch.licensing.join(", ")}). Contact the relevant authority before importing.`,
      licenceAuthority: base.licenceAuthority ?? "National competent authority",
      regulations: base.regulations ?? [],
      consequences: "Import without required authorisation may result in seizure and penalties.",
    };
  }

  return SENSITIVE_CHAPTERS[chapter] ?? null;
}

/**
 * Secondary existence check against USITC's HTS REST endpoint.
 * Because the first 6 HS digits are globally harmonised (HS 2022), any real
 * subheading shows up in both EU TARIC and US HTS. When TARIC is silent, a
 * USITC miss is a strong "this code was invented or long-abolished" signal.
 * Returns "exists" | "missing" | "unknown" — treat `unknown` as neutral so
 * USITC downtime never blocks a lookup.
 */
/**
 * When TARIC returns multiple CN8 siblings under the same 6-digit heading,
 * Claude's 6-digit answer can't tell them apart — the old code picked the
 * first-listed sibling, which is wrong for products that hit a semantic
 * split (e.g. Vaccinium myrtillus (bilberries, 08104030) vs
 * Vaccinium vitis-idaea (cowberries, 08104010)).
 *
 * This tiny Haiku call re-reads the product description alongside each
 * sibling's TARIC description and returns the best-fit CN8. Costs ~50 input
 * tokens; buys real accuracy at the sub-heading level.
 */
// Returns the best-fit CN10 code (or null on failure).
// Groups by CN8 within CN6 so the model sees both the subheading category
// (CN6) and the specific CN8 subdivision, then picks the right CN10.
async function pickCn8FromSiblings(description, siblings, priorReasoning = "", model = "claude-haiku-4-5-20251001", attrs = null) {
  if (!Array.isArray(siblings) || siblings.length === 0) return null;
  if (siblings.length === 1) return siblings[0].cn10;
  // Group siblings by CN6 prefix so the model can see the 6-digit subheading
  // 3-level grouping: CN6 → CN8 → CN10. The model sees the CN8 node as a
  // named subgroup so it can use its HS knowledge to identify e.g. that
  // 1902.30.10 = dried pasta vs 1902.30.90 = fresh/frozen/other pasta,
  // even when both have just "Other" at the CN10 level.
  const cn6Map = new Map();
  for (const s of siblings) {
    const cn6 = s.cn8.slice(0, 6);
    if (!cn6Map.has(cn6)) cn6Map.set(cn6, new Map());
    const cn8Map = cn6Map.get(cn6);
    if (!cn8Map.has(s.cn8)) cn8Map.set(s.cn8, []);
    cn8Map.get(s.cn8).push(s);
  }
  const list = Array.from(cn6Map.entries())
    .map(([cn6, cn8Map]) => {
      const subgroups = Array.from(cn8Map.entries())
        .map(([cn8, items]) => {
          const rows = items
            .map((s) => `      - ${s.cn10}: ${s.description || "(no description)"}`)
            .join("\n");
          return `    ${cn8}:\n${rows}`;
        })
        .join("\n");
      return `  ${cn6}:\n${subgroups}`;
    })
    .join("\n");

  const sys =
    "You are a customs classification expert. You will receive a product description, " +
    "prior reasoning, and CN10 codes grouped CN6 → CN8 → CN10.\n\n" +
    "PROCESS (in order):\n" +
    "1. Identify what CATEGORY each 6-digit (CN6) subheading group represents using your " +
    "HS/CN knowledge — e.g. 190240 = couscous, 190230 = other pasta, 190219 = uncooked pasta.\n" +
    "2. Within the correct CN6 group, identify what each 8-digit (CN8) subgroup represents — " +
    "e.g. 19023010 = dried pasta, 19023090 = other (fresh/frozen/cooked) pasta.\n" +
    "3. Pick the CN10 entry whose CN8 subgroup AND description best fit the product.\n\n" +
    "The CN10 descriptions (e.g. 'Other', 'Containing rice') describe distinctions WITHIN a " +
    "CN8 subgroup — always resolve CN6 then CN8 meaning first (steps 1-2).\n\n" +
    "NUMERIC THRESHOLDS: When CN8/CN10 descriptions split a subheading by a numeric threshold " +
    "(e.g. thrust in kN, power in kW, displacement in cm³, weight in kg, ash %, thickness in µm), " +
    "match the threshold against the product's stated specs. If specs are not stated but the product " +
    "is a named model whose rating is well-known (e.g. GE GEnx ≈ 300–340 kN thrust, Tesla Model 3 ≈ 75 kWh battery, " +
    "Pratt & Whitney PW1100G ≈ 110 kN), use that knowledge — do NOT default to the first or smallest bucket. " +
    "If you genuinely cannot determine which numeric bucket applies, prefer the most common/representative " +
    "rating for that product class, not the lowest.\n\n" +
    "MIXTURES / ASSORTMENTS: If the product description indicates a mixture, blend, assortment, medley, " +
    "or 'several different / mixed / varied' members of the heading (e.g. 'frozen mixed vegetables', " +
    "'assorted dried fruit', 'spice mix'), and one of the CN6/CN8 subgroups is named 'Mixtures of …' " +
    "(e.g. 0710 90 'Mixtures of vegetables', 0813 50 'Mixtures of nuts or dried fruits', 0910 91 " +
    "'Mixtures of spices'), prefer the named mixture subgroup over a generic 'Other vegetables/fruits/etc' " +
    "subgroup. Never collapse a true multi-kind mixture into a single-kind subheading (e.g. 'Olives') just " +
    "because that single-kind subheading happens to come first in the candidate list.\n\n" +
    'Output raw JSON only: {"cn10":"ten-digit string"}. The answer MUST be one of the candidates listed.';

  const specsBlock = attrs?.attributes?.specs
    ? `\nKnown specs: ${attrs.attributes.specs}\n`
    : "";
  const kindBlock = attrs?.kind ? `\nProduct kind: ${attrs.kind}` : "";
  const reasoningBlock = priorReasoning
    ? `\nPrior analysis: ${priorReasoning}\n`
    : "";
  const user =
    `Product: ${description}${kindBlock}${specsBlock}${reasoningBlock}\n\n` +
    `Candidate CN10 codes (grouped CN6 → CN8 → CN10):\n${list}\n\n` +
    `Return only the JSON object.`;

  try {
    const result = await callClaude(sys, user, model, 60);
    const picked = String(result?.cn10 ?? "").replace(/\D/g, "");
    if (picked && siblings.some((s) => s.cn10 === picked)) return picked;
  } catch {
    // fall through
  }
  return null;
}

async function usitcHs6Exists(hs6) {
  const digits = String(hs6 || "").replace(/\D/g, "").slice(0, 6);
  if (digits.length < 6) return "unknown";
  // Match at 4-digit heading level — WCO HS is globally harmonised only at
  // 4-digit level. EU and US often diverge at 6-digit (e.g. EU 1902.10 vs
  // US 1902.11/1902.19), so a 6-digit match would produce false "abolished"
  // for valid EU subheadings. Checking the heading (4 digits) is sufficient
  // to catch truly abolished codes like 8803 (→ 8807 in HS 2017).
  const heading4 = digits.slice(0, 4); // "1902"
  const formatted = `${heading4.slice(0, 2)}${heading4.slice(2, 4)}`; // "1902"
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(
      `https://hts.usitc.gov/reststop/search?keyword=${encodeURIComponent(heading4)}`,
      { signal: ctrl.signal, headers: { Accept: "application/json" } }
    );
    clearTimeout(t);
    if (!r.ok) return "unknown";
    const arr = await r.json();
    if (!Array.isArray(arr) || arr.length === 0) return "missing";
    // Only accept results whose `htsno` digits start with the 4-digit heading.
    const hit = arr.some((item) => {
      const n = String(item?.htsno || "").replace(/\D/g, "");
      return n.startsWith(heading4);
    });
    return hit ? "exists" : "missing";
  } catch {
    return "unknown";
  }
}

async function taricVerify(cn8, originCountry = null) {
  const code = cn8.replace(/\D/g, "").padEnd(10, "0").slice(0, 10);
  try {
    const descrResp = await fetch(TARIC_SOAP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=UTF-8", SOAPAction: '""' },
      body: makeSoap("goodsDescrForWs", { goodsCode: code, languageCode: "en" }),
      signal: AbortSignal.timeout(8000),
    });
    const descrXml = await descrResp.text();
    if (descrXml.includes("<faultstring>")) return null;
    const description = xmlText(descrXml, "description");
    if (!description) return null;
    const declarable = xmlText(descrXml, "declarable") === "true";

    let mfnRate = null, mfnRateRaw = null;
    const country = originCountry ? originCountry.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 2) : "US";
    const measResp = await fetch(TARIC_SOAP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=UTF-8", SOAPAction: '""' },
      body: makeSoap("goodsMeasForWs", { goodsCode: code, countryCode: country, tradeMovement: "I" }),
      signal: AbortSignal.timeout(8000),
    });
    const measXml = await measResp.text();
    const blocks = xmlBlocks(measXml, "measure");
    const now = new Date();
    const measures = blocks.map(m => {
      const mtBlock = m.match(/<measure_type>([\s\S]*?)<\/measure_type>/)?.[1] || "";
      const validTo = xmlText(m, "validity_end_date");
      return { measureType: xmlText(mtBlock, "measure_type"), dutyRateRaw: xmlText(m, "duty_rate")?.trim() || null, expired: validTo ? new Date(validTo) < now : false };
    }).filter(m => !m.expired);
    const mfnMeasure = measures.find(m => MFN_TYPES.has(m.measureType));
    if (mfnMeasure) { mfnRateRaw = mfnMeasure.dutyRateRaw; mfnRate = parseDutyRate(mfnRateRaw)?.adValorem ?? null; }

    return { description, declarable, mfnRate, mfnRateRaw, code10: code };
  } catch { return null; }
}

// ── TARIC nomenclature tree fallback ─────────────────────────────────────────
// When the SOAP service is down, we fall back to the daily-published static
// nomenclature tree JS files. These confirm code existence + descriptions but
// do NOT contain duty rates.

function extractJsonArray(js, varName) {
  const startStr = `${varName} = `;
  const idx = js.indexOf(startStr);
  if (idx < 0) return null;
  let pos = idx + startStr.length;
  if (js[pos] !== "[") return null;
  let depth = 0, inStr = false, escape = false;
  for (let i = pos; i < js.length; i++) {
    const ch = js[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "[") depth++;
    else if (ch === "]") { depth--; if (depth === 0) { try { return JSON.parse(js.slice(pos, i + 1)); } catch { return null; } } }
  }
  return null;
}

async function taricBrowseHeadingFromTree(heading) {
  const h = heading.replace(/\D/g, "").slice(0, 4);
  if (h.length !== 4) return [];
  const chapter = h.slice(0, 2).padStart(2, "0");
  // EU publishes nomenclature tree files on Jan 1 of the regulation year, not daily.
  // Try current-year Jan 1, previous-year Jan 1, then today as a last resort.
  const now = new Date();
  const year = now.getFullYear();
  const today = now.toISOString().slice(0, 10).replace(/-/g, "");
  const datesToTry = [`${year}0101`, `${year - 1}0101`, today];
  let js = null;
  for (const date of datesToTry) {
    try {
      const url = `${TARIC_TREE_BASE}/nomenclaturetree_en_${date}_${chapter}_en.js`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (resp.ok) { js = await resp.text(); break; }
    } catch { /* try next date */ }
  }
  if (!js) return [];
  try {
    const tree = extractJsonArray(js, "chaptertree");
    if (!tree) return [];
    const results = [];
    const seen = new Set();
    function walk(nodes) {
      if (!Array.isArray(nodes)) return;
      for (const node of nodes) {
        if (!Array.isArray(node) || node.length < 6) continue;
        const code = node[2];
        const desc = node[5];
        const children = node[7];
        if (typeof code === "string" && code.length === 10 && code.startsWith(h)) {
          const declarable = !Array.isArray(children);
          if (declarable && !seen.has(code)) {
            seen.add(code);
            results.push({
              cn8: code.slice(0, 8),
              cn10: code,
              description: typeof desc === "string" ? desc.replace(/ : $/, "").trim() : "",
              declarable: true,
              mfnRate: null,
              mfnRateRaw: null,
              _fromTree: true,
            });
          }
        }
        if (Array.isArray(children)) walk(children);
      }
    }
    walk(tree);
    return results;
  } catch { return []; }
}

// ── TARIC subheading browser ──────────────────────────────────────────────────

/**
 * Probe TARIC SOAP for valid declarable CN10 codes under a 4-digit heading.
 * Three-level probing:
 *   1. HS6 subheadings (heading + 10..90)
 *   2. CN8 extensions under each valid HS6 (hs6 + 00..90) → padded to CN10 with "00"
 *   3. For non-declarable CN8s, probe CN10 subdivisions (cn8 + 10..90)
 * Returns only TARIC-confirmed declarable codes with descriptions and MFN duty rates.
 * Falls back to nomenclature tree files when the SOAP service is unavailable.
 */
async function taricBrowseHeading(heading, extraCodes = [], nearHs6 = null) {
  const h = heading.replace(/\D/g, "").slice(0, 4);
  if (h.length !== 4) return [];

  // Helper: probe a single CN10 code via SOAP.
  // Returns null if code not found; throws { isTaricDown: true } if service is broken.
  async function verifyExact(cn10) {
    const code = cn10.replace(/\D/g, "").padEnd(10, "0").slice(0, 10);
    let descrXml;
    try {
      const descrResp = await fetch(TARIC_SOAP_URL, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=UTF-8", SOAPAction: '""' },
        body: makeSoap("goodsDescrForWs", { goodsCode: code, languageCode: "en" }),
        signal: AbortSignal.timeout(8000),
      });
      descrXml = await descrResp.text();
    } catch (e) {
      // Network error — service unreachable
      const err = new Error("TARIC_DOWN");
      err.isTaricDown = true;
      throw err;
    }

    // Server-side fault: "A technical error occurred" or similar
    if (descrXml.includes("<faultstring>")) {
      const err = new Error("TARIC_DOWN");
      err.isTaricDown = true;
      throw err;
    }

    const description = xmlText(descrXml, "description");
    if (!description) return null; // Code genuinely not in TARIC
    const declarable = xmlText(descrXml, "declarable") === "true";

    let mfnRate = null, mfnRateRaw = null, prohibited = false;
    const licensing = [];
    if (declarable) {
      try {
        const measResp = await fetch(TARIC_SOAP_URL, {
          method: "POST",
          headers: { "Content-Type": "text/xml; charset=UTF-8", SOAPAction: '""' },
          body: makeSoap("goodsMeasForWs", { goodsCode: code, countryCode: "US", tradeMovement: "I" }),
          signal: AbortSignal.timeout(8000),
        });
        const measXml = await measResp.text();
        if (!measXml.includes("<faultstring>")) {
          const blocks = xmlBlocks(measXml, "measure");
          const now = new Date();
          for (const m of blocks) {
            const mtBlock = m.match(/<measure_type>([\s\S]*)<\/measure_type>/)?.[1] || "";
            const mt = xmlText(mtBlock, "measure_type");
            const validTo = xmlText(m, "validity_end_date");
            const expired = validTo ? new Date(validTo) < now : false;
            if (expired || !mt) continue;
            if (MFN_TYPES.has(mt) && !mfnRateRaw) {
              mfnRateRaw = xmlText(m, "duty_rate")?.trim() || null;
              mfnRate = parseDutyRate(mfnRateRaw)?.adValorem ?? null;
            }
            if (PROHIBITION_TYPES.has(mt)) prohibited = true;
            if (LICENSING_TYPES.has(mt) && !licensing.includes(mt)) licensing.push(mt);
          }
        }
      } catch {} // Rate lookup failure is non-fatal
    }
    return { code10: code, description, declarable, mfnRate, mfnRateRaw, prohibited, licensing };
  }

  try {
    // Step 1: probe HS6 subheadings.
    // Standard sweep: heading + 10/20/.../90 (round multiples of 10).
    // Neighbour sweep: 10 codes starting at Claude's suggested hs6 (if provided).
    // This catches non-round endings like 1902.11, 1902.19 that HS 2017/2022
    // introduced alongside the classic 1902.20, 1902.30, 1902.40 codes.
    const hs6Set = new Set();
    for (let i = 1; i <= 9; i++) hs6Set.add(h + String(i * 10).padStart(2, "0"));
    if (nearHs6) {
      // Scan a window around Claude's suggestion: -5 backward, +10 forward.
      // Captures HS 2017/2022 "odd ending" codes (e.g. 1902.11, 1902.19)
      // when Claude picks 1902.10 or 1902.20 — typically ≤2 steps away.
      const base = parseInt(String(nearHs6).replace(/\D/g, "").slice(0, 6), 10);
      for (let d = -5; d <= 10; d++) {
        const candidate = String(base + d).padStart(6, "0");
        if (candidate.startsWith(h)) hs6Set.add(candidate);
      }
    }
    const hs6Probes = [...hs6Set];

    const hs6Results = await Promise.all(hs6Probes.map(hs6 => verifyExact(hs6 + "0000")));
    const validHs6 = hs6Probes.filter((_, i) => hs6Results[i]);

    // Step 2: probe CN8 under each valid HS6 (hs6 + 00..90, padded to 10 with "00")
    const cn8Probes = [];
    for (const hs6 of validHs6) {
      for (let i = 0; i <= 9; i++) cn8Probes.push(hs6 + String(i * 10).padStart(2, "0") + "00");
    }
    for (const code of extraCodes) {
      const clean = code.replace(/\D/g, "").padEnd(10, "0").slice(0, 10);
      if (!cn8Probes.includes(clean)) cn8Probes.push(clean);
    }

    const cn8Results = [];
    for (let i = 0; i < cn8Probes.length; i += 15) {
      const batch = cn8Probes.slice(i, i + 15);
      const results = await Promise.all(batch.map(c => verifyExact(c)));
      batch.forEach((code, j) => { if (results[j]) cn8Results.push({ code, ...results[j] }); });
    }

    // Step 3: for non-declarable CN8 results, probe CN10 subdivisions (cn8 + 10..90)
    const nonDeclarable = cn8Results.filter(r => !r.declarable);
    const cn10Probes = [];
    for (const r of nonDeclarable) {
      const cn8 = r.code.slice(0, 8);
      for (let i = 1; i <= 9; i++) cn10Probes.push(cn8 + String(i * 10).padStart(2, "0"));
    }

    const cn10Results = [];
    for (let i = 0; i < cn10Probes.length; i += 15) {
      const batch = cn10Probes.slice(i, i + 15);
      const results = await Promise.all(batch.map(c => verifyExact(c)));
      batch.forEach((code, j) => { if (results[j]) cn10Results.push({ code, ...results[j] }); });
    }

    const all = [...cn8Results, ...cn10Results];
    const seen = new Set();
    return all
      .filter(r => {
        if (!r.declarable) return false;
        if (seen.has(r.code10)) return false;
        seen.add(r.code10);
        return true;
      })
      .map(r => ({
        cn8: r.code10.slice(0, 8),
        cn10: r.code10,
        description: r.description,
        declarable: true,
        mfnRate: r.mfnRate,
        mfnRateRaw: r.mfnRateRaw,
        prohibited: r.prohibited ?? false,
        licensing: r.licensing ?? [],
      }));
  } catch (e) {
    if (e?.isTaricDown) {
      // TARIC SOAP is unavailable — fall back to nomenclature tree files (no rates)
      console.warn("[hs-lookup] TARIC SOAP down — falling back to nomenclature tree");
      const treeResults = await taricBrowseHeadingFromTree(h);
      // Signal to caller whether we got results or the service is genuinely down
      if (treeResults.length === 0) {
        const err = new Error("TARIC_SERVICE_DOWN");
        err.isTaricServiceDown = true;
        throw err;
      }
      return treeResults;
    }
    return [];
  }
}

// Cheap "find any declarable CN10 under this HS6" probe used to enrich the
// model's alternative subheadings (which the LLM only returns at hs6 level).
// Strategy: try hs6+"0000" first (single SOAP call covers the common case),
// then fan out to the 10 CN8 children in parallel, then to CN10 children of
// any non-declarable CN8. Returns null if TARIC has nothing declarable under
// the heading — caller falls back to displaying hs6 alone.
async function findFirstDeclarableCn10(hs6) {
  const h6 = String(hs6 ?? "").replace(/\D/g, "").slice(0, 6);
  if (h6.length !== 6) return null;

  async function probe(code10) {
    try {
      const resp = await fetch(TARIC_SOAP_URL, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=UTF-8", SOAPAction: '""' },
        body: makeSoap("goodsDescrForWs", { goodsCode: code10, languageCode: "en" }),
        signal: AbortSignal.timeout(6000),
      });
      const xml = await resp.text();
      if (xml.includes("<faultstring>")) return null;
      const description = xmlText(xml, "description");
      if (!description) return null;
      const declarable = xmlText(xml, "declarable") === "true";
      return { code10, declarable, description };
    } catch {
      return null;
    }
  }

  try {
    // Step 1: base CN10 (hs6 + "0000") — many subheadings are declarable here.
    const base = h6 + "0000";
    const baseRes = await probe(base);
    if (baseRes?.declarable) return base;

    // Step 2: probe the 10 CN8 children in parallel.
    const cn8Codes = Array.from({ length: 10 }, (_, i) =>
      h6 + String(i * 10).padStart(2, "0") + "00",
    );
    const cn8Results = await Promise.all(cn8Codes.map(probe));
    for (let i = 0; i < cn8Results.length; i++) {
      if (cn8Results[i]?.declarable) return cn8Codes[i];
    }

    // Step 3: for non-declarable CN8 parents, probe their CN10 children.
    for (let i = 0; i < cn8Results.length; i++) {
      if (!cn8Results[i] || cn8Results[i].declarable) continue;
      const cn8 = cn8Codes[i].slice(0, 8);
      const cn10Codes = Array.from({ length: 10 }, (_, j) =>
        cn8 + String(j * 10).padStart(2, "0"),
      );
      const cn10Results = await Promise.all(cn10Codes.map(probe));
      for (let j = 0; j < cn10Results.length; j++) {
        if (cn10Results[j]?.declarable) return cn10Codes[j];
      }
    }
  } catch {
    // Network-level failure — caller treats null as "no enrichment available"
  }
  return null;
}

// Sonnet vision call — derives a structured, classifier-ready product
// description from a photo. Output is intentionally compact and factual so
// the downstream HS pipeline (cache + Haiku + Sonnet + TARIC) can treat it
// like any user-typed description.
const VISION_SYSTEM = `You are a product identification expert. Look at the image and produce a single concise product description suitable for HS/CN customs classification.

Output raw JSON only:
{"description":"<≤200 char factual description>","confidence":"high"|"medium"|"low","notes":"<one sentence noting any visible material/composition/use cues>"}

Rules:
- Focus on material composition, function, and physical form — these drive HS classification.
- Be specific: "white silicone phone case for iPhone 15" beats "phone accessory".
- If the image is unclear, low-quality, or shows multiple unrelated items, set confidence:"low" and describe only what is clearly visible.
- If you cannot identify a product at all (blank, blurry, unrelated scene), output {"description":"","confidence":"low","notes":"unable to identify a product in the image"}.
- Do not invent details that aren't visible. No marketing language. No brand names unless clearly readable on a label.`;

async function describeImage(base64, mediaType, hint) {
  const userParts = [
    {
      type: "image",
      source: { type: "base64", media_type: mediaType, data: base64 },
    },
    {
      type: "text",
      text: hint
        ? `User-provided hint: ${hint}\n\nDescribe the product in this image.`
        : "Describe the product in this image.",
    },
  ];
  return callClaude(VISION_SYSTEM, userParts, "claude-sonnet-4-6", 400);
}



// ── Saturn (Luxembourg ADA) verification URL ──────────────────────────────────
// The Saturn API backend is WAF-restricted (server-to-server requests return 403).
// We generate a direct deep-link so users can verify in one click.

function saturnUrl(cn10) {
  const code = (cn10 || "").replace(/\D/g, "");
  if (!code) return null;
  const today = new Date().toISOString().slice(0, 10);
  return `https://saturn.etat.lu/ite-tariff-public/#/taric/nomenclature/sbn?sd=${today}&d=I&l=en&ql=en&cn=${code}`;
}

// ── Core classification (streaming-aware) ─────────────────────────────────────

const CONFIDENCE_PCT = { high: 92, medium: 72, low: 45 };

// Tidy the model's 2-3 word product label so it's safe to surface on tiles:
// strip newlines/whitespace runs, trim, cap at 40 chars (covers any
// "Wireless headphones (large)" style overshoot without truncating mid-word).
function cleanShortLabel(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 40);
}

// Normalize the model's self-reported `alternatives` into the shape the client
// consumes. We intentionally don't TARIC-probe alternatives — cost + latency.
// Each entry is the model's ranked next-best 6-digit subheading with a short
// label and its self-calibrated confidence. Returned as [] when missing.
function normalizeAlternatives(raw, primaryHs6, primaryPct) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  if (primaryHs6) seen.add(primaryHs6);
  const cleaned = raw
    .map((a) => {
      const hs6 = String(a?.hs6 || "").replace(/\D/g, "").slice(0, 6);
      const heading = String(a?.heading || hs6).replace(/\D/g, "").slice(0, 4);
      const pctRaw = Number(a?.confidence_pct ?? a?.confidencePct);
      const confidencePct = Number.isFinite(pctRaw)
        ? Math.max(1, Math.min(99, Math.round(pctRaw)))
        : null;
      return {
        hs6,
        heading,
        confidencePct,
        label: typeof a?.label === "string" ? a.label.slice(0, 140) : "",
        reasoning: typeof a?.reasoning === "string" ? a.reasoning.slice(0, 400) : "",
      };
    })
    .filter((a) => a.hs6.length === 6 && !seen.has(a.hs6) && (seen.add(a.hs6) || true))
    .slice(0, 2);

  // Probability-coherence: primary + alternatives represent mutually exclusive
  // outcomes over the space of HS codes, so they must sum to ≤100. Models
  // routinely overshoot (e.g. 97 + 6 + 2 = 105). Scale alternatives down
  // proportionally so the totals add up cleanly without touching the primary.
  // When the primary claims so much probability mass that an alternative would
  // round to 0%, drop it rather than floor at 1% — flooring is what pushes the
  // top-3 total over 100.
  if (Number.isFinite(primaryPct) && cleaned.length > 0) {
    const headroom = Math.max(0, 100 - primaryPct);
    const altSum = cleaned.reduce((s, a) => s + (a.confidencePct ?? 0), 0);
    if (altSum > headroom) {
      if (headroom === 0) return [];
      const scale = headroom / altSum;
      let used = 0;
      for (let i = 0; i < cleaned.length - 1; i++) {
        const scaled = Math.max(0, Math.round((cleaned[i].confidencePct ?? 0) * scale));
        cleaned[i].confidencePct = scaled;
        used += scaled;
      }
      cleaned[cleaned.length - 1].confidencePct = Math.max(0, headroom - used);
    }
  }
  return cleaned.filter((a) => (a.confidencePct ?? 0) > 0);
}

async function runClassification(data, userId, isPro, emit) {
  const descNorm = normalizeDescription(data.description);
  const staleThreshold = new Date(Date.now() - CACHE_MAX_AGE_DAYS * 86400000);

  // Pro-gated knobs: `detailed` explanation level is Pro-only; free users are
  // silently downgraded to `medium`. `model: "sonnet"` override will also be
  // gated here when the client starts sending it (post-billing wiring).
  const requestedLevel = data.explanationLevel ?? "medium";
  const effectiveLevel =
    requestedLevel === "detailed" && !isPro ? "medium" : requestedLevel;

  // Pro-gated duty rate: free users keep TARIC-verified codes but not the
  // TARIC duty rate — that's a Pro unlock. We strip the rate fields from the
  // payload sent to a free user and flag `dutyRateProOnly` so the app shows a
  // locked "Pro" chip in its place. Only flags when a rate actually exists, so
  // results with no TARIC rate don't show a misleading upsell. The cache still
  // stores the full result, so Pro users get rates on a cache hit.
  const gateDutyRateForFree = (payload) => {
    if (isPro || !payload || typeof payload !== "object") return payload;
    let gated = payload;
    if (payload.standardDutyRate != null || payload.mfnRateRaw != null) {
      gated = { ...gated, standardDutyRate: null, mfnRateRaw: null, dutyRateProOnly: true };
    }
    if (Array.isArray(payload.candidates) && payload.candidates.some((c) => c?.mfnRate != null || c?.mfnRateRaw != null)) {
      gated = {
        ...gated,
        dutyRateProOnly: true,
        candidates: payload.candidates.map((c) => ({ ...c, mfnRate: null, mfnRateRaw: null })),
      };
    }
    return gated;
  };

  // Cache check
  emit({ type: "thinking", text: "Checking cache…" });
  const cached = await prisma.hsLookupCache.findUnique({ where: { descriptionNorm: descNorm } });
  if (cached && cached.updatedAt > staleThreshold) {
    const result = JSON.parse(cached.resultJson);
    // Older entries may have a bare "Other" leaf stored; surface shortLabel on read.
    result.description = meaningfulDescription(result.description, result.shortLabel);
    // Re-run alternatives normalisation on cache hits. Older entries (pre-
    // normaliser, or written by an earlier version of this code) can have raw
    // model probabilities that sum to >100% with the primary — we don't want
    // those leaking through to the UI just because they're cached.
    if (Number.isFinite(result?.confidencePct) && Array.isArray(result?.alternatives)) {
      result.alternatives = normalizeAlternatives(
        result.alternatives,
        result.hs6,
        result.confidencePct,
      );
    }
    emit({ type: "thinking", text: "Cache hit — returning saved result ⚡" });
    const cacheHitTx = [
      prisma.hsLookupCache.update({ where: { id: cached.id }, data: { hitCount: { increment: 1 } } }),
    ];
    if (data.recordHistory !== false) {
      cacheHitTx.push(prisma.hsSearchHistory.create({ data: {
        userId, description: data.description,
        shortLabel: cleanShortLabel(result.shortLabel),
        hs6: result.hs6 || null, cn8: result.cn8 || null,
        dutyRate: isPro ? (result.standardDutyRate ?? null) : null,
        confidencePct: result.confidencePct ?? null,
        fromCache: true,
      }}));
    }
    prisma.$transaction(cacheHitTx).catch(() => {});
    // Re-opens (recordHistory: false) must not create a fresh inbox notification
    // or bump the unread bell — same duplication we avoid for the history row.
    if (data.recordHistory !== false) firePushForResult(userId, result);
    emit({ type: "result", payload: gateDutyRateForFree({ ...result, fromCache: true }) });
    return;
  }
  emit({ type: "thinking", text: "Cache miss — starting AI classification" });

  // Free-tier Sonnet cap. Once a free user has burned FREE_SONNET_LIMIT
  // lifetime Sonnet escalations, the cascade caps at Haiku for the pick
  // step and skips Opus rescues. Mobile renders a "less reliable" warning
  // on the result when `_modelCapped` is true. Cache hits don't count.
  let sonnetCapped = false;
  if (!isPro) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { sonnetUsesUsed: true },
    });
    if ((u?.sonnetUsesUsed ?? 0) >= FREE_SONNET_LIMIT) sonnetCapped = true;
  }
  const pickModel = sonnetCapped ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-6";

  // Step 1: Haiku — extract structured attributes (no classification).
  // Haiku no longer picks an HS code; it produces material/function/end-use
  // signals that the deterministic narrowing step uses to shortlist headings.
  emit({ type: "thinking", text: "Haiku: extracting product attributes…" });
  const attrs = await extractAttributes(data.description);
  const attrSummary = [
    attrs.kind && `kind=${attrs.kind}`,
    attrs.material && `material=${attrs.material}`,
    attrs.likelyChapters?.length && `chapters≈${attrs.likelyChapters.join("/")}`,
  ].filter(Boolean).join(", ");
  emit({ type: "thinking", text: `Haiku → ${attrSummary || "(extraction empty — Sonnet will work from description)"}` });

  // Spell-correction: Haiku returns the description with obvious typos fixed
  // (brand names / model numbers / technical terms left verbatim). We only
  // adopt it when it actually differs from what the user typed — otherwise a
  // misspelled query ("bycicle") drops into the low-confidence candidates path
  // because the keyword matcher can't match the heading bag. The user's
  // original text is still what we store in history and the cache key.
  let effectiveDescription = data.description;
  const corrected = (attrs.correctedQuery || "").trim();
  if (corrected && normalizeDescription(corrected) !== descNorm) {
    effectiveDescription = corrected;
    emit({ type: "thinking", text: `Corrected spelling: “${data.description}” → “${corrected}”` });
  }

  // Step 2: deterministic narrowing — score every heading in the index
  // against the description + extracted attributes; keep the top N.
  const candidates = narrowHeadings(attrs, effectiveDescription, 12);
  if (candidates.length > 0) {
    const preview = candidates.slice(0, 5).map((c) => c.heading).join(", ");
    emit({ type: "thinking", text: `Narrowed to ${candidates.length} candidate heading${candidates.length !== 1 ? "s" : ""} (${preview}${candidates.length > 5 ? "…" : ""})` });
  } else {
    emit({ type: "thinking", text: "Narrowing produced no candidates — Sonnet will pick from full HS" });
  }

  // Step 3: Sonnet (or Haiku when the free-tier cap is reached) — pick the
  // 6-digit subheading from the narrowed list.
  let claudeResult;
  let modelUsed = sonnetCapped ? "haiku" : "sonnet";
  emit({
    type: "thinking",
    text: sonnetCapped
      ? "Haiku: GRI / chapter-notes pick (Sonnet cap reached — upgrade for full accuracy)"
      : "Sonnet: GRI / chapter-notes pick…",
  });
  // A free user's Sonnet allowance is only spent when we actually SHOW them a
  // usable result — a single classification or the candidates list — never for
  // a disambiguation question, an error, or a fatal. Otherwise a lookup that
  // bounces back for disambiguation would burn two uses (the question + the
  // re-classify) for one logical search. Fires at most once per run, and is a
  // no-op for Pro users and when the pick fell back to Haiku (cap reached).
  let sonnetCharged = false;
  const chargeSonnetUse = () => {
    if (sonnetCharged || isPro || sonnetCapped) return;
    sonnetCharged = true;
    // Best-effort — if the increment fails the user still gets their result;
    // we just won't have cleanly billed the call.
    prisma.user.update({
      where: { id: userId },
      data: { sonnetUsesUsed: { increment: 1 } },
    }).catch(() => {});
  };

  try {
    claudeResult = await pickFromCandidates({
      description: effectiveDescription,
      attrs,
      candidates,
      model: pickModel,
      level: effectiveLevel,
    });
    emit({
      type: "thinking",
      text: `${sonnetCapped ? "Haiku" : "Sonnet"} → ${claudeResult.hs6 ?? claudeResult.status} (${claudeResult.confidencePct ?? "—"}%)`,
    });
  } catch {
    emit({ type: "error", message: "Classification service error", status: 502 });
    return;
  }

  // Step 4: low-confidence handling.
  // First pass (data.disambiguated !== true): if Sonnet is <75% sure and has
  // plausible alternatives, bounce back to the user with a single
  // multiple-choice question whose options are the model's own labels for
  // the primary + alternatives. The user's pick is appended to the
  // description and the client re-classifies with disambiguated=true.
  //
  // Why this beats the old Opus escalation:
  //   - ~85% cheaper (~$0.03 vs ~$0.22 for an Opus run)
  //   - faster (no extra ~10-30s for Opus to think)
  //   - the user disambiguates with knowledge the model can't have
  //
  // Second pass (data.disambiguated === true): Sonnet has now seen the
  // user's pick. If it's STILL <75%, fall back to Opus as a last resort —
  // we've burned the user's patience already and can't ask twice.
  if (
    claudeResult?.status === "classified" &&
    Number.isFinite(Number(claudeResult.confidencePct)) &&
    Number(claudeResult.confidencePct) < 75
  ) {
    const altsForChoice = Array.isArray(claudeResult.alternatives)
      ? claudeResult.alternatives
          .map((a) => (typeof a?.label === "string" ? a.label.trim() : ""))
          .filter((l) => l.length > 0)
      : [];

    if (!data.disambiguated && altsForChoice.length > 0) {
      const primaryLabel =
        (typeof claudeResult.shortLabel === "string" && claudeResult.shortLabel.trim()) ||
        (typeof claudeResult.heading === "string" && claudeResult.heading) ||
        "Stick with current pick";
      // Dedupe — model occasionally repeats the primary label among alternatives.
      const seen = new Set();
      const options = [primaryLabel, ...altsForChoice]
        .map((l) => l.replace(/\s+/g, " ").trim())
        .filter((l) => l && !seen.has(l.toLowerCase()) && (seen.add(l.toLowerCase()) || true))
        .slice(0, 4);

      emit({
        type: "thinking",
        text: `Sonnet ${claudeResult.confidencePct}% < 75% — asking the user to pick (skipping Opus)`,
      });
      const askResult = {
        status: "needs_info",
        needsMoreInfo: true,
        reason: claudeResult.reasoning ?? null,
        hint: claudeResult.reasoning ?? null,
        questions: [{
          question: "Which best matches your product?",
          answers: options,
          why: "Picking the closest one helps us classify more precisely.",
        }],
      };
      emit({ type: "result", payload: askResult });
      return;
    }

    // Second-pass last resort: user already disambiguated, Sonnet still unsure.
    // Skipped for capped free users — Opus would defeat the cost cap.
    if (data.disambiguated && !sonnetCapped) {
      emit({ type: "thinking", text: `Sonnet ${claudeResult.confidencePct}% after disambiguation — escalating to Opus as last resort…` });
      try {
        const opus = await pickFromCandidates({
          description: effectiveDescription,
          attrs,
          candidates,
          model: "claude-opus-4-7",
          level: effectiveLevel,
          prior: { hs6: claudeResult.hs6, confidencePct: claudeResult.confidencePct, reasoning: claudeResult.reasoning },
        });
        if (opus?.status) {
          modelUsed = "opus";
          const sameAsSonnet = opus.status === "classified" && opus.hs6 === claudeResult.hs6;
          emit({
            type: "thinking",
            text: sameAsSonnet
              ? `Opus confirms ${opus.hs6} (${opus.confidencePct ?? "—"}%)`
              : `Opus → ${opus.hs6 ?? opus.status} (${opus.confidencePct ?? "—"}%)`,
          });
          claudeResult = opus;
        }
      } catch {
        emit({ type: "thinking", text: "Opus escalation failed — keeping Sonnet result" });
      }
    }
  }

  // Fatal
  if (claudeResult.status === "fatal") {
    emit({ type: "thinking", text: `Fatal: ${claudeResult.message}` });
    emit({ type: "error", message: claudeResult.message || "Unable to classify product", status: 400 });
    return;
  }

  // Needs more info
  if (claudeResult.status === "needs_info") {
    emit({ type: "thinking", text: "Needs more detail — preparing questions" });
    claudeResult.needsMoreInfo = true;
    claudeResult.reason = claudeResult.partial_reasoning;
    claudeResult.questions = (claudeResult.questions || []).map(q => ({
      question: q.question, answers: q.options || [], why: q.why,
    }));
    claudeResult.hint = claudeResult.partial_reasoning;
    emit({ type: "result", payload: claudeResult });
    return;
  }

  // Candidates — browse TARIC for each heading
  if (claudeResult.status === "candidates") {
    const candidateHeadings = [...new Set((claudeResult.candidates || []).map(c => (c.hs6 || "").slice(0, 4)).filter(h => h.length === 4))];
    emit({ type: "thinking", text: `Multiple candidates — probing TARIC for headings: ${candidateHeadings.join(", ")}` });

    const browseResults = await Promise.allSettled(candidateHeadings.map(h => taricBrowseHeading(h)));
    const allVerifiedByHeading = {};
    candidateHeadings.forEach((h, i) => {
      allVerifiedByHeading[h] = browseResults[i].status === "fulfilled" ? browseResults[i].value : [];
    });

    const verified = (claudeResult.candidates || []).map(c => {
      const heading = (c.hs6 || "").slice(0, 4);
      const siblings = allVerifiedByHeading[heading] || [];
      const exact = siblings.find(s => s.cn8.startsWith(c.hs6));
      const best = exact || siblings[0];
      return {
        cn10: best?.cn10 || null, cn8: best?.cn8 || null, hs6: c.hs6,
        description: best?.description || c.label, label: c.label, reasoning: c.reasoning,
        confidencePct: c.confidence_pct, mfnRate: best?.mfnRate ?? null,
        mfnRateRaw: best?.mfnRateRaw || null, taricVerified: !!best,
        declarable: best?.declarable || false,
        saturnUrl: saturnUrl(best?.cn10 || c.hs6), siblings: siblings.slice(0, 8),
      };
    }).filter(c => c.taricVerified);

    if (verified.length === 0) {
      emit({ type: "thinking", text: "TARIC: none of the AI-suggested headings exist — try a more specific description" });
      emit({ type: "error", message: "AI suggested codes that do not exist in EU TARIC. Try a more specific description.", status: 400 });
      return;
    }
    emit({ type: "thinking", text: `TARIC verified ${verified.length} candidate(s)` });
    chargeSonnetUse();
    emit({ type: "result", payload: gateDutyRateForFree({ isCandidates: true, candidates: verified, partialReasoning: claudeResult.partial_reasoning }) });
    return;
  }

  // Single classification
  let hs6 = (claudeResult.hs6 || "").replace(/\D/g, "").slice(0, 6);
  let heading = hs6.slice(0, 4);

  if (hs6.length < 4) {
    emit({ type: "error", message: "Classification service returned an invalid code", status: 502 });
    return;
  }

  // Prefer the model's self-calibrated confidencePct (0–99). Only fall back
  // to the bucket map when the response is from an older shape that didn't
  // include the field — the map exists as a safety net, not a forced bucket.
  const selfReportedPct = Number.isFinite(claudeResult.confidencePct)
    ? Math.max(0, Math.min(99, Math.round(claudeResult.confidencePct)))
    : null;
  const resolvedPct = selfReportedPct ?? CONFIDENCE_PCT[claudeResult.confidence] ?? 72;

  let finalResult = {
    ...claudeResult,
    hs6,
    taricChapter: hs6.slice(0, 2),
    rationale: claudeResult.reasoning,
    shortLabel: cleanShortLabel(claudeResult.shortLabel),
    confidencePct: resolvedPct,
    _model: modelUsed,
    _modelCapped: sonnetCapped,
    alternatives: normalizeAlternatives(claudeResult.alternatives, hs6, resolvedPct),
  };

  // ── Cross-jurisdiction existence gate (USITC HTS) ────────────────────────
  // First 6 digits are globally harmonised — if USITC doesn't know the code,
  // it's almost certainly abolished (Claude's training data still has the
  // pre-HS-2017 codes) or invalid. When rejected we do ONE Sonnet retry with
  // the rejected code as a "do not pick this" hint, turning the catch into a
  // fix rather than just a warning.
  emit({ type: "thinking", text: "Cross-checking heading against USITC…" });
  let usitcStatus = await usitcHs6Exists(hs6);
  if (usitcStatus === "missing") {
    if (sonnetCapped) {
      emit({ type: "thinking", text: `USITC: heading ${heading} not found — skipping Opus retry (cap reached)` });
    } else {
    emit({ type: "thinking", text: `USITC: heading ${heading} not found — likely abolished. Retrying with Opus…` });
    try {
      // Drop the rejected heading from the candidate set so Opus is forced
      // to pick something else. Opus also sees the bad pick via `prior` so it
      // knows what was just rejected and why.
      const retryCandidates = candidates.filter((c) => c.heading !== heading);
      const retry = await pickFromCandidates({
        description: effectiveDescription,
        attrs,
        candidates: retryCandidates,
        model: "claude-opus-4-7",
        level: effectiveLevel,
        prior: {
          hs6,
          confidencePct: claudeResult.confidencePct,
          reasoning: `Heading ${heading} was rejected: it does NOT exist in the current 2026 nomenclature (likely abolished or renumbered, e.g. 8803 → 8807, Ch 28/29 battery precursors restructured). Pick a different, currently valid 6-digit subheading.`,
        },
      });
      const retryHs6 = String(retry.hs6 || "").replace(/\D/g, "").slice(0, 6);
      if (retryHs6.length === 6 && retryHs6 !== hs6) {
        const retryStatus = await usitcHs6Exists(retryHs6);
        if (retryStatus !== "missing") {
          emit({ type: "thinking", text: `Opus retry → ${retryHs6} (${retry.confidencePct ?? "—"}%) — accepting` });
          claudeResult = retry;
          modelUsed = "opus";
          hs6 = retryHs6;
          heading = retryHs6.slice(0, 4);
          const retryPct = Number.isFinite(Number(retry.confidencePct))
            ? Math.max(0, Math.min(99, Math.round(Number(retry.confidencePct))))
            : CONFIDENCE_PCT[retry.confidence] ?? 72;
          finalResult = {
            ...retry,
            hs6,
            taricChapter: hs6.slice(0, 2),
            rationale: retry.reasoning,
            shortLabel: cleanShortLabel(retry.shortLabel),
            confidencePct: retryPct,
            _model: modelUsed,
            _modelCapped: sonnetCapped,
            alternatives: normalizeAlternatives(retry.alternatives, hs6, retryPct),
          };
          usitcStatus = retryStatus;
        } else {
          emit({ type: "thinking", text: `Opus retry also missing in USITC — giving up` });
        }
      } else {
        emit({ type: "thinking", text: `Opus retry returned no fresh code — giving up` });
      }
    } catch {
      emit({ type: "thinking", text: "Opus retry failed — giving up" });
    }
    } // end !sonnetCapped

    // If retry didn't rescue us, emit a low-confidence warning result.
    if (usitcStatus === "missing") {
      finalResult.taricVerified = false;
      finalResult.confidence = "low";
      finalResult.confidencePct = 20;
      finalResult.taricWarning = `Heading ${heading} could not be verified in either EU TARIC or US HTS — even after an Opus retry. Please re-classify with more detail.`;
      finalResult.saturnUrl = saturnUrl(hs6);
      // No cache write — don't poison other users' lookups.
      if (data.recordHistory !== false) {
        prisma.hsSearchHistory.create({ data: {
          userId, description: data.description,
          shortLabel: finalResult.shortLabel ?? null,
          hs6: finalResult.hs6 || null, cn8: null,
          dutyRate: null,
          confidencePct: finalResult.confidencePct ?? null,
          fromCache: false,
        }}).catch(() => {});
      }
      emit({ type: "result", payload: gateDutyRateForFree(finalResult) });
      return;
    }
  } else if (usitcStatus === "exists") {
    emit({ type: "thinking", text: `USITC: heading ${heading} confirmed to exist globally ✓` });
  } else {
    emit({ type: "thinking", text: "USITC check inconclusive — continuing with TARIC" });
  }

  // TARIC heading browse — skippable per-request via `autoTaricValidation`.
  // Free users always get TARIC validation (verified codes + TARIC reasoning) —
  // it's part of the free tier; only the TARIC duty rate is Pro-gated (stripped
  // by gateDutyRateForFree). The "Auto TARIC Validation" toggle is Pro-only, so
  // honour the per-request flag for Pro users (they can disable it for speed)
  // but ignore a stale `false` from a free client.
  const autoTaric = isPro ? data.autoTaricValidation !== false : true;
  if (!autoTaric) {
    emit({ type: "thinking", text: "TARIC validation disabled — returning AI result as-is" });
    finalResult.taricVerified = false;
    finalResult.saturnUrl = saturnUrl(hs6);
  }

  // Hoisted so the alternatives-enrichment step below can reuse declarable
  // CN10s the primary heading probe already fetched (free for alts in the
  // same 4-digit heading as the primary).
  let siblings = [];

  if (autoTaric) {
    emit({ type: "thinking", text: `Probing TARIC · heading ${heading}…` });
    try {
      siblings = await taricBrowseHeading(heading, [], hs6);
    } catch (e) {
      // Both SOAP + tree path already failed — siblings stays empty
    }
    // If SOAP returned empty (not thrown), try the tree as a secondary source
    if (siblings.length === 0) {
      const treeSiblings = await taricBrowseHeadingFromTree(heading);
      if (treeSiblings.length > 0) siblings = treeSiblings;
    }
    const taricFromTree = siblings.length > 0 && siblings[0]?._fromTree;

    if (siblings.length === 0) {
      // Unverified: either the heading is wrong (e.g. 8803 — abolished and
      // renumbered to 8807) or the probe missed it. Force confidence down so
      // the client surfaces it as low-trust, and set an explicit warning the
      // ResultCard renders as a terracotta banner.
      emit({ type: "thinking", text: `TARIC: heading ${heading} not matched via probe — confidence downgraded to low` });
      finalResult.taricVerified = false;
      finalResult.taricWarning = `Heading ${heading} could not be verified in EU TARIC. It may be abolished or renumbered in CN 2026 — please re-classify with more detail or verify on Saturn.`;
      finalResult.saturnUrl = saturnUrl(hs6);
      finalResult.confidence = "low";
      finalResult.confidencePct = Math.min(finalResult.confidencePct ?? 40, 40);
    } else {
      const treeNote = taricFromTree ? " (TARIC SOAP unavailable — rates via Saturn link)" : "";
      emit({ type: "thinking", text: `TARIC: found ${siblings.length} declarable CN code${siblings.length !== 1 ? "s" : ""} under ${heading}${treeNote}` });
      // Narrow disambiguation: only pick between siblings that share Claude's
      // 6-digit prefix. We trust Claude's CN6 choice — widening to the whole
      // heading causes regressions because TARIC's CN8 descriptions lose the
      // CN6-level meaning (e.g. 19024010 "Unprepared" is couscous unprepared
      // not "unprepared pasta", but the description alone reads like a match).
      const matching = siblings.filter((s) => s.cn8.startsWith(hs6));
      let exactMatch;
      // CN10 sibling disambiguation is a small lookup-style pick — Sonnet is
      // sufficient (and faster than Opus). Always use Sonnet here regardless
      // of which model picked the parent subheading.
      const pickModel = "claude-sonnet-4-6";
      if (matching.length > 1) {
        // Multiple CN10s under Claude's preferred subheading — disambiguate.
        const pickedCn10 = await pickCn8FromSiblings(
          effectiveDescription, matching, claudeResult.reasoning || "", pickModel, attrs,
        );
        const picked = pickedCn10 ? matching.find((s) => s.cn10 === pickedCn10) : null;
        if (picked) {
          exactMatch = picked;
          emit({ type: "thinking", text: `Narrowed to ${picked.cn8} from ${matching.length} candidates via description match` });
        } else {
          exactMatch = matching[0];
          emit({ type: "thinking", text: `Disambiguation inconclusive — defaulting to ${exactMatch.cn8}` });
        }
      } else if (matching.length === 1) {
        exactMatch = matching[0];
      } else {
        // Claude's 6-digit subheading has no EU TARIC entry (e.g. EU uses
        // 1902.11/1902.19 where US/WCO has 1902.10). Disambiguate across ALL
        // declarable siblings so the model picks correctly instead of falling
        // back to siblings[0] which may be a completely different product.
        emit({ type: "thinking", text: `hs6 ${hs6} not found in TARIC — running full-heading disambiguation across ${siblings.length} siblings` });
        const pickedCn10 = await pickCn8FromSiblings(
          effectiveDescription, siblings, claudeResult.reasoning || "", pickModel, attrs,
        );
        exactMatch = pickedCn10 ? siblings.find((s) => s.cn10 === pickedCn10) : null;
        if (exactMatch) {
          emit({ type: "thinking", text: `Full-heading pick: ${exactMatch.cn8} (${exactMatch.description})` });
        }
      }
      const bestMatch = exactMatch || siblings[0];

      finalResult.cn8 = bestMatch.cn8;
      finalResult.cn10 = bestMatch.cn10;
      finalResult.hs6 = bestMatch.cn8.slice(0, 6);
      finalResult.description = meaningfulDescription(bestMatch.description, finalResult.shortLabel);
      finalResult.taricVerified = !taricFromTree; // Full SOAP verification only
      finalResult.saturnUrl = saturnUrl(bestMatch.cn10);

      if (bestMatch.mfnRate !== null) {
        finalResult.standardDutyRate = bestMatch.mfnRate;
        finalResult.mfnRateRaw = bestMatch.mfnRateRaw;
        emit({ type: "thinking", text: `MFN duty rate: ${bestMatch.mfnRateRaw ?? bestMatch.mfnRate + "%"}` });
      } else if (taricFromTree) {
        emit({ type: "thinking", text: "MFN duty rate: TARIC SOAP offline — check Saturn link" });
      } else {
        emit({ type: "thinking", text: "MFN duty rate: not found in TARIC measures" });
      }

      if (!exactMatch) {
        finalResult.taricWarning = `AI suggested ${hs6} but nearest valid code is ${bestMatch.cn8.slice(0, 6)}. Review the siblings below.`;
        if (finalResult.confidence === "high") finalResult.confidence = "medium";
        emit({ type: "thinking", text: `Best match: ${bestMatch.cn8} (nearest to suggested ${hs6})` });
      } else {
        if (finalResult.confidence === "medium") finalResult.confidence = "high";
        emit({ type: "thinking", text: `Exact match: ${bestMatch.cn8}${taricFromTree ? " — nomenclature confirmed ✓" : " — TARIC confirmed ✓"}` });
      }
      // Nudge the model's self-reported pct based on TARIC feedback rather
      // than snapping to a bucket: exact match +5, non-exact −10.
      if (selfReportedPct != null) {
        const delta = exactMatch ? 5 : -10;
        finalResult.confidencePct = Math.max(40, Math.min(99, selfReportedPct + delta));
      } else {
        finalResult.confidencePct = CONFIDENCE_PCT[finalResult.confidence] ?? 72;
      }
      if (siblings.length > 1) finalResult.taricSiblings = siblings.map(s => { const { _fromTree, ...r } = s; return r; });

      const sensitiveGoods = buildSensitiveGoods(finalResult.hs6, bestMatch);
      if (sensitiveGoods) {
        finalResult.sensitiveGoods = sensitiveGoods;
        emit({ type: "thinking", text: `⚠️ Sensitive/prohibited goods: ${sensitiveGoods.category}` });
      }
    }
  }

  // ── Enrich alternatives with declarable CN10s ──────────────────────────
  // The model only returns 6-digit hs6 codes for alternatives. The UI shows
  // them next to the 10-digit primary, so without enrichment the ranks 2/3
  // look visually truncated. For alts sharing the primary's 4-digit heading
  // we pick a CN10 from the already-fetched siblings (free); for others we
  // run a targeted TARIC probe. Failures fall back to hs6-only display.
  if (autoTaric && Array.isArray(finalResult.alternatives) && finalResult.alternatives.length > 0) {
    const primaryHeading = (finalResult.hs6 ?? "").slice(0, 4);
    const otherHs6 = [
      ...new Set(
        finalResult.alternatives
          .map((a) => (a?.hs6 ?? "").replace(/\D/g, "").slice(0, 6))
          .filter((h) => h.length === 6 && h.slice(0, 4) !== primaryHeading),
      ),
    ];
    const probeResults = await Promise.all(
      otherHs6.map((h) => findFirstDeclarableCn10(h).catch(() => null)),
    );
    const cn10ByHs6 = new Map();
    otherHs6.forEach((h, i) => { if (probeResults[i]) cn10ByHs6.set(h, probeResults[i]); });

    finalResult.alternatives = finalResult.alternatives.map((alt) => {
      const h6 = (alt?.hs6 ?? "").replace(/\D/g, "").slice(0, 6);
      if (h6.length !== 6) return alt;
      // Same heading as primary → reuse siblings; prefer one whose CN8 sits
      // under this hs6, else first declarable in the heading.
      if (h6.slice(0, 4) === primaryHeading && siblings.length > 0) {
        const match = siblings.find((s) => s.cn8?.startsWith(h6)) || siblings[0];
        if (match?.cn10) return { ...alt, cn10: match.cn10, cn8: match.cn8 ?? null };
      }
      const probed = cn10ByHs6.get(h6);
      if (probed) return { ...alt, cn10: probed, cn8: probed.slice(0, 8) };
      return alt;
    });
  }

  // Cache + history (fire-and-forget)
  const resultJson = JSON.stringify(finalResult);
  const cacheTx = [
    prisma.hsLookupCache.upsert({
      where: { descriptionNorm: descNorm },
      create: { descriptionNorm: descNorm, description: data.description, resultJson, hitCount: 1 },
      update: { resultJson, hitCount: { increment: 1 } },
    }),
  ];
  if (data.recordHistory !== false) {
    cacheTx.push(prisma.hsSearchHistory.create({ data: {
      userId, description: data.description,
      shortLabel: finalResult.shortLabel ?? null,
      hs6: finalResult.hs6 || null, cn8: finalResult.cn8 || null,
      dutyRate: isPro ? (finalResult.standardDutyRate ?? null) : null,
      confidencePct: finalResult.confidencePct ?? null,
      fromCache: false,
    }}));
  }
  prisma.$transaction(cacheTx).catch(() => {});

  if (data.recordHistory !== false) firePushForResult(userId, finalResult);
  chargeSonnetUse();
  emit({ type: "result", payload: gateDutyRateForFree(finalResult) });
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req) {
  const a = await requireUser(req);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });
  const userId = a.userId;
  const isPro = a.user?.plan === "pro";

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.issues }, { status: 400 });

  const data = parsed.data;

  // ── Rate lookup (non-streaming) ───────────────────────────────────────────
  if (data.type === "rate") {
    let result;
    try {
      result = await callClaude(
        `You are an EU customs tariff expert. Given an HS or CN code, return ONLY a JSON object:
{"hs":"the code as provided","cn10":"10-digit CN code, no dots","cn8":"first 8 digits","description":"short CN heading description","mfnRate":number,"rateType":"ad valorem","note":"brief note"}`,
        `HS/CN code: ${data.code}`
      );
    } catch {
      return NextResponse.json({ error: "Classification service error" }, { status: 502 });
    }
    if (result.cn10 || result.cn8) {
      const v = await taricVerify(result.cn10 || result.cn8);
      if (v) {
        result.description = v.description;
        result.mfnRate = v.mfnRate ?? result.mfnRate;
        result.mfnRateRaw = v.mfnRateRaw;
        result.taricVerified = true;
        result.cn10 = v.code10;
        result.cn8 = v.code10.slice(0, 8);
      }
    }
    result.saturnUrl = saturnUrl(result.cn10 || result.cn8);
    return NextResponse.json(result);
  }

  // ── Image classification — derive description, then run text path ────────
  // The vision step only changes the input source; downstream caching + TARIC
  // verification + sensitive-goods handling reuse the existing pipeline so
  // results are consistent with text classification of the same product.
  if (data.type === "classify-image") {
    if (!isPro) {
      return NextResponse.json(
        { error: "Image classification is a Pro feature" },
        { status: 403 },
      );
    }

    const wantsStreamImg = req.headers.get("accept")?.includes("text/event-stream");

    const runImageFlow = async (emit) => {
      emit({ type: "thinking", text: "Vision: analysing image…" });
      let vis;
      try {
        vis = await describeImage(data.imageBase64, data.imageMediaType, data.hint);
      } catch (e) {
        console.error("[hs-lookup] Vision call failed:", e?.message || e);
        emit({ type: "error", message: "Vision service error", status: 502 });
        return;
      }
      const desc = (vis?.description || "").trim();
      if (!desc || (vis?.confidence === "low" && desc.length < 10)) {
        emit({
          type: "error",
          message: vis?.notes || "Could not identify a product in the image. Try again with a clearer photo.",
          status: 422,
        });
        return;
      }
      emit({ type: "thinking", text: `Vision: identified "${desc.slice(0, 80)}"` });
      // Hand off to the existing text-classification pipeline. Cache key is
      // the normalised description so two photos of the same product hit it.
      const textData = {
        type: "classify",
        description: desc,
        explanationLevel: data.explanationLevel,
        autoTaricValidation: data.autoTaricValidation,
      };
      await runClassification(textData, userId, isPro, emit);
    };

    if (!wantsStreamImg) {
      let payload = null;
      let errPayload = null;
      try {
        await runImageFlow((event) => {
          if (event.type === "result") payload = event.payload;
          if (event.type === "error") errPayload = event;
        });
      } catch (e) {
        return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 502 });
      }
      if (errPayload) return NextResponse.json({ error: errPayload.message }, { status: errPayload.status || 502 });
      return NextResponse.json(payload);
    }

    const enc2 = new TextEncoder();
    const stream2 = new ReadableStream({
      async start(controller) {
        const emit = (event) => {
          try { controller.enqueue(enc2.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch {}
        };
        try {
          await runImageFlow(emit);
        } catch (e) {
          emit({ type: "error", message: e?.message ?? "Unknown error", status: 502 });
        }
        controller.close();
      },
    });
    return new Response(stream2, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  }

  // ── Classification — streaming or JSON ───────────────────────────────────
  const wantsStream = req.headers.get("accept")?.includes("text/event-stream");

  if (!wantsStream) {
    // Legacy JSON path — web app and non-streaming clients
    let payload = null;
    let errPayload = null;
    await runClassification(data, userId, isPro, (event) => {
      if (event.type === "result") payload = event.payload;
      if (event.type === "error") errPayload = event;
    });
    if (errPayload) return NextResponse.json({ error: errPayload.message }, { status: errPayload.status || 502 });
    return NextResponse.json(payload);
  }

  // Streaming SSE path — mobile / progressive clients
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event) => {
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch {}
      };
      try {
        await runClassification(data, userId, isPro, emit);
      } catch (e) {
        emit({ type: "error", message: e?.message ?? "Unknown error", status: 502 });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
