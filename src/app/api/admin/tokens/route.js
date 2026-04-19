// Admin-only API for managing per-user mobile tokens.
// Admins can list tokens for any user, generate new ones, and revoke them.
// Users generate tokens for themselves via an admin hand-off (one-time plaintext).

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { issueToken, revokeToken } from "@/lib/apiAuth";
import { z } from "zod";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) return { error: "Unauthenticated", status: 401 };
  if (session.user.role !== "ADMIN") return { error: "Forbidden", status: 403 };
  return { session };
}

const createSchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1).max(100),
  expiresInDays: z.number().int().positive().optional(),
});

const deleteSchema = z.object({
  id: z.string().min(1),
});

// GET /api/admin/tokens?userId=<id>  — list tokens for one user
// GET /api/admin/tokens               — list all tokens
export async function GET(req) {
  const a = await requireAdmin();
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  const where = userId ? { userId } : {};

  const rows = await prisma.apiToken.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      prefix: r.prefix,
      userId: r.userId,
      userEmail: r.user?.email,
      userName: r.user?.name,
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt,
      expiresAt: r.expiresAt,
      revokedAt: r.revokedAt,
    }))
  );
}

// POST /api/admin/tokens — generate a new token. Returns plaintext ONCE.
export async function POST(req) {
  const a = await requireAdmin();
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.issues }, { status: 400 });
  }

  const { userId, name, expiresInDays } = parsed.data;
  // Verify the user exists.
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 86400 * 1000)
    : null;

  const { plaintext, row } = await issueToken({ userId, name, expiresAt });
  return NextResponse.json({
    plaintext, // shown once, never returned again
    token: {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      userId: row.userId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    },
  });
}

// DELETE /api/admin/tokens — revoke a token (soft-delete via revokedAt).
export async function DELETE(req) {
  const a = await requireAdmin();
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }

  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  await revokeToken(parsed.data.id);
  return NextResponse.json({ ok: true });
}
