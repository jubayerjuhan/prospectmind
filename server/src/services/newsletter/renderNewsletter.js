/**
 * Newsletter rendering — sanitize, merge, wrap, and derive plain text.
 *
 * Order matters and is not negotiable: SANITIZE the author's template first,
 * THEN substitute merge values, escaping each one. Doing it the other way round
 * means a contact named "<b>" silently bolds the rest of the email, and worse,
 * it hands the sanitizer attacker-influenced structure to parse instead of just
 * the structure the author wrote.
 */

import sanitizeHtml from 'sanitize-html';
import { unsubscribeUrl } from './unsubscribeToken.js';

/* ── Sanitization ─────────────────────────────────────────────────────────── */

// Deliberately narrow. Everything on this list renders predictably inside the
// table-based shell below; anything that doesn't (script, iframe, form, style,
// and every on* handler) is discarded rather than escaped, so a stripped tag
// leaves no visible debris in the email.
const SANITIZE_OPTIONS = {
  allowedTags: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a',
    'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'blockquote', 'hr', 'img', 'span',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
    span: ['style'],
  },
  // No 'data:' — a pasted base64 image would blow past app.js's 5mb JSON cap and
  // is a deliverability liability anyway. Users link hosted images instead.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedStyles: {
    span: {
      color: [/^#[0-9a-fA-F]{3,6}$/, /^rgb\(/],
      'font-weight': [/^bold$/, /^\d{3}$/],
      'font-style': [/^italic$/],
      'text-decoration': [/^underline$/, /^line-through$/],
    },
  },
  transformTags: {
    a: (tagName, attribs) => ({
      tagName: 'a',
      attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' },
    }),
  },
  disallowedTagsMode: 'discard',
};

export const sanitizeBody = (html = '') => sanitizeHtml(String(html || ''), SANITIZE_OPTIONS);

/* ── Merge tags ───────────────────────────────────────────────────────────── */

export const MERGE_TAGS = ['firstName', 'lastName', 'fullName', 'email', 'company'];

// {{firstName}} or {{firstName|there}}
const TAG_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g;

// "Hi ," is the classic amateur-newsletter tell, and it costs one lookup table
// to avoid. An explicit {{tag|fallback}} always wins over these.
const DEFAULT_FALLBACKS = {
  firstName: 'there',
  fullName: 'there',
  lastName: '',
  email: '',
  company: '',
};

export const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const valuesFor = (contact = {}) => {
  const first = (contact.firstName || '').trim();
  const last = (contact.lastName || '').trim();
  return {
    firstName: first,
    lastName: last,
    fullName: [first, last].filter(Boolean).join(' '),
    email: (contact.email || '').trim(),
    company: (contact.company || '').trim(),
    ...(contact.customFields || {}),
  };
};

/**
 * Substitute {{tags}}. `escape` must be true for anything landing in HTML —
 * that, not the sanitizer, is what makes a hostile CSV harmless, because the
 * sanitizer has already run by this point and will never see these values.
 */
export const renderMergeTags = (template = '', contact = {}, { escape = true } = {}) => {
  const values = valuesFor(contact);

  return String(template || '').replace(TAG_RE, (_match, key, inlineFallback) => {
    const raw = values[key];
    const resolved =
      raw !== undefined && raw !== null && String(raw).trim() !== ''
        ? String(raw)
        : inlineFallback !== undefined
          ? inlineFallback
          : (DEFAULT_FALLBACKS[key] ?? '');

    return escape ? escapeHtml(resolved) : resolved;
  });
};

/**
 * A merge tag inside an href/src is rejected at save time rather than escaped.
 * HTML-escaping is simply the wrong encoding for a URL context, and doing it
 * properly (percent-encoding, scheme validation, keeping `javascript:` out of a
 * merge value) is a second problem we are not solving in this version.
 */
export const findMergeTagInUrl = (html = '') => {
  const attr = /(href|src)\s*=\s*["']([^"']*)["']/gi;
  let match;
  while ((match = attr.exec(String(html || '')))) {
    if (match[2].includes('{{')) return match[1];
  }
  return null;
};

/* ── Plain-text alternative ───────────────────────────────────────────────── */

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ',
};

/**
 * A real text/plain part is the cheapest deliverability win available:
 * SpamAssassin scores MIME_HTML_ONLY against you, and some corporate gateways
 * strip the HTML part entirely.
 */
export const buildTextFromHtml = (html = '') =>
  String(html || '')
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    // Keep the destination: a link whose text is "click here" is useless in text.
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => {
      const label = text.replace(/<[^>]+>/g, '').trim();
      return label && label !== href ? `${label} (${href})` : href;
    })
    .replace(/<\s*li[^>]*>/gi, '\n- ')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|h1|h2|h3|ul|ol|li|blockquote|div)\s*>/gi, '\n\n')
    .replace(/<\s*hr[^>]*>/gi, '\n---\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();

/* ── Outer template ───────────────────────────────────────────────────────── */

// Table-based and inline-styled on purpose: Outlook renders with the Word engine
// and ignores max-width on a div along with the whole of flexbox. Palette matches
// the transactional templates in services/resend/emailService.js.
const wrapEmailHtml = ({ bodyHtml, unsubUrl, orgName }) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.7;color:#0f172a;">
${bodyHtml}
        </td></tr>
        <tr><td style="padding:20px 32px 28px;border-top:1px solid #e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;line-height:1.6;color:#64748b;">
          You are receiving this because you subscribed to updates from ${escapeHtml(orgName)}.<br/>
          <a href="${unsubUrl}" style="color:#6366f1;">Unsubscribe</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

/* ── Entry point ──────────────────────────────────────────────────────────── */

/**
 * Render one campaign for one contact.
 *
 * Sanitizes again here even though the controller already sanitized on write —
 * it costs microseconds and covers rows written before this existed, or by a
 * script that bypassed the controller.
 */
export const renderForContact = (campaign, contact, { orgName = 'us' } = {}) => {
  const unsubUrl = unsubscribeUrl(contact._id);
  const safeBody = sanitizeBody(campaign.bodyHtml || '');

  const mergedBody = renderMergeTags(safeBody, contact, { escape: true });
  const html = wrapEmailHtml({ bodyHtml: mergedBody, unsubUrl, orgName });

  const baseText = campaign.bodyText?.trim() || buildTextFromHtml(safeBody);
  const text = `${renderMergeTags(baseText, contact, { escape: false })}\n\n—\nUnsubscribe: ${unsubUrl}`;

  // A CR or LF in a subject line is SMTP header injection, and a CSV `company`
  // field with an embedded newline is enough to cause it. Strip, don't escape.
  const subject = renderMergeTags(campaign.subject || '', contact, { escape: false })
    .replace(/[\r\n]+/g, ' ')
    .trim();

  return { subject, html, text, unsubUrl };
};

export const __testing = { SANITIZE_OPTIONS, DEFAULT_FALLBACKS, wrapEmailHtml };
