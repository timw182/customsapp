// PATCH /api/me/notifications/[id]
//   Mark a single notification read (or unread if `{read:false}` is sent).
//
// DELETE /api/me/notifications/[id]
//   Remove a single notification from the inbox.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";

export async function PATCH(req, { params }) {
  const auth = await requireUser(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;

  let body = null;
  try { body = await req.json(); } catch {}
  const markRead = body?.read !== false;   // default: mark read

  const result = await prisma.notification.updateMany({
    where: { id, userId: auth.userId },
    data: { readAt: markRead ? new Date() : null },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const auth = await requireUser(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  const result = await prisma.notification.deleteMany({
    where: { id, userId: auth.userId },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
