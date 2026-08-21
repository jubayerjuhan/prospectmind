/**
 * Unsubscribe tokens — stateless HMAC over the contact id.
 *
 * The alternative was a random token stored on each contact: that needs a
 * field, a unique index, generation on every CSV-imported row (which spoils the
 * single bulk insert), and a backfill for anything created before the column
 * existed. An HMAC needs none of it and is valid for any contact that exists,
 * whenever it was created.
 *
 * The trade is that the secret is effectively permanent. Rotating
 * NEWSLETTER_UNSUBSCRIBE_SECRET invalidates the unsubscribe link in every email
 * already sitting in every recipient's inbox — which is a compliance incident,
 * not an inconvenience. Set it once and leave it alone.
 *
 * It deliberately does NOT reuse JWT_SECRET for that reason: rotating the JWT
 * signing key is a routine security action, and it must not quietly break
 * unsubscribe links that have already been mailed out.
 *
 * A leaked token is a benign failure: it lets the holder suppress one address
 * they already know, and an admin can undo it. That is why there is no expiry —
 * an expired unsubscribe link is far worse than a shared one.
 */

import crypto from 'crypto';

// Falls back to JWT_SECRET so local dev works with no extra setup. Production
// must set its own — see .env.example.
const secret = () =>
  process.env.NEWSLETTER_UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || 'prospectmind-dev-unsubscribe-secret';

/** The server's own public origin. CLIENT_URL is the SPA and is the wrong host for an API route. */
export const publicApiUrl = () =>
  (process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, '');

export const sign = (contactId) =>
  crypto.createHmac('sha256', secret()).update(String(contactId)).digest('base64url');

export const verify = (contactId, signature) => {
  if (!contactId || !signature) return false;

  const expected = Buffer.from(sign(contactId));
  const provided = Buffer.from(String(signature));

  // timingSafeEqual throws on a length mismatch, so that has to be checked
  // first — and checking it is not a leak, since the length is fixed anyway.
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
};

export const unsubscribeUrl = (contactId) =>
  `${publicApiUrl()}/api/newsletters/unsubscribe/${contactId}/${sign(contactId)}`;

export const __testing = { secret };
