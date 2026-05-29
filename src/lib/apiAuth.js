// Shared auth for API routes.
// Accepts either a NextAuth session (web) or an Authorization: Bearer <token>
// header backed by the ApiToken table (mobile app). Returns { user, userId }
// or { error, status } if unauthenticated.

import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const TOKEN_PREFIX = "dty_live_";
const TOKEN_BYTES = 24; // 32 base64url chars → plenty of entropy

/**
 * Resolve the authenticated user from a Next.js request.
 * Tries Authorization: Bearer <token> first, then falls back to the NextAuth session.
 */
export async function requireUser(req) {
  const authHeader = req?.headers?.get?.("authorization") || "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const plaintext = authHeader.slice(7).trim();
    const tokenRow = await lookupToken(plaintext);
    if (!tokenRow) return { error: "Invalid or revoked token", status: 401 };
    if (tokenRow.expiresAt && tokenRow.expiresAt < new Date()) {
      return { error: "Token expired", status: 401 };
    }
    // Fire-and-forget bump of lastUsedAt; don't block the response.
    prisma.apiToken
      .update({ where: { id: tokenRow.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
    return { user: tokenRow.user, userId: tokenRow.userId, tokenId: tokenRow.id, via: "token" };
  }

  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthenticated", status: 401 };
  return { user: session.user, userId: session.user.id, via: "session" };
}

/**
 * Look up a plaintext bearer token. Constant-time-ish: check prefix first,
 * then bcrypt.compare against matching rows.
 *
 * Plaintext format: "dty_live_" + 32 base64url chars.
 * We store: full bcrypt hash + 8-char plaintext prefix (the chars *after* dty_live_)
 * for display and narrowing the compare set.
 */
async function lookupToken(plaintext) {
  if (!plaintext.startsWith(TOKEN_PREFIX)) return null;
  const body = plaintext.slice(TOKEN_PREFIX.length);
  if (body.length < 16) return null;
  const prefix = body.slice(0, 8);

  const candidates = await prisma.apiToken.findMany({
    where: { prefix, revokedAt: null },
    include: { user: true },
  });

  for (const c of candidates) {
    if (await bcrypt.compare(plaintext, c.tokenHash)) return c;
  }
  return null;
}

/**
 * Generate a new API token for a user. Returns { plaintext, row }.
 * Plaintext must be shown to the user *once* and never stored.
 */
export async function issueToken({ userId, name, expiresAt = null }) {
  const body = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  const plaintext = TOKEN_PREFIX + body;
  const prefix = body.slice(0, 8);
  const tokenHash = await bcrypt.hash(plaintext, 10);
  const row = await prisma.apiToken.create({
    data: { userId, name, tokenHash, prefix, expiresAt },
  });
  return { plaintext, row };
}

export async function revokeToken(id) {
  return prisma.apiToken.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
}

/**
 * Revoke all of a user's live tokens, optionally keeping one (e.g. the session
 * that is performing a password change). Used after credential changes so a
 * stolen/old token can't outlive the password it was issued under.
 */
export async function revokeUserTokens(userId, exceptId = null) {
  return prisma.apiToken.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
}
