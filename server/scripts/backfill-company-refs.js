import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../src/config/db.js';
import Prospect from '../src/models/Prospect.js';
import { findOrCreateCompany } from '../src/services/company/companyService.js';

/**
 * Backfill Prospect.companyRef from the existing free-text Prospect.company
 * (v2 Phase A). For every prospect with a company name but no companyRef,
 * find-or-create the org's Company and link it.
 *
 * Idempotent — skips prospects that already have a companyRef, so it's safe to
 * re-run. Does NOT touch the `company` string (kept as display source-of-truth).
 *
 *   node scripts/backfill-company-refs.js
 */

async function run() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await connectDB();

    const cursor = Prospect.find({
      company: { $nin: [null, ''] },
      companyRef: { $in: [null, undefined] },
    })
      .select('_id organization company')
      .cursor();

    let linked = 0;
    let skipped = 0;
    const companyCache = new Map(); // `${org}::${name}` -> companyId (avoid repeat upserts)

    for (let p = await cursor.next(); p != null; p = await cursor.next()) {
      const name = (p.company || '').trim();
      if (!name) {
        skipped += 1;
        continue;
      }

      const cacheKey = `${p.organization}::${name.toLowerCase()}`;
      let companyId = companyCache.get(cacheKey);

      if (!companyId) {
        const company = await findOrCreateCompany({ organization: p.organization, name });
        if (!company) {
          skipped += 1;
          continue;
        }
        companyId = company._id;
        companyCache.set(cacheKey, companyId);
      }

      await Prospect.updateOne({ _id: p._id }, { $set: { companyRef: companyId } });
      linked += 1;
      if (linked % 25 === 0) console.log(`  …linked ${linked} prospects so far`);
    }

    console.log(`\n🎉 Done. Linked: ${linked} | Skipped (no usable name): ${skipped} | Unique companies touched: ${companyCache.size}`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during company backfill:', error);
    process.exit(1);
  }
}

run();
