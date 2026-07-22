import Organization from '../../models/Organization.js';
import LinkedInSession from '../../models/LinkedInSession.js';
import { sendLinkedInSessionExpiredEmail } from '../resend/emailService.js';

// Debounce window — avoid sending one email per failed prospect when a batch
// of enrichments all hit the same dead LinkedIn session.
const ALERT_DEBOUNCE_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Notify the organization's owner that the shared LinkedIn session is dead
 * and automatic recovery couldn't fix it. Safe to call on every auth failure —
 * debounces itself via LinkedInSession.lastAlertSentAt.
 */
export const notifyLinkedInSessionDead = async (organizationId) => {
  const session = await LinkedInSession.findOne({});
  const recentlyAlerted =
    session?.lastAlertSentAt && Date.now() - session.lastAlertSentAt.getTime() < ALERT_DEBOUNCE_MS;
  if (recentlyAlerted) return;

  const org = await Organization.findById(organizationId).populate('owner', 'name email');
  if (!org?.owner?.email) return;

  await sendLinkedInSessionExpiredEmail({ name: org.owner.name || 'there', email: org.owner.email });
  await LinkedInSession.findOneAndUpdate({}, { lastAlertSentAt: new Date() }, { upsert: true });
  console.log(`[linkedin] 📧 Session-expired alert sent to ${org.owner.email}`);
};
