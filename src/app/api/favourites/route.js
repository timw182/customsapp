import { NextResponse } from "next/server";
import { requireUser } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";
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

  const { hsCode, description, dutyRate, notes, reasoning, confidencePct, sensitiveGoods } = parsed.data;
  const sensitiveGoodsJson = sensitiveGoods ? JSON.stringify(sensitiveGoods) : null;
  const fav = await prisma.hSFavourite.upsert({
    where: { userId_hsCode: { userId: a.userId, hsCode } },
    update: { description, dutyRate, notes, reasoning, confidencePct, sensitiveGoods: sensitiveGoodsJson },
    create: { userId: a.userId, hsCode, description, dutyRate: dutyRate ?? 0, notes, reasoning, confidencePct, sensitiveGoods: sensitiveGoodsJson },
  });
  return NextResponse.json(serialiseFav(fav));
}

export async function DELETE(req) {
  const a = await requireUser(req);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

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
