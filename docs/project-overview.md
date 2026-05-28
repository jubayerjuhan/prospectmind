# ProspectMind — Project Overview

## Vision

Build the most precise AI-powered prospect intelligence and outreach platform for tech recruiting. Not a mass-spam tool — a **high-signal, relationship-first** system that makes every outreach feel hand-crafted.

> "The moat is NOT automation. The moat is precision, relevance, contextual intelligence, and relationship quality."

---

## The Problem We Solve

Recruiters and founders waste hours manually:
- Googling people across LinkedIn, GitHub, X, Telegram
- Copy-pasting profiles into spreadsheets
- Writing personalized messages that never feel truly personal
- Guessing who to contact first and on which channel

ProspectMind automates all of this intelligently — starting from just a **name + company**.

---

## What It Does

Takes minimal input:
```
First Name | Last Name | Company | Type Hint
Ashwin     | Kumar     | Polygon | Talent
```

Outputs a fully enriched, classified, scored profile with ready-to-send messages:
```json
{
  "roleClassification": ["talent", "founder"],
  "compatibilityScore": 87,
  "scoreLabel": "strong_talent_match",
  "bestContactChannel": "telegram",
  "messages": {
    "linkedin": "Hey Ashwin — loved your work on...",
    "telegram": "...",
    "email": "..."
  }
}
```

---

## The 5-Layer AI Pipeline

```
Input: Name + Company
    ↓
[1] Identity Resolution   → Find LinkedIn, GitHub, X, Telegram, ENS
    ↓
[2] Profile Enrichment    → Skills, ecosystem, seniority, activity
    ↓
[3] Classification        → Talent / Client / Founder / Advisor / Hybrid
    ↓
[4] Compatibility Score   → 0–100 fit score + reasoning
    ↓
Output: Personalized outreach per channel
```

→ Full pipeline details: `docs/features/pipeline.md`

---

## Target Market

### Primary (now)
**Web3 companies and recruiting teams** who need to find and reach:
- Blockchain developers (Solidity, Rust, Move, Go)
- Protocol founders and CTOs
- DAO contributors and community leaders
- Web3 project advisors

### Secondary (phase 2+)
**Any tech recruiter or B2B sales team** targeting:
- Software engineers
- Startup founders
- Technical decision makers

---

## Business Model (SaaS)

| Plan | Prospects/month | Price |
|---|---|---|
| Free | 50 | $0 |
| Pro | 500 | $49/month |
| Enterprise | Unlimited | $199/month |

→ Billing details: `docs/features/billing.md`

---

## What Makes It Different

| Competitor | Problem |
|---|---|
| Apollo.io | Generic B2B, not Web3-aware, no AI outreach |
| Hunter.io | Only email finding, no enrichment or messaging |
| LinkedIn Recruiter | Expensive, no AI enrichment, no multi-channel |
| Manual outreach | Hours per prospect, inconsistent quality |

**ProspectMind's edge:**
- Web3 ecosystem-native intelligence (understands ENS, DAOs, protocols)
- Multi-channel outreach (email + LinkedIn + X + Telegram)
- Human-review step before sending — prevents spam
- AI that understands context, not just fills templates

---

## Core Product Principles

1. **Quality over quantity** — 10 perfect messages beat 1000 generic ones
2. **Human in the loop** — AI drafts, human approves before anything sends
3. **Precision identity resolution** — wrong person = everything fails
4. **Web3 native** — understand the ecosystem deeply, not superficially
5. **Relationship-first** — every message must feel like it came from a real person who did their homework
