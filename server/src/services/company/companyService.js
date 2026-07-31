import Company from '../../models/Company.js';
import { normalizeDomainKey, linkedinCompanyKey, linkedinCompanyUrl } from '../../utils/domains.js';

/**
 * Normalize a company name into a dedupe key.
 * Lowercases, strips common suffixes/punctuation, collapses whitespace.
 * "GoodHive, Inc." and "goodhive inc" → "goodhive".
 *
 * NOTE this is a display-name key, not an identity. Unrelated companies share
 * names; see Company.js for how identity is actually established.
 */
export const normalizeCompanyName = (name = '') => {
  return String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[.,]/g, ' ')
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|sa|sas|plc|company)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
};

/**
 * Upserts against unique indexes can legitimately return E11000 when two
 * workers insert concurrently. Re-read instead of failing the pipeline.
 */
const withDupRetry = async (attempt, refind, tries = 3) => {
  for (let i = 0; i < tries; i++) {
    try {
      return await attempt();
    } catch (err) {
      if (err?.code !== 11000 || i === tries - 1) throw err;
      const found = await refind();
      if (found) return found;
    }
  }
  return null;
};

/**
 * Expand loose company facts into the fields AND the derived identity keys.
 * findOneAndUpdate bypasses document middleware, so the pre('validate') hook on
 * the model cannot help there — this keeps key derivation in one place anyway.
 */
export const identityPatch = ({ website, domain, linkedinUrl, linkedinKey, ...rest } = {}) => {
  const patch = { ...rest };
  if (website) patch.website = website;
  if (domain) patch.domain = domain;

  const derivedDomain = normalizeDomainKey(domain || website || '');
  if (derivedDomain) patch.domainKey = derivedDomain;

  const derivedLinkedin = linkedinKey || linkedinCompanyKey(linkedinUrl || '');
  if (derivedLinkedin) {
    patch.linkedinKey = derivedLinkedin;
    patch.linkedinUrl = linkedinUrl || linkedinCompanyUrl(derivedLinkedin);
  }
  return patch;
};

/**
 * Find or create the name-only placeholder for a company we cannot yet
 * identify. Placeholders are flagged for review precisely because the name is
 * all we have — several real companies may share it.
 */
export const findOrCreatePlaceholder = async ({ organization, name, createdBy } = {}) => {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;

  const nameKey = normalizeCompanyName(trimmed);
  if (!nameKey) return null;

  // organization/nameKey/linkedinKey/domainKey come from the filter — repeating
  // them in $setOnInsert would be an update conflict.
  const filter = { organization, nameKey, linkedinKey: '', domainKey: '' };
  return withDupRetry(
    () =>
      Company.findOneAndUpdate(
        filter,
        {
          $setOnInsert: {
            name: trimmed,
            needsReview: true,
            reviewReason: 'no-verified-identity',
            ...(createdBy ? { createdBy } : {}),
          },
        },
        { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
      ),
    () => Company.findOne(filter)
  );
};

/**
 * Find or create the company holding a verified identity key.
 *
 * Three outcomes matter:
 *  - `matched`             — the company is already on record.
 *  - `promoted-placeholder`— a name-only record existed and this key resolves
 *                            it. Its stale, guess-derived research is cleared.
 *  - `created`             — new record. When a same-named company already
 *                            exists under a DIFFERENT key this is the split
 *                            that the old name-unique index made impossible.
 *
 * @param {'linkedinKey'|'domainKey'} keyField
 */
export const findOrCreateByKey = async ({ organization, name, keyField, key, facts = {}, createdBy } = {}) => {
  if (!organization || !keyField || !key) return null;

  const trimmed = String(name || '').trim();
  const nameKey = trimmed ? normalizeCompanyName(trimmed) : '';
  const patch = identityPatch({ ...facts, [keyField]: key });

  const existing = await Company.findOne({ organization, [keyField]: key });
  if (existing) return { company: existing, action: 'matched' };

  // Promote an unresolved placeholder rather than orphaning it — this keeps the
  // company's _id, so existing prospect links and /companies/:id URLs survive.
  if (nameKey) {
    const placeholder = await Company.findOne({ organization, nameKey, linkedinKey: '', domainKey: '' });
    if (placeholder) {
      try {
        const promoted = await Company.findOneAndUpdate(
          { _id: placeholder._id, linkedinKey: '', domainKey: '' }, // compare-and-swap
          {
            $set: {
              ...patch,
              needsReview: false,
              reviewReason: '',
              // Whatever was researched under the bare name described an
              // unverified entity. Invalidate it rather than showing it as fact.
              'aiAnalysis.analyzedForKey': null,
              'aiAnalysis.summary': '',
              industry: '',
              size: '',
              signals: [],
            },
            $push: { sourceRefs: { source: 'resolver', note: `resolved ${keyField}=${key}` } },
          },
          { returnDocument: 'after' }
        );
        if (promoted) return { company: promoted, action: 'promoted-placeholder' };
      } catch (err) {
        if (err?.code !== 11000) throw err;
        // Another company already holds this key: the two records were the same
        // company reached by different evidence. Converge instead of failing.
        const incumbent = await Company.findOne({ organization, [keyField]: key });
        if (incumbent) return { company: incumbent, action: 'matched' };
        throw err;
      }
      // Lost the CAS to a concurrent promoter — take their result.
      const winner = await Company.findOne({ organization, [keyField]: key });
      if (winner) return { company: winner, action: 'matched' };
    }
  }

  try {
    const created = await Company.create({
      organization,
      name: trimmed || key,
      nameKey: nameKey || key,
      ...patch,
      ...(createdBy ? { createdBy } : {}),
    });
    return { company: created, action: 'created' };
  } catch (err) {
    if (err?.code === 11000) {
      const raced = await Company.findOne({ organization, [keyField]: key });
      if (raced) return { company: raced, action: 'matched' };
    }
    throw err;
  }
};

/**
 * Back-compatible façade. Prefers a verified key when the caller can supply
 * one, otherwise falls back to the name-only placeholder.
 *
 * @returns {Promise<import('mongoose').Document|null>}
 */
export const findOrCreateCompany = async ({ organization, name, domain, website, linkedinUrl, createdBy } = {}) => {
  const linkedinKey = linkedinCompanyKey(linkedinUrl || '');
  if (linkedinKey) {
    const res = await findOrCreateByKey({
      organization, name, keyField: 'linkedinKey', key: linkedinKey,
      facts: { linkedinUrl, domain, website }, createdBy,
    });
    if (res?.company) return res.company;
  }

  const domainKey = normalizeDomainKey(domain || website || '');
  if (domainKey) {
    const res = await findOrCreateByKey({
      organization, name, keyField: 'domainKey', key: domainKey,
      facts: { domain: domain || domainKey, website }, createdBy,
    });
    if (res?.company) return res.company;
  }

  return findOrCreatePlaceholder({ organization, name, createdBy });
};
