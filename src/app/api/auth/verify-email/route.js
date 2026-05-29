// POST /api/auth/verify-email
// Body: { email, code, deviceName? }
//
// Confirms a freshly created account by validating a 6-digit verify_email code.
// On success: marks the user as verified, issues a session ApiToken, returns the
// same shape every existing route already accepts via `requireUser`.
//
// On failure: bumps the attempt counter; consumes the code after MAX_ATTEMPTS so
// it can't be brute-forced further.

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  normalizeEmail, isValidEmail, verifyCodeHash, consumeCode,
  bumpAttempts, latestActiveCode, MAX_ATTEMPTS, CODE_PURPOSES,
} from "@/lib/otp";
import { prisma } from "@/lib/prisma";
import { issueToken } from "@/lib/apiAuth";

const schema = z.object({
  email: z.string().min(1).max(320),
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
  deviceName: z.string().trim().min(1).max(60).optional(),
});

const GENERIC_ERROR = { error: "Invalid or expired code", code: "INVALID_OR_EXPIRED_CODE" };

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const email = normalizeEmail(parsed.data.email);
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const { code, deviceName } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true, emailVerifiedAt: true },
  });
  if (!user) {
    return NextResponse.json(GENERIC_ERROR, { status: 400 });
  }

  const row = await latestActiveCode(email, CODE_PURPOSES.VERIFY_EMAIL);
  if (!row) {
    return NextResponse.json(GENERIC_ERROR, { status: 400 });
  }

  if (row.attempts >= MAX_ATTEMPTS) {
    await consumeCode(row.id);
    return NextResponse.json(
      { error: "Too many attempts. Request a new code.", code: "TOO_MANY" },
      { status: 429 }
    );
  }

  const match = await verifyCodeHash(code, row.codeHash);
  if (!match) {
    await bumpAttempts(row.id);
    const remaining = Math.max(0, MAX_ATTEMPTS - (row.attempts + 1));
    return NextResponse.json(
      { ...GENERIC_ERROR, attemptsRemaining: remaining },
      { status: 400 }
    );
  }

  await consumeCode(row.id);

  // Mark the account verified iff it isn't already (re-verify is harmless).
  if (!user.emailVerifiedAt) {
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });
  }

  const { plaintext, row: tokenRow } = await issueToken({
    userId: user.id,
    name: deviceName || "Email verification",
  });

  return NextResponse.json({
    ok: true,
    token: plaintext,
    tokenId: tokenRow.id,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });
}
