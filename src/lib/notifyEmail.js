// Sends a notification email via Resend, gated by NotificationPrefs.emailEnabled.
// Shares the Dutify Pocket palette with otpEmail.js so brand stays consistent.
//
// Usage:
//   await sendNotificationEmail({
//     userId,
//     category: "billing",               // maps to emailEnabled master
//     subject: "Your Dutify Pro renewed",
//     heading: "Renewal confirmed",
//     lead:    "Your annual plan renewed on 19 Apr 2026.",
//     ctaLabel: "View invoice",
//     ctaUrl:   "https://dutify.lu/account/billing",
//   });
//
// Returns { sent: boolean, reason?: string, error?: string }.

import { Resend } from "resend";
import { prisma } from "@/lib/prisma";

const FROM = process.env.RESEND_FROM ?? "Dutify <codes@dutify.lu>";
const REPLY_TO = process.env.RESEND_REPLY_TO ?? "hello@dutify.lu";

// Palette — kept in sync with src/lib/otpEmail.js
const BG = "#1C1F26";
const CARD = "#252A35";
const RAISED = "#2C3040";
const BORDER = "#2E3445";
const TEXT = "#F5F5F5";
const TEXT_MUTED = "#A0A8B8";
const TEXT_FAINT = "#5C6478";
const SAGE = "#9CA88A";

const BODY_FONT = "'DM Sans','Helvetica Neue',Arial,sans-serif";
const MONO_FONT = "'JetBrains Mono','SFMono-Regular',Menlo,Consolas,monospace";

function buildHtml({ eyebrow, heading, lead, ctaLabel, ctaUrl }) {
  const cta = ctaLabel && ctaUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0;">
         <tr>
           <td style="background:${SAGE};border-radius:10px;">
             <a href="${ctaUrl}" style="display:inline-block;padding:14px 22px;font-family:${BODY_FONT};font-size:14px;font-weight:700;color:${BG};text-decoration:none;letter-spacing:0.2px;">${ctaLabel} →</a>
           </td>
         </tr>
       </table>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${heading}</title>
</head>
<body style="margin:0;padding:0;background:${BG};font-family:${BODY_FONT};color:${TEXT};-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:48px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:${CARD};border:1px solid ${BORDER};border-radius:16px;overflow:hidden;max-width:560px;width:100%;">

          <tr><td style="background:${SAGE};height:2px;font-size:0;line-height:0;">&nbsp;</td></tr>

          <tr>
            <td style="padding:36px 40px 28px;border-bottom:1px solid ${BORDER};">
              <p style="margin:0 0 12px;font-family:${MONO_FONT};font-size:10px;font-weight:500;letter-spacing:2.4px;text-transform:uppercase;color:${SAGE};">
                ${eyebrow}
              </p>
              <h1 style="margin:0;font-family:${BODY_FONT};font-size:28px;font-weight:700;color:${TEXT};letter-spacing:-0.4px;line-height:1.1;">
                Dutify<span style="color:${SAGE};">.</span>
              </h1>
            </td>
          </tr>

          <tr>
            <td style="padding:36px 40px 28px;">
              <h2 style="margin:0 0 14px;font-family:${BODY_FONT};font-size:22px;font-weight:700;color:${TEXT};letter-spacing:-0.3px;line-height:1.25;">
                ${heading}
              </h2>
              <p style="margin:0;color:${TEXT_MUTED};font-size:15px;line-height:1.6;font-family:${BODY_FONT};">
                ${lead}
              </p>
              ${cta}
            </td>
          </tr>

          <tr>
            <td style="padding:0 40px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:${RAISED};border:1px solid ${BORDER};border-radius:10px;padding:14px 16px;">
                    <p style="margin:0;font-family:${MONO_FONT};font-size:11px;color:${TEXT_MUTED};letter-spacing:0.4px;line-height:1.6;">
                      <span style="color:${SAGE};">●</span>&nbsp;&nbsp;Manage email preferences inside the Dutify Pocket app — Settings → Notifications.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <p style="margin:22px 0 0;font-family:${MONO_FONT};font-size:10px;color:${TEXT_FAINT};letter-spacing:2.4px;text-transform:uppercase;">
          Luxembourg · dutify.lu
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildText({ heading, lead, ctaLabel, ctaUrl }) {
  const cta = ctaLabel && ctaUrl ? `\n${ctaLabel}: ${ctaUrl}\n` : "";
  return [
    heading,
    "",
    lead,
    cta,
    "",
    "Manage email preferences in Dutify Pocket → Settings → Notifications.",
    "dutify.lu",
  ].join("\n");
}

/**
 * Send a branded notification email. Skips the send if the user has opted
 * out via NotificationPrefs.emailEnabled, or if no email is on file.
 *
 * `category` is kept for future fine-grained toggles (new-result digest vs.
 * billing vs. product). Today it's informational only — all non-OTP email
 * honours the single emailEnabled master flag.
 */
export async function sendNotificationEmail({
  userId,
  category = "general",
  subject,
  eyebrow = "Dutify Pocket",
  heading,
  lead,
  ctaLabel,
  ctaUrl,
}) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  const [user, prefs] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    }),
    prisma.notificationPrefs.findUnique({
      where: { userId },
      select: { emailEnabled: true },
    }),
  ]);

  if (!user?.email) return { sent: false, reason: "no-email" };
  if (prefs && prefs.emailEnabled === false) return { sent: false, reason: "opted-out" };

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: FROM,
    to: user.email,
    replyTo: REPLY_TO,
    subject,
    html: buildHtml({ eyebrow, heading, lead, ctaLabel, ctaUrl }),
    text: buildText({ heading, lead, ctaLabel, ctaUrl }),
    // Resend supports headers for List-Unsubscribe — worth wiring once we
    // have a one-click unsubscribe route. Placeholder for now.
    headers: {
      "X-Notification-Category": category,
    },
  });

  if (error) return { sent: false, error: error.message ?? "Resend failure" };
  return { sent: true };
}

/**
 * Send the same branded notification email to every user who has
 * emailEnabled === true AND a usable email. Resend doesn't have a cheap
 * "batch to many recipients" API that keeps per-user opt-out — so we loop.
 * Fine for our user volume; upgrade to Resend batch / a queue if it grows.
 *
 * Returns a summary of attempts. Individual failures are swallowed so one
 * bad address doesn't abort the broadcast.
 */
export async function broadcastNotificationEmail({
  category = "productUpdates",
  subject,
  eyebrow = "Dutify Pocket",
  heading,
  lead,
  ctaLabel,
  ctaUrl,
}) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  const users = await prisma.user.findMany({
    where: {
      notificationPrefs: { emailEnabled: true },
      email: { not: "" },
    },
    select: { email: true },
  });
  if (users.length === 0) return { sent: 0, total: 0 };

  const resend = new Resend(process.env.RESEND_API_KEY);
  const html = buildHtml({ eyebrow, heading, lead, ctaLabel, ctaUrl });
  const text = buildText({ heading, lead, ctaLabel, ctaUrl });

  let sent = 0;
  let failed = 0;
  for (const u of users) {
    try {
      const { error } = await resend.emails.send({
        from: FROM,
        to: u.email,
        replyTo: REPLY_TO,
        subject,
        html,
        text,
        headers: { "X-Notification-Category": category },
      });
      if (error) failed += 1;
      else sent += 1;
    } catch {
      failed += 1;
    }
  }

  return { sent, failed, total: users.length };
}
