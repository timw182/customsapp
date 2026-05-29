// DELETE /api/me
//   Permanently deletes the authenticated user and all their data.
//   Cascades from User handle ApiToken, Account, Session, Shipment,
//   HSFavourite, and HsSearchHistory automatically. OtpCode is keyed by
//   email (no FK), so we purge those explicitly.
//
// GET /api/me
//   Returns the authenticated user's minimal profile — useful for the mobile
//   app to display the real email after OTP sign-in.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";
import { FREE_SONNET_LIMIT, FREE_SAVED_LIMIT } from "@/lib/limits";

export async function GET(req) {
  const auth = await requireUser(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: {
      id: true, email: true, name: true, role: true, plan: true, createdAt: true,
      sonnetUsesUsed: true,
    },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Classifications the user has run this calendar month. Kept for legacy
  // mobile builds that still surface it; the live paywall does not gate on it.
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const [usageThisMonth, savedCount] = await Promise.all([
    prisma.hsSearchHistory.count({
      where: { userId: auth.userId, createdAt: { gte: startOfMonth } },
    }),
    prisma.hSFavourite.count({ where: { userId: auth.userId } }),
  ]);

  const isPro = user.plan === "pro";
  const sonnetUsesRemaining = isPro
    ? null
    : Math.max(0, FREE_SONNET_LIMIT - (user.sonnetUsesUsed ?? 0));

  return NextResponse.json({
    user: {
      ...user,
      usageThisMonth,
      sonnetUsesRemaining,
      savedCount,
      savedLimit: isPro ? null : FREE_SAVED_LIMIT,
    },
  });
}

export async function DELETE(req) {
  const auth = await requireUser(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { email: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // All User relations use onDelete: Cascade — ApiToken, Account, Session,
  // Shipment, HSFavourite, HsSearchHistory are wiped automatically. OtpCode
  // is keyed by email (no FK), so wipe explicitly.
  await prisma.$transaction([
    prisma.otpCode.deleteMany({ where: { email: user.email } }),
    prisma.user.delete({ where: { id: auth.userId } }),
  ]);

  return NextResponse.json({ ok: true });
}
