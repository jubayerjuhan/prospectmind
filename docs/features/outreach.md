# Outreach Engine

**File:** `server/src/services/pipeline/outreach.js`
**Related:** `server/src/services/resend/emailService.js` (for actual sending)

---

## Message Generation (Layer 5)

Messages are generated per available channel, personalized using:
- Recent GitHub activity / repos
- Blockchain ecosystems they work in
- Current role and seniority
- Company context
- Classification angle (talent vs client)

### Channels

| Channel | Max Length | Has Subject |
|---|---|---|
| `email` | 120 words | ✅ |
| `linkedin` | 80 words | ❌ |
| `x` | 80 words | ❌ |
| `telegram` | 80 words | ❌ |

Only channels where a contact handle was discovered are generated.

---

## Human Review Flow

All messages start as `status: "draft"`. They must be approved by a human before sending.

```
draft → approved (user clicks approve, optionally edits body)
      → rejected (user dismisses)
approved → sent (future: when sending is wired up)
sent    → replied (future: when reply tracking is added)
```

**Frontend:** `ProspectDetailPage.jsx` — shows each message with Approve / Edit buttons.

When editing: user modifies text in a textarea, clicks "Approve" — the edited version is saved to `message.editedBody` and `status` set to `approved`.

---

## Talent vs Client Messaging

### Talent positioning
- Hook: their specific project, open-source work, or ecosystem contribution
- Platform pitch: elite Web3 talent network, community-powered, quality projects
- CTA: soft invite to explore opportunities, no hard sell

### Client positioning
- Hook: difficulty hiring Web3 talent, specific role they might need
- Platform pitch: community-vetted talent, no upfront fee, pay-on-hire model
- CTA: offer to share relevant profiles, low-commitment ask

### Hybrid profiles
- Lead with `primaryAngle`, acknowledge `secondaryAngle` if relevant
- Example: Founder/Talent → lead with talent opportunities, mention advisor/community angle

---

## Sending (Future)

Email sending is partially wired via Resend (`emailService.sendOutreachEmail`).
LinkedIn / X / Telegram sending requires 3rd party integrations (not yet built).

→ See `docs/status/roadmap.md` Phase 2 for sending integrations plan.

---

## Quality Rules (enforced in prompt)

Messages are rejected by the prompt if they:
- Start with "I came across your profile"
- Start with "Hope this finds you well"
- Use corporate jargon or obvious AI patterns
- Don't reference anything specific to the recipient
- Have a hard sell or pushy CTA
