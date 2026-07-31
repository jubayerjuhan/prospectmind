/**
 * Decide WHICH company a prospect actually works for.
 *
 * The name alone cannot answer this: several unrelated companies share one, and
 * picking the wrong record poisons the prospect's research and every outreach
 * message generated from it. So identity is derived from evidence attached to
 * this specific person, in descending order of trust, and when no evidence
 * exists the resolver refuses to guess rather than coin-flipping.
 */

import Company from '../../models/Company.js';
import Prospect from '../../models/Prospect.js';
import {
  normalizeDomainKey, domainFromEmail, linkedinCompanyKey, linkedinCompanyUrl,
  isPersonalNameDomain,
} from '../../utils/domains.js';
import {
  normalizeCompanyName, findOrCreateByKey, findOrCreatePlaceholder,
} from './companyService.js';

const compact = (s = '') => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

const linkedinSlugOf = (url = '') => (String(url).match(/\/in\/([^/?]+)/i)?.[1] || '').toLowerCase();

/**
 * The name to display for a prospect's employer.
 *
 * `prospect.company` is free text an importer or a human supplied, and it is
 * routinely blank — a LinkedIn-sourced prospect often has none. The current
 * role in the enriched experience is the next best label, and unlike the
 * headline it is the company alone rather than a marketing sentence.
 */
export const companyDisplayName = (prospect = {}) =>
  String(prospect.company || '').trim() ||
  String(prospect.enrichedProfile?.experience?.[0]?.company || '').trim();

/**
 * A personal site is as often a portfolio as an employer's domain, so it only
 * counts when the domain visibly agrees with the company name. Without this
 * check the weakest evidence source would reintroduce the very ambiguity the
 * resolver exists to remove.
 */
const websiteAgreesWithName = (domainKey, companyName) => {
  const sld = compact(String(domainKey).split('.')[0]);
  const name = compact(companyName);
  if (!sld || !name || name.length < 3) return false;
  return sld.includes(name) || name.includes(sld);
};

/**
 * Derive an identity key from the prospect alone. Pure: no DB, no network — so
 * it is usable before enrichment (to anchor search queries) and by the
 * migration's dry-run planner.
 *
 * Deliberately does NOT consult enrichedProfile.bio: the bio is AI-written from
 * search results that were themselves filtered using the company name, so using
 * it to pick the company is circular and will confirm a wrong match.
 *
 * @returns {{keyField: 'linkedinKey'|'domainKey'|null, key: string, facts: Object, source: string, confidence: string}}
 */
export const deriveCompanyIdentity = (prospect = {}) => {
  const ep = prospect.enrichedProfile || {};
  const none = { keyField: null, key: '', facts: {}, source: 'name-only', confidence: 'low' };

  const person = {
    firstName: prospect.firstName,
    lastName: prospect.lastName,
    linkedinSlug: linkedinSlugOf(prospect.rawLinkedin || ep.linkedinUrl || ''),
  };

  // 1. The employer's own LinkedIn page, off the profile's experience section.
  //    An exact entity id — the only evidence that cleanly separates namesakes.
  const liUrl = ep.companyLinkedinUrl || prospect.rawCompanyLinkedin || '';
  const liKey = linkedinCompanyKey(liUrl);
  if (liKey) {
    return {
      keyField: 'linkedinKey',
      key: liKey,
      facts: { linkedinUrl: liUrl.startsWith('http') ? liUrl : linkedinCompanyUrl(liKey) },
      source: 'linkedin-company',
      confidence: 'high',
    };
  }

  // 2. An operator-supplied employer domain.
  const hinted = normalizeDomainKey(prospect.rawCompanyDomain || '');
  if (hinted && !isPersonalNameDomain(hinted, person)) {
    return { keyField: 'domainKey', key: hinted, facts: { domain: hinted }, source: 'domain-hint', confidence: 'high' };
  }

  // 3. A work-email domain. rawEmail was typed for THIS person; the enriched
  //    email comes from the confirmed profile's contact panel. Both beat any
  //    generic web finding. normalizeDomainKey drops free and platform hosts.
  for (const email of [prospect.rawEmail, ep.email]) {
    const domain = normalizeDomainKey(domainFromEmail(email || ''));
    if (domain && !isPersonalNameDomain(domain, person)) {
      return { keyField: 'domainKey', key: domain, facts: { domain }, source: 'work-email', confidence: 'high' };
    }
  }

  // 4. The website on the contact panel — only when it agrees with the name.
  const site = normalizeDomainKey(ep.website || '');
  if (site && !isPersonalNameDomain(site, person) && websiteAgreesWithName(site, companyDisplayName(prospect))) {
    return { keyField: 'domainKey', key: site, facts: { domain: site }, source: 'contact-website', confidence: 'medium' };
  }

  return none;
};

/**
 * Resolve (and optionally create) the Company for a prospect.
 *
 * @param {Object}  opts.prospect      plain object or document; may carry an
 *                                     in-memory enrichedProfile not yet saved
 * @param {Boolean} opts.dryRun        plan only — never writes. Used by the
 *                                     migration to report before it acts.
 * @returns {Promise<{company, action, evidence, needsReview, reviewReason}>}
 */
export const resolveCompanyForProspect = async ({ prospect, organization, dryRun = false } = {}) => {
  const org = organization || prospect?.organization;
  const nil = { company: null, action: 'no-company', evidence: { source: 'none', value: '', confidence: 'none' }, needsReview: false, reviewReason: '' };
  if (!org) return nil;

  // A human already said which company this is. Never second-guess it.
  if (prospect.companyLinkSource === 'manual' && prospect.companyRef) {
    const manual = await Company.findById(prospect.companyRef);
    if (manual) {
      return { company: manual, action: 'manual', evidence: { source: 'manual', value: String(manual._id), confidence: 'high' }, needsReview: false, reviewReason: '' };
    }
  }

  const identity = deriveCompanyIdentity(prospect);
  const name = companyDisplayName(prospect);

  // The free-text name is a LABEL now, not the identity — a LinkedIn company
  // page identifies the employer on its own. Requiring a name here stranded
  // every prospect whose company field was blank even when their profile told
  // us exactly where they work.
  if (!identity.keyField && !name) return nil;

  const nameKey = name ? normalizeCompanyName(name) : '';

  // ── A verified key: match, promote a placeholder, or split off a new record.
  if (identity.keyField && identity.key) {
    if (dryRun) {
      const existing = await Company.findOne({ organization: org, [identity.keyField]: identity.key }).lean();
      return {
        company: existing || null,
        action: existing ? 'matched' : 'created',
        evidence: { source: identity.source, value: identity.key, confidence: identity.confidence },
        needsReview: false,
        reviewReason: '',
      };
    }

    const res = await findOrCreateByKey({
      organization: org, name, keyField: identity.keyField, key: identity.key,
      facts: identity.facts, createdBy: prospect.createdBy,
    });
    if (res?.company) {
      return {
        company: res.company,
        action: res.action,
        evidence: { source: identity.source, value: identity.key, confidence: identity.confidence },
        needsReview: false,
        reviewReason: '',
      };
    }
  }

  // ── No key. Fall back on the name, but only where it is unambiguous.
  const resolvedSameName = nameKey
    ? await Company.find({
        organization: org,
        nameKey,
        $or: [{ linkedinKey: { $gt: '' } }, { domainKey: { $gt: '' } }],
      }).lean()
    : [];

  // Exactly one identified company with this name — overwhelmingly the right
  // one, but the LINK is weak, so mark it for review rather than trusting it.
  if (resolvedSameName.length === 1) {
    const only = dryRun ? resolvedSameName[0] : await Company.findById(resolvedSameName[0]._id);
    return {
      company: only,
      action: 'name-only-unique-match',
      evidence: { source: 'name-only', value: nameKey, confidence: 'low' },
      needsReview: true,
      reviewReason: 'name-only-link',
    };
  }

  // Two or more real companies share this name and nothing tells us which.
  // This is the reported bug. Refuse to pick — a placeholder the UI flags is
  // far better than confidently attaching the wrong company's research.
  const ambiguous = resolvedSameName.length >= 2;
  const placeholder = dryRun
    ? await Company.findOne({ organization: org, nameKey, linkedinKey: '', domainKey: '' }).lean()
    : await findOrCreatePlaceholder({ organization: org, name, createdBy: prospect.createdBy });

  return {
    company: placeholder,
    action: ambiguous ? 'ambiguous' : 'placeholder',
    evidence: { source: 'name-only', value: nameKey, confidence: ambiguous ? 'none' : 'low' },
    needsReview: true,
    reviewReason: ambiguous ? 'ambiguous-name' : 'no-verified-identity',
  };
};

/**
 * Resolve and persist a prospect's company link. Network-free and AI-free, so
 * it is safe on every creation path — including the ones that never queue the
 * pipeline and would otherwise leave the prospect with no company at all.
 *
 * @returns {Promise<Object|null>} the linked company
 */
export const ensureCompanyLink = async (prospectOrId) => {
  const prospect = typeof prospectOrId === 'object' && prospectOrId?._id
    ? prospectOrId
    : await Prospect.findById(prospectOrId);
  if (!prospect) return null;
  if (prospect.companyLinkSource === 'manual') return null;
  // No early name check: the resolver decides, and a LinkedIn company page is
  // enough to identify an employer with no name on record.

  try {
    const res = await resolveCompanyForProspect({ prospect, organization: prospect.organization });
    if (!res.company) return null;

    const changed = String(prospect.companyRef || '') !== String(res.company._id);
    await Prospect.findByIdAndUpdate(prospect._id, {
      companyRef: res.company._id,
      companyLinkSource: res.evidence.source,
      companyLinkConfidence: res.evidence.confidence,
      companyLinkedAt: new Date(),
      // Prose written against the previous company describes the wrong entity.
      ...(changed && prospect.companyRef ? { needsReenrichment: true, reenrichmentReason: 'company-identity-corrected', outreachStale: true } : {}),
    });
    return res.company;
  } catch (err) {
    console.warn(`[companyResolver] Link skipped for ${prospect._id}: ${err.message}`);
    return null;
  }
};
