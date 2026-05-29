// GET  /api/me/data  — returns row counts for each deletable data category
// DELETE /api/me/data  — deletes a specific category { category: string }

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";

const CATEGORIES = ["searchHistory", "favourites", "shipments", "notifications", "deviceTokens", "prefs"];

export async function GET(req) {
  const auth = await requireUser(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const [searchHistory, favourites, shipments, notifications, deviceTokens, user] = await Promise.all([
    prisma.hsSearchHistory.count({ where: { userId: auth.userId } }),
    prisma.hSFavourite.count({ where: { userId: auth.userId } }),
    prisma.shipment.count({ where: { userId: auth.userId } }),
    prisma.notification.count({ where: { userId: auth.userId } }),
    prisma.devicePushToken.count({ where: { userId: auth.userId } }),
    prisma.user.findUnique({ where: { id: auth.userId }, select: { prefsJson: true, createdAt: true } }),
  ]);

  return NextResponse.json({
    searchHistory,
    favourites,
    shipments,
    notifications,
    deviceTokens,
    hasPrefs: !!user?.prefsJson,
    memberSince: user?.createdAt ?? null,
  });
}

export async function DELETE(req) {
  const auth = await requireUser(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { category } = body;
  if (!CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "Unknown category" }, { status: 400 });
  }

  switch (category) {
    case "searchHistory":
      await prisma.hsSearchHistory.deleteMany({ where: { userId: auth.userId } });
      break;
    case "favourites":
      await prisma.hSFavourite.deleteMany({ where: { userId: auth.userId } });
      break;
    case "shipments":
      await prisma.shipment.deleteMany({ where: { userId: auth.userId } });
      break;
    case "notifications":
      await prisma.notification.deleteMany({ where: { userId: auth.userId } });
      break;
    case "deviceTokens":
      await prisma.devicePushToken.deleteMany({ where: { userId: auth.userId } });
      break;
    case "prefs":
      await prisma.user.update({ where: { id: auth.userId }, data: { prefsJson: null } });
      break;
  }

  return NextResponse.json({ ok: true, deleted: category });
}
