#!/usr/bin/env node
// Standalone test harness for the HS classification pipeline.
// Usage: node scripts/test-classify.mjs "CFM56 engine"
//
// Replicates the extract → narrow → Sonnet pick → Opus<75% flow from
// src/app/api/hs-lookup/route.js using the same heading index, prompts, and
// model IDs — but no DB, no auth, no TARIC probe. Good enough to verify
// classification correctness end-to-end.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const description = process.argv.slice(2).join(" ").trim() || "CFM56 engine";

// Load .env for ANTHROPIC_API_KEY (same approach as ecosystem.config.js).
function loadDotenv(filePath) {
  try {
    const content = readFileSync(resolve(ROOT, filePath), "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
        val = val.slice(1, -1);
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}
loadDotenv(".env");
loadDotenv(".env.local");

const HEADING_INDEX = JSON.parse(readFileSync(resolve(ROOT, "data/heading-index.json"), "utf8"));

// Extract the prompt strings + helpers from route.js so we test exactly what
// production runs. The file is plain JS and we only need a few constants /
// functions, so a regex grab is simpler than wiring a dynamic import that
// would also pull in next/server, Prisma, etc.
const ROUTE_SRC = readFileSync(resolve(ROOT, "src/app/api/hs-lookup/route.js"), "utf8");
function pullConst(name) {
  const re = new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`);
  const m = ROUTE_SRC.match(re);
  if (!m) throw new Error(`could not extract ${name} from route.js`);
  return m[1];
}
const HAIKU_EXTRACT_SYSTEM = pullConst("HAIKU_EXTRACT_SYSTEM");
const PICK_SYSTEM = pullConst("PICK_SYSTEM");

const INDEX_STOPWORDS = new Set([
  "and","or","of","the","for","with","without","to","in","on","by","from",
  "a","an","as","at","be","is","it","its","not","that","this","other","any",
  "all","more","less","than","etc","containing","made","having","used",
  "product","item","items","goods","type","kind","form","new","used",
  "small","large","high","low",
]);
// Kept in sync with src/app/api/hs-lookup/route.js (foldPlural + indexTokens).
function foldPlural(t) {
  if (t.length < 5) return t;
  if (t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.endsWith("sses") || t.endsWith("xes") || t.endsWith("ches") || t.endsWith("shes")) return t.slice(0, -2);
  if (t.endsWith("s") && !t.endsWith("ss") && !t.endsWith("us") && !t.endsWith("is")) return t.slice(0, -1);
  return t;
}
function indexTokens(text) {
  if (!text) return [];
  return String(text).toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/)
    .map((t) => t.trim().replace(/^-+|-+$/g, ""))
    .filter((t) => t.length >= 3 && !INDEX_STOPWORDS.has(t) && !/^\d+$/.test(t))
    .map(foldPlural);
}

function narrowHeadings(attrs, description, limit = 12) {
  const headings = HEADING_INDEX?.headings;
  if (!headings) return [];
  const queryParts = [
    description, attrs?.kind, attrs?.material, attrs?.function, attrs?.endUse,
    attrs?.attributes?.form, attrs?.attributes?.processing, attrs?.attributes?.specs,
    ...(Array.isArray(attrs?.keywords) ? attrs.keywords : []),
  ].filter(Boolean).join(" ");
  const queryTokens = new Set(indexTokens(queryParts));
  if (queryTokens.size === 0) return [];
  const likely = Array.isArray(attrs?.likelyChapters)
    ? attrs.likelyChapters.map((c) => String(c).padStart(2, "0").slice(0, 2)) : [];
  const likelySet = new Set(likely);
  const primaryChapter = likely[0] || null;
  const scored = [];
  for (const [h4, entry] of Object.entries(headings)) {
    const chapter = h4.slice(0, 2);
    const descTokens = new Set(indexTokens(entry.description));
    const kwSet = new Set((entry.keywords || []).map(foldPlural));
    let score = 0;
    for (const tok of queryTokens) {
      if (descTokens.has(tok)) score += 3;
      else if (kwSet.has(tok)) score += 1;
    }
    if (score === 0 && !likelySet.has(chapter)) continue;
    if (likelySet.has(chapter)) score *= 1.5;
    if (chapter === primaryChapter) score += 5;
    scored.push({ heading: h4, description: entry.description, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);
  const includedChapters = new Set(top.map((c) => c.heading.slice(0, 2)));
  for (const ch of likely) {
    if (includedChapters.has(ch)) continue;
    const fallback = Object.entries(headings)
      .filter(([h]) => h.startsWith(ch))
      .map(([h, e]) => ({ heading: h, description: e.description, score: 0 }))
      .slice(0, 2);
    top.push(...fallback);
    if (top.length >= limit + 4) break;
  }
  return top.slice(0, limit + 4);
}

async function callClaude(system, userMsg, model, maxTokens = 2500) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model, max_tokens: maxTokens, system,
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Claude API ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  const text = data.content?.find((b) => b.type === "text")?.text || "";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

function rationaleInstruction(level) {
  return "For the 'reasoning' field: 1–2 sentences (around 250 chars) naming the chapter and the GRI/note that applies.";
}

// Kept in sync with NUMERIC_SPLIT_SUBHEADINGS in src/app/api/hs-lookup/route.js.
const NUMERIC_SPLIT_SUBHEADINGS = {
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
  "8711": [
    ["8711.10", "With reciprocating internal-combustion piston engine, cylinder capacity ≤ 50 cm³"],
    ["8711.20", "Piston engine, > 50 cm³ but ≤ 250 cm³"],
    ["8711.30", "Piston engine, > 250 cm³ but ≤ 500 cm³"],
    ["8711.40", "Piston engine, > 500 cm³ but ≤ 800 cm³"],
    ["8711.50", "Piston engine, > 800 cm³"],
    ["8711.60", "With electric motor for propulsion (incl. e-bikes and electric motorcycles)"],
    ["8711.90", "Other (incl. side-cars)"],
  ],
};

function formatCandidatesBlock(candidates) {
  if (!candidates?.length) return "(no narrowed candidates — pick freely from valid HS 2022 headings.)";
  return candidates.map((c) => {
    const base = `- ${c.heading}: ${c.description}`;
    const subs = NUMERIC_SPLIT_SUBHEADINGS[c.heading];
    if (!subs) return base;
    const subLines = subs.map(([code, desc]) => `    ${code} — ${desc}`).join("\n");
    return `${base}\n  Subheadings (HS 2022):\n${subLines}`;
  }).join("\n");
}
function formatAttributesBlock(attrs) {
  if (!attrs) return "(none)";
  const lines = [
    attrs.kind && `  kind: ${attrs.kind}`,
    attrs.material && `  material: ${attrs.material}`,
    attrs.function && `  function: ${attrs.function}`,
    attrs.endUse && `  endUse: ${attrs.endUse}`,
    attrs.attributes?.form && `  form: ${attrs.attributes.form}`,
    attrs.attributes?.processing && `  processing: ${attrs.attributes.processing}`,
    attrs.attributes?.specs && `  specs: ${attrs.attributes.specs}`,
    attrs.likelyChapters?.length && `  likelyChapters: ${attrs.likelyChapters.join(", ")}`,
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : "(none)";
}

async function pickFromCandidates({ description, attrs, candidates, model, prior = null }) {
  const priorBlock = prior
    ? `\nPreliminary pick by a lighter model (re-evaluate rigorously — confirm or override):\n  hs6: ${prior.hs6 ?? "—"}\n  confidence: ${prior.confidencePct ?? "—"}%\n  reasoning: ${prior.reasoning ?? "—"}\n`
    : "";
  const userMsg =
    `Product: ${description}\n\n` +
    `Extracted attributes:\n${formatAttributesBlock(attrs)}\n\n` +
    `Candidate 4-digit headings (deterministic narrowing — strongly prefer one of these):\n${formatCandidatesBlock(candidates)}\n` +
    `${priorBlock}\n${rationaleInstruction("medium")}\n\nPick the best 6-digit HS subheading.`;
  const maxTokens = model.includes("opus") ? 3500 : 2500;
  return callClaude(PICK_SYSTEM, userMsg, model, maxTokens);
}

// ── Run ───
const t0 = Date.now();
console.log(`\n[input] ${description}\n`);

console.log("[step 1] Haiku extract…");
const attrs = await callClaude(HAIKU_EXTRACT_SYSTEM, `Product description: ${description}`, "claude-haiku-4-5-20251001", 500);
console.log(JSON.stringify(attrs, null, 2));

console.log("\n[step 2] Narrow headings…");
const candidates = narrowHeadings(attrs, description, 12);
for (const c of candidates) console.log(`  ${c.heading} (score ${c.score.toFixed(1)}) — ${c.description.slice(0, 80)}`);

console.log("\n[step 3] Sonnet pick…");
const sonnet = await pickFromCandidates({ description, attrs, candidates, model: "claude-sonnet-4-6" });
console.log(`  status=${sonnet.status} hs6=${sonnet.hs6} pct=${sonnet.confidencePct}`);
console.log(`  reasoning: ${sonnet.reasoning?.slice(0, 200)}`);

let final = sonnet;
let modelUsed = "sonnet";
if (sonnet.status === "classified" && Number(sonnet.confidencePct) < 75) {
  console.log(`\n[step 4] Sonnet ${sonnet.confidencePct}% < 75 — escalating to Opus…`);
  const opus = await pickFromCandidates({
    description, attrs, candidates, model: "claude-opus-4-7",
    prior: { hs6: sonnet.hs6, confidencePct: sonnet.confidencePct, reasoning: sonnet.reasoning },
  });
  console.log(`  Opus → status=${opus.status} hs6=${opus.hs6} pct=${opus.confidencePct}`);
  console.log(`  reasoning: ${opus.reasoning?.slice(0, 200)}`);
  final = opus; modelUsed = "opus";
} else {
  console.log(`\n[step 4] Sonnet ≥ 75% — Opus skipped`);
}

console.log(`\n[result] ${modelUsed} → hs6=${final.hs6} pct=${final.confidencePct} (${(Date.now()-t0)/1000}s)`);
