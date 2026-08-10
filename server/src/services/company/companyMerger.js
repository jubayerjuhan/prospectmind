/**
 * Company de-duplication and merging.
 *
 * Company identity is keyed on linkedinKey then domainKey, and the partial
 * unique indexes deliberately let two same-named companies coexist once each
 * holds a real key (see Company.js). That is correct for "Kiln the staking
 * company" vs "Kiln the design studio" — and wrong for certik.com vs
 * certik.org, which are one company that happens to own its brand under two
 * TLDs. This module draws the line between those two cases.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * Two records are the same company when their normalized names match AND one
 * of the following corroborates it:
 *   - their domains are the same brand under different public suffixes, or
 *   - one of them is a keyless placeholder, whose name was only ever a guess.
 *
 * Two DIFFERENT LinkedIn company pages veto the merge outright, whatever else
 * agrees. A LinkedIn slug is the one key nobody shares by accident.
 *
 * A name match on its own is never enough — that is precisely the collapse the
 * keyed identity model was built to prevent.
 *
 * ── Why merging rather than blocking ────────────────────────────────────────
 * By the time a duplicate is detected, both records may already carry research,
 * signals, contacts and linked prospects. Refusing the second write would leave
 * whichever arrived first, discarding real work. Merging keeps the union.
 */

import mongoose from 'mongoose';
import Company from '../../models/Company.js';
import Prospect from '../../models/Prospect.js';
import { isSameBrandDomain } from '../../utils/domains.js';

/** Scalar facts folded from the duplicate wherever the survivor has a gap. */
const MERGE_SCALARS = ['website', 'domain', 'industry', 'size', 'headquarters', 'founded'];

/** How firmly a record's identity is established. Higher wins a merge. */
export const identityStrength = (company = {}) => {
  if (company.linkedinKey) return 2;
  if (company.domainKey) return 1;
  return 0;
};

/** How much a record actually knows — the tie-breaker when identity ties. */
const richness = (company = {}) => {
  let score = 0;
  for (const field of MERGE_SCALARS) if (company[field]) score += 1;
  if (company.aiAnalysis?.summary) score += 2;
  if (company.atsBoard?.provider) score += 1;
  score += (company.signals?.length || 0);
  score += (company.contacts?.length || 0);
  return score;
};

/**
 * Which of two duplicates should survive.
 *
 * Identity strength first — a record with a LinkedIn page is the one worth
 * keeping. Then linked prospects: whichever record the org's actual work points
 * at is the one they recognize, and keeping it moves the fewest links. Then
 * whichever knows more. Age last: an older _id is likelier to be linked from a
 * bookmark or an existing /companies/:id URL, and merging preserves that _id.
 *
 * `prospectCount` is optional — findDuplicateGroups attaches it. Without it the
 * comparison simply falls through to richness, which is why the callers that
 * cannot count cheaply are still correct.
 */
export const pickPrimary = (a, b) => {
  const byIdentity = identityStrength(b) - identityStrength(a);
  if (byIdentity !== 0) return byIdentity > 0 ? b : a;

  const byProspects = (b.prospectCount || 0) - (a.prospectCount || 0);
  if (byProspects !== 0) return byProspects > 0 ? b : a;

  const byRichness = richness(b) - richness(a);
  if (byRichness !== 0) return byRichness > 0 ? b : a;

  return new Date(a.createdAt || 0) <= new Date(b.createdAt || 0) ? a : b;
};

/**
 * Whether two company records describe the same real company.
 * Both arguments may be plain objects — nothing here touches the database.
 */
export const isLikelySameCompany = (a, b) => {
  if (!a || !b) return false;
  if (a._id && b._id && String(a._id) === String(b._id)) return false;
  if (String(a.organization || '') !== String(b.organization || '')) return false;
  if (!a.nameKey || a.nameKey !== b.nameKey) return false;

  // Two different LinkedIn company pages settle it: these are two companies
  // that share a name. No amount of domain similarity outranks that — but see
  // linkedinKeysContradict for why a slug and a numeric id are not "different".
  if (linkedinKeysContradict(a.linkedinKey, b.linkedinKey)) return false;

  // Two records that have each been analyzed into unrelated sectors are not one
  // company, however well their name and brand line up.
  if (industriesContradict(a.industry, b.industry)) return false;

  // A keyless placeholder never had an identity to contradict — the name was
  // all it ever held, and the keyed record is the identified version of it.
  const aKeyless = !a.linkedinKey && !a.domainKey;
  const bKeyless = !b.linkedinKey && !b.domainKey;
  if (aKeyless !== bKeyless) return true;
  if (aKeyless && bKeyless) return false; // the placeholder unique index owns this case

  // certik.com / certik.org — one brand, two TLDs, same name on both.
  return isSameBrandDomain(a.domainKey, b.domainKey);
};

/** Words that carry no sector meaning, so their overlap proves nothing. */
const INDUSTRY_STOPWORDS = new Set(['and', 'or', 'the', 'of', 'for', 'in', 'a', 'an', 'others', 'general']);

const industryTokens = (industry = '') =>
  new Set(
    String(industry)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !INDUSTRY_STOPWORDS.has(t))
  );

/**
 * Whether two analyzed records describe different lines of business.
 *
 * A brand held under two TLDs is ambiguous on its own: certik.com/certik.org is
 * one company, kiln.fi/kiln.com is a staking company and a coworking operator.
 * Once both sides have been analyzed, the industry is the cheapest evidence
 * that separates them — same company, and the two descriptions share at least
 * one real term ("Computer and Network Security" / "Blockchain Security" both
 * say *security*); different companies, and they have nothing in common.
 *
 * Only counts when BOTH sides know their industry. An unanalyzed record is
 * silent, not contradicting.
 */
const industriesContradict = (a = '', b = '') => {
  const ta = industryTokens(a);
  const tb = industryTokens(b);
  if (!ta.size || !tb.size) return false;
  for (const token of ta) if (tb.has(token)) return false;
  return true;
};

/**
 * Whether two LinkedIn keys prove the records are different companies.
 *
 * linkedinCompanyKey emits two non-comparable forms, because LinkedIn serves
 * both URL shapes for one page: a slug ('certik') and a numeric id
 * ('id:11831043'). A slug and an id that differ say nothing — they are as
 * likely to be the same page written two ways as they are to be two pages.
 * Only two keys of the SAME form can contradict each other.
 */
const linkedinKeysContradict = (a = '', b = '') => {
  if (!a || !b || a === b) return false;
  const aIsId = a.startsWith('id:');
  const bIsId = b.startsWith('id:');
  return aIsId === bIsId;
};

/** Dedupe a list of subdocuments by a derived key, first occurrence winning. */
const unionBy = (primaryItems = [], duplicateItems = [], keyOf) => {
  const seen = new Set();
  const out = [];
  for (const item of [...(primaryItems || []), ...(duplicateItems || [])]) {
    const key = keyOf(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
};

/**
 * Build the survivor's post-merge state. Pure — exported for tests, and so the
 * UI can preview a merge without performing one.
 */
export const buildMergePatch = (primary, duplicate) => {
  const patch = {};

  for (const field of MERGE_SCALARS) {
    if (!primary[field] && duplicate[field]) patch[field] = duplicate[field];
  }

  // Identity keys are adopted only into a gap. The duplicate is deleted before
  // this patch is applied, so its key is free by then — but the survivor's own
  // key is never overwritten, since that is the identity everything else
  // (aiAnalysis.analyzedForKey, prospect links) was resolved against.
  if (!primary.linkedinKey && duplicate.linkedinKey) {
    patch.linkedinKey = duplicate.linkedinKey;
    patch.linkedinUrl = primary.linkedinUrl || duplicate.linkedinUrl || '';
  }
  if (!primary.domainKey && duplicate.domainKey) patch.domainKey = duplicate.domainKey;

  if (!primary.atsBoard?.provider && duplicate.atsBoard?.provider) patch.atsBoard = duplicate.atsBoard;

  // The survivor's own analysis describes its own identity key, so it is
  // preferred outright. The duplicate's is taken only to fill a blank, and
  // analyzedForKey is cleared when it does: that text was written about the
  // other record's key, and leaving the key attached would claim it describes
  // this one. A null key is exactly what makes the analyzer re-run and heal it.
  if (!primary.aiAnalysis?.lastAnalyzedAt && duplicate.aiAnalysis?.lastAnalyzedAt) {
    patch.aiAnalysis = { ...duplicate.aiAnalysis, analyzedForKey: null };
  }

  patch.signals = unionBy(primary.signals, duplicate.signals, (s) => String(s.signal || s.name || ''));
  patch.contacts = unionBy(
    primary.contacts,
    duplicate.contacts,
    (c) => `${c.type}|${String(c.value || '').toLowerCase()}`
  );
  patch.sourceRefs = unionBy(
    primary.sourceRefs,
    duplicate.sourceRefs,
    (r) => `${r.source}|${r.url || ''}|${r.note || ''}`
  );
  patch.sourceRefs.push({
    source: 'merge',
    note: `merged duplicate "${duplicate.name}"${duplicate.domainKey ? ` (${duplicate.domainKey})` : ''}`,
  });

  // Keep whichever search ran most recently, but never drop an imported pick —
  // those point at real prospects that survive the merge.
  const primaryRun = new Date(primary.prospectSearch?.lastRunAt || 0);
  const duplicateRun = new Date(duplicate.prospectSearch?.lastRunAt || 0);
  const newerSearch = duplicateRun > primaryRun ? duplicate.prospectSearch : primary.prospectSearch;
  if (newerSearch) {
    patch.prospectSearch = {
      ...newerSearch,
      candidates: unionBy(
        [...(primary.prospectSearch?.candidates || []), ...(duplicate.prospectSearch?.candidates || [])]
          .filter((c) => c.imported),
        [...(primary.prospectSearch?.candidates || []), ...(duplicate.prospectSearch?.candidates || [])],
        (c) => String(c.linkedinUrl || '').toLowerCase()
      ),
    };
  }

  // A record that ends the merge holding a real key is no longer unverified.
  const willHaveKey = primary.linkedinKey || primary.domainKey || patch.linkedinKey || patch.domainKey;
  if (willHaveKey) {
    patch.needsReview = false;
    patch.reviewReason = '';
  }

  return patch;
};

/**
 * Merge `duplicateId` into `primaryId` and delete the duplicate.
 *
 * Ordering matters. Prospects are repointed BEFORE the delete so no prospect is
 * ever left referencing a company that no longer exists, and the survivor is
 * patched LAST so adopting the duplicate's identity key cannot collide with the
 * unique index while the duplicate still holds it.
 *
 * @returns {Promise<{ company, movedProspects: Number, mergedName: String }>}
 */
export const mergeCompanies = async ({ organization, primaryId, duplicateId } = {}) => {
  if (String(primaryId) === String(duplicateId)) {
    throw new Error('A company cannot be merged into itself.');
  }

  const [primary, duplicate] = await Promise.all([
    Company.findOne({ _id: primaryId, organization }),
    Company.findOne({ _id: duplicateId, organization }),
  ]);

  if (!primary) throw new Error('Company to keep was not found.');
  if (!duplicate) throw new Error('Company to merge was not found.');

  const patch = buildMergePatch(primary.toObject(), duplicate.toObject());

  const { modifiedCount } = await Prospect.updateMany(
    { organization, companyRef: duplicate._id },
    { $set: { companyRef: primary._id } }
  );

  await Company.deleteOne({ _id: duplicate._id, organization });

  const merged = await Company.findOneAndUpdate(
    { _id: primary._id, organization },
    { $set: patch },
    { returnDocument: 'after' }
  );

  console.log(
    `[merge] ${duplicate.name} (${duplicate.domainKey || duplicate.linkedinKey || 'no key'}) → ` +
      `${primary.name} (${primary.domainKey || primary.linkedinKey || 'no key'}), ` +
      `${modifiedCount} prospect(s) moved`
  );

  return { company: merged, movedProspects: modifiedCount, mergedName: duplicate.name };
};

/**
 * Existing duplicate pairs in an organization, newest first.
 *
 * Only companies sharing a nameKey can possibly match, so the scan is grouped
 * on that first and the rule is applied within each group — an organization
 * with 10k companies compares a handful of records, not 10k².
 */
export const findDuplicateGroups = async (organization) => {
  const shared = await Company.aggregate([
    { $match: { organization: new mongoose.Types.ObjectId(String(organization)) } },
    { $group: { _id: '$nameKey', ids: { $push: '$_id' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);

  if (!shared.length) return [];

  const candidateIds = shared.flatMap((g) => g.ids);

  const [companies, counts] = await Promise.all([
    Company.find({ organization, _id: { $in: candidateIds } }).lean(),
    Prospect.aggregate([
      { $match: { organization: new mongoose.Types.ObjectId(String(organization)), companyRef: { $in: candidateIds }, isArchived: false } },
      { $group: { _id: '$companyRef', n: { $sum: 1 } } },
    ]),
  ]);

  // Attached here rather than in the controller so pickPrimary can weigh it,
  // and so the response carries the same numbers the decision was made on.
  const countBy = new Map(counts.map((c) => [String(c._id), c.n]));
  for (const company of companies) company.prospectCount = countBy.get(String(company._id)) || 0;

  const byName = new Map();
  for (const company of companies) {
    if (!byName.has(company.nameKey)) byName.set(company.nameKey, []);
    byName.get(company.nameKey).push(company);
  }

  const pairs = [];
  for (const group of byName.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (!isLikelySameCompany(group[i], group[j])) continue;
        const primary = pickPrimary(group[i], group[j]);
        const duplicate = primary === group[i] ? group[j] : group[i];
        pairs.push({ primary, duplicate });
      }
    }
  }

  // A bare placeholder matches every keyed sibling sharing its name, so when
  // more than one matches there is nothing to choose between them — an empty
  // "Kiln" fits both the staking company and the coworking operator equally.
  // Offering an irreversible coin flip is worse than offering nothing; the
  // record stays flagged `needsReview`, which is the honest state for it.
  const matchCount = new Map();
  for (const { primary, duplicate } of pairs) {
    for (const side of [primary, duplicate]) {
      if (side.linkedinKey || side.domainKey) continue;
      matchCount.set(String(side._id), (matchCount.get(String(side._id)) || 0) + 1);
    }
  }

  return pairs.filter(
    ({ primary, duplicate }) =>
      (matchCount.get(String(primary._id)) || 0) <= 1 && (matchCount.get(String(duplicate._id)) || 0) <= 1
  );
};

/**
 * The existing record a would-be new company should fold into, or null.
 *
 * Called on the create path with the facts about to be written, so a duplicate
 * is never persisted in the first place.
 */
export const findMergeTarget = async ({ organization, nameKey, linkedinKey = '', domainKey = '' } = {}) => {
  if (!organization || !nameKey) return null;

  const siblings = await Company.find({ organization, nameKey });
  if (!siblings.length) return null;

  const incoming = { organization, nameKey, linkedinKey, domainKey };
  const matches = siblings
    .map((doc) => ({ doc, plain: doc.toObject() }))
    .filter(({ plain }) => isLikelySameCompany(incoming, plain));
  if (!matches.length) return null;

  // More than one sibling can match a brand — keep the strongest. pickPrimary
  // returns one of the two references it was given, so the plain objects are
  // held alongside their documents rather than re-derived per comparison.
  return matches.reduce((best, current) =>
    pickPrimary(best.plain, current.plain) === best.plain ? best : current
  ).doc;
};

export const __companyMergerTesting = {
  identityStrength,
  richness,
  pickPrimary,
  isLikelySameCompany,
  buildMergePatch,
  unionBy,
};
