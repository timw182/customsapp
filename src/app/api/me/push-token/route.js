// POST /api/me/push-token
//   Register (or refresh) this device for push AND sync the per-user flags
//   in one call. The mobile client calls this on every app launch and whenever
//   the user flips a toggle, so it's idempotent and cheap.
//   Body: {
//     token:    string   (Expo push token — required when the master is ON)
//     platform: "ios" | "android" | "web"
//     flags:    {
//       pushEnabled?, pushNewResults?, pushLowConfidence?,
//       pushBilling?, pushProductUpdates?, emailEnabled?
//     }
//   }
//   Missing flag keys preserve the existing value on update, or fall back to
//   the schema defaults on first insert.
//
// DELETE /api/me/push-token?token=...
//   Remove one device's token (master flipped OFF, or sign-out). Omit ?token
//   to wipe every device for this user (e.g. "disable on all devices").
//   Does NOT clear NotificationPrefs — flags persist so re-enabling restores
//   the same per-category state.
//
// GET /api/me/push-token
//   Return current NotificationPrefs + the device list. Used by the client
//   to reconcile state on launch when the OS-level permission may have
//   changed out from under us.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";

const ALLOWED_PLATFORMS = new Set(["ios", "android", "web"]);
const FLAG_KEYS = [
  "pushEnabled",
  "pushNewResults",
  "pushLowConfidence",
  "pushBilling",
  "pushProductUpdates",
  "emailEnabled",
];

function pickFlags(input) {
  if (!input || typeof input !== "object") return {};
  const out = {};
  for (const k of FLAG_KEYS) {
    if (typeof input[k] === "boolean") out[k] = input[k];
  }
  return out;
}

const PREFS_SELECT = {
  pushEnabled: true,
  pushNewResults: true,
  pushLowConfidence: true,
  pushBilling: true,
  pushProductUpdates: true,
  emailEnabled: true,
  updatedAt: true,
};

const DEVICE_SELECT = {
  id: true,
  token: true,
  platform: true,
  updatedAt: true,
};

export async function POST(req) {
  const auth = await requireUser(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body;
  try { body = await req.json(); } catch { body = null; }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const platform = typeof body.platform === "string" ? body.platform.trim().toLowerCase() : "";
  const flags = pickFlags(body.flags);

  // If a token is supplied, validate platform too. The client may omit the
  // token when only syncing flags (push disabled on this device but we still
  // want to update other categories).
  if (token && !ALLOWED_PLATFORMS.has(platform)) {
    return NextResponse.json({ error: "platform must be ios|android|web" }, { status: 400 });
  }

  const [prefs, device] = await prisma.$transaction([
    prisma.notificationPrefs.upsert({
      where: { userId: auth.userId },
      create: { userId: auth.userId, ...flags },
      update: flags,
      select: PREFS_SELECT,
    }),
    ...(token
      ? [prisma.devicePushToken.upsert({
          where: { token },
          create: { userId: auth.userId, token, platform },
          update: { userId: auth.userId, platform },
          select: DEVICE_SELECT,
        })]
      : []),
  ]);

  return NextResponse.json({
    prefs,
    device: device ?? null,
  });
}

export async function DELETE(req) {
  const auth = await requireUser(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (token) {
    // Scope the delete to this user's row — don't let a leaked token of
    // another user be wiped via this endpoint.
    await prisma.devicePushToken.deleteMany({
      where: { userId: auth.userId, token },
    });
  } else {
    await prisma.devicePushToken.deleteMany({ where: { userId: auth.userId } });
  }

  return NextResponse.json({ ok: true });
}

export async function GET(req) {
  const auth = await requireUser(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const [prefs, devices] = await Promise.all([
    prisma.notificationPrefs.findUnique({
      where: { userId: auth.userId },
      select: PREFS_SELECT,
    }),
    prisma.devicePushToken.findMany({
      where: { userId: auth.userId },
      select: DEVICE_SELECT,
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  return NextResponse.json({ prefs, devices });
}
