// GET /api/me/profile  → returns the authenticated user's profile.
// PUT /api/me/profile  → updates name / company / phone / avatar.
//
// Account-wide store: both the mobile app and the web UI hit these so a user
// sees the same profile everywhere they sign in. Avatar is stored as raw
// base64 (no data: prefix) plus its MIME; the GET response wraps it in a data
// URL the client can drop straight into <img src> / <Image source.uri>.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";

// Hard cap on inbound avatar payloads. ~800KB base64 = ~600KB binary, plenty
// for a 512×512 JPEG. Mobile resizes/compresses before sending; this is the
// "in case the client misbehaves" backstop.
const MAX_AVATAR_B64 = 800_000;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

const putSchema = z.object({
  name:    z.string().trim().max(120).nullable().optional(),
  company: z.string().trim().max(120).nullable().optional(),
  phone:   z.string().trim().max(40).nullable().optional(),
  // avatar:
  //   undefined → don't touch
  //   null      → clear
  //   { mime, base64 } → replace
  avatar: z
    .union([
      z.null(),
      z.object({
        mime: z.string().refine((v) => ALLOWED_MIME.has(v), "Unsupported image type"),
        base64: z.string().min(1).max(MAX_AVATAR_B64, "Avatar too large"),
      }),
    ])
    .optional(),
});

function toResponse(user) {
  const avatar =
    user.avatarMime && user.avatarData
      ? { mime: user.avatarMime, dataUrl: `data:${user.avatarMime};base64,${user.avatarData}` }
      : null;
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? "",
    company: user.company ?? "",
    phone: user.phone ?? "",
    avatar,
  };
}

export async function GET(req) {
  const auth = await requireUser(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: {
      id: true, email: true, name: true,
      company: true, phone: true, avatarMime: true, avatarData: true,
    },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json({ profile: toResponse(user) });
}

export async function PUT(req) {
  const auth = await requireUser(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const data = {};
  if (parsed.data.name !== undefined)    data.name    = parsed.data.name?.length ? parsed.data.name : null;
  if (parsed.data.company !== undefined) data.company = parsed.data.company?.length ? parsed.data.company : null;
  if (parsed.data.phone !== undefined)   data.phone   = parsed.data.phone?.length ? parsed.data.phone : null;
  if (parsed.data.avatar !== undefined) {
    if (parsed.data.avatar === null) {
      data.avatarMime = null;
      data.avatarData = null;
    } else {
      data.avatarMime = parsed.data.avatar.mime;
      data.avatarData = parsed.data.avatar.base64;
    }
  }

  const user = await prisma.user.update({
    where: { id: auth.userId },
    data,
    select: {
      id: true, email: true, name: true,
      company: true, phone: true, avatarMime: true, avatarData: true,
    },
  });
  return NextResponse.json({ profile: toResponse(user) });
}
