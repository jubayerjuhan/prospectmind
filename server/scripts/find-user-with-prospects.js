import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../src/config/db.js';
import Prospect from '../src/models/Prospect.js';
import User from '../src/models/User.js';
import Organization from '../src/models/Organization.js';

async function run() {
  await connectDB();

  // Orgs that have at least one prospect
  const orgIds = await Prospect.distinct('organization');
  console.log(`\nOrganizations with prospects: ${orgIds.length}\n`);

  for (const orgId of orgIds) {
    const count = await Prospect.countDocuments({ organization: orgId });
    const org = await Organization.findById(orgId).lean();
    // latest prospect for this org
    const latest = await Prospect.findOne({ organization: orgId }).sort({ createdAt: -1 }).lean();
    // owner / most recent user in the org
    const users = await User.find({ organization: orgId }).sort({ lastLogin: -1, createdAt: -1 }).lean();
    console.log('────────────────────────────────────────');
    console.log(`Org: ${org?.name || orgId}  (id ${orgId})`);
    console.log(`  Prospects: ${count}`);
    console.log(`  Latest prospect: ${latest?.name || '-'} @ ${latest?.company || '-'}  (created ${latest?.createdAt})`);
    users.forEach((u) => {
      console.log(`  User: ${u.email}  | name: ${u.name} | role: ${u.role} | lastLogin: ${u.lastLogin || 'never'} | created: ${u.createdAt}`);
    });
  }

  console.log('\nDone.');
  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
