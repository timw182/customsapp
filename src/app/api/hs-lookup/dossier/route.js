import { NextResponse } from "next/server";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireUser } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";
import { normalizeDescription } from "@/lib/hs-pipeline.mjs";
import { ClassificationDossierPDF, BtiApplicationPDF } from "@/components/ClassificationDossierPDF";

export const maxDuration = 30;

// react-pdf's built-in fonts cover WinAnsi (CP1252) only; map the few symbols the
// model commonly emits that fall outside it so they don't drop silently from the PDF.
function clean(s) {
  if (s == null) return s;
  return String(s)
    .replace(/≤/g, "<=").replace(/≥/g, ">=")
    .replace(/→/g, "->").replace(/←/g, "<-").replace(/↔/g, "<->")
    .replace(/−/g, "-").replace(/≈/g, "~")
    .replace(/[✓✔]/g, "").replace(/[□☐☑]/g, "[ ]")
    .replace(/⚠/g, "!");
}

// Map a classification result (the HsLookupCache.resultJson shape, also the shape
// the mobile client holds) onto what the PDF components expect. Free-text fields
// are cleaned of non-WinAnsi glyphs so the built-in PDF fonts render them.
function buildDossierData({ inputDescription, result, ref }) {
  const sg = result.sensitiveGoods;
  return {
    inputDescription: clean(inputDescription || ""),
    shortLabel: clean(result.shortLabel) || null,
    hs6: result.hs6 || null,
    cn8: result.cn8 || null,
    cn10: result.cn10 || null,
    taricDescription: clean(result.description) || null,
    confidencePct: typeof result.confidencePct === "number" ? result.confidencePct : null,
    model: result._model || null,
    rationale: clean(result.rationale) || null,
    alternatives: Array.isArray(result.alternatives)
      ? result.alternatives.map((alt) => ({
          code: alt.cn10 || alt.cn8 || alt.hs6,
          hs6: alt.hs6,
          label: clean(alt.label) || "",
          confidencePct: typeof alt.confidencePct === "number" ? alt.confidencePct : null,
          reasoning: clean(alt.reasoning) || "",
        }))
      : [],
    taricVerified: result.taricVerified ?? null,
    taricWarning: clean(result.taricWarning) || null,
    dutyRateRaw:
      result.mfnRateRaw ||
      (typeof result.standardDutyRate === "number" ? `${result.standardDutyRate}%` : null),
    saturnUrl: result.saturnUrl || null,
    sensitiveGoods: sg
      ? {
          category: clean(sg.category),
          warning: clean(sg.warning),
          licenceAuthority: clean(sg.licenceAuthority),
          regulations: Array.isArray(sg.regulations) ? sg.regulations.map(clean) : sg.regulations,
          consequences: clean(sg.consequences),
        }
      : null,
    nomenclatureVersion: "CN 2026 / HS 2022",
    ref,
    generatedAt: new Date().toISOString(),
  };
}

export async function POST(req) {
  const a = await requireUser(req);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });
  const isPro = a.user?.plan === "pro";

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }

  const kind = body?.kind === "ruling" ? "ruling" : "dossier"; // "ruling" PDF wired next (BtiApplicationPDF)
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  const posted = body?.result && typeof body.result === "object" ? body.result : null;

  // The dossier (and the pre-filled ruling draft) are Pro features. The on-screen
  // ruling nudge/checklist stays free on the client; only the generated PDF is gated.
  if (!isPro) return NextResponse.json({ error: "Dossier export is a Pro feature", proOnly: true }, { status: 403 });

  // Prefer the authoritative cached result (text lookups, keyed by the user's input);
  // fall back to the client-posted result (image lookups, whose cache key is the
  // vision-derived text the client never sees — or a rare cache miss/eviction).
  let result = null;
  let inputDescription = query;
  let ref = null;
  if (query) {
    const cached = await prisma.hsLookupCache.findUnique({ where: { descriptionNorm: normalizeDescription(query) } });
    if (cached) {
      try {
        result = JSON.parse(cached.resultJson);
        inputDescription = cached.description || query;
        ref = cached.id ? cached.id.slice(-8).toUpperCase() : null;
      } catch { /* fall through to posted */ }
    }
  }
  if (!result && posted) {
    result = posted;
    inputDescription = query || posted.shortLabel || posted.description || "";
  }
  if (!result) {
    return NextResponse.json({ error: "No classification to document. Run a lookup first." }, { status: 400 });
  }

  const data = buildDossierData({ inputDescription, result, ref });
  if (kind === "ruling") {
    data.applicant = { name: a.user?.name || null, company: a.user?.company || null, email: a.user?.email || null };
  }
  const codeForName = String(result.cn10 || result.cn8 || result.hs6 || "code").replace(/\D/g, "") || "code";
  const filename = `${kind === "ruling" ? "bti-draft" : "dossier"}-${codeForName}-${Date.now()}.pdf`;

  const Component = kind === "ruling" ? BtiApplicationPDF : ClassificationDossierPDF;
  const buffer = await renderToBuffer(React.createElement(Component, { data }));
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
