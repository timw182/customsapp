import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(8).max(128),
  inviteCode: z.string().min(1),
});

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first?.path?.[0];
    if (field === "email") return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    if (field === "password") return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    return NextResponse.json({ error: "All fields are required" }, { status: 400 });
  }

  const { email, name, password, inviteCode } = parsed.data;

  // Check invite exists and is not expired (pre-check only — race condition handled below)
  const invite = await prisma.inviteCode.findUnique({ where: { code: inviteCode } });
  if (!invite) {
    return NextResponse.json({ error: "Invalid or already used invite code" }, { status: 400 });
  }
  if (invite.expiresAt && invite.expiresAt < new Date()) {
    return NextResponse.json({ error: "Invite code expired" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Email already in use" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // Atomic claim: updateMany with usedAt=null guard prevents two simultaneous registrations
  // using the same invite code (TOCTOU race condition fix)
  const claimed = await prisma.inviteCode.updateMany({
    where: { code: inviteCode, usedAt: null },
    data: { usedAt: new Date(), usedBy: email },
  });

  if (claimed.count === 0) {
    // Another request won the race — code was just used
    return NextResponse.json({ error: "Invalid or already used invite code" }, { status: 400 });
  }

  try {
    await prisma.user.create({ data: { email, name, passwordHash } });
  } catch (err) {
    // If user creation fails, roll back the invite claim so it can be reused
    await prisma.inviteCode.update({
      where: { code: inviteCode },
      data: { usedAt: null, usedBy: null },
    });
    throw err;
  }

  return NextResponse.json({ ok: true });
}
