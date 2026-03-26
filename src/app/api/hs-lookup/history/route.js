import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const history = await prisma.hsSearchHistory.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { id: true, description: true, hs6: true, cn8: true, dutyRate: true, fromCache: true, createdAt: true },
  });

  return NextResponse.json(history);
}

export async function DELETE(req) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (id) {
    await prisma.hsSearchHistory.deleteMany({ where: { id, userId: session.user.id } });
  } else {
    await prisma.hsSearchHistory.deleteMany({ where: { userId: session.user.id } });
  }

  return NextResponse.json({ ok: true });
}
