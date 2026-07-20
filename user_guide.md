# ProspectMind User Guide

Welcome to **ProspectMind**! This guide will walk you through everything you need to know to leverage our AI-powered prospect intelligence and outreach platform.

ProspectMind isn't just another mass-spam tool; it's designed to give you high-signal, precision-based intelligence starting from just a name and a company or a GitHub profile.

---

## 1. What is ProspectMind?

ProspectMind takes minimal input (like a name and company) and pushes it through a **5-Layer AI Pipeline** to automatically figure out who a person is, what their skills are, how well they match your needs, and how best to contact them. 

The primary use case is built around **tech & Web3 recruiting** (finding Blockchain developers, Founders, DAO contributors), but it works for any highly targeted B2B sales or recruiting effort.

---

## 2. Core Concepts

### Campaigns
Everything starts with a **Campaign**. Campaigns group your prospects together and provide "context" to the AI.
- Before running prospects, you define the **Campaign Description**, **Target Ecosystem** (e.g., Ethereum, React), and **Target Personas**.
- The AI uses this context to score how well a prospect fits your specific campaign goals and to write highly personalized messages.

### The 5-Layer AI Pipeline
When you add a prospect, they automatically enter a 5-step background process:
1. **Identity Resolution:** The AI searches the web to find the person's real LinkedIn, GitHub, X (Twitter), and Telegram profiles.
2. **Profile Enrichment:** It scrapes available public data (like GitHub repos and stars) to build a complete profile of their skills and seniority.
3. **Classification:** It categorizes them (e.g., Talent, Client, Founder, Advisor, or Hybrid).
4. **Compatibility Scoring:** It scores them from 0–100 against your Campaign's goals and tells you the best channel to contact them on.
5. **Outreach Generation:** It drafts personalized, non-pushy outreach messages tailored specifically to that person's recent activity.

---

## 3. How to Use ProspectMind

### A. Creating a Campaign
1. Navigate to the **Campaigns** tab in the sidebar.
2. Click **Create Campaign**.
3. Give your campaign a name and fill out the context (what you are looking for, what ecosystem, etc.). *Note: The richer the context you provide, the better the AI scoring and outreach messages will be!*

### B. Adding Prospects Manually
If you know exactly who you are looking for:
1. Go to the **Prospects** page.
2. Click **Add Prospect**.
3. Enter their First Name, Last Name, and Company. You can also provide a LinkedIn or GitHub URL if you have it.
4. Assign them to your Campaign.
5. Save. The prospect will immediately enter the `pending` state and the pipeline will begin running!

### C. Using the GitHub Talent Engine (GTE)
If you want the system to automatically find candidates for you based on keywords:
1. Go to the **Talent Engine** tab.
2. Create a new GTE Campaign.
3. Enter keywords (e.g., "Solidity DeFi Protocol", "Zero Knowledge").
4. The engine will automatically search GitHub for repositories matching those keywords, find the top contributors, and import them directly into your prospect list!
5. The pipeline will automatically run on every discovered contributor.

---

## 4. Managing Prospects & Outreach

### Reviewing a Prospect
Click on any prospect in your list to view their detailed profile. You will see:
- Their **Match Score** (0-100) and priority level.
- A **Competency Radar** showing their strengths based on their enriched data.
- Their discovered social links.

### Re-running the Pipeline
If you update a prospect's details or change your campaign context, you can click the **Re-run** button at the top of the prospect's profile. This will place them back into the `pending` queue and re-process their data through the AI layers.

### Generating & Sending Messages
1. Scroll down to the **Outreach Messages** section on a prospect's profile.
2. If the pipeline has finished, you will see AI-drafted messages tailored for Email, LinkedIn, Telegram, etc.
3. Because ProspectMind focuses on quality, **messages are never sent automatically**. You get to review, edit, and approve every message before it goes out, ensuring you never look like a spam bot!

---

## 5. Billing & Limits

ProspectMind operates on a usage-based SaaS model:
- **Free Plan:** Up to 50 prospects per month.
- **Pro Plan:** Up to 500 prospects per month.
- **Enterprise Plan:** Unlimited prospects.

You can view your current usage limit via the progress bar at the bottom left of your dashboard sidebar. If you hit your limit, the pipeline will pause new prospects until your limit resets or you upgrade your plan in the **Billing** tab.
