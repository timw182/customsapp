import { NextResponse } from "next/server";
import { requireUser } from "@/lib/apiAuth";
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

// Cache entries older than 180 days are considered stale (CN codes update annually)
const CACHE_MAX_AGE_DAYS = 180;

function normalizeDescription(s) {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

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
});

const rateSchema = z.object({
  type: z.literal("rate"),
  code: z.string().min(4).max(14),
});

const bodySchema = z.discriminatedUnion("type", [classifySchema, rateSchema]);

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
async function pickCn8FromSiblings(description, siblings, priorReasoning = "", model = "claude-haiku-4-5-20251001") {
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
    'Output raw JSON only: {"cn10":"ten-digit string"}. The answer MUST be one of the candidates listed.';

  const reasoningBlock = priorReasoning
    ? `\nPrior analysis: ${priorReasoning}\n`
    : "";
  const user =
    `Product: ${description}${reasoningBlock}\n\n` +
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

// ── Claude call helper ────────────────────────────────────────────────────────

async function callClaude(system, userMsg, model = "claude-sonnet-4-6", maxTokens = 2500) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.error(`[hs-lookup] Claude API error (${model}):`, resp.status, errText.slice(0, 300));
    throw new Error(`Claude API ${resp.status}`);
  }
  const data = await resp.json();
  const text = data.content?.find(b => b.type === "text")?.text || "";
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch (e) {
    console.error(`[hs-lookup] JSON parse error (${model}). Raw:`, text.slice(0, 500));
    throw e;
  }
}

// Lightweight system prompt for Haiku — no WCO/BTI citation required, just correct heading.
const HAIKU_SYSTEM = `You are an EU customs classification expert. Classify products into the correct HS subheading (6-digit) for EU import.

NOMENCLATURE: CN 2026 (Reg EU 2025/1926, from 1 Jan 2026). HS 6-digit level is HS 2022.
Key changes your training may not have:
- Chapter 95 Additional Note 1 DELETED (1 Nov 2025): classify festive goods by material (GRI 1), NOT as 9505
- 8803 abolished → 8807 (aircraft parts); 8806 = UAVs
- New CN8 subheadings (TARIC resolves 8–10 digits, you only return 6): NMC oxide 2841 90, LFP 2842 90, artificial graphite 3801 10, PV wafers 3818 00, wind tower 7308 20, turbine rotors/blades 8410 90/8412 90, H2 fuel cell gen 8501 33, MPPT inverter 8504 40, battery separator 8507 90, electrolysis cell stack 8543 90

Output raw JSON only. Two options:

OPTION A — confident (clear single heading):
{"status":"classified","hs6":"6-digit","heading":"4-digit","confidence":"high","confidencePct":<integer 70-99>,"reasoning":"1-2 sentence justification citing the key GRI or chapter note","alternatives":[{"hs6":"6-digit","heading":"4-digit","confidence_pct":<integer 1-69>,"label":"short product label for this alternative","reasoning":"1 short sentence: why this was considered and why it was rejected in favour of the primary"},{"hs6":"6-digit","heading":"4-digit","confidence_pct":<integer 1-69>,"label":"short product label","reasoning":"1 short sentence"}]}

OPTION B — not confident (ambiguous, needs info, multiple options, or unusual product):
{"status":"escalate","reason":"why you are not confident"}

Rules for alternatives in OPTION A:
- ALWAYS include exactly 2 alternatives — the 2 next-most-plausible 6-digit subheadings you considered and ruled out.
- Each alternative's confidence_pct must be LESS than the primary confidencePct, and must sum with the primary to ≤100.
- Ordered by confidence_pct descending.
- Use real HS 2022 subheadings — do not invent codes.

The confidencePct field must reflect a calibrated probability that your chosen hs6 is the correct 6-digit subheading under GRI 1 — be honest, not optimistic:
- 95–99: textbook case, the description unambiguously lands on one subheading with no competing headings
- 85–94: clear classification but one secondary heading you ruled out
- 75–84: reasonable confidence, multiple plausible headings, you picked one based on the dominant characteristic
- 70–74: borderline — consider returning escalate instead

Rules:
- Return OPTION A only when you are genuinely certain of the 6-digit subheading
- Return OPTION B for anything ambiguous, multi-material, dual-use, specialty chemical, or where you would normally ask a follow-up question
- Never refuse to classify — if completely unsure return OPTION B
- Output raw JSON, no markdown`;

const CLASSIFY_SYSTEM = `You are a customs classification expert specializing in EU Combined Nomenclature (CN) and TARIC.

Your task: classify products into the correct HS HEADING (4-digit) and SUBHEADING (6-digit) based on a description.

CRITICAL: You must ONLY return 6-digit HS codes (subheading level). The 7th–10th digits (CN8/TARIC) will be resolved automatically from the official EU TARIC database. Do NOT guess CN8 or CN10 codes — they change annually and your training data may be outdated.

NOMENCLATURE IN FORCE: Use CN 2026 (Commission Implementing Regulation (EU) 2025/1926, OJ L 31.10.2025, applicable from 1 January 2026). The 6-digit HS subheadings are still HS 2022 — only the EU's 8–10 digit CN extensions changed. Key restructuring to know:
- HS 2017: 8803 abolished → 8807; 8806 (UAVs) added
- HS 2022: Chapter 28/29 battery precursors restructured
- CN 2026 (new at CN8 level, your training data will NOT have these — TARIC probing handles them):
  • 2841 90 40 — Lithium nickel manganese cobalt oxides (NMC cathode powder) [was: 2841 90 other]
  • 2842 90 20 — Lithium iron phosphate (LFP cathode powder) [was: 2842 90 other]
  • 3801 10 10/90 — Artificial graphite split by ash content [was: 3801 10 00]
  • 3818 00 1x — Photovoltaic silicon wafers ≤200 µm (so-called PV wafers) [new split]
  • 7308 20 10 — Tubular wind turbine steel towers and tower-sections [was: 7308 20 other, now free]
  • 8410 90 10/20 — Rotors / Stators for hydraulic turbines [was: 8410 90 other]
  • 8412 90 60 — Wind turbine blades [was: 8412 90 other]
  • 8501 33 10 — Hydrogen fuel cell generators 75–375 kW [was: 8501 33 other]
  • 8504 40 84 — Inverters with maximum power point tracking (MPPT) functionality [was: 8504 40 other]
  • 8507 90 31/39 — Battery separators of plastic film ≤40 µm / other [was: 8507 90 other]
  • 8543 90 10 — Assemblies of stacked galvanic cells for water electrolysis (H₂/O₂ production) [was: 8543 90 other]
  • Chapter 29 new: 2909 30 37 (decabromodiphenyl ether), 2915 60 11 (1-isopropyl-2,2-dimethyltrimethylene diisobutyrate)

CLASSIFICATION RULE CHANGES — these affect the correct 6-digit heading, not just CN8 extensions:

1. CHAPTER 95 — Christmas articles (effective 1 November 2025, Reg EU 2025/1926 Art.1(1)):
   Additional Note 1 to Chapter 95 has been DELETED. This note previously overrode GRI and classified Christmas/festive articles under 9505 regardless of their material or function.
   Now apply GRI 1 strictly by material and function:
   - Plastic Christmas tree ornaments → Chapter 39 (plastics), not 9505
   - Glass Christmas ornaments → Chapter 70, not 9505
   - Textile advent calendars → Chapter 63, not 9505
   - Purpose-made Christmas crackers (pyrotechnic) → 3604
   - Articles that ARE toys (playable by children) → 9503, not 9505
   ONLY classify under 9505 if the article is exclusively a festivity decoration with no other function and cannot be classified more specifically elsewhere. When in doubt, classify by material.

2. DICHLOROETHYLENE / HALOGENATED ETHYLENE MIXTURES (Annex 10 amendment, Reg EU 2025/1926):
   Dichloroethylene and mixtures containing halogenated derivatives of ethylene or propylene CANNOT be classified as derivatives of ethane (Chapter 29 ethane subheadings). These must be classified under their own specific subheadings as halogenated derivatives of ethylene/propylene:
   - 1,2-dichloroethylene → 2903 29 (halogenated derivatives of acyclic hydrocarbons, unsaturated)
   - Mixtures of halogenated ethylene/propylene derivatives → 2903 or 3824 depending on composition and use
   Do NOT classify these as ethane derivatives.

When classifying CN 2026 product types in the list above, note in your reasoning that a dedicated CN 2026 subheading exists at the 8-digit level (TARIC will resolve it). Classify to the correct 6-digit HS subheading.

PROCESS:
1. Extract key classification attributes: material, function/use, product category, level of processing
2. Check Chapter Notes and Section Notes for exclusions first (GRI 1)
3. For festive/seasonal goods: apply GRI 1 by material since Chapter 95 Note 1 is deleted
4. For halogenated hydrocarbons: verify ethylene vs ethane origin before selecting subheading
5. Map to the most specific 6-digit HS subheading
6. For clean-energy goods (battery materials, wind/solar, electrolysis), flag CN 2026 subheading in reasoning

RESPONSE FORMAT — pick exactly ONE of the four options below. Output raw JSON only, no markdown, no code fences.

OPTION 1 — HIGH/MEDIUM CONFIDENCE (you can determine a single subheading):
{
  "status": "classified",
  "hs6": "6-digit string (e.g. 880730)",
  "heading": "4-digit heading (e.g. 8807)",
  "confidence": "high | medium",
  "confidencePct": <integer 60-99>,
  "reasoning": "Authoritative reasoning citing: (1) which GRI applies (GRI 1–6) and why, (2) the relevant Chapter Note or Section Note by number (e.g. 'Chapter 61 Note 3 excludes...'), (3) the WCO Explanatory Note for the heading/subheading (e.g. 'EN 6203 covers...'), (4) any applicable EU BTI reference or CJEU ruling. If a CN 2026 dedicated subheading exists for this product, state it explicitly. Be specific — quote the rule, do not just name it.",
  "chapter": "HS chapter name",
  "notes": "any ambiguity, assumptions, or CN 2026 subheading notes",
  "alternatives": [
    {"hs6": "6-digit string", "heading": "4-digit heading", "confidence_pct": <integer 1-59>, "label": "short product label for this alternative", "reasoning": "1-2 sentence summary: why this subheading was considered and why it was rejected in favour of the primary (cite the deciding GRI / chapter note)"},
    {"hs6": "6-digit string", "heading": "4-digit heading", "confidence_pct": <integer 1-59>, "label": "short product label", "reasoning": "1-2 sentence summary"}
  ]
}

Rules for alternatives in OPTION 1:
- ALWAYS include exactly 2 alternatives — the 2 next-most-plausible 6-digit subheadings that you seriously considered and ruled out.
- Each alternative's confidence_pct must be LESS than the primary confidencePct, and the three values (primary + 2 alternatives) must sum to ≤100.
- Ordered by confidence_pct descending.
- Alternatives must be real HS 2022 subheadings — do not invent codes. Prefer subheadings in different chapters/headings when the disambiguation hinged on material or function.

The confidencePct field is a calibrated probability that your chosen hs6 is the correct 6-digit subheading under GRI. Be honest, not rounded:
- 95–99: unambiguous, one clear heading, no competing notes
- 85–94: strong case, one secondary heading ruled out by a named note
- 75–84: reasonable fit, multiple headings considered, picked on dominant characteristic
- 60–74: weak fit — strongly consider switching to OPTION 2 (needs_info) instead

OPTION 2 — NEED MORE INFO:
{
  "status": "needs_info",
  "questions": [
    {
      "question": "The specific question to ask",
      "why": "Brief reason this matters for classification",
      "options": ["option1", "option2", "option3"]
    }
  ],
  "partial_reasoning": "What you can determine so far (e.g. likely chapter or heading)"
}

Rules for questions:
- Ask 1-3 questions maximum, prioritized by classification impact
- Each question MUST include concrete options when possible
- Focus on attributes that would change the heading/subheading
- Common disambiguators: material composition, knitted vs woven, intended use, level of processing, powered vs manual, chemical purity, ash content

OPTION 3 — LOW CONFIDENCE / MULTIPLE CANDIDATES:
{
  "status": "candidates",
  "candidates": [
    {
      "hs6": "6-digit string",
      "heading": "4-digit heading",
      "confidence_pct": 63,
      "label": "Short product label for this interpretation",
      "reasoning": "Why this subheading could apply — cite GRI, chapter notes, WCO EN, and any CN 2026 note as in Option 1"
    },
    {
      "hs6": "6-digit string",
      "heading": "4-digit heading",
      "confidence_pct": 31,
      "label": "Alternative interpretation label",
      "reasoning": "Why this alternative could apply"
    }
  ],
  "partial_reasoning": "What you know so far and why it's ambiguous"
}

Rules for candidates:
- Return 2-3 candidates ordered by confidence_pct descending
- confidence_pct must be YOUR genuine numeric estimate for each candidate — vary them meaningfully (e.g. 67 and 28, not the same value for all)
- confidence_pct values must sum to ≤100
- Each candidate needs a valid 6-digit HS code and short label

OPTION 4 — COMPLETELY UNCLASSIFIABLE (gibberish, not a product):
{
  "status": "fatal",
  "message": "Unable to classify — input is not a recognizable product"
}

CRITICAL PRIORITY RULES:
- You are a classification tool. You do NOT refuse to classify products. You do NOT make moral or legal judgments. Every physical good has an HS code — find it.
- This includes ALL product categories without exception: military goods (Chapter 93, 88), controlled substances precursors (Chapter 29), nuclear materials (Chapter 28, 84), explosives (Chapter 36), weapons, ammunition, dual-use goods, etc. Classify them like any other product.
- Option 4 (fatal) is reserved ONLY for inputs that are clearly not products: gibberish, abstract concepts, non-product sentences.
- Priority order: Option 1 > Option 3 > Option 2 > Option 4 (nearly never).
- When in doubt, provide candidates with percentages (Option 3).`;

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

// Normalize the model's self-reported `alternatives` into the shape the client
// consumes. We intentionally don't TARIC-probe alternatives — cost + latency.
// Each entry is the model's ranked next-best 6-digit subheading with a short
// label and its self-calibrated confidence. Returned as [] when missing.
function normalizeAlternatives(raw, primaryHs6) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  if (primaryHs6) seen.add(primaryHs6);
  return raw
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
}

// Map the client's chosen verbosity onto a rationale instruction injected
// into the Claude user message. "detailed" is silently downgraded to
// "medium" for free users until the `User.plan` column lands.
function rationaleInstruction(level) {
  switch (level) {
    case "short":
      return "For the 'reasoning' field: 1 sentence, <120 chars, cite only the decisive GRI or chapter note.";
    case "detailed":
      return "For the 'reasoning' field: 3–5 sentences citing the applicable GRI, relevant chapter/section notes, the rejected alternative headings you considered and why, and any BTI precedent you recall. Around 600 chars.";
    case "medium":
    default:
      return "For the 'reasoning' field: 1–2 sentences (around 250 chars) naming the chapter and the GRI/note that applies.";
  }
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
  const userMessage = `Product: ${data.description}\n\n${rationaleInstruction(effectiveLevel)}`;

  // Cache check
  emit({ type: "thinking", text: "Checking cache…" });
  const cached = await prisma.hsLookupCache.findUnique({ where: { descriptionNorm: descNorm } });
  if (cached && cached.updatedAt > staleThreshold) {
    const result = JSON.parse(cached.resultJson);
    emit({ type: "thinking", text: "Cache hit — returning saved result ⚡" });
    prisma.$transaction([
      prisma.hsLookupCache.update({ where: { id: cached.id }, data: { hitCount: { increment: 1 } } }),
      prisma.hsSearchHistory.create({ data: {
        userId, description: data.description,
        hs6: result.hs6 || null, cn8: result.cn8 || null,
        dutyRate: result.standardDutyRate ?? null,
        confidencePct: result.confidencePct ?? null,
        fromCache: true,
      }}),
    ]).catch(() => {});
    firePushForResult(userId, result);
    emit({ type: "result", payload: { ...result, fromCache: true } });
    return;
  }
  emit({ type: "thinking", text: "Cache miss — starting AI classification" });

  // Step 1: Haiku triage
  let claudeResult;
  let modelUsed = "haiku";
  emit({ type: "thinking", text: "Haiku: fast-path analysis…" });
  try {
    const haiku = await callClaude(HAIKU_SYSTEM, userMessage, "claude-haiku-4-5-20251001", 600);
    if (haiku.status === "classified" && haiku.confidence === "high" && haiku.hs6?.length >= 6) {
      emit({ type: "thinking", text: `Haiku → ${haiku.hs6} (high confidence)` });
      claudeResult = {
        status: "classified",
        hs6: haiku.hs6,
        heading: haiku.heading || haiku.hs6.slice(0, 4),
        confidence: "high",
        reasoning: haiku.reasoning || "",
        chapter: "",
        notes: "Classified by Haiku (fast path)",
        alternatives: haiku.alternatives,
      };
    } else {
      emit({ type: "thinking", text: `Haiku uncertain (${haiku.status ?? "—"}) → escalating to Sonnet` });
      modelUsed = "sonnet";
      emit({ type: "thinking", text: "Sonnet: full GRI / WCO / CN 2026 analysis…" });
      claudeResult = await callClaude(CLASSIFY_SYSTEM, userMessage);
      emit({ type: "thinking", text: `Sonnet → ${claudeResult.hs6 ?? claudeResult.status} (${claudeResult.confidence ?? "—"})` });
    }
  } catch {
    emit({ type: "thinking", text: "Haiku failed → falling back to Sonnet" });
    modelUsed = "sonnet";
    emit({ type: "thinking", text: "Sonnet: full GRI / WCO / CN 2026 analysis…" });
    try {
      claudeResult = await callClaude(CLASSIFY_SYSTEM, userMessage);
      emit({ type: "thinking", text: `Sonnet → ${claudeResult.hs6 ?? claudeResult.status} (${claudeResult.confidence ?? "—"})` });
    } catch {
      emit({ type: "error", message: "Classification service error", status: 502 });
      return;
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
    emit({ type: "result", payload: { isCandidates: true, candidates: verified, partialReasoning: claudeResult.partial_reasoning } });
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
    confidencePct: resolvedPct,
    _model: modelUsed,
    alternatives: normalizeAlternatives(claudeResult.alternatives, hs6),
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
    emit({ type: "thinking", text: `USITC: heading ${heading} not found — likely abolished. Retrying with Sonnet…` });
    try {
      const retryMessage =
        `${userMessage}\n\n` +
        `CRITICAL: The heading ${heading} does NOT exist in the current 2026 nomenclature. ` +
        `It was almost certainly abolished or renumbered (e.g. HS 2017 moved 8803 → 8807, ` +
        `HS 2022 restructured Ch 28/29 battery precursors). Pick a different, currently ` +
        `valid 6-digit subheading. If unsure, return status=escalate or needs_info.`;
      const retry = await callClaude(CLASSIFY_SYSTEM, retryMessage);
      const retryHs6 = String(retry.hs6 || "").replace(/\D/g, "").slice(0, 6);
      if (retryHs6.length === 6 && retryHs6 !== hs6) {
        const retryStatus = await usitcHs6Exists(retryHs6);
        if (retryStatus !== "missing") {
          emit({ type: "thinking", text: `Sonnet retry → ${retryHs6} (${retry.confidence ?? "—"}) — accepting` });
          // Swap to the retry result and continue normal TARIC processing below.
          claudeResult = retry;
          modelUsed = "sonnet";
          hs6 = retryHs6;
          heading = retryHs6.slice(0, 4);
          const retryPct = Number.isFinite(retry.confidencePct)
            ? Math.max(0, Math.min(99, Math.round(retry.confidencePct)))
            : CONFIDENCE_PCT[retry.confidence] ?? 72;
          finalResult = {
            ...retry,
            hs6,
            taricChapter: hs6.slice(0, 2),
            rationale: retry.reasoning,
            confidencePct: retryPct,
            _model: modelUsed,
            alternatives: normalizeAlternatives(retry.alternatives, hs6),
          };
          usitcStatus = retryStatus; // update for the downstream success path
        } else {
          emit({ type: "thinking", text: `Sonnet retry also missing in USITC — giving up` });
        }
      } else {
        emit({ type: "thinking", text: `Sonnet retry returned no fresh code — giving up` });
      }
    } catch (e) {
      emit({ type: "thinking", text: "Sonnet retry failed — giving up" });
    }

    // If retry didn't rescue us, emit a low-confidence warning result.
    if (usitcStatus === "missing") {
      finalResult.taricVerified = false;
      finalResult.confidence = "low";
      finalResult.confidencePct = 20;
      finalResult.taricWarning = `Heading ${heading} could not be verified in either EU TARIC or US HTS — even after a Sonnet retry. Please re-classify with more detail.`;
      finalResult.saturnUrl = saturnUrl(hs6);
      // No cache write — don't poison other users' lookups.
      prisma.hsSearchHistory.create({ data: {
        userId, description: data.description,
        hs6: finalResult.hs6 || null, cn8: null,
        dutyRate: null,
        confidencePct: finalResult.confidencePct ?? null,
        fromCache: false,
      }}).catch(() => {});
      emit({ type: "result", payload: finalResult });
      return;
    }
  } else if (usitcStatus === "exists") {
    emit({ type: "thinking", text: `USITC: heading ${heading} confirmed to exist globally ✓` });
  } else {
    emit({ type: "thinking", text: "USITC check inconclusive — continuing with TARIC" });
  }

  // TARIC heading browse — skippable per-request via `autoTaricValidation`.
  const autoTaric = data.autoTaricValidation !== false; // default on
  if (!autoTaric) {
    emit({ type: "thinking", text: "TARIC validation disabled — returning AI result as-is" });
    finalResult.taricVerified = false;
    finalResult.saturnUrl = saturnUrl(hs6);
  }

  if (autoTaric) {
    emit({ type: "thinking", text: `Probing TARIC · heading ${heading}…` });
    let siblings = [];
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
      const pickModel = modelUsed === "sonnet" ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001";
      if (matching.length > 1) {
        // Multiple CN10s under Claude's preferred subheading — disambiguate.
        const pickedCn10 = await pickCn8FromSiblings(
          data.description, matching, claudeResult.reasoning || "", pickModel,
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
          data.description, siblings, claudeResult.reasoning || "", pickModel,
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
      finalResult.description = bestMatch.description;
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

  // Cache + history (fire-and-forget)
  const resultJson = JSON.stringify(finalResult);
  prisma.$transaction([
    prisma.hsLookupCache.upsert({
      where: { descriptionNorm: descNorm },
      create: { descriptionNorm: descNorm, description: data.description, resultJson, hitCount: 1 },
      update: { resultJson, hitCount: { increment: 1 } },
    }),
    prisma.hsSearchHistory.create({ data: {
      userId, description: data.description,
      hs6: finalResult.hs6 || null, cn8: finalResult.cn8 || null,
      dutyRate: finalResult.standardDutyRate ?? null,
      confidencePct: finalResult.confidencePct ?? null,
      fromCache: false,
    }}),
  ]).catch(() => {});

  firePushForResult(userId, finalResult);
  emit({ type: "result", payload: finalResult });
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
