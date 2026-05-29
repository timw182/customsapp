// Shared HS-classification core — the pure, model-facing pipeline used by both
// the production route (src/app/api/hs-lookup/route.js) and the offline eval /
// test harnesses (scripts/eval-classify.mjs, scripts/test-classify.mjs).
//
// Everything here is free of Next.js / Prisma / TARIC-SOAP dependencies so it
// can be imported from plain Node. Keeping it in ONE place is what stops the
// harnesses from drifting away from what production actually runs.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Heading-keyword index (deterministic narrowing). Built by
// scripts/build-heading-index.mjs from the EU TARIC nomenclature tree.
// Shape: { headings: { "8407": { description, keywords: [...] }, ... } }
// Loaded once at module init. Production runs from the project root, so
// cwd/data/... resolves; scripts may run from elsewhere, so we fall back to a
// path resolved relative to this file.
function loadHeadingIndex() {
  const candidates = [
    path.join(process.cwd(), "data", "heading-index.json"),
    fileURLToPath(new URL("../../data/heading-index.json", import.meta.url)),
  ];
  for (const p of candidates) {
    try {
      const idx = JSON.parse(readFileSync(p, "utf8"));
      console.log(`[hs-lookup] Loaded heading index: ${Object.keys(idx.headings || {}).length} headings`);
      return idx;
    } catch {
      // try next candidate
    }
  }
  console.warn("[hs-lookup] heading-index.json missing — narrowing disabled (run scripts/build-heading-index.mjs)");
  return { headings: {} };
}
let HEADING_INDEX = loadHeadingIndex();

function normalizeDescription(s) {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

const INDEX_STOPWORDS = new Set([
  "and","or","of","the","for","with","without","to","in","on","by","from",
  "a","an","as","at","be","is","it","its","not","that","this","other","any",
  "all","more","less","than","etc","containing","made","having","used",
  "product","item","items","goods","type","kind","form","new","used",
  "small","large","high","low",
]);

// Conservative plural→singular folding so query "motorcycle" matches a heading
// keyword bag built from "motorcycles". Applied at both ends (query + bag) so
// the result is symmetric regardless of which side came pluralised. Only fires
// for tokens of length ≥ 5 and skips known false-positive suffixes (ss, us, is)
// to keep "glass", "gas", "axis" from being mangled.
function foldPlural(t) {
  if (t.length < 5) return t;
  if (t.endsWith("ies")) return t.slice(0, -3) + "y";          // batteries → battery
  if (
    t.endsWith("sses") ||                                       // classes → class
    t.endsWith("xes") ||                                        // boxes → box
    t.endsWith("ches") ||                                       // watches → watch
    t.endsWith("shes")                                          // dishes → dish
  ) return t.slice(0, -2);
  if (t.endsWith("s") && !t.endsWith("ss") && !t.endsWith("us") && !t.endsWith("is")) {
    return t.slice(0, -1);                                      // motorcycles → motorcycle
  }
  return t;
}

function indexTokens(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim().replace(/^-+|-+$/g, ""))
    .filter((t) => t.length >= 3 && !INDEX_STOPWORDS.has(t) && !/^\d+$/.test(t))
    .map(foldPlural);
}

// Precomputed scoring model over the heading corpus, built once (lazily) from
// HEADING_INDEX so narrowHeadings doesn't re-tokenise 1300+ headings every call
// and so tokens can be weighted by rarity. For each heading we keep its
// description/keyword token sets + token count; across the corpus we keep each
// token's document frequency → BM25 idf, and the average doc length. Rebuilt
// only if the index object identity changes.
let _scoringModel = null;
let _scoringFor = null;
function getScoringModel() {
  const headings = HEADING_INDEX?.headings || {};
  if (_scoringModel && _scoringFor === HEADING_INDEX) return _scoringModel;
  const docs = new Map();   // h4 → { desc, descSet, kwSet, len }
  const df = new Map();     // token → number of headings containing it
  let totalLen = 0, n = 0;
  for (const [h4, entry] of Object.entries(headings)) {
    if (h4.endsWith("00")) continue;            // chapter-umbrella rows aren't real headings
    const descSet = new Set(indexTokens(entry.description));
    const kwSet = new Set((entry.keywords || []).map(foldPlural));
    const all = new Set([...descSet, ...kwSet]);
    docs.set(h4, { desc: entry.description, descSet, kwSet, len: all.size });
    for (const t of all) df.set(t, (df.get(t) || 0) + 1);
    totalLen += all.size; n++;
  }
  const idf = new Map();
  for (const [t, d] of df) idf.set(t, Math.log(1 + (n - d + 0.5) / (d + 0.5))); // BM25 idf
  _scoringModel = { docs, idf, avgdl: n ? totalLen / n : 1 };
  _scoringFor = HEADING_INDEX;
  return _scoringModel;
}

/**
 * Score every heading in the index against the product attributes + raw
 * description and return the top N candidates. Returns [] if the index is
 * missing — the caller falls back to letting Sonnet pick from full HS.
 *
 * Scoring is BM25 over the heading's description + keyword bag, so a rare,
 * discriminating token (e.g. "saffron", "turbojet", "vacuum") far outweighs a
 * ubiquitous one (e.g. "other", "article", "machine"), and a heading with a
 * huge keyword bag no longer matches everything by chance (length norm). A
 * description hit outweighs a keyword-bag hit (FIELD_DESC vs FIELD_KW).
 * Haiku's likelyChapters apply a gentle multiplicative prior on top.
 *
 * Always seeds the top of `likelyChapters` so the model still sees Haiku's
 * preferred chapters even when keyword scoring misses (e.g. specs-heavy
 * descriptions with little prose).
 */
function narrowHeadings(attrs, description, limit = 12) {
  const headings = HEADING_INDEX?.headings;
  if (!headings || Object.keys(headings).length === 0) return [];

  const queryParts = [
    description,
    attrs?.kind,
    attrs?.material,
    attrs?.function,
    attrs?.endUse,
    attrs?.attributes?.form,
    attrs?.attributes?.processing,
    attrs?.attributes?.specs,
    ...(Array.isArray(attrs?.keywords) ? attrs.keywords : []),
  ].filter(Boolean).join(" ");
  const queryTokens = new Set(indexTokens(queryParts));
  if (queryTokens.size === 0) return [];

  const likely = Array.isArray(attrs?.likelyChapters)
    ? attrs.likelyChapters.map((c) => String(c).padStart(2, "0").slice(0, 2))
    : [];
  const likelySet = new Set(likely);
  const primaryChapter = likely[0] || null;

  // BM25 token scoring. Field weights boost a description hit over a keyword-bag
  // hit; k1/b are standard BM25 knobs (b < 0.75 since HS doc lengths vary a lot).
  const { docs, idf, avgdl } = getScoringModel();
  const K1 = 1.2, B = 0.5, FIELD_DESC = 2.0, FIELD_KW = 1.0;
  const scored = [];
  for (const [h4, doc] of docs) {
    const chapter = h4.slice(0, 2);
    let score = 0;
    for (const tok of queryTokens) {
      const inDesc = doc.descSet.has(tok);
      const inKw = !inDesc && doc.kwSet.has(tok);
      if (!inDesc && !inKw) continue;
      const f = inDesc ? FIELD_DESC : FIELD_KW;
      score += (idf.get(tok) || 0) * (f * (K1 + 1)) / (f + K1 * (1 - B + B * doc.len / avgdl));
    }
    if (score === 0 && !likelySet.has(chapter)) continue;

    // Gentle multiplicative chapter prior (replaces the old ×1.5 + flat +5,
    // which on the new score scale would either dominate or vanish). A strong
    // lexical match in an unexpected chapter can now still surface.
    if (chapter === primaryChapter) score *= 1.8;
    else if (likelySet.has(chapter)) score *= 1.4;
    scored.push({ heading: h4, description: doc.desc, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);

  // Always include at least one heading from each likelyChapter so Haiku's
  // chapter hint is represented even when keyword scoring misses entirely.
  const includedChapters = new Set(top.map((c) => c.heading.slice(0, 2)));
  for (const ch of likely) {
    if (includedChapters.has(ch)) continue;
    const fallback = Object.entries(headings)
      .filter(([h]) => h.startsWith(ch) && !h.endsWith("00"))
      .map(([h, e]) => ({ heading: h, description: e.description, score: 0 }))
      .slice(0, 2);
    top.push(...fallback);
    if (top.length >= limit + 4) break;
  }

  return top.slice(0, limit + 4);
}

// ── Claude call helper ────────────────────────────────────────────────────────

async function callClaude(system, userMsg, model = "claude-sonnet-4-6", maxTokens = 2500) {
  // userMsg may be a plain string (text-only) OR an array of content blocks
  // for multimodal input (e.g. [{type:"image",source:{...}}, {type:"text",text:"..."}]).
  // Anthropic's API accepts both shapes; pass through unchanged.
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

// Haiku no longer classifies — it extracts structured attributes that drive
// the deterministic narrowing step. Removing Haiku from the classification
// decision eliminated a class of confident-but-wrong outputs that were
// previously accepted on the fast path.
const HAIKU_EXTRACT_SYSTEM = `You are a product attribute extractor for EU customs classification (CN 2026 / HS 2022). Read the product description and output the structural attributes that determine HS classification. You do NOT pick an HS code — that is the next stage's job.

Output raw JSON only, no markdown:
{
  "correctedQuery": "<the description rewritten with obvious spelling/typo mistakes in ordinary product words corrected (e.g. 'bycicle'→'bicycle', 'aluminium tyre'→'aluminium tyre'). PRESERVE brand names, model numbers, units, part codes and unfamiliar technical/material terms EXACTLY as written. Do not expand abbreviations, add words, or change meaning. If nothing needs fixing, repeat the description verbatim.>",
  "kind": "<short noun phrase: what is this thing? e.g. 'turbojet engine', 'cotton t-shirt', 'lithium iron phosphate cathode powder'>",
  "material": "<dominant material(s), lowercase, comma-separated for blends — e.g. 'aluminium', '60% cotton, 40% polyester'>",
  "function": "<what it does or its primary purpose>",
  "endUse": "<industrial | consumer | automotive | aerospace | medical | military | construction | agricultural | food | textile-apparel | other>",
  "attributes": {
    "form": "<solid | liquid | powder | gel | sheet | bulk | finished article | part | component | accessory | ...>",
    "processing": "<raw | semi-processed | finished | assembled | knocked-down | unknown>",
    "powered": "<powered | non-powered | unknown>",
    "specs": "<short string of key numeric specs (e.g. '500 cm³, 75 kW, diesel') or empty>"
  },
  "keywords": ["<5-15 lowercase single words or compound nouns most useful for nomenclature lookup>"],
  "likelyChapters": ["<2-digit HS chapter numbers you'd consider, ordered by likelihood, max 4 e.g. ['85','84']>"]
}

Rules:
- "correctedQuery": fix ONLY clear misspellings of common product words. Never touch brand names, model numbers, units, codes, or technical/material terms you don't recognise — copy them through unchanged. When in doubt, leave the word as-is. This is spell-correction, not rewriting.
- DO NOT output an HS code, heading number, or subheading. Your job is attribute extraction.
- Be specific and discriminating. "alloy steel structural beam" > "metal part". Avoid generic adjectives.
- For "keywords": pick terms that distinguish this product within the HS nomenclature (materials, forms, technical specs, functional descriptors). Skip generic words like "product", "item", brand names.
- "likelyChapters" is a hint for the next stage — give your best 1-4 chapter guesses based on the kind/material/function. Never invent chapters.
- If a field is genuinely unknown from the description, return "" (or [] for arrays). Do not invent.
- Output raw JSON, no markdown.`;

// Used by Sonnet (and Opus, when escalated) to pick the final 6-digit
// subheading from a deterministically-narrowed candidate list.
const PICK_SYSTEM = `You are a customs classification expert specializing in EU Combined Nomenclature (CN) and TARIC.

Your task: given a product description, extracted attributes, and a SHORTLIST of candidate 4-digit headings, pick the correct 6-digit HS SUBHEADING.

CRITICAL: You must ONLY return 6-digit HS codes (subheading level). The 7th–10th digits (CN8/TARIC) will be resolved automatically from the official EU TARIC database. Do NOT guess CN8 or CN10 codes — they change annually and your training data may be outdated.

The candidate headings were generated by a deterministic keyword match against the EU TARIC nomenclature tree. They are STRONG signals — prefer one of them unless none fits, in which case you may pick a different heading and flag it in your reasoning.

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

3. MIXTURES / ASSORTMENTS OF MULTIPLE KINDS within one heading (GRI 3(b) and named subheadings):
   When the product is a mixture, blend, assortment, medley, or "several different / mixed / varied" members of the same heading, and that heading has a dedicated "Mixtures of …" subheading, the mixture subheading wins over the generic "Other" subheading. Do not collapse a true mixture into an "other" residual when a named mixture subheading exists. Examples:
   - Frozen mixed vegetables (peas + carrots + corn + …) → 0710 90 (Mixtures of vegetables), NOT 0710 80 (Other vegetables)
   - Mixed dried vegetables → 0712 90 (incl. mixtures of dried vegetables)
   - Mixed dried fruits / mixed nuts → 0813 50 (Mixtures of nuts or dried fruits)
   - Mixed frozen fruit → 0811 90 (Other — includes mixtures); check 0811 subheading notes
   - Mixed prepared/preserved vegetables → 2004 90 (frozen) / 2005 99 (not frozen)
   - Curry / mixed spices / spice blends → 0910 91 (Mixtures of spices)
   - Muesli (mixed cereals + fruit + nuts) → 1904 10 / 1904 20 depending on form
   Rule of thumb: if the user says "mixed", "mixture", "assorted", "variety", "medley", "several different", or lists multiple sibling products from one heading, pick the named mixture subheading first.

When classifying CN 2026 product types in the list above, note in your reasoning that a dedicated CN 2026 subheading exists at the 8-digit level (TARIC will resolve it). Classify to the correct 6-digit HS subheading.

PROCESS:
1. Read the product description and the extracted attributes (material, function, end use, form, specs).
2. Review the candidate headings shortlist. Identify which candidates are plausible based on material + function (GRI 1).
3. Check Chapter Notes and Section Notes of those candidates for exclusions (GRI 1).
4. For festive/seasonal goods: apply GRI 1 by material since Chapter 95 Note 1 is deleted.
5. For halogenated hydrocarbons: verify ethylene vs ethane origin before selecting subheading.
6. Pick the most specific 6-digit HS subheading under the chosen heading.
7. For clean-energy goods (battery materials, wind/solar, electrolysis), flag CN 2026 subheading in reasoning.

RESPONSE FORMAT — pick exactly ONE of the four options below. Output raw JSON only, no markdown, no code fences.

OPTION 1 — HIGH/MEDIUM CONFIDENCE (you can determine a single subheading):
{
  "status": "classified",
  "hs6": "6-digit string (e.g. 880730)",
  "heading": "4-digit heading (e.g. 8807)",
  "confidence": "high | medium",
  "confidencePct": <integer 60-99>,
  "shortLabel": "2-3 word product label (e.g. 'Wireless headphones', 'Portable computer', 'Cotton t-shirt'). Title-case the first word; keep it concrete and visual — a user scanning a list of past lookups should recognise the product at a glance.",
  "reasoning": "Authoritative reasoning citing: (1) which GRI applies (GRI 1–6) and why, (2) the relevant Chapter Note or Section Note by number (e.g. 'Chapter 61 Note 3 excludes...'), (3) the WCO Explanatory Note for the heading/subheading (e.g. 'EN 6203 covers...'), (4) any applicable EU BTI reference or CJEU ruling. If a CN 2026 dedicated subheading exists for this product, state it explicitly. Be specific — quote the rule, do not just name it.",
  "chapter": "HS chapter name",
  "notes": "any ambiguity, assumptions, or CN 2026 subheading notes",
  "alternatives": [
    {"hs6": "6-digit string", "heading": "4-digit heading", "confidence_pct": <integer 1-59>, "label": "short product label for this alternative", "reasoning": "1-2 sentence summary: why this subheading was considered and why it was rejected in favour of the primary (cite the deciding GRI / chapter note)"},
    {"hs6": "6-digit string", "heading": "4-digit heading", "confidence_pct": <integer 1-59>, "label": "short product label", "reasoning": "1-2 sentence summary"}
  ]
}

Rules for alternatives in OPTION 1:
- ALWAYS include exactly 2 alternatives — the 2 next-most-plausible 6-digit subheadings you considered. They show your work; they need not be credible competitors.
- Each alternative's confidence_pct must be LESS than the primary confidencePct.
- Ordered by confidence_pct descending.
- Alternatives must be real HS 2022 subheadings — do not invent codes. Prefer subheadings in different chapters/headings when the disambiguation hinged on material or function.

The confidencePct field is a calibrated probability that your chosen hs6 is the correct 6-digit subheading under GRI. Be honest, not rounded. Listing alternatives below does NOT lower this score; alternatives are just the next-best subheadings you sanity-checked.
- 95–99: GRI 1 applies cleanly, the chosen subheading is the obvious answer, alternatives are distant possibilities only
- 85–94: strong case, at least one alternative is a credible candidate ruled out by a specific note or characteristic
- 75–84: reasonable fit, multiple headings genuinely competing, picked on dominant characteristic
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

// ── Pipeline stage helpers ────────────────────────────────────────────────────

const EMPTY_ATTRS = Object.freeze({
  correctedQuery: "",
  kind: "", material: "", function: "", endUse: "",
  attributes: { form: "", processing: "", powered: "", specs: "" },
  keywords: [], likelyChapters: [],
});

/**
 * Stage 1: Haiku attribute extraction. Returns a normalised attribute
 * envelope. Never throws — on failure we hand the pipeline EMPTY_ATTRS and
 * let Sonnet work from the raw description alone.
 */
async function extractAttributes(description) {
  try {
    const raw = await callClaude(
      HAIKU_EXTRACT_SYSTEM,
      `Product description: ${description}`,
      "claude-haiku-4-5-20251001",
      500,
    );
    return {
      correctedQuery: String(raw?.correctedQuery ?? "").slice(0, 500),
      kind: String(raw?.kind ?? "").slice(0, 200),
      material: String(raw?.material ?? "").slice(0, 200),
      function: String(raw?.function ?? "").slice(0, 300),
      endUse: String(raw?.endUse ?? "").slice(0, 60),
      attributes: {
        form: String(raw?.attributes?.form ?? "").slice(0, 60),
        processing: String(raw?.attributes?.processing ?? "").slice(0, 60),
        powered: String(raw?.attributes?.powered ?? "").slice(0, 30),
        specs: String(raw?.attributes?.specs ?? "").slice(0, 200),
      },
      keywords: Array.isArray(raw?.keywords)
        ? raw.keywords.slice(0, 20).map((k) => String(k).toLowerCase().slice(0, 40))
        : [],
      likelyChapters: Array.isArray(raw?.likelyChapters)
        ? raw.likelyChapters.slice(0, 4).map((c) => String(c).padStart(2, "0").slice(0, 2))
        : [],
    };
  } catch {
    return { ...EMPTY_ATTRS };
  }
}

// 6-digit subheading structure for headings the model has historically
// hallucinated. Each entry maps a 4-digit heading → an ordered list of its
// CN6 children with a one-line summary. Sonnet otherwise has to recall e.g.
// the cm³ ladder under 8711 from training data, and gets it wrong (cf.
// "2000 cc motorcycle" → 871160 instead of 871150). Surfacing the structure
// in-prompt anchors the pick. Keep entries terse — these multiply token cost
// for every classify call where the heading is shortlisted. Also covers HS-2022
// restructurings whose new CN6 codes post-date the training data (8517 phones,
// 8541 PV cells, 8539 LED lamps, 8806 UAVs) — without the ladder the model falls
// back to the deleted pre-2022 subheading.
const SUBHEADING_LADDERS = {
  "8407": [
    ["8407.10", "Aircraft engines"],
    ["8407.21", "Marine propulsion — outboard"],
    ["8407.29", "Marine propulsion — other (inboard)"],
    ["8407.31", "Vehicle propulsion engines, cylinder capacity ≤ 50 cm³"],
    ["8407.32", "Vehicle propulsion, > 50 cm³ but ≤ 250 cm³"],
    ["8407.33", "Vehicle propulsion, > 250 cm³ but ≤ 1 000 cm³"],
    ["8407.34", "Vehicle propulsion, > 1 000 cm³"],
    ["8407.90", "Other spark-ignition piston engines"],
  ],
  "8408": [
    ["8408.10", "Marine propulsion engines (compression-ignition / diesel)"],
    ["8408.20", "Engines for vehicles of Chapter 87 (diesel)"],
    ["8408.90", "Other diesel engines"],
  ],
  "8411": [
    ["8411.11", "Turbojets, thrust ≤ 25 kN"],
    ["8411.12", "Turbojets, thrust > 25 kN"],
    ["8411.21", "Turbopropellers, power ≤ 1 100 kW"],
    ["8411.22", "Turbopropellers, power > 1 100 kW"],
    ["8411.81", "Other gas turbines, power ≤ 5 000 kW"],
    ["8411.82", "Other gas turbines, power > 5 000 kW"],
    ["8411.91", "Parts of turbojets or turbopropellers"],
    ["8411.99", "Parts of other gas turbines"],
  ],
  "8501": [
    ["8501.10", "Motors of an output ≤ 37.5 W"],
    ["8501.20", "Universal AC/DC motors > 37.5 W"],
    ["8501.31", "Other DC motors / DC generators, output ≤ 750 W"],
    ["8501.32", "Other DC motors / DC generators, > 750 W but ≤ 75 kW"],
    ["8501.33", "Other DC motors / DC generators, > 75 kW but ≤ 375 kW"],
    ["8501.34", "Other DC motors / DC generators, > 375 kW"],
    ["8501.40", "Other AC single-phase motors"],
    ["8501.51", "Other AC multi-phase motors, output ≤ 750 W"],
    ["8501.52", "Other AC multi-phase motors, > 750 W but ≤ 75 kW"],
    ["8501.53", "Other AC multi-phase motors, > 75 kW"],
    ["8501.61", "AC generators (alternators), ≤ 75 kVA"],
    ["8501.62", "AC generators, > 75 kVA but ≤ 375 kVA"],
    ["8501.63", "AC generators, > 375 kVA but ≤ 750 kVA"],
    ["8501.64", "AC generators, > 750 kVA"],
    ["8501.71", "Photovoltaic DC generators, output ≤ 50 W"],
    ["8501.72", "Photovoltaic DC generators, > 50 W"],
    ["8501.80", "Photovoltaic AC generators"],
  ],
  "8504": [
    ["8504.10", "Ballasts for discharge lamps or tubes"],
    ["8504.21", "Liquid-dielectric transformers, ≤ 650 kVA"],
    ["8504.22", "Liquid-dielectric transformers, > 650 kVA but ≤ 10 000 kVA"],
    ["8504.23", "Liquid-dielectric transformers, > 10 000 kVA"],
    ["8504.31", "Other transformers, ≤ 1 kVA"],
    ["8504.32", "Other transformers, > 1 kVA but ≤ 16 kVA"],
    ["8504.33", "Other transformers, > 16 kVA but ≤ 500 kVA"],
    ["8504.34", "Other transformers, > 500 kVA"],
    ["8504.40", "Static converters (rectifiers, inverters, UPS)"],
    ["8504.50", "Other inductors"],
    ["8504.90", "Parts"],
  ],
  "8507": [
    ["8507.10", "Lead-acid, of a kind used for starting piston engines"],
    ["8507.20", "Other lead-acid accumulators"],
    ["8507.30", "Nickel-cadmium accumulators"],
    ["8507.50", "Nickel-metal hydride accumulators"],
    ["8507.60", "Lithium-ion accumulators"],
    ["8507.80", "Other accumulators (e.g. lithium-iron-phosphate)"],
    ["8507.90", "Parts"],
  ],
  "8703": [
    ["8703.10", "Snowmobiles, golf cars & similar special-purpose vehicles"],
    ["8703.21", "Petrol (spark-ignition) car, cylinder capacity ≤ 1 000 cm³"],
    ["8703.22", "Petrol car, > 1 000 cm³ but ≤ 1 500 cm³"],
    ["8703.23", "Petrol car, > 1 500 cm³ but ≤ 3 000 cm³"],
    ["8703.24", "Petrol car, > 3 000 cm³"],
    ["8703.31", "Diesel (compression-ignition) car, cylinder capacity ≤ 1 500 cm³"],
    ["8703.32", "Diesel car, > 1 500 cm³ but ≤ 2 500 cm³"],
    ["8703.33", "Diesel car, > 2 500 cm³"],
    ["8703.40", "Petrol HYBRID (HEV, NOT plug-in) — only if an electric motor is explicitly stated"],
    ["8703.50", "Diesel HYBRID (HEV, NOT plug-in) — only if an electric motor is explicitly stated"],
    ["8703.60", "Petrol PLUG-IN hybrid (PHEV) — only if chargeable from an external source is stated"],
    ["8703.70", "Diesel PLUG-IN hybrid (PHEV) — only if chargeable from an external source is stated"],
    ["8703.80", "Pure ELECTRIC vehicle (BEV) — electric motor only"],
    ["8703.90", "Other (e.g. hydrogen / other propulsion)"],
  ],
  "8711": [
    ["8711.10", "With reciprocating internal-combustion piston engine, cylinder capacity ≤ 50 cm³"],
    ["8711.20", "Piston engine, > 50 cm³ but ≤ 250 cm³"],
    ["8711.30", "Piston engine, > 250 cm³ but ≤ 500 cm³"],
    ["8711.40", "Piston engine, > 500 cm³ but ≤ 800 cm³"],
    ["8711.50", "Piston engine, > 800 cm³"],
    ["8711.60", "With electric motor for propulsion (incl. e-bikes and electric motorcycles)"],
    ["8711.90", "Other (incl. side-cars)"],
  ],
  // ── HS 2022 restructurings — new CN6 codes the model's training predates ──
  "8517": [
    ["8517.11", "Line telephone sets with cordless handsets"],
    ["8517.13", "Smartphones"],
    ["8517.14", "Other telephones for cellular networks (non-smartphone mobile phones)"],
    ["8517.18", "Other telephone sets"],
    ["8517.61", "Base stations"],
    ["8517.62", "Reception/conversion/transmission apparatus — routers, switches, modems"],
    ["8517.69", "Other communication apparatus"],
    ["8517.71", "Aerials and aerial reflectors (parts)"],
    ["8517.79", "Other parts"],
  ],
  "8539": [
    ["8539.10", "Sealed beam lamp units"],
    ["8539.21", "Tungsten halogen filament lamps"],
    ["8539.22", "Other filament lamps, ≤ 200 W and > 100 V"],
    ["8539.29", "Other filament lamps"],
    ["8539.31", "Fluorescent, hot cathode"],
    ["8539.32", "Mercury/sodium vapour; metal halide lamps"],
    ["8539.39", "Other discharge lamps"],
    ["8539.41", "Arc lamps"],
    ["8539.49", "Ultraviolet or infra-red lamps"],
    ["8539.51", "LED modules"],
    ["8539.52", "LED lamps (finished LED bulbs/tubes)"],
    ["8539.90", "Parts"],
  ],
  "8541": [
    ["8541.10", "Diodes, other than photosensitive or LEDs"],
    ["8541.21", "Transistors, dissipation rate < 1 W"],
    ["8541.29", "Other transistors"],
    ["8541.30", "Thyristors, diacs and triacs"],
    ["8541.41", "Light-emitting diodes (LED) — the diode component itself"],
    ["8541.42", "Photovoltaic cells NOT assembled in modules/panels"],
    ["8541.43", "Photovoltaic cells assembled in modules or made up into panels"],
    ["8541.49", "Other photosensitive semiconductor devices"],
    ["8541.51", "Semiconductor-based transducers"],
    ["8541.59", "Other semiconductor devices"],
    ["8541.60", "Mounted piezoelectric crystals"],
    ["8541.90", "Parts"],
  ],
  "8806": [
    ["8806.10", "UAVs designed for the carriage of passengers"],
    ["8806.21", "Remote-controlled flight only — max take-off weight ≤ 250 g"],
    ["8806.22", "Remote-controlled flight only — > 250 g but ≤ 7 kg"],
    ["8806.23", "Remote-controlled flight only — > 7 kg but ≤ 25 kg"],
    ["8806.24", "Remote-controlled flight only — > 25 kg but ≤ 150 kg"],
    ["8806.29", "Remote-controlled flight only — other"],
    ["8806.91", "Other UAVs (not limited to remote-controlled) — ≤ 250 g"],
    ["8806.92", "Other UAVs — > 250 g but ≤ 7 kg"],
    ["8806.93", "Other UAVs — > 7 kg but ≤ 25 kg"],
    ["8806.94", "Other UAVs — > 25 kg but ≤ 150 kg"],
    ["8806.99", "Other UAVs"],
  ],
};

// Optional per-heading disambiguation rules, surfaced under the subheading
// ladder. Used where the *structure* alone isn't enough and the model tends to
// jump to the wrong branch — e.g. picking a hybrid/electric car code when the
// description only gives engine displacement.
const SUBHEADING_NOTES = {
  "8703":
    "Pick the propulsion branch from what is described, not from assumptions. " +
    "If no electric motor / hybrid / plug-in / battery is mentioned, treat it as a " +
    "conventional combustion car: use 8703.21–24 (petrol) or 8703.31–33 (diesel) by " +
    "cylinder capacity. Default to petrol (spark-ignition) when the fuel type is not " +
    "stated. Only use 8703.40/.50/.60/.70/.80 when electrification is explicitly described.",
  "8517":
    "HS 2022 split the old 8517.12. A smartphone → 8517.13; any other mobile/cellular " +
    "phone → 8517.14; a cordless landline set → 8517.11. Network apparatus (routers, " +
    "switches, modems, hubs) → 8517.62. Never output 8517.12 (deleted in HS 2022), and " +
    "do not put a phone in 8517.62.",
  "8539":
    "A finished LED light bulb / tube / lamp → 8539.52 (new in HS 2022); a bare LED " +
    "module → 8539.51. The LED diode component (not a lamp) is 8541.41, not here.",
  "8541":
    "HS 2022 deleted 8541.40. A photovoltaic panel/module → 8541.43; loose PV cells not " +
    "in a module → 8541.42; an LED diode component → 8541.41. A finished LED lamp/bulb is " +
    "8539.52, not in 8541. Never output 8541.40.",
  "8806":
    "Heading 8806 (UAVs/drones) is new in HS 2022. Consumer and commercial camera drones " +
    "are normally remote-controlled → 8806.21–.29 by max take-off weight (≤ 250 g → 8806.21, " +
    ">250 g–7 kg → 8806.22). Use 8806.10 only for passenger-carrying UAVs; use 8806.91–.99 " +
    "only for UAVs not limited to remote-controlled flight (e.g. autonomous).",
};

function formatCandidatesBlock(candidates) {
  if (!candidates || candidates.length === 0) {
    return "(no narrowed candidates — pick freely from valid HS 2022 headings.)";
  }
  return candidates
    .map((c) => {
      const base = `- ${c.heading}: ${c.description}`;
      const subs = SUBHEADING_LADDERS[c.heading];
      if (!subs) return base;
      // Indent the subheading list under the parent so the model reads it
      // as a structural expansion, not a separate candidate.
      const subLines = subs.map(([code, desc]) => `    ${code} — ${desc}`).join("\n");
      const note = SUBHEADING_NOTES[c.heading];
      const noteLine = note ? `\n  Note: ${note}` : "";
      return `${base}\n  Subheadings (HS 2022):\n${subLines}${noteLine}`;
    })
    .join("\n");
}

function formatAttributesBlock(attrs) {
  if (!attrs) return "(none)";
  const lines = [
    attrs.kind ? `  kind: ${attrs.kind}` : null,
    attrs.material ? `  material: ${attrs.material}` : null,
    attrs.function ? `  function: ${attrs.function}` : null,
    attrs.endUse ? `  endUse: ${attrs.endUse}` : null,
    attrs.attributes?.form ? `  form: ${attrs.attributes.form}` : null,
    attrs.attributes?.processing ? `  processing: ${attrs.attributes.processing}` : null,
    attrs.attributes?.powered && attrs.attributes.powered !== "unknown"
      ? `  powered: ${attrs.attributes.powered}` : null,
    attrs.attributes?.specs ? `  specs: ${attrs.attributes.specs}` : null,
    attrs.likelyChapters?.length ? `  likelyChapters: ${attrs.likelyChapters.join(", ")}` : null,
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : "(none)";
}

/**
 * Stage 2/3: pick the final 6-digit subheading. Used by Sonnet and Opus.
 * When `prior` is supplied (Opus escalation), Sonnet's pick + reasoning are
 * shown so Opus can confirm or override with deeper analysis.
 */
async function pickFromCandidates({
  description,
  attrs,
  candidates,
  model,
  level,
  prior = null,
}) {
  const priorBlock = prior
    ? `\nPreliminary pick by a lighter model (re-evaluate rigorously — confirm or override):\n  hs6: ${prior.hs6 ?? "—"}\n  confidence: ${prior.confidencePct ?? "—"}%\n  reasoning: ${prior.reasoning ?? "—"}\n`
    : "";
  const userMsg =
    `Product: ${description}\n\n` +
    `Extracted attributes:\n${formatAttributesBlock(attrs)}\n\n` +
    `Candidate 4-digit headings (deterministic narrowing — strongly prefer one of these):\n${formatCandidatesBlock(candidates)}\n` +
    `${priorBlock}\n` +
    `${rationaleInstruction(level)}\n\n` +
    `Pick the best 6-digit HS subheading.`;
  // Opus gets a higher token ceiling — extended reasoning chains run longer.
  const maxTokens = model.includes("opus") ? 3500 : 2500;
  return callClaude(PICK_SYSTEM, userMsg, model, maxTokens);
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

export {
  normalizeDescription,
  callClaude,
  HEADING_INDEX,
  INDEX_STOPWORDS,
  foldPlural,
  indexTokens,
  narrowHeadings,
  HAIKU_EXTRACT_SYSTEM,
  PICK_SYSTEM,
  EMPTY_ATTRS,
  extractAttributes,
  SUBHEADING_LADDERS,
  SUBHEADING_NOTES,
  formatCandidatesBlock,
  formatAttributesBlock,
  rationaleInstruction,
  pickFromCandidates,
};
