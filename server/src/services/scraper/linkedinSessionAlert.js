import Organization from '../../models/Organization.js';
import LinkedInSession from '../../models/LinkedInSession.js';
import { sendLinkedInSessionExpiredEmail } from '../resend/emailService.js';

// Debounce window — avoid sending one email per failed prospect when a batch
// of enrichments all hit the same dead LinkedIn session.
const ALERT_DEBOUNCE_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Record that a pipeline step just hit the dead LinkedIn session.
 *
 * Distinct from notifyLinkedInSessionDead: that one emails the owner and is
 * debounced to 6h, which is right for an email and wrong for the UI — a user
 * who dismissed the modal an hour ago and then starts a new run must see it
 * again. So this is undebounced and writes a fresh `lastFailureAt` the client
 * can compare against what it has already dismissed.
 *
 * Fire-and-forget by design: it must never turn a degraded enrichment into a
 * failed one, so every caller should catch.
 *
 * @param {'prospect-enrichment'|'company-analysis'|'company-linkedin-search'} context
 */
export const recordLinkedInAuthFailure = async (context) => {
  await LinkedInSession.findOneAndUpdate(
    {},
    { status: 'dead', lastFailureAt: new Date(), lastFailureContext: context },
    { upsert: true }
  );
};

/**
 * Notify the organization's owner that the shared LinkedIn session is dead
 * and automatic recovery couldn't fix it. Safe to call on every auth failure —
 * debounces itself via LinkedInSession.lastAlertSentAt.
 *
 * Returns whether an alert was actually sent (false when debounced) — callers
 * use this to piggyback other "session just died" reactions (e.g. starting
 * the Live Login browser so it's already up by the time the owner reads the
 * email) on the same 6h window, instead of re-triggering on every failed
 * prospect in a batch.
 */
export const notifyLinkedInSessionDead = async (organizationId) => {
  const session = await LinkedInSession.findOne({});
  const recentlyAlerted =
    session?.lastAlertSentAt && Date.now() - session.lastAlertSentAt.getTime() < ALERT_DEBOUNCE_MS;
  if (recentlyAlerted) return false;

  const org = await Organization.findById(organizationId).populate('owner', 'name email');
  if (!org?.owner?.email) return false;

  await sendLinkedInSessionExpiredEmail({ name: org.owner.name || 'there', email: org.owner.email });
  await LinkedInSession.findOneAndUpdate({}, { lastAlertSentAt: new Date() }, { upsert: true });
  console.log(`[linkedin] 📧 Session-expired alert sent to ${org.owner.email}`);
  return true;
};
