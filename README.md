# ProspectMind

> AI-powered prospect intelligence & personalized outreach — built as a standalone SaaS.

## What it does

ProspectMind takes minimal prospect data (name + company) and runs it through a multi-layer AI pipeline:

| Layer | What |
|---|---|
| **1. Identity Resolution** | Discovers LinkedIn, GitHub, X, Telegram profiles |
| **2. Profile Enrichment** | Extracts skills, tech stack, ecosystem involvement |
| **3. Classification** | Assigns roles: Talent / Client / Mentor / Advisor / Founder |
| **4. Compatibility Scoring** | Generates 0–100 fit score with reasoning |
| **5. Outreach Generation** | Creates personalized messages per channel |

## Stack

- **Frontend**: Vite + React + TailwindCSS + React Query
- **Backend**: Node.js + Express + MongoDB (Mongoose)
- **AI**: Google Gemini (via the `askAI()` router in `services/ai/claudeClient.js`; Groq support exists but is currently disabled)
- **Queue**: BullMQ + Redis
- **Scraping**: Puppeteer (LinkedIn profiles + company pages)
- **Billing**: Stripe
- **Email**: Resend

## Quick Start

### 1. Clone & Install

```bash
# Install server deps
cd server && npm install

# Install client deps
cd ../client && npm install
```

### 2. Configure Environment

```bash
cd server
cp .env.example .env
# Fill in your keys: MONGODB_URI, REDIS_URL, GEMINI_API_KEY, SERPER_API_KEY, STRIPE_*, RESEND_API_KEY
```

### 3. Run

```bash
# Terminal 1 — API server
cd server && npm run dev

# Terminal 2 — React client
cd client && npm run dev
```

App is at `http://localhost:5173`

## Plans

| Plan | Prospects/month | Price |
|---|---|---|
| Free | 50 | $0 |
| Pro | 500 | $49/mo |
| Enterprise | Unlimited | $199/mo |

## Project Structure

```
prospectmind/
├── client/                     # Vite + React frontend
│   └── src/
│       ├── pages/              # Route-level components
│       ├── components/         # Reusable UI components
│       ├── stores/             # Zustand state (auth)
│       └── lib/                # Axios instance + helpers
└── server/                     # Express API
    └── src/
        ├── models/             # Mongoose schemas
        ├── routes/             # Express routes
        ├── controllers/        # Request handlers
        └── services/
            ├── pipeline/       # AI pipeline layers + BullMQ queue
            ├── ai/             # askAI() router → Gemini (Groq dormant)
            ├── stripe/         # Billing
            └── resend/         # Email
```
