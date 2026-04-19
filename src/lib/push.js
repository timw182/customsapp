// Expo push delivery, gated by NotificationPrefs.
//
// Usage:
//   import { sendPushToUser } from "@/lib/push";
//   await sendPushToUser({
//     userId,
//     category: "newResults",       // maps to the pushNewResults flag
//     title: "Classification ready",
//     body:  "Plastic widget → CN 3924 10 00",
//     data:  { hs: "39241000" },
//   });
//
// Delivery gates checked in order:
//   1. NotificationPrefs.pushEnabled (master) — if false, no push ever.
//   2. The category flag (e.g. pushNewResults).
//   3. User has at least one DevicePushToken registered.
//
// Expo push responses: "DeviceNotRegistered" means the OS revoked permission
// or the app was uninstalled — we delete the token so we stop retrying.
// https://docs.expo.dev/push-notifications/sending-notifications/

import { prisma } from "@/lib/prisma";

const EXPO_ENDPOINT = "https://exp.host/--/api/v2/push/send";

const CATEGORY_TO_FLAG = {
  newResults:     "pushNewResults",
  lowConfidence:  "pushLowConfidence",
  billing:        "pushBilling",
  productUpdates: "pushProductUpdates",
};

/**
 * Send a push to every registered device for `userId` that has the relevant
 * category flag enabled. Returns a summary — callers shouldn't block on this
 * (call with .catch(() => {}) inside a fire-and-forget).
 */
export async function sendPushToUser({ userId, category, title, body, data }) {
  const flagKey = CATEGORY_TO_FLAG[category];
  if (!flagKey) throw new Error(`Unknown push category: ${category}`);

  // Always persist to the inbox first — even if muted — so the user can
  // review what would have reached them. The bell icon works regardless of
  // OS permission or category toggles.
  prisma.notification.create({
    data: {
      userId,
      category,
      title,
      body,
      data: data ? JSON.stringify(data) : null,
    },
  }).catch(() => {});

  const prefs = await prisma.notificationPrefs.findUnique({
    where: { userId },
    select: { pushEnabled: true, [flagKey]: true },
  });
  if (!prefs?.pushEnabled || !prefs[flagKey]) {
    return { sent: 0, skipped: "muted" };
  }

  const devices = await prisma.devicePushToken.findMany({
    where: { userId },
    select: { id: true, token: true },
  });
  if (devices.length === 0) return { sent: 0, skipped: "no-devices" };

  const messages = devices.map((d) => ({
    to: d.token,
    title,
    body,
    data: data ?? {},
    sound: "default",
    priority: "high",
  }));

  let res;
  try {
    res = await fetch(EXPO_ENDPOINT, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });
  } catch (e) {
    return { sent: 0, error: e?.message ?? "network" };
  }

  if (!res.ok) {
    return { sent: 0, error: `Expo returned ${res.status}` };
  }

  const payload = await res.json().catch(() => null);
  const tickets = Array.isArray(payload?.data) ? payload.data : [];

  // Walk the tickets — any "DeviceNotRegistered" means the client-side token
  // is stale. Delete those rows so we stop retrying.
  const deadIds = [];
  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i];
    const device = devices[i];
    if (t?.status === "error" && t.details?.error === "DeviceNotRegistered") {
      deadIds.push(device.id);
    }
  }
  if (deadIds.length > 0) {
    await prisma.devicePushToken.deleteMany({ where: { id: { in: deadIds } } })
      .catch(() => {});
  }

  const sent = tickets.filter((t) => t?.status === "ok").length;
  return { sent, pruned: deadIds.length, total: devices.length };
}

// Chunk size for Expo's push API — their docs cap a single POST at 100.
const EXPO_BATCH = 100;

/**
 * Send a push to every user who has `pushEnabled` AND the given category
 * flag on. Used for product-update announcements, maintenance notices, etc.
 * Batched at 100 per request. Prunes DeviceNotRegistered tokens on the way.
 */
export async function broadcastPush({ category, title, body, data }) {
  const flagKey = CATEGORY_TO_FLAG[category];
  if (!flagKey) throw new Error(`Unknown push category: ${category}`);

  // Persist to every user's inbox (regardless of mute state), so even users
  // who have this category muted can still see announcements in the bell.
  // We target users who have the MASTER pushEnabled on but skip the
  // per-category check here — product updates shouldn't surprise-appear in
  // the inbox of someone who hard-muted the whole app.
  prisma.user.findMany({
    where: { notificationPrefs: { pushEnabled: true } },
    select: { id: true },
  }).then((users) => {
    if (users.length === 0) return;
    return prisma.notification.createMany({
      data: users.map((u) => ({
        userId: u.id,
        category,
        title,
        body,
        data: data ? JSON.stringify(data) : null,
      })),
    });
  }).catch(() => {});

  // Pull every device whose user has the master + category on. One query,
  // flat list keyed by token, so we can chunk straight into Expo.
  const rows = await prisma.devicePushToken.findMany({
    where: {
      user: {
        notificationPrefs: { pushEnabled: true, [flagKey]: true },
      },
    },
    select: { id: true, token: true },
  });
  if (rows.length === 0) return { sent: 0, total: 0 };

  let sentTotal = 0;
  let prunedTotal = 0;

  for (let i = 0; i < rows.length; i += EXPO_BATCH) {
    const chunk = rows.slice(i, i + EXPO_BATCH);
    const messages = chunk.map((r) => ({
      to: r.token,
      title,
      body,
      data: data ?? {},
      sound: "default",
      priority: "high",
    }));

    let res;
    try {
      res = await fetch(EXPO_ENDPOINT, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Accept-encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messages),
      });
    } catch {
      continue;
    }
    if (!res.ok) continue;

    const payload = await res.json().catch(() => null);
    const tickets = Array.isArray(payload?.data) ? payload.data : [];

    const dead = [];
    for (let j = 0; j < tickets.length; j++) {
      const t = tickets[j];
      if (t?.status === "ok") sentTotal += 1;
      if (t?.status === "error" && t.details?.error === "DeviceNotRegistered") {
        dead.push(chunk[j].id);
      }
    }
    if (dead.length) {
      prunedTotal += dead.length;
      await prisma.devicePushToken.deleteMany({ where: { id: { in: dead } } })
        .catch(() => {});
    }
  }

  return { sent: sentTotal, pruned: prunedTotal, total: rows.length };
}
