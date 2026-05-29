import { NextResponse } from "next/server";
import { requireUser } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";

export async function GET(req) {
  const a = await requireUser(req);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  const history = await prisma.hsSearchHistory.findMany({
    where: { userId: a.userId },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { id: true, description: true, shortLabel: true, hs6: true, cn8: true, dutyRate: true, confidencePct: true, fromCache: true, createdAt: true },
  });

  return NextResponse.json(history);
}

export async function DELETE(req) {
  const a = await requireUser(req);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (id) {
    await prisma.hsSearchHistory.deleteMany({ where: { id, userId: a.userId } });
  } else {
    await prisma.hsSearchHistory.deleteMany({ where: { userId: a.userId } });
  }

  return NextResponse.json({ ok: true });
}
