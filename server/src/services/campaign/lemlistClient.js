/**
 * Thin lemlist HTTP client: auth, throttling, retries, and the one guardrail
 * that matters.
 *
 * Kept separate from lemlistPush so the planner stays pure and this file stays
 * the only place that knows lemlist is reachable over a network.
 *
 * ── Rate limit ─────────────────────────────────────────────────────────────
 * lemlist allows 20 requests per 2 seconds per API key. A push is one request
 * per lead, so a 500-lead list is ~500 requests and cannot run inside an HTTP
 * handler. We self-pace to one request per MIN_INTERVAL_MS and still honour a
 * 429's Retry-After, because the limit is per key and another process on the
 * same org's key can spend the budget underneath us.
 */

const BASE = 'https://api.lemlist.com/api';
const MIN_INTERVAL_MS = 120;   // ~8 req/s against a documented ceiling of 10
const MAX_ATTEMPTS = 4;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class LemlistError extends Error {
  constructor(message, { status, path, method, body } = {}) {
    super(message);
    this.name = 'LemlistError';
    this.status = status;
    this.path = path;
    this.method = method;
    this.body = body;
  }
}

/**
 * @param {String} apiKey     The org's lemlist key (Organization.integrations.lemlist.apiKey)
 * @param {Object} deps       Injectable for tests: fetchImpl, sleep, now
 */
export const createLemlistClient = (
  apiKey,
  { fetchImpl = globalThis.fetch, sleep = defaultSleep, now = Date.now } = {},
) => {
  if (!apiKey) throw new LemlistError('No lemlist API key configured for this organization');

  // lemlist uses HTTP Basic with an empty username and the key as the password.
  const authorization = 'Basic ' + Buffer.from(`:${apiKey}`).toString('base64');
  let nextSlotAt = 0;

  // `now` is injectable because a fake sleep that does not advance a real
  // clock makes the next wait longer than the last, which reads as a pacing bug
  // that only exists in the test.
  const pace = async () => {
    const wait = nextSlotAt - now();
    if (wait > 0) await sleep(wait);
    nextSlotAt = Math.max(now(), nextSlotAt) + MIN_INTERVAL_MS;
  };

  const request = async (method, path, body) => {
    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await pace();

      let response;
      try {
        response = await fetchImpl(BASE + path, {
          method,
          headers: { Authorization: authorization, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (cause) {
        // A dropped connection mid-push is worth one more try; a persistent
        // outage should surface rather than spin.
        lastError = new LemlistError(`Network error calling ${method} ${path}: ${cause.message}`, { method, path });
        if (attempt === MAX_ATTEMPTS) throw lastError;
        await sleep(300 * attempt);
        continue;
      }

      const text = await response.text();
      let parsed;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }

      if (response.ok) return parsed;

      // 429 tells us exactly how long to wait; trust it over our own guess.
      if (response.status === 429) {
        const retryAfter = Number(response.headers?.get?.('Retry-After')) || 2;
        lastError = new LemlistError(`Rate limited on ${method} ${path}`, {
          status: 429, method, path, body: parsed,
        });
        if (attempt === MAX_ATTEMPTS) throw lastError;
        await sleep(retryAfter * 1000);
        continue;
      }

      if (response.status >= 500) {
        lastError = new LemlistError(`lemlist ${response.status} on ${method} ${path}`, {
          status: response.status, method, path, body: parsed,
        });
        if (attempt === MAX_ATTEMPTS) throw lastError;
        await sleep(500 * attempt);
        continue;
      }

      // 4xx other than 429 is our mistake — retrying repeats it.
      throw new LemlistError(
        `lemlist ${response.status} on ${method} ${path}: ${JSON.stringify(parsed).slice(0, 300)}`,
        { status: response.status, method, path, body: parsed },
      );
    }
    throw lastError;
  };

  return {
    createCampaign: (payload) => request('POST', '/campaigns', payload),
    addStep: (sequenceId, step) => request('POST', `/sequences/${sequenceId}/steps`, step),
    addLead: (campaignId, lead) => request('POST', `/campaigns/${campaignId}/leads/`, lead),
    getCampaign: (campaignId) => request('GET', `/campaigns/${campaignId}`),
    getSequences: (campaignId) => request('GET', `/campaigns/${campaignId}/sequences`),

    // Cheapest authenticated call lemlist offers — used only to prove a key is
    // live before we store it, so `lastVerifiedAt` reflects a real call rather
    // than an assumption.
    getTeam: () => request('GET', '/team'),

    /**
     * Remove a lead from a campaign.
     *
     * `action=remove` is not optional and is deliberately not a parameter:
     * lemlist's DELETE falls back to UNSUBSCRIBING the lead when it is absent,
     * which returns 200, leaves the lead in place, and writes the address to
     * the team-wide suppression list. Across a list of real prospects that is
     * an unrecoverable deliverability loss, so the unsafe call is simply not
     * expressible through this client.
     */
    removeLead: (campaignId, leadId) =>
      request('DELETE', `/campaigns/${campaignId}/leads/${encodeURIComponent(leadId)}?action=remove`),
  };
};

export const __testables = { MIN_INTERVAL_MS, MAX_ATTEMPTS };
