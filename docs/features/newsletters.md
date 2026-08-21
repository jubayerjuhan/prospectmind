# Newsletters

**Models:** `NewsletterCampaign` · `NewsletterContact` · `NewsletterSuppression`
**Services:** `server/src/services/newsletter/`
**API:** `/api/newsletters` · **UI:** `/newsletters`

A second sending surface, deliberately separate from the prospecting pipeline:
write a piece of content, attach a list of people, and send it — now or later.

---

## Why it isn't a ProspectList

A `ProspectList` is a targeting + AI-strategy container whose members run the
enrichment pipeline and consume `getProspectLimit()`. A newsletter recipient is
a name and an email address somebody typed in. Reusing `Prospect` would have
meant every newsletter recipient becoming a pipeline job and burning quota,
which is both expensive and wrong.

So newsletters share **no** data with the prospecting side. Nothing here calls
`canAddProspect()`, `queuePipelineRun()`, or `ensureCompanyLink()`.

---

## Data model

| Model | Scope | Why |
|---|---|---|
| `NewsletterCampaign` | org | Content, sender identity, status, schedule, denormalized `stats` |
| `NewsletterContact` | **one campaign** | Recipient + per-send state. Its own collection, not an embedded array |
| `NewsletterSuppression` | **org-wide** | The permanent do-not-mail list, keyed on the email address |

**Contacts are a separate collection** because each carries per-send state
(`status`, `sentAt`, `error`). Embedding a few thousand of those would rewrite
the whole campaign document on every single send, race with concurrent writes,
and eventually meet the 16MB BSON ceiling — where the campaign becomes
permanently unwritable mid-blast. The unique `{campaign, email}` index also *is*
the dedupe mechanism, which is why the import can insert with `ordered: false`
and let the index absorb collisions.

**Suppression is org-wide and keyed on the address**, even though contacts are
per-campaign. If an unsubscribe only flipped the contact row, the next CSV
import into a different campaign would silently re-subscribe someone who opted
out. That is the mistake that gets a sending domain blacklisted, so the record
has to outlive both the contact and the campaign.

---

## Unsubscribe

### GET does not unsubscribe

`GET /api/newsletters/unsubscribe/:contactId/:sig` renders a confirmation page
and **changes nothing**. `POST` to the same URL performs it.

This split is load-bearing, not politeness. Outlook Safe Links, Gmail's
prefetcher, and corporate mail scanners fetch every URL in a delivered message.
A GET-unsubscribes design silently opts out a slice of the list the moment the
blast lands, and it looks exactly like poor engagement.

The POST also serves RFC 8058 one-click. That isn't a contradiction: one-click's
"no confirmation step" rule binds the *mailbox provider*, and providers only POST
when they parsed `List-Unsubscribe-Post` themselves.

Both are idempotent, and both live **above** `router.use(protect)` in
`routes/newsletters.js` — the only unauthenticated routes in that file.

### Tokens are stateless HMACs

`sign(contactId) = HMAC-SHA256(contactId, NEWSLETTER_UNSUBSCRIBE_SECRET)`,
base64url. No stored token, no index, no backfill, and valid for any contact
whenever it was created. Verification is `timingSafeEqual` with an explicit
length guard (it throws on a length mismatch).

> ⚠️ **`NEWSLETTER_UNSUBSCRIBE_SECRET` is effectively permanent.** Rotating it
> invalidates the unsubscribe link in every email already sitting in a
> recipient's inbox, which is a compliance incident. It deliberately does not
> reuse `JWT_SECRET`, because rotating a JWT signing key is routine and must not
> break unsubscribe links as a side effect.

There is no expiry: an expired unsubscribe link is far worse than a shared one.
A leaked token only lets the holder suppress one address they already know, and
an admin can undo it.

### Headers

Every newsletter carries `List-Unsubscribe` and
`List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Gmail and Yahoo require
these of bulk senders. Advertising One-Click is only legitimate because the POST
route genuinely accepts an unauthenticated submission.

---

## Rendering

`services/newsletter/renderNewsletter.js`. The order is not negotiable:

1. **Sanitize** the author's template (`sanitize-html`, narrow allowlist; no
   `data:` URLs, no `<style>`, no event handlers).
2. **Substitute** merge tags, **HTML-escaping every value**.
3. **Wrap** in a table-based, inline-styled shell with the unsubscribe footer.
4. **Derive** a `text/plain` alternative.

Doing 1 and 2 the other way round means a contact named `<b>` bolds the rest of
the email, and worse, hands the sanitizer attacker-influenced structure to parse.

**Merge tags:** `{{firstName}}`, `{{lastName}}`, `{{fullName}}`, `{{email}}`,
`{{company}}`, plus anything in `customFields`. `{{firstName|there}}` sets an
inline fallback; otherwise `firstName`/`fullName` default to `there` so no one
ever receives "Hi ,".

**Merge tags inside `href`/`src` are rejected with a 400 at save time**, not
escaped — HTML-escaping is the wrong encoding for a URL context, and doing it
properly (percent-encoding, scheme validation, keeping `javascript:` out of a
merge value) is a separate problem.

**Subjects have CR/LF stripped.** A newline in a subject is SMTP header
injection, and a CSV `company` field with an embedded newline is enough to
attempt it.

**The plain-text part is generated, not optional.** SpamAssassin scores
`MIME_HTML_ONLY` against you and some corporate gateways drop the HTML part.

Table-based markup and inline styles throughout: Outlook renders with the Word
engine and ignores `max-width` on a `div` along with all of flexbox.

---

## Sending

One BullMQ job drives one whole campaign, streaming its recipients — not one job
per recipient. Per-recipient jobs would let BullMQ's `limiter` pace Resend
exactly, but a 5,000-recipient blast becomes 5,000 Redis jobs, and
`pipeline/queue.js` documents at length why this codebase minimises Redis
commands. Everything that would have bought is recovered another way:

| Concern | How |
|---|---|
| Pacing | Explicit interval between sends, `NEWSLETTER_SEND_RATE` (default 1.5/s) |
| Idempotency | Compare-and-swap claim `pending → sending`; skip if `modifiedCount === 0` |
| Double-send after a crash | Resend `idempotencyKey` per `{campaign, contact}` |
| Resumability | The cursor is `status: 'pending'` in Mongo, never in memory |
| Cancellation | Campaign status re-read every page (the `runner.js` cooperative idiom) |
| Rate limit (429) | Back off and retry the *same* recipient, up to 3 times |

Default 1.5/s rather than Resend's ~2/s cap because the cap is **account-wide** —
a blast running flat out competes with password resets for the whole run.

A run reset stranded `sending` rows back to `pending` at start; that is safe
precisely because of the idempotency key.

**Status:** `draft | scheduled → sending → sent | failed | canceled`.
A campaign ends `sent` **even with `stats.failed > 0`** — a blast where 3 of
5,000 addresses were bad is not a failed campaign, and calling it one invites a
re-send that duplicates the other 4,997. `failed` is reserved for a top-level
throw.

### Scheduling

BullMQ **delayed jobs**, not `node-cron`. `startUsageResetCron()` in `server.js`
is not gated by `RUN_WORKERS` and Cloud Run runs up to three replicas, so a cron
sweep would fire on all three and send everything three times. A delayed job
lives in Redis, the single coordinator, and fires exactly once.

Job ids carry a timestamp (`nl:<campaignId>:<epoch>`) rather than being derived
from the campaign alone, because BullMQ **silently drops** an add whose id
already exists — a deterministic id would make a re-send vanish with no error if
the previous job hadn't been reaped. Double-sends are prevented by the campaign's
status check in the controller, which returns a visible 409.

**Boot reconciliation** (`startNewsletterReconciler`) re-queues any `scheduled`
campaign whose job is missing from Redis. Delayed jobs exist only in Redis, so
an eviction or flush would otherwise make a scheduled send silently never fire.

---

## Frontend

`client/src/pages/NewslettersPage.jsx` — gallery + workspace switched by search
params (`?id=&tab=content|recipients`), the shape `CampaignsPage` uses.

The composer is **TipTap v3**. The ProseMirror schema is an allowlist, so pasting
from Word or a web page yields clean semantic HTML rather than div-and-font soup;
`codeBlock` is disabled as it has no sensible email rendering.

> The editor is **uncontrolled** and re-seeded by remount (`key={newsletter._id}`).
> TipTap cannot be a controlled input: feeding the parent's value back in on every
> change makes `onUpdate → state → prop → setContent` race the user's next
> keystroke, so the editor rewrites its own document mid-edit and the caret jumps.
> This was a real bug during development, not a hypothetical.

CSV parsing is shared with the prospect importer via `client/src/lib/csv.js`
(`parseCsvText`, `normHeader`, `splitName`). Both importers parse client-side and
POST structured JSON, never a file, so the user confirms the column mapping first.

---

## Known gaps

- **No bounce/complaint handling.** A hard-bouncing address is re-mailed on every
  blast. `NewsletterSuppression.reason` already has `bounced`/`complained` values
  so a Resend webhook needs no migration; `resendMessageId` is persisted as the
  join key. This is the most valuable follow-up.
- **No open/click tracking.** Deliberately out of scope for v1.
- **No send quota.** Newsletter sends consume nothing. See the risks noted in
  `plan-overview.md`.
- **No postal address in the footer.** CAN-SPAM requires one for US recipients;
  there is no field for it on `Organization` yet.
