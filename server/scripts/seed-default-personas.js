import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../src/config/db.js';
import Organization from '../src/models/Organization.js';
import User from '../src/models/User.js';
import Persona from '../src/models/Persona.js';

/**
 * Seed each organization with the GoodHive default Persona (HLD §3.4.4).
 *
 * Idempotent: skips any org that already has a persona with this name, so it's
 * safe to re-run. Requires at least one User in the org to attribute createdBy.
 *
 *   node scripts/seed-default-personas.js
 */

const DEFAULT_PERSONA = {
  name: 'Founder hiring Web3 talent',
  prompt: `You are evaluating whether this prospect matches the "Founder hiring Web3 talent" persona.

Analyze all available information about the person and their company.

Consider:
- Are they a founder, co-founder, CEO or executive decision maker?
- Do they work in Web3, blockchain, crypto or digital assets?
- Are they involved in hiring or building engineering teams?
- Does their company appear to be growing?
- Are there any hiring signals or technical expansion plans?
- Would they likely influence the decision to work with an external recruiting partner?

Give:
- A score between 0 and 100.
- A short explanation of the score.
- The evidence supporting your conclusion.`,
};

async function run() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await connectDB();

    const orgs = await Organization.find({}).select('_id name').lean();
    console.log(`Found ${orgs.length} organization(s).`);

    let created = 0;
    let skipped = 0;
    let noUser = 0;

    for (const org of orgs) {
      const existing = await Persona.findOne({
        organization: org._id,
        name: { $regex: `^${DEFAULT_PERSONA.name}$`, $options: 'i' },
      }).lean();

      if (existing) {
        skipped += 1;
        console.log(`  ⏭  ${org.name || org._id}: already has "${DEFAULT_PERSONA.name}"`);
        continue;
      }

      // Attribute to any user in the org (Persona requires createdBy).
      const user = await User.findOne({ organization: org._id }).select('_id').lean();
      if (!user) {
        noUser += 1;
        console.log(`  ⚠  ${org.name || org._id}: no user found, skipping`);
        continue;
      }

      await Persona.create({
        organization: org._id,
        createdBy: user._id,
        name: DEFAULT_PERSONA.name,
        prompt: DEFAULT_PERSONA.prompt,
        isActive: true,
      });
      created += 1;
      console.log(`  ✅ ${org.name || org._id}: seeded "${DEFAULT_PERSONA.name}"`);
    }

    console.log(`\n🎉 Done. Created: ${created} | Skipped (existing): ${skipped} | Skipped (no user): ${noUser}`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding personas:', error);
    process.exit(1);
  }
}

run();
