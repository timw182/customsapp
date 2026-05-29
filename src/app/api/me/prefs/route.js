// GET  /api/me/prefs  — returns merged prefs (server + defaults)
// PATCH /api/me/prefs  — partial update; also syncs emailNotifications → NotificationPrefs

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";

const DEFAULTS = {
  currency: "EUR",
  language: "en",
  dateFormat: "dmy-slash",
  defaultOrigin: null,
  units: "metric",
  showConfidenceScores: true,
  aiModel: "haiku",
  confidenceThreshold: 80,
  autoTaricValidation: true,
  explanationLevel: "short",
  showReasoningSteps: true,
  dataUsageAnalytics: true,
};

function parsePrefs(raw) {
  if (!raw) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function GET(req) {
  const auth = await requireUser(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const [user, notifPrefs] = await Promise.all([
    prisma.user.findUnique({
      where: { id: auth.userId },
      select: { prefsJson: true },
    }),
    prisma.notificationPrefs.findUnique({
      where: { userId: auth.userId },
      select: { emailEnabled: true },
    }),
  ]);

  const prefs = parsePrefs(user?.prefsJson);
  prefs.emailNotifications = notifPrefs?.emailEnabled ?? true;

  return NextResponse.json({ prefs });
}

export async function PATCH(req) {
  const auth = await requireUser(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { prefsJson: true },
  });

  const current = parsePrefs(user?.prefsJson);
  const { emailNotifications, ...rest } = body;

  // Merge only known keys to avoid storing arbitrary data
  const ALLOWED = new Set(Object.keys(DEFAULTS));
  const merged = { ...current };
  for (const [k, v] of Object.entries(rest)) {
    if (ALLOWED.has(k)) merged[k] = v;
  }

  const ops = [
    prisma.user.update({
      where: { id: auth.userId },
      data: { prefsJson: JSON.stringify(merged) },
    }),
  ];

  // Sync email toggle to NotificationPrefs if provided
  if (typeof emailNotifications === "boolean") {
    ops.push(
      prisma.notificationPrefs.upsert({
        where: { userId: auth.userId },
        create: { userId: auth.userId, emailEnabled: emailNotifications },
        update: { emailEnabled: emailNotifications },
      })
    );
  }

  await prisma.$transaction(ops);

  return NextResponse.json({ ok: true, prefs: { ...merged, emailNotifications: emailNotifications ?? true } });
}
