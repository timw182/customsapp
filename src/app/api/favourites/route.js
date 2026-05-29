import { NextResponse } from "next/server";
import { requireUser } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";
import { FREE_SAVED_LIMIT } from "@/lib/limits";
import { z } from "zod";

const sensitiveGoodsSchema = z.object({
  category: z.string().min(1).max(200),
  warning: z.string().min(1).max(2000),
  licenceAuthority: z.string().max(400).optional(),
  regulations: z.array(z.string().max(400)).max(20).optional(),
  consequences: z.string().max(2000).optional(),
}).nullable().optional();

const createSchema = z.object({
  hsCode: z.string().min(4).max(14),
  description: z.string().min(1).max(500),
  shortLabel: z.string().max(80).optional(),
  dutyRate: z.number().min(0).max(100).optional(),
  notes: z.string().max(1000).optional(),
  reasoning: z.string().max(4000).optional(),
  confidencePct: z.number().int().min(0).max(100).optional(),
  sensitiveGoods: sensitiveGoodsSchema,
});

function parseSensitive(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function serialiseFav(fav) {
  return { ...fav, sensitiveGoods: parseSensitive(fav.sensitiveGoods) };
}

const deleteSchema = z.object({
  id: z.string().min(1),
});

export async function GET(req) {
  const a = await requireUser(req);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });
  const favs = await prisma.hSFavourite.findMany({
    where: { userId: a.userId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(favs.map(serialiseFav));
}

export async function POST(req) {
  const a = await requireUser(req);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.issues }, { status: 400 });
  }

  const { hsCode, description, shortLabel, dutyRate, notes, reasoning, confidencePct, sensitiveGoods } = parsed.data;
  const sensitiveGoodsJson = sensitiveGoods ? JSON.stringify(sensitiveGoods) : null;
  const cleanLabel = typeof shortLabel === "string" ? shortLabel.replace(/\s+/g, " ").trim().slice(0, 40) || null : null;

  // Free-tier cap: 4 saved records. UPSERT means editing an existing
  // favourite (same hsCode) doesn't count against the cap — only adding a
  // brand-new one does. Pro skips the check entirely.
  const user = await prisma.user.findUnique({
    where: { id: a.userId },
    select: { plan: true },
  });
  if (user?.plan !== "pro") {
    const existing = await prisma.hSFavourite.findUnique({
      where: { userId_hsCode: { userId: a.userId, hsCode } },
      select: { id: true },
    });
    if (!existing) {
      const count = await prisma.hSFavourite.count({ where: { userId: a.userId } });
      if (count >= FREE_SAVED_LIMIT) {
        return NextResponse.json(
          { error: "SAVED_LIMIT", code: "SAVED_LIMIT", limit: FREE_SAVED_LIMIT },
          { status: 402 },
        );
      }
    }
  }

  const fav = await prisma.hSFavourite.upsert({
    where: { userId_hsCode: { userId: a.userId, hsCode } },
    update: { description, shortLabel: cleanLabel, dutyRate, notes, reasoning, confidencePct, sensitiveGoods: sensitiveGoodsJson },
    create: { userId: a.userId, hsCode, description, shortLabel: cleanLabel, dutyRate: dutyRate ?? 0, notes, reasoning, confidencePct, sensitiveGoods: sensitiveGoodsJson },
  });
  return NextResponse.json(serialiseFav(fav));
}

export async function DELETE(req) {
  const a = await requireUser(req);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  // `?all=1` wipes every favourite for the current user. Used by the
  // Data & Privacy screen's "Delete All Classifications" action.
  const url = new URL(req.url);
  if (url.searchParams.get("all") === "1") {
    const result = await prisma.hSFavourite.deleteMany({
      where: { userId: a.userId },
    });
    return NextResponse.json({ ok: true, deleted: result.count });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // Scope deletion to the current user so one user can't delete another's favourite.
  const result = await prisma.hSFavourite.deleteMany({
    where: { id: parsed.data.id, userId: a.userId },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
