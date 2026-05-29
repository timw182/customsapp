#!/usr/bin/env node
// Accuracy harness for the HS classification pipeline.
//
// Runs the REAL extract → narrow → pick stages (imported from
// src/lib/hs-pipeline.mjs — the same code production runs) over the golden set
// in scripts/eval-data.jsonl and reports:
//   • narrowing recall@shortlist  — was the correct 4-digit heading even offered
//                                    to the model? (this bounds everything else)
//   • hs6 top-1 / top-3           — did the pick (primary / primary+alternatives)
//                                    match the gold 6-digit subheading?
//   • ceiling breaches            — top-1 misses where the heading was ABSENT from
//                                    the shortlist (a narrowing failure, not a pick failure)
//   • status distribution         — classified / needs_info / candidates / fatal
//   • would-disambiguate rate     — classified picks under the 75% threshold
//   • confidence calibration      — predicted confidence vs actual top-1 accuracy
//
// It does NOT hit TARIC/USITC/DB, so it measures the *classification* stage (hs6).
// cn8/TARIC resolution is a separate, live-dependent stage.
//
// Usage:
//   node scripts/eval-classify.mjs                 # full set, Sonnet, concurrency 5
//   node scripts/eval-classify.mjs --limit=3       # smoke test (first 3 cases)
//   node scripts/eval-classify.mjs --tag=hs2022    # only rows with a given tag
//   node scripts/eval-classify.mjs --opus          # mirror prod: escalate <75% to Opus
//   node scripts/eval-classify.mjs --threshold=70  # exit 1 if hs6 top-1 < 70% (CI gate)
//   node scripts/eval-classify.mjs --concurrency=8 --out=eval-reports/run.json
//
// Run from the project root (/var/www/customs).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractAttributes, narrowHeadings, pickFromCandidates } from "../src/lib/hs-pipeline.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ── args ──────────────────────────────────────────────────────────────────────
const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
}
const PICK_MODEL = args.model || "claude-sonnet-4-6";
const OPUS_MODEL = args["opus-model"] || "claude-opus-4-7";
const CONCURRENCY = Math.max(1, parseInt(args.concurrency || "5", 10));
const LIMIT = args.limit ? parseInt(args.limit, 10) : Infinity;
const TAGS = args.tag ? String(args.tag).split(",").map((t) => t.trim()).filter(Boolean) : null;
const USE_OPUS = !!args.opus;
const THRESHOLD = args.threshold ? parseFloat(args.threshold) : null;
const DATA_PATH = args.data ? resolve(ROOT, args.data) : resolve(ROOT, "scripts/eval-data.jsonl");

// ── env (callClaude reads ANTHROPIC_API_KEY at call time) ──────────────────────
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
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY not set (looked in .env / .env.local). Aborting.");
  process.exit(2);
}

// ── dataset ─────────────────────────────────────────────────────────────────--
function loadDataset() {
  const rows = [];
  readFileSync(DATA_PATH, "utf8").split("\n").forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith("//")) return;
    let obj;
    try { obj = JSON.parse(t); } catch (e) { throw new Error(`bad JSON on line ${i + 1}: ${e.message}`); }
    const hs6 = String(obj.hs6 || "").replace(/\D/g, "");
    if (hs6.length !== 6) throw new Error(`row ${obj.id || i + 1}: hs6 must be 6 digits`);
    rows.push({ ...obj, hs6 });
  });
  return rows;
}
let cases = loadDataset();
if (TAGS) cases = cases.filter((c) => Array.isArray(c.tags) && c.tags.some((t) => TAGS.includes(t)));
cases = cases.slice(0, LIMIT);
if (cases.length === 0) { console.error("no cases selected"); process.exit(2); }

const norm6 = (s) => String(s || "").replace(/\D/g, "").slice(0, 6);

// ── per-case runner ────────────────────────────────────────────────────────---
async function runCase(c) {
  const t0 = Date.now();
  const rec = { id: c.id, tags: c.tags || [], goldHs6: c.hs6, goldHeading: c.hs6.slice(0, 4) };
  try {
    const attrs = await extractAttributes(c.description);
    const effective = (attrs.correctedQuery || "").trim() || c.description;
    const candidates = narrowHeadings(attrs, effective, 12);
    const shortlist = candidates.map((x) => x.heading);
    rec.shortlistLen = shortlist.length;
    rec.headingRank = shortlist.indexOf(rec.goldHeading); // -1 if absent
    rec.recallHit = rec.headingRank >= 0;
    rec.likelyChapters = attrs.likelyChapters || [];

    let pick = await pickFromCandidates({ description: effective, attrs, candidates, model: PICK_MODEL, level: "medium" });
    rec.model = PICK_MODEL.includes("sonnet") ? "sonnet" : PICK_MODEL.includes("opus") ? "opus" : PICK_MODEL;
    rec.status = pick.status;
    rec.confidencePct = Number.isFinite(Number(pick.confidencePct)) ? Number(pick.confidencePct) : null;

    // First-pass low-confidence: in prod this asks the user; mark it, and optionally
    // mirror the second-pass Opus escalation (prod only escalates after disambiguation).
    rec.wouldDisambiguate = pick.status === "classified" && rec.confidencePct != null && rec.confidencePct < 75;
    if (USE_OPUS && rec.wouldDisambiguate) {
      const opus = await pickFromCandidates({
        description: effective, attrs, candidates, model: OPUS_MODEL, level: "medium",
        prior: { hs6: pick.hs6, confidencePct: pick.confidencePct, reasoning: pick.reasoning },
      });
      if (opus?.status) { pick = opus; rec.model = "opus"; rec.status = opus.status; rec.confidencePct = Number.isFinite(Number(opus.confidencePct)) ? Number(opus.confidencePct) : rec.confidencePct; }
    }

    const primary = norm6(pick.hs6);
    const alts = Array.isArray(pick.alternatives) ? pick.alternatives.map((a) => norm6(a.hs6)).filter((h) => h.length === 6) : [];
    const cands = pick.status === "candidates" && Array.isArray(pick.candidates) ? pick.candidates.map((a) => norm6(a.hs6)).filter((h) => h.length === 6) : [];
    rec.predictedHs6 = primary || (cands[0] ?? null);
    rec.top1 = pick.status === "classified" && primary === c.hs6;
    rec.top3 = rec.top1 || (pick.status === "classified" && alts.includes(c.hs6)) || (pick.status === "candidates" && cands.includes(c.hs6));
    rec.resolved = pick.status === "classified" || pick.status === "candidates";
    rec.reasoning = (pick.reasoning || pick.partial_reasoning || "").slice(0, 160);
  } catch (e) {
    rec.error = String(e?.message || e).slice(0, 160);
    rec.status = "error";
    rec.top1 = false; rec.top3 = false; rec.resolved = false;
  }
  rec.ms = Date.now() - t0;
  return rec;
}

// ── bounded-concurrency pool ───────────────────────────────────────────────---
async function runPool(items, n, worker) {
  const out = new Array(items.length);
  let i = 0, done = 0;
  async function pump() {
    while (i < items.length) {
      const idx = i++;
      const r = await worker(items[idx]);
      out[idx] = r;
      done++;
      const mark = r.error ? "ERR " : r.top1 ? "PASS" : "MISS";
      const rk = r.recallHit ? `rank ${r.headingRank}` : "ABSENT";
      process.stdout.write(
        `  [${String(done).padStart(2)}/${items.length}] ${mark}  ${r.id.padEnd(18)} ` +
        `gold ${r.goldHs6}  pred ${(r.predictedHs6 || "—").padEnd(6)}  ${String(r.status).padEnd(10)} ` +
        `${r.confidencePct != null ? (r.confidencePct + "%").padStart(4) : "  — "}  heading ${rk}` +
        `${r.error ? "  !" + r.error : ""}\n`,
      );
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, pump));
  return out;
}

// ── run ───────────────────────────────────────────────────────────────────────
const pct = (num, den) => (den ? ((100 * num) / den).toFixed(1) + "%" : "—");
console.log(`\nHS classification eval — ${cases.length} cases · pick=${PICK_MODEL}${USE_OPUS ? ` · opus<75=${OPUS_MODEL}` : ""} · concurrency=${CONCURRENCY}\n`);
const wall0 = Date.now();
const recs = await runPool(cases, CONCURRENCY, runCase);
const wallMs = Date.now() - wall0;

// ── aggregate ─────────────────────────────────────────────────────────────────
const n = recs.length;
const errs = recs.filter((r) => r.error);
const scored = recs.filter((r) => !r.error);
const recallHits = scored.filter((r) => r.recallHit);
const top1 = scored.filter((r) => r.top1);
const top3 = scored.filter((r) => r.top3);
const ceilingBreaches = scored.filter((r) => !r.top1 && !r.recallHit); // heading absent from shortlist
const pickFailsWithHeadingPresent = scored.filter((r) => !r.top1 && r.recallHit);

const statusDist = {};
for (const r of scored) statusDist[r.status] = (statusDist[r.status] || 0) + 1;
const wouldDis = scored.filter((r) => r.wouldDisambiguate);

const ranks = recallHits.map((r) => r.headingRank).sort((a, b) => a - b);
const meanRank = ranks.length ? (ranks.reduce((s, x) => s + x, 0) / ranks.length).toFixed(1) : "—";
const lat = scored.map((r) => r.ms).sort((a, b) => a - b);
const median = (arr) => (arr.length ? arr[Math.floor(arr.length / 2)] : 0);

// calibration: bucket classified picks by confidence, compare to actual top-1
const buckets = [[0, 60], [60, 70], [70, 80], [80, 90], [90, 101]];
const calib = buckets.map(([lo, hi]) => {
  const inB = scored.filter((r) => r.status === "classified" && r.confidencePct != null && r.confidencePct >= lo && r.confidencePct < hi);
  const hit = inB.filter((r) => r.top1).length;
  return { range: `${lo}-${hi - 1}`, n: inB.length, acc: inB.length ? (100 * hit) / inB.length : null };
});

// per-tag
const tagSet = [...new Set(scored.flatMap((r) => r.tags))].sort();
const perTag = tagSet.map((tag) => {
  const inT = scored.filter((r) => r.tags.includes(tag));
  return { tag, n: inT.length, top1: inT.filter((r) => r.top1).length, recall: inT.filter((r) => r.recallHit).length };
});

// ── print summary ──────────────────────────────────────────────────────────---
console.log("\n" + "═".repeat(72));
console.log("SUMMARY");
console.log("═".repeat(72));
console.log(`cases scored        ${scored.length}/${n}${errs.length ? `  (${errs.length} errored)` : ""}`);
console.log(`narrowing recall    ${pct(recallHits.length, scored.length)}  (correct heading offered to the model; mean rank ${meanRank})`);
console.log(`hs6 top-1           ${pct(top1.length, scored.length)}`);
console.log(`hs6 top-3           ${pct(top3.length, scored.length)}  (primary + alternatives / candidates)`);
console.log(`resolved            ${pct(scored.filter((r) => r.resolved).length, scored.length)}  (classified or candidates; rest = needs_info/fatal)`);
console.log(`would-disambiguate  ${pct(wouldDis.length, scored.length)}  (classified picks < 75%)`);
console.log(`\ntop-1 miss breakdown:`);
console.log(`  ceiling breaches (heading ABSENT from shortlist)  ${ceilingBreaches.length}${ceilingBreaches.length ? "  → " + ceilingBreaches.map((r) => r.id).join(", ") : ""}`);
console.log(`  pick errors (heading present, wrong subheading)   ${pickFailsWithHeadingPresent.length}${pickFailsWithHeadingPresent.length ? "  → " + pickFailsWithHeadingPresent.map((r) => `${r.id}(${r.predictedHs6}≠${r.goldHs6})`).join(", ") : ""}`);
console.log(`\nstatus distribution: ${Object.entries(statusDist).map(([k, v]) => `${k}=${v}`).join("  ")}`);
console.log(`\nconfidence calibration (classified picks):`);
for (const b of calib) console.log(`  ${b.range.padStart(6)}%   n=${String(b.n).padStart(2)}   actual top-1 ${b.acc == null ? "—" : b.acc.toFixed(0) + "%"}`);
console.log(`\nper-tag (top-1 · recall):`);
for (const t of perTag) console.log(`  ${t.tag.padEnd(16)} top-1 ${pct(t.top1, t.n).padStart(6)}   recall ${pct(t.recall, t.n).padStart(6)}   (n=${t.n})`);
if (errs.length) console.log(`\nerrors: ${errs.map((r) => `${r.id}: ${r.error}`).join(" | ")}`);
console.log(`\nlatency  median ${median(lat)}ms · p-slowest ${lat[lat.length - 1] || 0}ms · wall ${(wallMs / 1000).toFixed(1)}s`);

// ── write report ───────────────────────────────────────────────────────────---
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outPath = args.out ? resolve(ROOT, args.out) : resolve(ROOT, `eval-reports/eval-${stamp}.json`);
mkdirSync(dirname(outPath), { recursive: true });
const report = {
  runAt: new Date().toISOString(),
  config: { pickModel: PICK_MODEL, useOpus: USE_OPUS, opusModel: USE_OPUS ? OPUS_MODEL : null, concurrency: CONCURRENCY, n: scored.length, errored: errs.length, tagsFilter: TAGS, dataPath: DATA_PATH },
  metrics: {
    narrowingRecall: scored.length ? recallHits.length / scored.length : 0,
    meanHeadingRank: meanRank,
    hs6Top1: scored.length ? top1.length / scored.length : 0,
    hs6Top3: scored.length ? top3.length / scored.length : 0,
    resolvedRate: scored.length ? scored.filter((r) => r.resolved).length / scored.length : 0,
    wouldDisambiguateRate: scored.length ? wouldDis.length / scored.length : 0,
    ceilingBreaches: ceilingBreaches.map((r) => r.id),
    statusDistribution: statusDist,
    calibration: calib,
    perTag,
    latencyMsMedian: median(lat),
    wallMs,
  },
  cases: recs,
};
writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
console.log(`\nreport → ${outPath}\n`);

if (THRESHOLD != null) {
  const t1 = scored.length ? (100 * top1.length) / scored.length : 0;
  if (t1 < THRESHOLD) { console.error(`FAIL: hs6 top-1 ${t1.toFixed(1)}% < threshold ${THRESHOLD}%`); process.exit(1); }
  console.log(`PASS: hs6 top-1 ${t1.toFixed(1)}% ≥ threshold ${THRESHOLD}%`);
}
