import Company from '../../models/Company.js';

/**
 * Normalize a company name into a dedupe key.
 * Lowercases, strips common suffixes/punctuation, collapses whitespace.
 * "GoodHive, Inc." and "goodhive inc" → "goodhive".
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
 * Find or create a Company for an organization by normalized name.
 * Idempotent and concurrency-safe via the unique (organization, nameKey) index
 * plus an upsert. Returns null for blank names.
 *
 * @returns {Promise<import('mongoose').Document|null>}
 */
export const findOrCreateCompany = async ({ organization, name, createdBy } = {}) => {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;

  const nameKey = normalizeCompanyName(trimmed);
  if (!nameKey) return null;

  // Upsert on the unique (organization, nameKey) index. $setOnInsert keeps the
  // first-seen display name and creator; re-runs won't clobber existing data.
  const company = await Company.findOneAndUpdate(
    { organization, nameKey },
    {
      $setOnInsert: {
        organization,
        nameKey,
        name: trimmed,
        ...(createdBy ? { createdBy } : {}),
      },
    },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
  );

  return company;
};
