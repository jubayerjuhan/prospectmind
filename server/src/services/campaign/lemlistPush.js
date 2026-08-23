/**
 * Planning half of the "push this campaign into lemlist" button.
 *
 * Pure and network-free on purpose: every decision that can be got wrong —
 * which leads are pushable, what the steps look like — is made here and can be
 * asserted in tests. `executePushPlan` (separate) only replays the plan over
 * HTTP.
 *
 * ── One campaign, every reachable channel at every touch ──────────────────
 * Each touch (stepOrder) can fan out into MULTIPLE lemlist steps — one per
 * distinct channel any lead actually resolved to at that position. A prospect
 * with no email but a LinkedIn URL gets the LinkedIn step at that touch; a
 * prospect with both gets BOTH (explicit product choice: maximize reach over
 * avoiding duplicate contact — see plan-overview.md). A step simply never
 * fires for a lead missing the field it needs — that is lemlist's own
 * behaviour with a mixed contact list, not something this planner enforces.
 *
 * The channel at each touch is NOT read from `list.sequence[i].channel`
 * (that only decides touch COUNT and delay). It is read from what
 * campaignExecutor actually resolved for each lead — the per-prospect
 * fallback in generateSequenceForProspect already picked email-if-available,
 * LinkedIn otherwise, per lead; this planner's job is only to build a lemlist
 * step for every distinct answer that shows up.
 *
 * ── Two encodings of the same generated text ───────────────────────────────
 * The same touch can be sent by both an email step (HTML) and a LinkedIn/manual
 * step (plain text) to a dual-reachable lead. lemlist substitutes a custom
 * variable as a literal string with no per-step re-encoding, so one flat
 * `stepNMessage` cannot serve both correctly — HTML entities and <br> tags
 * would appear as literal text in a LinkedIn DM, and a raw "\n\n" collapses to
 * nothing in an email (see the bug this fixed). Every message value is
 * therefore emitted TWICE: `stepNMessage` (HTML, for an email step) and
 * `stepNMessageText` (plain, for LinkedIn/manual) — same source text, two
 * encodings, so each step template reads whichever is correct for it.
 */

// lemlist step types we can target. x/telegram have no sendable equivalent, so
// they become `manual` — lemlist holds the generated text as a human task in
// the right sequence position instead of dropping it on the floor.
const CHANNEL_TO_STEP = {
  email: { type: 'email', needs: 'email' },
  linkedin: { type: 'linkedinSend', needs: 'linkedinUrl' },
  x: { type: 'manual', needs: 'xUrl' },
  telegram: { type: 'manual', needs: 'telegramHandle' },
};

const CHANNEL_LABEL = { email: 'Email', linkedin: 'LinkedIn', x: 'X', telegram: 'Telegram' };

// Deterministic ordering for the sub-steps at one touch, so a rebuild of the
// same data always produces the same lemlist sequence.
const CHANNEL_PRIORITY = ['email', 'linkedin', 'x', 'telegram'];

const DEFAULT_SEQUENCE = [{ stepOrder: 1, channel: 'email', delayDays: 0 }];

// Keys that are ours alone — bookkeeping we don't want cluttering a lemlist
// lead as a custom variable the user might accidentally merge into a message.
const INTERNAL_KEYS = new Set(['messages', 'status', 'skipReason', 'prospectId']);

const isBlank = (value) => String(value ?? '').trim() === '';

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const escapeHtml = (text) => text.replace(/[&<>]/g, (ch) => HTML_ESCAPES[ch]);

/**
 * Generated copy comes back as plain text with real "\n\n" paragraph breaks —
 * see SequenceCard in the frontend, which renders it with `whitespace-pre-line`
 * for exactly that reason. An HTML email cannot: a raw newline inside
 * `<p>{{step1Message}}</p>` is just whitespace to a renderer and collapses to
 * nothing, which is precisely what turned "Hi Jubayer,\n\nI was impressed…"
 * into "Hi Jubayer,I was impressed…" in a real lemlist preview — the paragraph
 * break vanished instead of becoming a line break.
 *
 * Escaped first so a stray "&" or "<" in generated copy can't be interpreted as
 * markup, then blank-line-separated runs become paragraphs and single newlines
 * within a paragraph become <br>. The outer step template already wraps the
 * substituted value in one <p>…</p> (see stepsFor), so a value containing
 * "</p><p>" here closes and reopens that tag correctly rather than nesting.
 */
const toEmailHtml = (text) =>
  escapeHtml(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n/g, '<br>'))
    .join('</p><p>');

/**
 * Non-email fields (linkedinSend, manual) are plain text in lemlist, not HTML —
 * a literal "&" should stay "&", not become "&amp;". Only normalize line
 * endings so a Windows-authored "\r\n" behaves like every other "\n".
 */
const normalizePlainText = (text) => text.replace(/\r\n/g, '\n');

/**
 * The channel(s) actually resolved by any lead at each touch, in campaign
 * order. `sequence` still supplies the touch COUNT and each touch's delay —
 * campaignExecutor always writes exactly one message per configured stepOrder
 * per lead — but the CHANNEL at each position comes from what leads really
 * have, not from `sequence[i].channel`.
 *
 * @returns {Array<{ stepOrder: Number, delayDays: Number, channels: Array<String> }>}
 */
const touchesFor = (sequence, leads) => {
  const bySignature = new Map(); // stepOrder -> Set<channel>
  for (const lead of leads) {
    for (const message of lead.messages || []) {
      if (!message?.channel) continue;
      if (!CHANNEL_TO_STEP[message.channel]) continue; // defensive: only the 4 known channels are ever produced
      if (!bySignature.has(message.stepOrder)) bySignature.set(message.stepOrder, new Set());
      bySignature.get(message.stepOrder).add(message.channel);
    }
  }

  return [...sequence]
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .map((configured) => ({
      stepOrder: configured.stepOrder,
      delayDays: Number(configured.delayDays ?? 0),
      channels: [...(bySignature.get(configured.stepOrder) || [])]
        .sort((a, b) => CHANNEL_PRIORITY.indexOf(a) - CHANNEL_PRIORITY.indexOf(b)),
    }))
    .filter((touch) => touch.channels.length > 0); // nobody resolved a channel here — no lemlist step to build
};

/**
 * Build the lemlist steps: one per (touch, channel) pair. Sub-steps at the
 * same touch share that touch's delay pattern — the FIRST sub-step carries the
 * configured delay, later ones at the same touch get delay 0 so they fire the
 * same day, as parallel attempts at one logical touch rather than a longer
 * sequence.
 *
 * Message text is NOT baked in here. Each step is a generic template
 * referencing `{{stepNSubject}}` / `{{stepNMessage}}` (email) or
 * `{{stepNMessageText}}` (LinkedIn/manual) — the personalised copy rides on
 * each lead as a custom variable, since one step serves every lead under it.
 */
const stepsFor = (touches) => {
  const steps = [];
  let index = 0;
  for (const touch of touches) {
    touch.channels.forEach((channel, subIndex) => {
      index += 1;
      const order = touch.stepOrder;
      const step = {
        type: CHANNEL_TO_STEP[channel].type,
        index,
        delay: subIndex === 0 ? touch.delayDays : 0,
      };

      if (channel === 'email') {
        step.subject = `{{step${order}Subject}}`;
        step.message = `<p>{{step${order}Message}}</p>`;
      } else if (channel === 'linkedin') {
        step.message = `{{step${order}MessageText}}`;
      } else {
        // `manual` requires a title — it is what the user sees in their task list.
        step.title = `Send ${CHANNEL_LABEL[channel]} message (step ${order})`;
        step.message = `{{step${order}MessageText}}`;
      }
      steps.push(step);
    });
  }
  return steps;
};

const STEP_MESSAGE_KEY = /^step(\d+)Message$/;

/**
 * The lead body for lemlist. Everything flat and non-empty goes across; unknown
 * keys land as custom variables usable as {{key}}. Empty values are dropped
 * rather than sent as "", so a missing variable fails loudly in lemlist's
 * preview instead of rendering an invisible blank.
 *
 * Every `stepNMessage` is emitted in BOTH encodings — see the file header for
 * why one flat variable cannot serve both an email step and a LinkedIn/manual
 * step sharing the same touch.
 */
const leadBodyFor = (lead) => {
  const body = {};
  for (const [key, value] of Object.entries(lead)) {
    if (INTERNAL_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;
    if (isBlank(value)) continue;

    if (STEP_MESSAGE_KEY.test(key)) {
      const text = String(value);
      body[key] = toEmailHtml(text);              // stepNMessage — for an email step
      body[`${key}Text`] = normalizePlainText(text); // stepNMessageText — for LinkedIn/manual
      continue;
    }

    body[key] = typeof value === 'string' ? value : String(value);
  }
  return body;
};

/**
 * Why a lead cannot be pushed. Returned rather than thrown: one unreachable
 * prospect must not sink the other 499.
 *
 * @param {Array<String>} neededFields  The contact field ANY step in the built
 *   sequence would need (e.g. ['email','linkedinUrl']) — a lead missing all of
 *   them can never receive a single step. A lead missing only some is still
 *   pushed: the steps it can't satisfy simply won't fire for it.
 */
const refusalFor = (lead, neededFields) => {
  if (lead.status === 'skipped') return lead.skipReason || 'Skipped during generation';
  if (!(lead.messages || []).length) return 'No generated messages';
  if (neededFields.length && neededFields.every((field) => isBlank(lead[field]))) {
    return `Not reachable on any configured channel (needs one of: ${neededFields.join(', ')})`;
  }
  return null;
};

/**
 * @param {Object} list   ProspectList — uses `name` and `sequence`.
 * @param {Array}  leads  Output of buildOutreachLeads().
 * @returns {{campaigns: Array, skipped: Array, totals: Object}}
 */
export const buildPushPlan = (list, leads = []) => {
  const sequence = list?.sequence?.length ? list.sequence : DEFAULT_SEQUENCE;
  const touches = touchesFor(sequence, leads);
  const neededFields = [...new Set(
    touches.flatMap((touch) => touch.channels.map((c) => CHANNEL_TO_STEP[c].needs))
  )];

  const skipped = [];
  const pushableLeads = [];

  for (const lead of leads) {
    const refusal = refusalFor(lead, neededFields);
    if (refusal) {
      skipped.push({
        prospectId: lead.prospectId || '',
        name: `${lead.firstName || ''} ${lead.lastName || ''}`.trim(),
        reason: refusal,
      });
      continue;
    }
    pushableLeads.push(leadBodyFor(lead));
  }

  // touches.length === 0 only when no lead resolved any channel anywhere, which
  // independently means every lead's `messages` was empty and refusalFor
  // already refused all of them above — so pushableLeads is empty here too.
  // No separate branch needed.
  const campaigns = pushableLeads.length
    ? [{
        signature: 'all', // one campaign, always — kept for the executor/service's per-campaign bookkeeping
        name: String(list?.name || 'Campaign').trim().slice(0, 140),
        steps: stepsFor(touches),
        leads: pushableLeads,
      }]
    : [];

  return {
    campaigns,
    skipped,
    totals: {
      leads: leads.length,
      pushable: pushableLeads.length,
      skipped: skipped.length,
      campaigns: campaigns.length,
    },
  };
};

export const __testables = {
  touchesFor, stepsFor, leadBodyFor, refusalFor, toEmailHtml, escapeHtml, normalizePlainText,
};
