import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM_EMAIL || 'noreply@prospectmind.ai';

/* ── Welcome ─────────────────────────────────────────────────────── */
export const sendWelcomeEmail = async ({ name, email }) => {
  return resend.emails.send({
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
  return resend.emails.send({
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
  return resend.emails.send({
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

/* ── Outreach ─────────────────────────────────────────────────────── */
export const sendOutreachEmail = async ({ to, subject, body, fromName }) => {
  return resend.emails.send({
    from: `${fromName} <${FROM}>`,
    to,
    subject,
    html: `<div style="font-family: sans-serif; font-size: 15px; line-height: 1.7; color: #333;">${body.replace(/\n/g, '<br/>')}</div>`,
  });
};
