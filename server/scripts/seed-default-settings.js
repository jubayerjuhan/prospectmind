import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../src/config/db.js';
import Organization from '../src/models/Organization.js';
import User from '../src/models/User.js';
import Persona from '../src/models/Persona.js';
import Playbook from '../src/models/Playbook.js';
import Signal from '../src/models/Signal.js';

/**
 * Seed every organization with the GoodHive default Settings (HLD §3.4.4) —
 * Personas, Playbooks and Signals — so day-1 behavior matches the pre-redesign
 * hardcoded prompts.
 *
 * Two of the Playbooks exist for the company prospect finder rather than for
 * outreach: it refuses to run without one, so a brand-new org would otherwise
 * open the picker to an empty list. They state WHO to reach at a company, which
 * is what the finder's query planner reads.
 *
 * Idempotent: skips anything that already exists (by name, per org). Safe to
 * re-run. Supersedes seed-default-personas.js (kept for compat).
 *
 *   node scripts/seed-default-settings.js
 */

const DEFAULTS = [
  {
    Model: Persona,
    label: 'Persona',
    doc: {
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
    },
  },
  {
    Model: Persona,
    label: 'Persona',
    doc: {
      name: 'Recruiter',
      prompt: `You are evaluating whether this prospect matches the "Recruiter" persona.

Analyze all available information about the person and their company.

Consider:
- Is recruiting, talent acquisition or people/HR their actual job (in-house recruiter, talent partner, agency recruiter, headhunter, sourcer)?
- Do they recruit technical roles — engineers, blockchain/Web3 developers, technical leadership — rather than only non-technical ones?
- Do they own or influence the choice of sourcing channels and hiring partners?
- Is there evidence of live hiring: open roles they are posting, active sourcing, "we're hiring" activity?
- Do they work in or adjacent to Web3, blockchain, crypto or digital assets?
- Are they senior enough to bring in an external recruiting partner, or are they purely executing someone else's process?

Score higher when recruiting technical talent is clearly their day job and they have live roles to fill.
Score lower for hiring managers who occasionally interview, for HR generalists with no technical remit, or for people whose recruiting work is historical rather than current.

Give:
- A score between 0 and 100.
- A short explanation of the score.
- The evidence supporting your conclusion.`,
    },
  },
  {
    Model: Persona,
    label: 'Persona',
    doc: {
      name: 'Founder',
      prompt: `You are evaluating whether this prospect matches the "Founder" persona.

Analyze all available information about the person and their company.

Consider:
- Are they a founder, co-founder, CEO or owner of the company — someone who started it, not just an employee of it?
- Is the company real and active (a product, protocol, users, funding, public traction) rather than an idea or a dormant side project?
- What stage are they at (pre-seed, seed, Series A+) and is the team growing?
- Are they hands-on with the product and the team, or a passive/serial title-holder across many ventures?
- Do they operate in Web3, blockchain, crypto or digital assets?
- Do they hold final decision authority on budget, hiring and vendor choices?

Score higher for active, hands-on founders of a growing company where they clearly decide.
Score lower for advisors, angel investors, "founder" titles on inactive ventures, or employees mislabelled as founders.

Give:
- A score between 0 and 100.
- A short explanation of the score.
- The evidence supporting your conclusion.`,
    },
  },
  {
    Model: Playbook,
    label: 'Playbook',
    doc: {
      name: 'Sell GoodHive to Web3 startups',
      prompt: `You are writing outreach messages for GoodHive.

GoodHive is a community-driven Web3 recruitment platform specialized in senior blockchain engineers and technical leaders.

Our positioning:
- Pay only if you hire.
- Community-validated candidates.
- Fast access to highly specialized Web3 talent.
- Trusted by leading Web3 companies.

The objective is to start a conversation, not to sell aggressively.

The tone should be:
- Professional
- Friendly
- Short
- Personalized
- Curious

Avoid:
- Generic sales language
- Long introductions
- Overpromising
- Obvious AI wording

Every message should naturally reference the prospect's background whenever relevant and finish with a simple call to action.`,
    },
  },
  {
    Model: Playbook,
    label: 'Playbook',
    doc: {
      name: 'Sell GoodHive — reach the hiring decision-maker',
      prompt: `You are working the GoodHive sales motion into a company that is building a technical team.

GoodHive is a community-driven Web3 recruitment platform specialized in senior blockchain engineers and technical leaders.

Our positioning:
- Pay only if you hire.
- Community-validated candidates.
- Fast access to highly specialized Web3 talent.
- Trusted by leading Web3 companies.

WHO TO REACH AT THE COMPANY
The people who can actually decide to bring in an external recruiting partner:
- Founders, co-founders, CEOs and owners.
- CTOs, VPs of Engineering, Heads of Engineering, Engineering Directors.
- Heads of Talent, Talent Acquisition Leads, Technical Recruiters, People/HR leads.
- Chief of Staff or COO where they own hiring.

Prefer people with budget authority or direct ownership of hiring. Skip individual
contributors, interns, and advisors — they cannot buy, and reaching them burns the account.

The objective is to start a conversation, not to sell aggressively.

The tone should be professional, friendly, short, personalized and curious.

Avoid generic sales language, long introductions, overpromising, and obvious AI wording.

Every message should naturally reference the prospect's background whenever relevant and
finish with a simple call to action.`,
    },
  },
  {
    Model: Playbook,
    label: 'Playbook',
    doc: {
      name: 'Recruit Web3 engineers — reach senior builders',
      prompt: `You are sourcing senior technical talent on behalf of GoodHive's client companies.

GoodHive places senior blockchain engineers and technical leaders with Web3 companies.
We approach engineers about specific, concrete opportunities — never with generic
"exciting opportunity" spam.

WHO TO REACH AT THE COMPANY
The people who actually build the product:
- Senior, Staff and Principal Engineers.
- Smart contract, protocol, blockchain and Solidity engineers.
- Backend, infrastructure and platform engineers.
- Engineering leads and tech leads who still write code.
- Security engineers and auditors.

Prefer engineers with demonstrable depth — shipped protocols, open-source work,
audited contracts, conference talks. Skip recruiters, sales, marketing and
non-technical roles entirely; they are the wrong side of this conversation.

The objective is to open a low-pressure conversation about what they are building now
and what would make them consider a move.

The tone should be peer-to-peer, technically credible, short and specific.
Engineers detect and discard recruiter boilerplate instantly.

Avoid flattery, buzzwords, salary-first pitches, urgency tactics, and any claim about
their work you cannot support from what you actually know about them.

Reference something concrete about their work, then close with a genuinely low-commitment
call to action.`,
    },
  },
  {
    Model: Signal,
    label: 'Signal',
    doc: {
      name: 'Engineering Hiring Activity',
      appliesTo: ['company'],
      prompt: `Determine whether this company is actively hiring technical talent.

Search for evidence such as:
- Careers page
- Job boards
- LinkedIn job postings
- Engineering openings
- Public announcements
- Team expansion
- Recent funding linked to hiring

If hiring is detected:
- Estimate the hiring intensity (Low, Medium or High).
- Identify the technical roles being recruited.
- Explain why this signal is relevant.
- List the sources used to support the conclusion.

If no evidence is found, clearly state that no hiring activity could be confirmed.`,
    },
  },
];

async function run() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await connectDB();

    const orgs = await Organization.find({}).select('_id name').lean();
    console.log(`Found ${orgs.length} organization(s).\n`);

    let created = 0;
    let skipped = 0;

    for (const org of orgs) {
      const user = await User.findOne({ organization: org._id }).select('_id').lean();
      if (!user) {
        console.log(`  ⚠  ${org.name || org._id}: no user found, skipping org`);
        continue;
      }

      for (const { Model, label, doc } of DEFAULTS) {
        const existing = await Model.findOne({
          organization: org._id,
          name: { $regex: `^${doc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
        }).lean();

        if (existing) {
          skipped += 1;
          continue;
        }

        await Model.create({
          organization: org._id,
          createdBy: user._id,
          isActive: true,
          ...doc,
        });
        created += 1;
        console.log(`  ✅ ${org.name || org._id}: seeded ${label} "${doc.name}"`);
      }
    }

    console.log(`\n🎉 Done. Created: ${created} | Skipped (existing): ${skipped}`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding settings:', error);
    process.exit(1);
  }
}

run();
