// POST /api/support
//   Sends a support ticket from the authenticated mobile user straight to the
//   support inbox via Resend — no device mail client involved. The user types a
//   subject + message in-app; we attach their account context server-side
//   (email, plan, app version, platform) and set reply-to to their address so
//   support can answer them directly.

import { NextResponse } from "next/server";
import { Resend } from "resend";
import { requireUser } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";

// From must be on a Resend-verified domain (same as OTP/notification mail).
// To is the human support inbox; reply-to is overridden per-request to the user.
const FROM = process.env.RESEND_FROM_SUPPORT ?? "Dutify Support <hello@dutify.lu>";
const SUPPORT_INBOX = process.env.SUPPORT_INBOX ?? "hello@kernstudio.dev";

const MAX_SUBJECT = 120;
const MAX_MESSAGE = 4000;

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function POST(req) {
  const auth = await requireUser(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const subject = String(body?.subject ?? "").trim().slice(0, MAX_SUBJECT);
  const message = String(body?.message ?? "").trim().slice(0, MAX_MESSAGE);
  const appVersion = String(body?.appVersion ?? "—").slice(0, 40);
  const platform = String(body?.platform ?? "—").slice(0, 20);

  if (!subject || !message) {
    return NextResponse.json({ error: "Subject and message are required" }, { status: 400 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "Email service is not configured" }, { status: 503 });
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { email: true, plan: true, name: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const planLabel = user.plan === "pro" ? "Pro" : "Free";
  const meta = [
    `Account: ${user.email ?? "unknown"}${user.name ? ` (${user.name})` : ""}`,
    `Plan: ${planLabel}`,
    `App: Dutify Pocket ${appVersion} (${platform})`,
    `User ID: ${auth.userId}`,
  ];

  const text = `${message}\n\n—\n${meta.join("\n")}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1C1F26;line-height:1.5">
  <p style="white-space:pre-wrap;margin:0 0 16px">${esc(message)}</p>
  <hr style="border:none;border-top:1px solid #ddd;margin:16px 0" />
  <p style="font-size:12px;color:#666;margin:0">${meta.map(esc).join("<br/>")}</p>
</div>`;

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: FROM,
    to: SUPPORT_INBOX,
    replyTo: user.email || undefined,
    subject: `[Support · ${planLabel}] ${subject}`,
    text,
    html,
  });

  if (error) {
    return NextResponse.json({ error: error.message ?? "Failed to send ticket" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
