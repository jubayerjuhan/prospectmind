/**
 * Re-resolve company identities.
 *
 * Companies used to be keyed on their normalized NAME alone, so two unrelated
 * organizations sharing a name collapsed into a single record and every
 * prospect at either one inherited the other's research. This script repairs
 * the existing data: it backfills the new identity keys, merges records that
 * turn out to be the same company, splits records that turn out to be several,
 * and flags the prospects whose stored AI prose was written about the wrong one.
 *
 * DRY RUN IS THE DEFAULT. Nothing is written without --apply.
 *
 *   node scripts/reresolve-companies.js                  # plan only
 *   node scripts/reresolve-companies.js --apply          # execute
 *   node scripts/reresolve-companies.js --org=<id>       # scope to one org
 *   node scripts/reresolve-companies.js --requeue        # also re-run pipelines
 *
 * Step order is load-bearing: the new unique index cannot build while duplicate
 * keys exist, and the old name-unique index forbids the splits. So it must go
 *   backfill+merge → drop old index → sync new indexes → split.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import Company from '../src/models/Company.js';
import Prospect from '../src/models/Prospect.js';
import { normalizeDomainKey } from '../src/utils/domains.js';
import { normalizeCompanyName } from '../src/services/company/companyService.js';
import { deriveCompanyIdentity } from '../src/services/company/companyResolver.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
// Prepare the schema WITHOUT re-resolving anything: backfill the empty identity
// keys and switch the indexes, then stop. This is the minimum that makes a
// normal pipeline re-run able to split a wrongly-merged company — without it
// the legacy name-unique index rejects the split and the re-run silently
// leaves the prospect on the wrong company.
const INDEXES_ONLY = args.includes('--indexes-only');
const REQUEUE = args.includes('--requeue');
const VERBOSE = args.includes('--verbose');
const ORG = args.find((a) => a.startsWith('--org='))?.split('=')[1] || null;
const LIMIT = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1]) || 0;

const LEGACY_INDEX = 'organization_1_nameKey_1';

const head = (t) => console.log(`\n${'─'.repeat(72)}\n${t}\n${'─'.repeat(72)}`);
const note = (t) => console.log(`  ${t}`);

// ── Step 0: preflight ────────────────────────────────────────────────────────

const preflight = async () => {
  head('Step 0 — Preflight');
  const indexes = await Company.collection.indexes();
  note(`Company indexes (${indexes.length}):`);
  indexes.forEach((i) => note(`  · ${i.name}${i.unique ? ' [unique]' : ''}${i.partialFilterExpression ? ' [partial]' : ''}`));

  const legacy = indexes.find((i) => i.name === LEGACY_INDEX);
  note(legacy
    ? `⚠  Legacy "${LEGACY_INDEX}" is still present — it forbids two companies sharing a name, so no split can be written until it is dropped.`
    : `✓  Legacy "${LEGACY_INDEX}" already dropped.`);

  const orgFilter = ORG ? { organization: new mongoose.Types.ObjectId(ORG) } : {};
  const [companies, withDomain, missingKeys, prospects] = await Promise.all([
    Company.countDocuments(orgFilter),
    Company.countDocuments({ ...orgFilter, domain: { $nin: [null, ''] } }),
    Company.countDocuments({ ...orgFilter, $or: [{ domainKey: { $exists: false } }, { linkedinKey: { $exists: false } }] }),
    Prospect.countDocuments({ ...orgFilter, company: { $nin: [null, ''] } }),
  ]);
  note(`companies=${companies}  with a stored domain=${withDomain}  missing identity keys=${missingKeys}  prospects with a company=${prospects}`);

  // A MISSING key matches neither partial filter, so such a document sits under
  // no uniqueness rule at all. Backfilling '' is what puts them back under one.
  if (missingKeys) note(`⚠  ${missingKeys} company/companies have no identity-key fields and are currently exempt from every unique index.`);
  return { orgFilter, legacyPresent: Boolean(legacy) };
};

// ── Step 1: backfill keys, then merge records that collide on a key ──────────

const backfillAndMerge = async (orgFilter) => {
  head('Step 1 — Backfill identity keys and merge collisions');

  const companies = await Company.find(orgFilter).lean();
  const updates = [];

  for (const c of companies) {
    // The stored `domain`/`website` were picked by a name search, so treat them
    // as a weak starting point — prospect evidence overrides them in step 3.
    const domainKey = normalizeDomainKey(c.domain || c.website || '');
    const set = {};
    if (c.domainKey !== (domainKey || '')) set.domainKey = domainKey || '';
    if (c.linkedinKey == null) set.linkedinKey = '';
    // A MISSING key matches neither partial filter, so the record sits under no
    // uniqueness rule and find-or-create cannot see it as a placeholder — which
    // would quietly create a duplicate beside it. Writing '' is what fixes that.
    if (!INDEXES_ONLY && c.needsReview == null) set.needsReview = !domainKey;
    if (Object.keys(set).length) updates.push({ updateOne: { filter: { _id: c._id }, update: { $set: set } } });
  }

  note(`${updates.length} company/companies need key backfill.`);

  // Group by the derived key: any group larger than one BLOCKS the unique index.
  const byKey = new Map();
  for (const c of companies) {
    const key = normalizeDomainKey(c.domain || c.website || '');
    if (!key) continue;
    const id = `${c.organization}::${key}`;
    if (!byKey.has(id)) byKey.set(id, []);
    byKey.get(id).push(c);
  }

  const collisions = [...byKey.entries()].filter(([, group]) => group.length > 1);
  if (!collisions.length) {
    note('✓ No domainKey collisions — the unique index can build.');
  } else {
    note(`⚠ ${collisions.length} domainKey collision group(s) — these MUST merge before the unique index can build:`);
  }

  const merges = [];
  for (const [id, group] of collisions) {
    const counts = await Promise.all(group.map((c) => Prospect.countDocuments({ companyRef: c._id })));
    const ranked = group
      .map((c, i) => ({ company: c, prospects: counts[i] }))
      .sort((a, b) => b.prospects - a.prospects || new Date(a.company.createdAt) - new Date(b.company.createdAt));
    const [winner, ...losers] = ranked;
    note(`  ${id.split('::')[1]}`);
    note(`    keep  "${winner.company.name}" (${winner.prospects} prospect(s))`);
    losers.forEach((l) => note(`    merge "${l.company.name}" (${l.prospects} prospect(s)) → repoint and mark isMergedInto`));
    merges.push({ winner, losers });
  }

  if (APPLY) {
    if (updates.length) {
      const res = await Company.bulkWrite(updates);
      note(`✓ Backfilled ${res.modifiedCount} company/companies.`);
    }
    for (const { winner, losers } of merges) {
      for (const loser of losers) {
        await Prospect.updateMany({ companyRef: loser.company._id }, { $set: { companyRef: winner.company._id } });
        // Kept, not deleted: a merge decided from guessed domains is exactly the
        // kind of call an operator may need to walk back.
        await Company.updateOne({ _id: loser.company._id }, {
          $set: { isMergedInto: winner.company._id, domainKey: '', linkedinKey: '', needsReview: true, reviewReason: 'merged-duplicate' },
        });
      }
      await Company.updateOne({ _id: winner.company._id }, {
        $set: { 'aiAnalysis.analyzedForKey': null },
        $push: { sourceRefs: { source: 'migration', note: `merged ${losers.length} duplicate record(s)`, at: new Date() } },
      });
    }
    if (merges.length) note(`✓ Merged ${merges.reduce((n, m) => n + m.losers.length, 0)} duplicate record(s).`);
  } else if (merges.length) {
    note('→ Re-run with --apply to perform these merges. The index switch is blocked until then.');
  }

  return { pendingMerges: merges.length };
};

// ── Step 2: index switch ─────────────────────────────────────────────────────

const switchIndexes = async () => {
  head('Step 2 — Index switch');
  if (!APPLY) {
    note('(dry run) would drop the legacy name-unique index and sync the partial identity indexes.');
    return;
  }

  const before = (await Company.collection.indexes()).map((i) => i.name);
  try {
    await Company.collection.dropIndex(LEGACY_INDEX);
    note(`✓ Dropped "${LEGACY_INDEX}" — two companies may now share a name when their identities differ.`);
  } catch (err) {
    if (err.codeName === 'IndexNotFound' || /index not found/i.test(err.message)) {
      note(`· "${LEGACY_INDEX}" already absent.`);
    } else {
      throw err;
    }
  }

  const synced = await Company.syncIndexes();
  const after = (await Company.collection.indexes()).map((i) => i.name);
  note(`syncIndexes dropped: ${JSON.stringify(synced)}`);
  note(`before: ${before.join(', ')}`);
  note(`after : ${after.join(', ')}`);
};

// ── Step 3: plan the re-resolution (pure, no writes) ─────────────────────────

const planResolution = async (orgFilter) => {
  head('Step 3 — Plan');

  const query = Prospect.find({ ...orgFilter, company: { $nin: [null, ''] } })
    .select('firstName lastName company companyRef organization rawEmail rawLinkedin rawCompanyLinkedin rawCompanyDomain companyLinkSource enrichedProfile.email enrichedProfile.website enrichedProfile.companyLinkedinUrl')
    .lean();
  if (LIMIT) query.limit(LIMIT);
  const prospects = await query;

  note(`Evaluating ${prospects.length} prospect(s).`);

  // Histogram the resolved identity per (org, nameKey). A group resolving to
  // two or more distinct keys is a company that was never really one company.
  const groups = new Map();
  const perProspect = [];

  for (const p of prospects) {
    const identity = deriveCompanyIdentity(p);
    const nameKey = normalizeCompanyName(p.company || '');
    const key = identity.key ? `${identity.keyField}:${identity.key}` : '(unresolved)';
    const gid = `${p.organization}::${nameKey}`;

    if (!groups.has(gid)) groups.set(gid, { nameKey, organization: p.organization, keys: new Map() });
    const g = groups.get(gid);
    if (!g.keys.has(key)) g.keys.set(key, { count: 0, sources: new Map(), prospects: [] });
    const bucket = g.keys.get(key);
    bucket.count++;
    bucket.sources.set(identity.source, (bucket.sources.get(identity.source) || 0) + 1);
    bucket.prospects.push(p);

    perProspect.push({ prospect: p, identity, key, gid });
  }

  const splitGroups = [...groups.values()].filter(
    (g) => [...g.keys.keys()].filter((k) => k !== '(unresolved)').length >= 2
  );

  const stats = { resolved: 0, unresolved: 0 };
  perProspect.forEach((r) => (r.key === '(unresolved)' ? stats.unresolved++ : stats.resolved++));
  note(`resolved to a verified identity: ${stats.resolved}   name-only: ${stats.unresolved}`);

  if (!splitGroups.length) {
    note('✓ No company name resolves to more than one identity — nothing to split.');
  } else {
    note(`\n⚠ ${splitGroups.length} name(s) resolve to MORE THAN ONE company — these are the wrong-company cases:`);
    for (const g of splitGroups) {
      const existing = await Company.findOne({ organization: g.organization, nameKey: g.nameKey }).lean();
      const total = [...g.keys.values()].reduce((n, b) => n + b.count, 0);
      note(`\n  nameKey "${g.nameKey}" | company ${existing?._id || '—'} (${total} prospect(s))`);
      const ranked = [...g.keys.entries()].sort((a, b) => b[1].count - a[1].count);
      ranked.forEach(([key, bucket], i) => {
        const sources = [...bucket.sources.entries()].map(([s, n]) => `${s}:${n}`).join(', ');
        const verdict = key === '(unresolved)'
          ? 'ambiguous → placeholder + needsReview'
          : i === 0 ? `promote existing ${existing?._id || 'record'}` : 'SPLIT → new record';
        note(`    ${key.padEnd(34)} ${String(bucket.count).padStart(3)}  [${sources}]  → ${verdict}`);
      });
    }
  }

  if (VERBOSE) {
    note('\nPer-prospect plan:');
    perProspect.forEach((r) =>
      note(`  ${r.prospect.firstName} ${r.prospect.lastName || ''} @ ${r.prospect.company} → ${r.key} (${r.identity.source})`)
    );
  }

  return { perProspect, splitGroups, groups };
};

// ── Step 4/5: apply and flag contaminated prospects ─────────────────────────

const applyResolution = async ({ perProspect, splitGroups }) => {
  head('Step 4 — Apply re-resolution');

  // Every prospect in a split group is suspect, not just the ones that move:
  // the merged record's summary was injected into ALL of their outreach.
  const splitGids = new Set(splitGroups.map((g) => `${g.organization}::${g.nameKey}`));

  const contaminated = { refChanged: 0, keyChanged: 0, groupAmbiguous: 0 };
  const prospectWrites = [];
  const seenCompanyKeyChange = new Set();

  // Resolve for real, one prospect at a time — findOrCreateByKey performs the
  // promote / split / converge decisions and is idempotent.
  const { resolveCompanyForProspect } = await import('../src/services/company/companyResolver.js');

  for (const { prospect, gid } of perProspect) {
    if (prospect.companyLinkSource === 'manual') continue;

    let res;
    try {
      res = await resolveCompanyForProspect({
        prospect,
        organization: prospect.organization,
        dryRun: !APPLY,
      });
    } catch (err) {
      note(`  ⚠ ${prospect._id}: ${err.message}`);
      continue;
    }
    if (!res.company) continue;

    const refChanged = String(prospect.companyRef || '') !== String(res.company._id);
    const keyChanged = ['promoted-placeholder', 'created'].includes(res.action);
    const groupAmbiguous = splitGids.has(gid);

    if (refChanged) contaminated.refChanged++;
    else if (keyChanged) contaminated.keyChanged++;
    else if (groupAmbiguous) contaminated.groupAmbiguous++;

    if (keyChanged) seenCompanyKeyChange.add(String(res.company._id));

    if (refChanged || keyChanged || groupAmbiguous) {
      prospectWrites.push({
        updateOne: {
          filter: { _id: prospect._id },
          update: {
            $set: {
              companyRef: res.company._id,
              companyLinkSource: res.evidence.source,
              companyLinkConfidence: res.evidence.confidence,
              companyLinkedAt: new Date(),
              // The stored bio / persona reasoning / outreach were generated
              // against the wrong company. Left in place (a flagged-wrong bio
              // beats an empty one) but marked so the UI stops presenting them
              // as current and the operator can re-run.
              needsReenrichment: true,
              reenrichmentReason: 'company-identity-corrected',
              outreachStale: true,
            },
          },
        },
      });
    }
  }

  const total = contaminated.refChanged + contaminated.keyChanged + contaminated.groupAmbiguous;
  note(`contaminated: ${total} (ref-changed ${contaminated.refChanged}, key-changed ${contaminated.keyChanged}, group-ambiguous ${contaminated.groupAmbiguous})`);
  note(`${prospectWrites.length} prospect update(s) ${APPLY ? 'to write' : 'planned'}.`);

  if (!APPLY) {
    note('→ Re-run with --apply to write these changes.');
    return { requeueCount: prospectWrites.length };
  }

  if (prospectWrites.length) {
    const res = await Prospect.bulkWrite(prospectWrites);
    note(`✓ Updated ${res.modifiedCount} prospect(s).`);
  }

  // Clear guess-derived research on every company whose identity moved. The
  // analyzer's own analyzedForKey check would already re-run it, but the stale
  // summary must not be on screen in the meantime.
  if (seenCompanyKeyChange.size) {
    const res = await Company.updateMany(
      { _id: { $in: [...seenCompanyKeyChange].map((id) => new mongoose.Types.ObjectId(id)) } },
      {
        $set: { industry: '', size: '', 'aiAnalysis.summary': '', 'aiAnalysis.analyzedForKey': null, signals: [] },
        $push: { sourceRefs: { source: 'migration', note: 'identity changed — prior research invalidated', at: new Date() } },
      }
    );
    note(`✓ Invalidated stale research on ${res.modifiedCount} company/companies.`);
  }

  const orphans = await Company.aggregate([
    { $lookup: { from: 'prospects', localField: '_id', foreignField: 'companyRef', as: 'p' } },
    { $match: { p: { $size: 0 } } },
    { $project: { name: 1, nameKey: 1 } },
  ]);
  if (orphans.length) {
    note(`· ${orphans.length} company/companies now have no prospects (reported, NOT deleted): ${orphans.slice(0, 10).map((o) => o.name).join(', ')}${orphans.length > 10 ? '…' : ''}`);
  }

  return { requeueCount: prospectWrites.length };
};

// ── Step 6: optional re-run ──────────────────────────────────────────────────

const requeue = async () => {
  head('Step 6 — Re-run pipelines');
  const flagged = await Prospect.find({ needsReenrichment: true }).select('_id').lean();
  if (!flagged.length) return note('Nothing flagged.');

  if (!REQUEUE) {
    note(`${flagged.length} prospect(s) are flagged for re-enrichment.`);
    note('Each re-run costs search + LLM calls, so this is opt-in: add --requeue.');
    return;
  }

  const { queuePipelineRun } = await import('../src/services/pipeline/queue.js');
  const CONCURRENCY = 5;
  for (let i = 0; i < flagged.length; i += CONCURRENCY) {
    await Promise.all(flagged.slice(i, i + CONCURRENCY).map((p) => queuePipelineRun(p._id).catch(() => null)));
  }
  note(`✓ Queued ${flagged.length} pipeline run(s).`);
};

// ── main ─────────────────────────────────────────────────────────────────────

const main = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`\n${APPLY ? '🔴 APPLY MODE — changes WILL be written' : '🔵 DRY RUN — no changes will be written'}`);
  if (ORG) console.log(`   scoped to organization ${ORG}`);

  const { orgFilter } = await preflight();
  const { pendingMerges } = await backfillAndMerge(orgFilter);

  // Building the unique index over duplicate keys fails, and the failure is
  // easy to miss — so stop rather than proceed into a half-migrated state.
  if (pendingMerges && !APPLY) {
    head('STOPPED');
    note(`${pendingMerges} merge group(s) must be resolved first. Re-run with --apply.`);
    await mongoose.disconnect();
    return;
  }

  await switchIndexes();

  if (INDEXES_ONLY) {
    head('Done — indexes only');
    note('Identity keys are backfilled and the indexes are switched. No company was');
    note('re-resolved, no research was invalidated, no prospect was touched.');
    note('Re-running a prospect\'s pipeline can now split a wrongly-merged company.');
    if (!APPLY) note('\n(This was a dry run — add --apply to write.)');
    await mongoose.disconnect();
    return;
  }

  const plan = await planResolution(orgFilter);
  await applyResolution(plan);
  await requeue();

  head('Done');
  if (!APPLY) note('This was a dry run. Re-run with --apply once the plan above looks right.');
  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error('\n❌ Migration failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
