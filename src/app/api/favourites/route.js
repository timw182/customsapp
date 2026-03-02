import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createSchema = z.object({
  hsCode: z.string().min(4).max(14),
  description: z.string().min(1).max(500),
  dutyRate: z.number().min(0).max(100).optional(),
  notes: z.string().max(1000).optional(),
});

const deleteSchema = z.object({
  id: z.string().min(1),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const favs = await prisma.hSFavourite.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(favs);
}

export async function POST(req) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const { hsCode, description, dutyRate, notes } = parsed.data;
  const fav = await prisma.hSFavourite.upsert({
    where: { userId_hsCode: { userId: session.user.id, hsCode } },
    update: { description, dutyRate, notes },
    create: { userId: session.user.id, hsCode, description, dutyRate: dutyRate ?? 0, notes },
  });
  return NextResponse.json(fav);
}

export async function DELETE(req) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  await prisma.hSFavourite.delete({ where: { id: parsed.data.id } });
  return NextResponse.json({ ok: true });
}
