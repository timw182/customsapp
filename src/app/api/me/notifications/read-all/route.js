// POST /api/me/notifications/read-all
//   Mark every unread notification read. Used by "Mark all as read" in the
//   bell-icon inbox.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";

export async function POST(req) {
  const auth = await requireUser(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const result = await prisma.notification.updateMany({
    where: { userId: auth.userId, readAt: null },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ ok: true, updated: result.count });
}
