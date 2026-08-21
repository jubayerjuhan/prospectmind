import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM_EMAIL || 'noreply@prospectmind.ai';

// Newsletters can be pointed at a separate verified subdomain so that a blast
// which attracts spam complaints cannot damage the reputation of the domain
// that also delivers password resets. Falls back to the shared address.
const NEWSLETTER_FROM = process.env.RESEND_NEWSLETTER_FROM_EMAIL || FROM;

// Logs instead of sending. This is what makes it possible to exercise a
// 500-recipient blast — pacing, status transitions, resume, cancel — without
// spending Resend quota or risking a real send to a real list.
const DRY_RUN = process.env.NEWSLETTER_DRY_RUN === 'true';

export class EmailSendError extends Error {
  constructor(message, { statusCode = null, code = null } = {}) {
    super(message);
    this.name = 'EmailSendError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Send, and actually notice when it fails.
 *
 * The Resend SDK resolves with `{ data, error }` and does NOT throw on API
 * errors, so every `return resend.emails.send(...)` in this file used to report
 * a hard failure — bad key, invalid address, quota exhausted — as success. A
 * bulk send built on that would report "1,000 sent" having delivered nothing,
 * so failures have to surface as exceptions the caller can see.
 */
const deliver = async (payload, options) => {
  const { data, error } = await resend.emails.send(payload, options);

  if (error) {
    throw new EmailSendError(error.message || 'Email delivery failed.', {
      statusCode: error.statusCode ?? null,
      code: error.name ?? null,
    });
  }

  return data;
};

/* ── Welcome ─────────────────────────────────────────────────────── */
export const sendWelcomeEmail = async ({ name, email }) => {
  return deliver({
    from: FROM,
    to: email,
    subject: 'Welcome to ProspectMind 🎯',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="color: #1a1a2e; font-size: 28px;">Welcome to ProspectMind, ${name}!</h1>
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          You're now set up to start enriching and qualifying your prospects with AI-powered intelligence.
        </p>
        <h3 style="color: #1a1a2e;">Here's what you can do:</h3>
        <ul style="color: #555; font-size: 16px; line-height: 2;">
          <li>📤 Upload a CSV of prospects</li>
          <li>🔍 Auto-enrich profiles across LinkedIn, GitHub, X, and Telegram</li>
          <li>🏷️ Get AI classification and compatibility scores</li>
          <li>✉️ Generate personalized outreach messages</li>
        </ul>
        <a href="${process.env.CLIENT_URL}/dashboard"
           style="display: inline-block; margin-top: 24px; padding: 14px 28px; background: #6366f1; color: white; border-radius: 8px; text-decoration: none; font-weight: 600;">
          Go to Dashboard →
        </a>
        <p style="color: #999; font-size: 13px; margin-top: 40px;">
          ProspectMind · Precision prospect intelligence
        </p>
      </div>
    `,
  });
};

/* ── Email verification ───────────────────────────────────────────── */
export const sendVerificationEmail = async ({ name, email, verifyUrl }) => {
  return deliver({
    from: FROM,
    to: email,
    subject: 'Verify your ProspectMind email',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="margin-bottom: 24px;">
          <div style="display: inline-flex; align-items: center; gap: 8px;">
            <div style="width: 32px; height: 32px; background: #6366f1; border-radius: 8px; display: inline-block;"></div>
            <span style="font-size: 18px; font-weight: 700; color: #0f172a;">ProspectMind</span>
          </div>
        </div>
        <h1 style="color: #0f172a; font-size: 24px; margin-bottom: 12px;">Verify your email address</h1>
        <p style="color: #64748b; font-size: 15px; line-height: 1.6; margin-bottom: 28px;">
          Hi ${name}, click the button below to verify your email and activate your account. This link expires in 24 hours.
        </p>
        <a href="${verifyUrl}"
           style="display: inline-block; padding: 14px 28px; background: #6366f1; color: white; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">
          Verify email →
        </a>
        <p style="color: #94a3b8; font-size: 13px; margin-top: 32px;">
          If you didn't create a ProspectMind account, you can safely ignore this email.
        </p>
        <p style="color: #cbd5e1; font-size: 12px; margin-top: 8px; word-break: break-all;">
          Or copy this link: ${verifyUrl}
        </p>
      </div>
    `,
  });
};

/* ── Password reset ───────────────────────────────────────────────── */
export const sendPasswordResetEmail = async ({ name, email, resetUrl }) => {
  return deliver({
    from: FROM,
    to: email,
    subject: 'Reset your ProspectMind password',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="margin-bottom: 24px;">
          <div style="display: inline-flex; align-items: center; gap: 8px;">
            <div style="width: 32px; height: 32px; background: #6366f1; border-radius: 8px; display: inline-block;"></div>
            <span style="font-size: 18px; font-weight: 700; color: #0f172a;">ProspectMind</span>
          </div>
        </div>
        <h1 style="color: #0f172a; font-size: 24px; margin-bottom: 12px;">Reset your password</h1>
        <p style="color: #64748b; font-size: 15px; line-height: 1.6; margin-bottom: 28px;">
          Hi ${name}, we received a request to reset your password. Click below to choose a new one. This link expires in 1 hour.
        </p>
        <a href="${resetUrl}"
           style="display: inline-block; padding: 14px 28px; background: #6366f1; color: white; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">
          Reset password →
        </a>
        <p style="color: #94a3b8; font-size: 13px; margin-top: 32px;">
          If you didn't request this, you can safely ignore it. Your password won't change.
        </p>
        <p style="color: #cbd5e1; font-size: 12px; margin-top: 8px; word-break: break-all;">
          Or copy this link: ${resetUrl}
        </p>
      </div>
    `,
  });
};

/* ── LinkedIn session expired (ops alert) ──────────────────────────── */
export const sendLinkedInSessionExpiredEmail = async ({ name, email }) => {
  return deliver({
    from: FROM,
    to: email,
    subject: '⚠️ LinkedIn session needs a refresh — ProspectMind',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="margin-bottom: 24px;">
          <div style="display: inline-flex; align-items: center; gap: 8px;">
            <div style="width: 32px; height: 32px; background: #6366f1; border-radius: 8px; display: inline-block;"></div>
            <span style="font-size: 18px; font-weight: 700; color: #0f172a;">ProspectMind</span>
          </div>
        </div>
        <h1 style="color: #0f172a; font-size: 24px; margin-bottom: 12px;">LinkedIn session needs a refresh</h1>
        <p style="color: #64748b; font-size: 15px; line-height: 1.6; margin-bottom: 20px;">
          Hi ${name}, the LinkedIn scraping session died (a security checkpoint or expired cookie) and automatic
          recovery couldn't fix it. Prospect enrichment involving LinkedIn is paused until it's refreshed.
        </p>
        <p style="color: #64748b; font-size: 15px; line-height: 1.6; margin-bottom: 28px;">
          Fix it from Settings: log into linkedin.com in your own browser, copy the <code>li_at</code> cookie
          (DevTools → Application → Cookies), and paste it into the LinkedIn Session card.
        </p>
        <a href="${process.env.CLIENT_URL}/settings"
           style="display: inline-block; padding: 14px 28px; background: #6366f1; color: white; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">
          Open Settings →
        </a>
      </div>
    `,
  });
};

/* ── Outreach ─────────────────────────────────────────────────────── */
export const sendOutreachEmail = async ({ to, subject, body, fromName }) => {
  return deliver({
    from: `${fromName} <${FROM}>`,
    to,
    subject,
    html: `<div style="font-family: sans-serif; font-size: 15px; line-height: 1.7; color: #333;">${body.replace(/\n/g, '<br/>')}</div>`,
  });
};

/* ── Newsletters ──────────────────────────────────────────────────── */

/**
 * One newsletter, to one recipient.
 *
 * Differs from sendOutreachEmail in three ways that matter for bulk mail:
 * a real text/plain alternative, a reply-to that isn't a noreply address, and
 * the List-Unsubscribe headers Gmail and Yahoo require of bulk senders.
 *
 * `idempotencyKey` is the safety net under the send worker's own bookkeeping:
 * if the process dies between a successful send and the status write, the
 * resumed job's retry hits the same key and Resend returns the original result
 * instead of delivering a second copy.
 */
export const sendNewsletterEmail = async ({
  to,
  subject,
  html,
  text,
  fromName,
  replyTo,
  headers = {},
  idempotencyKey,
}) => {
  if (DRY_RUN) {
    console.log(`[newsletter:dry-run] → ${to} · "${subject}"`);
    return { id: `dryrun_${Date.now()}_${Math.random().toString(36).slice(2, 10)}` };
  }

  return deliver(
    {
      from: fromName ? `${fromName} <${NEWSLETTER_FROM}>` : NEWSLETTER_FROM,
      to,
      subject,
      html,
      text,
      ...(replyTo ? { replyTo } : {}),
      headers,
    },
    idempotencyKey ? { idempotencyKey } : undefined
  );
};
