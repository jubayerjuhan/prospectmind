/**
 * Planning half of the "push this campaign into lemlist" button.
 *
 * Pure and network-free on purpose: every decision that can be got wrong —
 * which leads are pushable, what the steps look like — is made here and can be
 * asserted in tests. `executePushPlan` (separate) only replays the plan over
 * HTTP.
 *
 * ── One campaign, not one per channel signature ───────────────────────────
 * An earlier version bucketed leads by their PER-PROSPECT resolved channel
 * (campaignExecutor's generateSequenceForProspect falls back to whatever
 * channel a prospect actually has, e.g. LinkedIn for someone with no email) and
 * created one lemlist campaign per distinct bucket. That fragmented a single
 * six-lead campaign into four lemlist campaigns — correct in isolation, but not
 * what a "push to lemlist" button should do: the user wants one campaign that
 * mirrors the one they built here.
 *
 * The fix is to stop trying to make the lemlist step type match each lead's
 * resolved channel, and instead build steps from the campaign's CONFIGURED
 * `sequence` — the same one channel-per-step the Sequence builder UI already
 * commits to for every lead. A lead who lacks the field a step needs (no email
 * for an email step, no LinkedIn URL for a linkedinSend step) simply never
 * receives that particular touch — lemlist requires the field to send, so the
 * step silently no-ops for that lead, the same way it would for any real
 * lemlist campaign built by hand with a mixed contact list. That is a property
 * of lemlist itself, not a gap in this planner.
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
 * Sequence steps, sorted and densely renumbered, with a valid channel
 * substituted for any legacy/unknown one. The single source both `stepsFor`
 * and `leadBodyFor` read from, so "which channel is step 2" can never disagree
 * between the step's own type and how its message variable gets formatted.
 */
const orderedChannelsFor = (sequence) =>
  [...sequence]
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .map((s) => (CHANNEL_TO_STEP[s.channel] ? s.channel : 'email'));

/**
 * Build the lemlist steps for the campaign's configured sequence.
 *
 * Message text is NOT baked in here. Each step is a generic template
 * ({{step1Subject}} / {{step1Message}}) and the personalised copy rides on each
 * lead as a custom variable — lemlist's documented behaviour for unknown keys,
 * and the only way one step can serve many leads whose generated copy varies.
 */
const stepsFor = (orderedChannels, sequence) =>
  orderedChannels.map((channel, i) => {
    const order = i + 1; // renumbered densely — a gap in stepOrder must not become a gap in lemlist's sequence
    const configured = [...sequence].sort((a, b) => a.stepOrder - b.stepOrder)[i];
    const step = {
      type: CHANNEL_TO_STEP[channel].type,
      index: order,
      delay: Number(configured?.delayDays ?? 0),
    };

    if (channel === 'email') {
      step.subject = `{{step${order}Subject}}`;
      step.message = `<p>{{step${order}Message}}</p>`;
    } else if (channel === 'linkedin') {
      step.message = `{{step${order}Message}}`;
    } else {
      // `manual` requires a title — it is what the user sees in their task list.
      step.title = `Send ${CHANNEL_LABEL[channel]} message (step ${order})`;
      step.message = `{{step${order}Message}}`;
    }
    return step;
  });

const STEP_MESSAGE_KEY = /^step(\d+)Message$/;

/**
 * The lead body for lemlist. Everything flat and non-empty goes across; unknown
 * keys land as custom variables usable as {{key}}. Empty values are dropped
 * rather than sent as "", so a missing variable fails loudly in lemlist's
 * preview instead of rendering an invisible blank.
 *
 * Each `stepNMessage` is formatted for the channel step N actually is in this
 * campaign — HTML for an email step, plain text otherwise — because the same
 * generated text is reused verbatim as a lemlist custom variable, and lemlist
 * does a literal string substitution with no markdown or newline handling of
 * its own.
 */
const leadBodyFor = (lead, orderedChannels) => {
  const body = {};
  for (const [key, value] of Object.entries(lead)) {
    if (INTERNAL_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;
    if (isBlank(value)) continue;

    const stepMatch = STEP_MESSAGE_KEY.exec(key);
    if (stepMatch) {
      const channel = orderedChannels[Number(stepMatch[1]) - 1];
      body[key] = channel === 'email' ? toEmailHtml(String(value)) : normalizePlainText(String(value));
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
 * @param {Array<String>} neededFields  The contact field each configured step
 *   would need to ever fire (e.g. ['email','linkedinUrl']) — a lead missing
 *   all of them can never receive a single step, so pushing them is pointless.
 *   A lead missing only SOME of them is still pushed: the steps it can't
 *   satisfy simply won't send for it, same as any real mixed-contact list.
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
  const orderedChannels = orderedChannelsFor(sequence);
  const neededFields = [...new Set(
    sequence
      .map((s) => CHANNEL_TO_STEP[s.channel]?.needs)
      .filter(Boolean)
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
    pushableLeads.push(leadBodyFor(lead, orderedChannels));
  }

  const campaigns = pushableLeads.length
    ? [{
        signature: 'all', // one campaign, always — kept for the executor/service's per-campaign bookkeeping
        name: String(list?.name || 'Campaign').trim().slice(0, 140),
        steps: stepsFor(orderedChannels, sequence),
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

export const __testables = { stepsFor, leadBodyFor, refusalFor, orderedChannelsFor, toEmailHtml, escapeHtml };
