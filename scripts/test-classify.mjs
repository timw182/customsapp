#!/usr/bin/env node
// Single-input smoke test for the HS classification pipeline.
// Usage: node scripts/test-classify.mjs "CFM56 engine"
//
// Exercises the REAL extract → narrow → Sonnet pick → Opus<75% flow by importing
// the shared module (src/lib/hs-pipeline.mjs) that production also runs — no DB,
// no auth, no TARIC probe. Because it imports rather than copies, it can never
// drift from production prompts/scoring the way the old hand-copied version did.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractAttributes, narrowHeadings, pickFromCandidates } from "../src/lib/hs-pipeline.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const description = process.argv.slice(2).join(" ").trim() || "CFM56 engine";

// Load .env for ANTHROPIC_API_KEY (the module's callClaude reads it at call time,
// which is after this runs — ESM evaluates the import's top level first, but that
// only loads the heading index, which needs no key).
function loadDotenv(file) {
  try {
    for (const line of readFileSync(resolve(ROOT, file), "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {}
}
loadDotenv(".env");
loadDotenv(".env.local");

const t0 = Date.now();
console.log(`\n[input] ${description}\n`);

console.log("[step 1] Haiku extract…");
const attrs = await extractAttributes(description);
console.log(JSON.stringify(attrs, null, 2));

// Mirror production: narrow on the spell-corrected query when Haiku changed it.
const effective = (attrs.correctedQuery || "").trim() || description;

console.log("\n[step 2] Narrow headings…");
const candidates = narrowHeadings(attrs, effective, 12);
for (const c of candidates) console.log(`  ${c.heading} (score ${c.score.toFixed(1)}) — ${c.description.slice(0, 80)}`);

console.log("\n[step 3] Sonnet pick…");
const sonnet = await pickFromCandidates({ description: effective, attrs, candidates, model: "claude-sonnet-4-6", level: "medium" });
console.log(`  status=${sonnet.status} hs6=${sonnet.hs6} pct=${sonnet.confidencePct}`);
console.log(`  reasoning: ${sonnet.reasoning?.slice(0, 200)}`);

let final = sonnet;
let modelUsed = "sonnet";
if (sonnet.status === "classified" && Number(sonnet.confidencePct) < 75) {
  console.log(`\n[step 4] Sonnet ${sonnet.confidencePct}% < 75 — escalating to Opus…`);
  const opus = await pickFromCandidates({
    description: effective, attrs, candidates, model: "claude-opus-4-7", level: "medium",
    prior: { hs6: sonnet.hs6, confidencePct: sonnet.confidencePct, reasoning: sonnet.reasoning },
  });
  console.log(`  Opus → status=${opus.status} hs6=${opus.hs6} pct=${opus.confidencePct}`);
  console.log(`  reasoning: ${opus.reasoning?.slice(0, 200)}`);
  final = opus;
  modelUsed = "opus";
} else {
  console.log(`\n[step 4] Sonnet ≥ 75% — Opus skipped`);
}

console.log(`\n[result] ${modelUsed} → hs6=${final.hs6} pct=${final.confidencePct} (${(Date.now() - t0) / 1000}s)`);
