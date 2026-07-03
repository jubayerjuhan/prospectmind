import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../src/config/db.js';
import Prospect from '../src/models/Prospect.js';
import ProspectList from '../src/models/ProspectList.js';
import Organization from '../src/models/Organization.js';

async function run() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await connectDB();

    console.log('🧹 Purging prospects collection...');
    const prospectResult = await Prospect.deleteMany({});
    console.log(`✅ Deleted ${prospectResult.deletedCount} prospects from database.`);

    console.log('🧹 Clearing prospect references from all lists...');
    const listResult = await ProspectList.updateMany({}, { $set: { prospects: [] } });
    console.log(`✅ Cleared references in manual/dynamic lists.`);

    console.log('🔄 Resetting monthly prospects usage counters...');
    const orgResult = await Organization.updateMany({}, { $set: { 'usage.prospectsThisMonth': 0 } });
    console.log(`✅ Reset prospects usage counter for all organizations.`);

    console.log('🎉 Database purge completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during database purge:', error);
    process.exit(1);
  }
}

run();
