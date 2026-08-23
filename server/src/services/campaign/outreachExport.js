/**
 * One shape for a campaign's generated outreach, served two ways.
 *
 * The CSV download and the JSON endpoint lemlist calls must not drift — a
 * column that exists in one and not the other is the kind of difference nobody
 * notices until a sequence goes out with an empty variable. Both are built from
 * the leads this module produces; the CSV layer only decides headers and order.
 *
 * Field names are chosen for the consumer: lemlist maps flat, camelCase keys
 * straight onto lead fields and custom variables, so `step1Message` can be
 * dropped into a template as {{step1Message}} with no transformation.
 */

import Prospect from '../../models/Prospect.js';

// A Company that never resolved to a real name keeps its identity key as the
// name ("id:89222342"). That is an internal handle, not something to send to an
// outreach tool that might merge it into a message.
const isIdentityKeyName = (name = '') => /^id:\d+$/.test(String(name).trim());

// A user-provided value wins over an enriched one — the same precedence the
// pipeline applies, so an export never contradicts the profile page.
const pick = (...values) => values.find((value) => String(value ?? '').trim()) || '';

/**
 * @param {Object} list  A ProspectList (lean) with `outreach.results`.
 * @param {ObjectId|String} organizationId
 * @returns {Promise<{ leads: Array<Object>, maxSteps: Number }>}
 */
export const buildOutreachLeads = async (list, organizationId) => {
  const results = list.outreach?.results || [];
  if (!results.length) return { leads: [], maxSteps: 0 };

  // Contacts are not denormalized onto the result, so fetch them.
  const prospects = await Prospect.find({
    _id: { $in: results.map((result) => result.prospect).filter(Boolean) },
    organization: organizationId,
  })
    .select([
      'firstName lastName company companyRef compatibilityScore outreachPriority',
      'rawEmail rawLinkedin rawX rawTelegram rawGithub rawWebsite rawPhone',
      'enrichedProfile.email enrichedProfile.linkedinUrl enrichedProfile.githubUrl',
      'enrichedProfile.xUrl enrichedProfile.telegramHandle enrichedProfile.website',
      'enrichedProfile.currentRole enrichedProfile.location',
    ].join(' '))
    .populate('companyRef', 'name')
    .lean();

  const byId = new Map(prospects.map((prospect) => [String(prospect._id), prospect]));

  // The widest sequence in the run decides how many step fields exist; a
  // prospect whose sequence fell short simply leaves those empty.
  const maxSteps = results.reduce((max, result) => Math.max(max, (result.messages || []).length), 0);

  const leads = results.map((result) => {
    const prospect = byId.get(String(result.prospect)) || {};
    const enriched = prospect.enrichedProfile || {};
    const [fallbackFirst, ...fallbackRest] = String(result.prospectName || '').split(' ');
    const linkedName = isIdentityKeyName(prospect.companyRef?.name) ? '' : prospect.companyRef?.name;

    const lead = {
      prospectId: String(result.prospect || ''),
      firstName: prospect.firstName || fallbackFirst || '',
      lastName: prospect.lastName || fallbackRest.join(' '),
      companyName: pick(prospect.company, linkedName),
      jobTitle: enriched.currentRole || '',
      location: enriched.location || '',

      email: pick(prospect.rawEmail, enriched.email),
      linkedinUrl: pick(prospect.rawLinkedin, enriched.linkedinUrl),
      githubUrl: pick(prospect.rawGithub, enriched.githubUrl),
      xUrl: pick(prospect.rawX, enriched.xUrl),
      telegramHandle: pick(prospect.rawTelegram, enriched.telegramHandle),
      website: pick(prospect.rawWebsite, enriched.website),
      phone: prospect.rawPhone || '',

      score: prospect.compatibilityScore ?? null,
      priority: prospect.outreachPriority || '',
      persona: result.personaName || '',
      personaScore: result.personaScore ?? null,
      status: result.status || '',
      skipReason: result.skipReason || '',
      generatedAt: result.generatedAt ? new Date(result.generatedAt).toISOString() : '',

      // Nested too: flat keys are for lemlist's variables, this is for anything
      // that would rather iterate the sequence than guess at key names.
      messages: (result.messages || []).map((message) => ({
        stepOrder: message.stepOrder,
        channel: message.channel || '',
        delayDays: message.delayDays ?? 0,
        subject: message.subject || '',
        body: message.body || '',
      })),
    };

    for (let step = 1; step <= maxSteps; step += 1) {
      const message = (result.messages || []).find((m) => m.stepOrder === step);
      lead[`step${step}Channel`] = message?.channel || '';
      lead[`step${step}DelayDays`] = message?.delayDays ?? '';
      lead[`step${step}Subject`] = message?.subject || '';
      lead[`step${step}Message`] = message?.body || '';
    }

    return lead;
  });

  return { leads, maxSteps };
};

/** Column definitions for the CSV rendering of the same leads. */
export const outreachCsvColumns = (maxSteps) => {
  const columns = [
    { key: 'firstName', header: 'First Name' },
    { key: 'lastName', header: 'Last Name' },
    { key: 'companyName', header: 'Company' },
    { key: 'jobTitle', header: 'Role' },
    { key: 'email', header: 'Email' },
    { key: 'linkedinUrl', header: 'LinkedIn' },
    { key: 'githubUrl', header: 'GitHub' },
    { key: 'xUrl', header: 'X' },
    { key: 'telegramHandle', header: 'Telegram' },
    { key: 'website', header: 'Website' },
    { key: 'phone', header: 'Phone' },
    { key: 'location', header: 'Location' },
    { key: 'score', header: 'Score' },
    { key: 'priority', header: 'Priority' },
    { key: 'persona', header: 'Persona' },
    { key: 'personaScore', header: 'Persona Score' },
    { key: 'status', header: 'Status' },
    { key: 'skipReason', header: 'Skip Reason' },
    { key: 'generatedAt', header: 'Generated At' },
  ];
  for (let step = 1; step <= maxSteps; step += 1) {
    columns.push(
      { key: `step${step}Channel`, header: `Step ${step} Channel` },
      { key: `step${step}DelayDays`, header: `Step ${step} Delay (days)` },
      { key: `step${step}Subject`, header: `Step ${step} Subject` },
      { key: `step${step}Message`, header: `Step ${step} Message` },
    );
  }
  return columns;
};
