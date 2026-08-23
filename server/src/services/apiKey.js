/**
 * Organization API keys, for external tools pulling data out of ProspectMind.
 *
 * Two rules shape this:
 *   1. Only the hash is stored. The plaintext is shown once and is gone after —
 *      a database dump must not be a set of live credentials to every
 *      customer's prospect data. SHA-256 is right here (unlike for passwords):
 *      the input is 32 bytes of CSPRNG output, so there is nothing to brute
 *      force, and a fast hash keeps per-request verification cheap.
 *   2. The prefix is deliberate. `pm_live_` makes a leaked key identifiable in
 *      a log or a repo — by us, by the user, and by secret scanners.
 */

import crypto from 'node:crypto';

const PREFIX = 'pm_live_';

export const hashApiKey = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');

/**
 * @returns {{ key: String, hash: String, last4: String }} `key` is the only
 *   time the plaintext exists — hand it to the user and do not persist it.
 */
export const generateApiKey = () => {
  const key = `${PREFIX}${crypto.randomBytes(32).toString('hex')}`;
  return { key, hash: hashApiKey(key), last4: key.slice(-4) };
};

export const looksLikeApiKey = (value = '') => String(value).startsWith(PREFIX);
