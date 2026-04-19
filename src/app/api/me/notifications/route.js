// GET /api/me/notifications
//   Returns the user's inbox — newest first, capped at 100 items. Also
//   includes the unread count so the mobile app can render a badge without
//   a second roundtrip.
//
// DELETE /api/me/notifications
//   Wipes the entire inbox for the current user.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";

const SELECT = {
  id: true,
  category: true,
  title: true,
  body: true,
  data: true,
  readAt: true,
  createdAt: true,
};

function serialise(row) {
  let data = null;
  if (row.data) { try { data = JSON.parse(row.data); } catch { data = null; } }
  return { ...row, data };
}

export async function GET(req) {
  const auth = await requireUser(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: auth.userId },
      select: SELECT,
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.notification.count({
      where: { userId: auth.userId, readAt: null },
    }),
  ]);

  return NextResponse.json({
    notifications: rows.map(serialise),
    unread,
  });
}

export async function DELETE(req) {
  const auth = await requireUser(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const result = await prisma.notification.deleteMany({
    where: { userId: auth.userId },
  });
  return NextResponse.json({ ok: true, deleted: result.count });
}
