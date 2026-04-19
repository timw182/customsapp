// POST /api/auth/verify-code
// Body: { email, code, deviceName? }
// On success: upserts the User, issues a fresh ApiToken (the same shape every
// existing API route already accepts via `requireUser`), returns the plaintext
// token + minimal user fields. On failure: bumps attempt counter; consumes the
// code after MAX_ATTEMPTS so it can't be brute-forced further.

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  normalizeEmail, isValidEmail, verifyCodeHash, consumeCode,
  bumpAttempts, latestActiveCode, MAX_ATTEMPTS,
} from "@/lib/otp";
import { prisma } from "@/lib/prisma";
import { issueToken } from "@/lib/apiAuth";

const schema = z.object({
  email: z.string().min(1).max(320),
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
  deviceName: z.string().trim().min(1).max(60).optional(),
});

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

  const row = await latestActiveCode(email);
  if (!row) {
    // Either no code was ever sent, or the most recent one already expired /
    // was consumed. Keep the message generic so we don't leak state.
    return NextResponse.json({ error: "Invalid or expired code" }, { status: 400 });
  }

  if (row.attempts >= MAX_ATTEMPTS) {
    await consumeCode(row.id);
    return NextResponse.json({ error: "Too many attempts. Request a new code." }, { status: 429 });
  }

  const match = await verifyCodeHash(code, row.codeHash);
  if (!match) {
    await bumpAttempts(row.id);
    const remaining = Math.max(0, MAX_ATTEMPTS - (row.attempts + 1));
    return NextResponse.json(
      { error: "Invalid code", attemptsRemaining: remaining },
      { status: 400 }
    );
  }

  // Code is valid — burn it first so a duplicate submit can't reuse it.
  await consumeCode(row.id);

  // Upsert the user. Passwordless sign-up: the `passwordHash` column is
  // non-nullable in the schema, so store a disabled sentinel for new rows.
  // Existing rows keep whatever hash they already have.
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      // Sentinel — not a valid bcrypt hash, so password login is impossible.
      passwordHash: "!otp-only",
    },
    update: {},
    select: { id: true, email: true, name: true, role: true },
  });

  const { plaintext, row: tokenRow } = await issueToken({
    userId: user.id,
    name: deviceName || "Passwordless sign-in",
  });

  return NextResponse.json({
    ok: true,
    token: plaintext,
    tokenId: tokenRow.id,
    user,
  });
}
