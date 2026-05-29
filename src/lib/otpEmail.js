// Sends an email-verification or password-reset code via Resend.
// Template matches the Dutify Pocket mobile app: deep charcoal canvas,
// sage accents, DM Sans / JetBrains Mono, minimal layout.
//
// Email-client caveats:
// - All styles inline; <style> is stripped by Gmail and others.
// - meta name="color-scheme" + supported-color-schemes stops Apple Mail dark
//   mode from auto-inverting our already-dark palette.
// - Outlook gets degraded font stacks (no DM Sans) via system sans.

import { Resend } from "resend";
import { CODE_PURPOSES } from "@/lib/otp";

// Verification + password-reset codes are sent from the main hello@ address
// (not the shared RESEND_FROM env, which targets transactional notification
// emails). Keeping the From: line consistent with the reply-to means users
// who reply to a code email land in the same inbox they'd expect.
const FROM = process.env.RESEND_FROM_OTP ?? "Dutify <hello@dutify.lu>";
const REPLY_TO = process.env.RESEND_REPLY_TO ?? "hello@dutify.lu";

// App palette (theme/tokens.ts mirror)
const BG = "#1C1F26";        // deep charcoal
const CARD = "#252A35";
const RAISED = "#2C3040";
const INPUT = "#1A1E27";
const BORDER = "#2E3445";
const TEXT = "#F5F5F5";
const TEXT_MUTED = "#A0A8B8";
const TEXT_FAINT = "#5C6478";
const SAGE = "#9CA88A";
const SAGE_DIM = "#7A8A6A";

const BODY_FONT = "'DM Sans','Helvetica Neue',Arial,sans-serif";
const MONO_FONT = "'JetBrains Mono','SFMono-Regular',Menlo,Consolas,monospace";

const COPY = {
  [CODE_PURPOSES.VERIFY_EMAIL]: {
    eyebrow: "Dutify Pocket · Verify email",
    headline: "Verify your email",
    body: "Enter this code in the Dutify app to finish creating your account. If you didn't sign up, you can ignore this email — the code expires on its own.",
    cardLabel: "Verification Code",
    subject: (code) => `Your Dutify verification code: ${code}`,
    textTitle: "Your Dutify verification code",
    textHint: (ttl) => `Enter this code in the Dutify app within ${ttl} minutes to verify your email.`,
  },
  [CODE_PURPOSES.RESET_PASSWORD]: {
    eyebrow: "Dutify Pocket · Reset password",
    headline: "Reset your password",
    body: "Enter this code in the Dutify app to set a new password. If you didn't request a reset, you can ignore this email — the code expires on its own.",
    cardLabel: "Reset Code",
    subject: (code) => `Your Dutify password reset code: ${code}`,
    textTitle: "Your Dutify password reset code",
    textHint: (ttl) => `Enter this code in the Dutify app within ${ttl} minutes to reset your password.`,
  },
};

function buildHtml(code, ttlMinutes, copy) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${copy.headline}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${BG};font-family:${BODY_FONT};color:${TEXT};-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:48px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:${CARD};border:1px solid ${BORDER};border-radius:16px;overflow:hidden;max-width:560px;width:100%;">

          <!-- Sage hairline -->
          <tr>
            <td style="background:${SAGE};height:2px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- Masthead -->
          <tr>
            <td style="padding:36px 40px 28px;border-bottom:1px solid ${BORDER};">
              <p style="margin:0 0 12px;font-family:${MONO_FONT};font-size:10px;font-weight:500;letter-spacing:2.4px;text-transform:uppercase;color:${SAGE};">
                ${copy.eyebrow}
              </p>
              <h1 style="margin:0;font-family:${BODY_FONT};font-size:28px;font-weight:700;color:${TEXT};letter-spacing:-0.4px;line-height:1.1;">
                Dutify<span style="color:${SAGE};">.</span>
              </h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px 8px;">
              <h2 style="margin:0 0 14px;font-family:${BODY_FONT};font-size:22px;font-weight:700;color:${TEXT};letter-spacing:-0.3px;line-height:1.25;">
                ${copy.headline}
              </h2>
              <p style="margin:0 0 28px;color:${TEXT_MUTED};font-size:15px;line-height:1.6;font-family:${BODY_FONT};">
                ${copy.body}
              </p>

              <!-- Code card -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
                <tr>
                  <td style="background:${INPUT};border:1px solid ${SAGE_DIM};border-radius:12px;padding:28px 20px;text-align:center;">
                    <p style="margin:0 0 12px;font-family:${MONO_FONT};font-size:10px;font-weight:500;letter-spacing:2.4px;text-transform:uppercase;color:${SAGE};">
                      ${copy.cardLabel}
                    </p>
                    <p style="margin:0;font-family:${MONO_FONT};font-size:34px;letter-spacing:10px;color:${TEXT};font-weight:600;line-height:1;">
                      ${code}
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Meta strip -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
                <tr>
                  <td style="background:${RAISED};border:1px solid ${BORDER};border-radius:10px;padding:14px 16px;">
                    <p style="margin:0;font-family:${MONO_FONT};font-size:11px;color:${TEXT_MUTED};letter-spacing:0.4px;line-height:1.6;">
                      <span style="color:${SAGE};">●</span>&nbsp;&nbsp;Expires in ${ttlMinutes} minutes
                      &nbsp;&nbsp;·&nbsp;&nbsp;one-time use
                      &nbsp;&nbsp;·&nbsp;&nbsp;don't share
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:22px 40px 28px;">
              <p style="margin:0;font-family:${BODY_FONT};font-size:12px;line-height:1.6;color:${TEXT_FAINT};">
                Dutify staff will never ask you for this code. If someone does, hang up.
              </p>
            </td>
          </tr>

        </table>

        <!-- Sub-footer -->
        <p style="margin:22px 0 0;font-family:${MONO_FONT};font-size:10px;color:${TEXT_FAINT};letter-spacing:2.4px;text-transform:uppercase;">
          Luxembourg · dutify.lu
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildText(code, ttlMinutes, copy) {
  return [
    copy.textTitle,
    "",
    `    ${code}`,
    "",
    copy.textHint(ttlMinutes),
    "",
    "If you didn't request this, ignore the email — the code expires on its own.",
    "Dutify staff will never ask you for this code.",
    "",
    "dutify.lu",
  ].join("\n");
}

/**
 * Send a one-time email-verification or password-reset code.
 * Returns { ok: true } on success, { ok: false, error } on Resend failure.
 * Throws only on programmer error (missing API key or unknown purpose).
 */
export async function sendOtpEmail({ to, code, ttlMinutes, purpose = CODE_PURPOSES.VERIFY_EMAIL }) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  const copy = COPY[purpose];
  if (!copy) throw new Error(`Unknown OTP email purpose: ${purpose}`);

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: FROM,
    to,
    replyTo: REPLY_TO,
    subject: copy.subject(code),
    html: buildHtml(code, ttlMinutes, copy),
    text: buildText(code, ttlMinutes, copy),
  });
  if (error) return { ok: false, error: error.message ?? "Resend failure" };
  return { ok: true };
}
