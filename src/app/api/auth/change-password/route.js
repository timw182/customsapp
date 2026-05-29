// POST /api/auth/change-password
// Body: { currentPassword, newPassword }
// Auth: Bearer token (requireUser)
//
// Validates the current password, hashes the new one, and updates the user
// record. Returns 401 if the current password doesn't match.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, revokeUserTokens } from "@/lib/apiAuth";
import { verifyPassword, hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export async function POST(req) {
  const auth = await requireUser(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });

  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Invalid request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { passwordHash: true },
  });

  if (!user?.passwordHash || user.passwordHash === "!otp-only") {
    return NextResponse.json(
      { error: "No password set — use forgot password to set one", code: "NO_PASSWORD" },
      { status: 400 }
    );
  }

  const match = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
  if (!match) {
    return NextResponse.json(
      { error: "Current password is incorrect", code: "WRONG_PASSWORD" },
      { status: 401 }
    );
  }

  const newHash = await hashPassword(parsed.data.newPassword);
  await prisma.user.update({
    where: { id: auth.userId },
    data: { passwordHash: newHash },
  });

  // Log out every other device after a password change. Keep the current
  // session (auth.tokenId) alive so the user isn't kicked out of the app they
  // just used; a web session (no tokenId) revokes all mobile tokens.
  await revokeUserTokens(auth.userId, auth.tokenId ?? null);

  return NextResponse.json({ ok: true });
}
