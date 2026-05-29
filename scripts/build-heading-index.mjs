#!/usr/bin/env node
// Builds data/heading-index.json — a deterministic 4-digit heading → keywords
// map used by the HS lookup pipeline to narrow candidate headings before the
// Sonnet pick stage.
//
// Source: EU TARIC nomenclature tree files (one .js file per chapter, daily
// published). We pull each chapter, walk every node, and keep the headings
// (depth-2: chapter + 2 digits) plus their immediate children (subheadings)
// to derive a richer keyword bag.
//
// Run with: node scripts/build-heading-index.mjs
// Output:   data/heading-index.json

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PATH = resolve(ROOT, "data/heading-index.json");
const TREE_BASE = "https://ec.europa.eu/taxation_customs/dds2/taric/nomenclaturetree";

// EU publishes new tree files on regulation effective dates (typically Jan 1).
// Try current year, then previous year, then today as a last fallback.
function candidateDates() {
  const now = new Date();
  const y = now.getFullYear();
  const today = now.toISOString().slice(0, 10).replace(/-/g, "");
  return [`${y}0101`, `${y - 1}0101`, today];
}

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
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        // EU tree files are JS, not strict JSON — strings can contain literal
        // tabs/newlines/non-breaking spaces that JSON.parse rejects. Escape
        // ASCII control chars (< 0x20) inside the candidate slice before
        // parsing.
        const raw = js.slice(pos, i + 1);
        const sanitized = raw.replace(/[\x00-\x1F]/g, (c) =>
          c === "\t" ? "\\t" :
          c === "\n" ? "\\n" :
          c === "\r" ? "\\r" :
          " "
        );
        try { return JSON.parse(sanitized); } catch { return null; }
      }
    }
  }
  return null;
}

async function fetchChapterTree(chapter) {
  const ch = String(chapter).padStart(2, "0");
  for (const date of candidateDates()) {
    const url = `${TREE_BASE}/nomenclaturetree_en_${date}_${ch}_en.js`;
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!resp.ok) continue;
      const js = await resp.text();
      const tree = extractJsonArray(js, "chaptertree");
      if (tree) return { tree, date };
    } catch {
      // try next date
    }
  }
  return null;
}

// Stopwords stripped from keyword derivation — generic taxonomic noise that
// shows up in too many headings to discriminate.
const STOPWORDS = new Set([
  "and", "or", "of", "the", "for", "with", "without", "to", "in", "on", "by",
  "from", "a", "an", "as", "at", "be", "but", "if", "is", "it", "its", "no",
  "not", "such", "than", "that", "this", "their", "them", "they", "we", "you",
  "other", "others", "any", "all", "more", "less", "than", "etc", "ex",
  "containing", "made", "having", "used", "intended", "whether",
  "kind", "kinds", "type", "types", "form", "forms",
  "headings", "heading", "subheading", "subheadings", "note", "notes",
  "chapter", "chapters", "section",
  "see", "below", "above", "thereof", "therefor", "therefrom",
  "weight", "weighing", "mass",
  "value", "values",
  "exceeding", "less", "more", "kg", "cm", "mm", "g", "ml", "l",
  "non", "etc",
]);

// Conservative plural→singular folding — must match foldPlural in
// src/app/api/hs-lookup/route.js so the runtime query and the stored keyword
// bag end up in the same form. Keep these two implementations in sync.
function foldPlural(t) {
  if (t.length < 5) return t;
  if (t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (
    t.endsWith("sses") ||
    t.endsWith("xes") ||
    t.endsWith("ches") ||
    t.endsWith("shes")
  ) return t.slice(0, -2);
  if (t.endsWith("s") && !t.endsWith("ss") && !t.endsWith("us") && !t.endsWith("is")) {
    return t.slice(0, -1);
  }
  return t;
}

function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim().replace(/^-+|-+$/g, ""))
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t))
    .map(foldPlural);
}

// Walk a chapter tree and harvest:
//   - 4-digit heading code + its description
//   - keyword bag built from the heading description + every descendant
//     description (caps depth so we don't drown the bag in CN10 noise)
function harvestChapter(chapter, tree) {
  const ch = String(chapter).padStart(2, "0");
  const headings = new Map(); // heading4 → { description, keywords:Set }

  function cleanDesc(d) {
    return typeof d === "string" ? d.replace(/\s*:\s*$/, "").trim() : "";
  }

  function walk(nodes, currentHeading) {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!Array.isArray(node) || node.length < 6) continue;
      const code = typeof node[2] === "string" ? node[2] : "";
      const desc = cleanDesc(node[5]);
      const children = node[7];
      const digits = code.replace(/\D/g, "");

      let nextHeading = currentHeading;
      // Skip chapter-umbrella codes (XX00) — not real HS headings; real ones
      // are numbered XX01–XX99.
      if (digits.length >= 4 && digits.slice(0, 2) === ch && digits.slice(2, 4) !== "00") {
        const h4 = digits.slice(0, 4);
        if (!headings.has(h4)) {
          headings.set(h4, { description: "", keywords: new Set() });
        }
        nextHeading = h4;
        // Capture the canonical heading description the first time we see the
        // heading node itself (its code ends in "00000000" or has 4 sig digits).
        if (digits.length === 10 && digits.endsWith("000000") && desc) {
          const entry = headings.get(h4);
          if (!entry.description) entry.description = desc;
        }
      }

      if (nextHeading && desc) {
        const entry = headings.get(nextHeading);
        for (const tok of tokenize(desc)) entry.keywords.add(tok);
      }

      if (Array.isArray(children)) walk(children, nextHeading);
    }
  }

  walk(tree, null);

  // Fallback descriptions: pick the shortest non-empty descendant if the
  // heading node didn't carry one.
  for (const [h4, entry] of headings) {
    if (entry.description) continue;
    // Walk again to find the first node that starts with h4 and has a desc
    function findDesc(nodes) {
      if (!Array.isArray(nodes)) return null;
      for (const node of nodes) {
        if (!Array.isArray(node) || node.length < 6) continue;
        const code = typeof node[2] === "string" ? node[2] : "";
        const digits = code.replace(/\D/g, "");
        if (digits.startsWith(h4)) {
          const d = cleanDesc(node[5]);
          if (d) return d;
          const found = findDesc(node[7]);
          if (found) return found;
        }
      }
      return null;
    }
    entry.description = findDesc(tree) || "";
  }

  return headings;
}

async function main() {
  const all = {};
  let okChapters = 0;
  let failChapters = [];

  // Chapter 77 is reserved/unused in the HS; skip silently.
  for (let chapter = 1; chapter <= 99; chapter++) {
    if (chapter === 77) continue;
    process.stdout.write(`ch ${String(chapter).padStart(2, "0")} … `);
    const fetched = await fetchChapterTree(chapter);
    if (!fetched) {
      process.stdout.write("FAIL\n");
      failChapters.push(chapter);
      continue;
    }
    const headings = harvestChapter(chapter, fetched.tree);
    for (const [h4, entry] of headings) {
      // Keep keyword bags compact — sort and drop singletons that almost
      // never appear in user descriptions. Cap at 60 to keep the file small.
      const keywords = [...entry.keywords].sort().slice(0, 60);
      all[h4] = { description: entry.description, keywords };
    }
    okChapters++;
    process.stdout.write(`${headings.size} headings (${fetched.date})\n`);
  }

  await mkdir(dirname(OUT_PATH), { recursive: true });
  const payload = {
    builtAt: new Date().toISOString(),
    okChapters,
    failedChapters: failChapters,
    headings: all,
  };
  await writeFile(OUT_PATH, JSON.stringify(payload), "utf8");
  console.log(`\nWrote ${OUT_PATH}`);
  console.log(`  ${Object.keys(all).length} headings across ${okChapters} chapters`);
  if (failChapters.length) console.log(`  ${failChapters.length} chapters failed: ${failChapters.join(", ")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
