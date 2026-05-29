// POST /api/auth/reset-password
// Body: { email, code, newPassword, deviceName? }
//
// Validates a reset_password code, hashes the new password, updates the user's
// passwordHash, marks `emailVerifiedAt` if not already set (verifying the email
// as a side-effect of proving inbox access), and issues a session token so the
// mobile app drops the user straight into the authenticated experience.
//
// This is the path legacy "!otp-only" users take to set their first real
// password — the same code that resets a password also unblocks them.

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  normalizeEmail, isValidEmail, verifyCodeHash, consumeCode,
  bumpAttempts, latestActiveCode, MAX_ATTEMPTS, CODE_PURPOSES,
} from "@/lib/otp";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { issueToken, revokeUserTokens } from "@/lib/apiAuth";

const schema = z.object({
  email: z.string().min(1).max(320),
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(200),
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

  const { code, newPassword, deviceName } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true, emailVerifiedAt: true },
  });
  if (!user) {
    return NextResponse.json(GENERIC_ERROR, { status: 400 });
  }

  const row = await latestActiveCode(email, CODE_PURPOSES.RESET_PASSWORD);
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

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
    },
  });

  // A reset means the old password may be compromised — kill every existing
  // session before minting the fresh one below so stale tokens can't survive.
  await revokeUserTokens(user.id);

  const { plaintext, row: tokenRow } = await issueToken({
    userId: user.id,
    name: deviceName || "Password reset",
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
