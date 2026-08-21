/**
 * Newsletter campaigns, their recipients, and the public unsubscribe.
 *
 * Tenancy follows the same shape as prospectListController: one guard query
 * (getCampaign) that resolves the campaign under the org, and every subsequent
 * query scoped by it. The exception is the unsubscribe pair at the bottom,
 * which is unauthenticated by necessity and derives its authority from an HMAC
 * instead — see services/newsletter/unsubscribeToken.js.
 */

import mongoose from 'mongoose';
import NewsletterCampaign from '../models/NewsletterCampaign.js';
import NewsletterContact from '../models/NewsletterContact.js';
import NewsletterSuppression from '../models/NewsletterSuppression.js';
import {
  sanitizeBody,
  buildTextFromHtml,
  findMergeTagInUrl,
  renderForContact,
  escapeHtml,
} from '../services/newsletter/renderNewsletter.js';
import { verify as verifyUnsubToken } from '../services/newsletter/unsubscribeToken.js';
import { queueNewsletterSend, cancelQueuedSend } from '../services/newsletter/newsletterQueue.js';

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Rough shape check only. Real validity is only ever proven by a delivery, and
// an over-strict regex silently drops addresses that work.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CONTENT_LOCKED = ['sending', 'sent'];

/* ── Guards ───────────────────────────────────────────────────────────────── */

const getCampaign = async ({ campaignId, organizationId }) => {
  if (!mongoose.isValidObjectId(campaignId)) {
    return { error: { status: 404, message: 'Newsletter not found.' } };
  }

  const campaign = await NewsletterCampaign.findOne({
    _id: campaignId,
    organization: organizationId,
    isArchived: false,
  });

  if (!campaign) return { error: { status: 404, message: 'Newsletter not found.' } };
  return { campaign };
};

const ensureUniqueName = async ({ organizationId, name, excludeId }) => {
  const existing = await NewsletterCampaign.findOne({
    organization: organizationId,
    isArchived: false,
    name: { $regex: `^${escapeRegex(name.trim())}$`, $options: 'i' },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  }).lean();

  return !existing;
};

const serialize = (campaign) => ({
  _id: campaign._id,
  name: campaign.name,
  subject: campaign.subject,
  bodyHtml: campaign.bodyHtml,
  bodyText: campaign.bodyText,
  fromName: campaign.fromName,
  replyTo: campaign.replyTo,
  status: campaign.status,
  scheduledFor: campaign.scheduledFor || null,
  startedAt: campaign.startedAt || null,
  completedAt: campaign.completedAt || null,
  stats: campaign.stats,
  error: campaign.error || null,
  createdAt: campaign.createdAt,
  updatedAt: campaign.updatedAt,
});

/* ── Campaign CRUD ────────────────────────────────────────────────────────── */

export const listNewsletters = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));

  const filter = { organization: req.organization._id, isArchived: false };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.search) {
    filter.name = { $regex: escapeRegex(req.query.search.trim()), $options: 'i' };
  }

  const [campaigns, total] = await Promise.all([
    NewsletterCampaign.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    NewsletterCampaign.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: campaigns.map(serialize),
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  });
};

export const createNewsletter = async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ success: false, message: 'A name is required.' });

  if (!(await ensureUniqueName({ organizationId: req.organization._id, name }))) {
    return res.status(409).json({ success: false, message: 'A newsletter with that name already exists.' });
  }

  const campaign = await NewsletterCampaign.create({
    organization: req.organization._id,
    createdBy: req.user._id,
    name,
    subject: (req.body.subject || '').trim(),
    // Empty means "fall back to the creator at send time", which is what most
    // people want and nobody wants to type.
    fromName: (req.body.fromName || req.user.name || '').trim(),
    replyTo: (req.body.replyTo || req.user.email || '').trim(),
  });

  res.status(201).json({ success: true, data: serialize(campaign) });
};

export const getNewsletter = async (req, res) => {
  const { campaign, error } = await getCampaign({
    campaignId: req.params.id,
    organizationId: req.organization._id,
  });
  if (error) return res.status(error.status).json({ success: false, message: error.message });

  const recipientCount = await NewsletterContact.countDocuments({ campaign: campaign._id });
  res.json({ success: true, data: { ...serialize(campaign), recipientCount } });
};

export const updateNewsletter = async (req, res) => {
  const { campaign, error } = await getCampaign({
    campaignId: req.params.id,
    organizationId: req.organization._id,
  });
  if (error) return res.status(error.status).json({ success: false, message: error.message });

  // Editing the body of something already going out would mean two different
  // emails under one campaign, with no way to tell who got which.
  if (CONTENT_LOCKED.includes(campaign.status)) {
    return res.status(409).json({
      success: false,
      message: `This newsletter has already been ${campaign.status === 'sent' ? 'sent' : 'started'} and can no longer be edited.`,
    });
  }

  if (req.body.name !== undefined) {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: 'A name is required.' });
    if (!(await ensureUniqueName({ organizationId: req.organization._id, name, excludeId: campaign._id }))) {
      return res.status(409).json({ success: false, message: 'A newsletter with that name already exists.' });
    }
    campaign.name = name;
  }

  if (req.body.subject !== undefined) campaign.subject = String(req.body.subject).trim();
  if (req.body.fromName !== undefined) campaign.fromName = String(req.body.fromName).trim();
  if (req.body.replyTo !== undefined) campaign.replyTo = String(req.body.replyTo).trim();

  if (req.body.bodyHtml !== undefined) {
    // Refused rather than escaped: HTML-escaping is the wrong encoding for a URL
    // context, and doing merge-tags-in-URLs properly is a separate problem.
    const badAttr = findMergeTagInUrl(req.body.bodyHtml);
    if (badAttr) {
      return res.status(400).json({
        success: false,
        message: `Merge tags aren't supported inside a link (${badAttr}). Use them in the text instead.`,
      });
    }

    // Sanitize on write so what is stored is already safe. The renderer
    // sanitizes again — cheap, and it covers rows written another way.
    campaign.bodyHtml = sanitizeBody(req.body.bodyHtml);
    campaign.bodyText = buildTextFromHtml(campaign.bodyHtml);
  }

  await campaign.save();
  res.json({ success: true, data: serialize(campaign) });
};

export const archiveNewsletter = async (req, res) => {
  const { campaign, error } = await getCampaign({
    campaignId: req.params.id,
    organizationId: req.organization._id,
  });
  if (error) return res.status(error.status).json({ success: false, message: error.message });

  if (campaign.status === 'sending') {
    return res.status(409).json({ success: false, message: 'Cancel the send before deleting this newsletter.' });
  }

  campaign.isArchived = true;
  await campaign.save();
  res.json({ success: true, message: 'Newsletter deleted.' });
};

/* ── Recipients ───────────────────────────────────────────────────────────── */

export const listContacts = async (req, res) => {
  const { campaign, error } = await getCampaign({
    campaignId: req.params.id,
    organizationId: req.organization._id,
  });
  if (error) return res.status(error.status).json({ success: false, message: error.message });

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));

  const filter = { campaign: campaign._id };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.search) {
    const rx = { $regex: escapeRegex(req.query.search.trim()), $options: 'i' };
    filter.$or = [{ email: rx }, { firstName: rx }, { lastName: rx }, { company: rx }];
  }

  const [contacts, total] = await Promise.all([
    NewsletterContact.find(filter).sort({ createdAt: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    NewsletterContact.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: contacts,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  });
};

const normalizeContactRow = (row = {}) => ({
  firstName: String(row.firstName || '').trim(),
  lastName: String(row.lastName || '').trim(),
  email: String(row.email || '').trim().toLowerCase(),
  company: String(row.company || '').trim(),
  customFields: row.customFields && typeof row.customFields === 'object' ? row.customFields : {},
});

export const addContact = async (req, res) => {
  const { campaign, error } = await getCampaign({
    campaignId: req.params.id,
    organizationId: req.organization._id,
  });
  if (error) return res.status(error.status).json({ success: false, message: error.message });

  const row = normalizeContactRow(req.body);
  if (!EMAIL_RE.test(row.email)) {
    return res.status(400).json({ success: false, message: 'A valid email address is required.' });
  }

  const suppressed = await NewsletterSuppression.findOne({
    organization: req.organization._id,
    email: row.email,
  }).lean();

  try {
    const contact = await NewsletterContact.create({
      ...row,
      organization: req.organization._id,
      campaign: campaign._id,
      // Added straight into the terminal state rather than being quietly
      // dropped, so the operator can see the address is on the do-not-mail list.
      ...(suppressed ? { status: 'unsubscribed' } : {}),
    });
    res.status(201).json({ success: true, data: contact, suppressed: Boolean(suppressed) });
  } catch (e) {
    if (e.code === 11000) {
      return res.status(409).json({ success: false, message: 'That address is already on this newsletter.' });
    }
    throw e;
  }
};

/**
 * Bulk import, mirroring bulkImportProspectsToList: the client parses the CSV
 * and posts JSON, not multipart.
 *
 * Deliberately NOT clamped to a plan allowance — newsletter recipients don't
 * consume the prospect quota, which is the whole reason they aren't Prospects.
 */
export const importContacts = async (req, res) => {
  const { campaign, error } = await getCampaign({
    campaignId: req.params.id,
    organizationId: req.organization._id,
  });
  if (error) return res.status(error.status).json({ success: false, message: error.message });

  if (!Array.isArray(req.body.contacts)) {
    return res.status(400).json({ success: false, message: 'contacts array required.' });
  }

  const rows = req.body.contacts.map(normalizeContactRow);
  const invalid = rows.filter((r) => !EMAIL_RE.test(r.email)).length;
  const valid = rows.filter((r) => EMAIL_RE.test(r.email));

  // Dedupe within the upload; first occurrence wins, as in the prospect import.
  const seen = new Set();
  const unique = valid.filter((r) => (seen.has(r.email) ? false : (seen.add(r.email), true)));

  const suppressedList = await NewsletterSuppression.find({
    organization: req.organization._id,
    email: { $in: unique.map((r) => r.email) },
  }).select('email').lean();
  const suppressedSet = new Set(suppressedList.map((s) => s.email));

  const importable = unique.filter((r) => !suppressedSet.has(r.email));

  let created = 0;
  if (importable.length) {
    // ordered:false so the unique {campaign,email} index absorbs anything
    // already present — including a concurrent import — instead of aborting
    // the whole batch on the first collision.
    const result = await NewsletterContact.insertMany(
      importable.map((r) => ({ ...r, organization: req.organization._id, campaign: campaign._id })),
      { ordered: false }
    ).catch((e) => {
      if (e.writeErrors || e.code === 11000) return e.insertedDocs || [];
      throw e;
    });
    created = Array.isArray(result) ? result.length : 0;
  }

  res.status(201).json({
    success: true,
    data: {
      created,
      skipped: rows.length - created,
      invalid,
      suppressed: unique.length - importable.length,
    },
  });
};

export const removeContacts = async (req, res) => {
  const { campaign, error } = await getCampaign({
    campaignId: req.params.id,
    organizationId: req.organization._id,
  });
  if (error) return res.status(error.status).json({ success: false, message: error.message });

  const ids = (Array.isArray(req.body.contactIds) ? req.body.contactIds : [])
    .filter((id) => mongoose.isValidObjectId(id));
  if (!ids.length) return res.status(400).json({ success: false, message: 'contactIds array required.' });

  const result = await NewsletterContact.deleteMany({ _id: { $in: ids }, campaign: campaign._id });
  res.json({ success: true, data: { removed: result.deletedCount } });
};

/* ── Preview ──────────────────────────────────────────────────────────────── */

// Renders exactly what the worker would send, and sends nothing.
export const previewNewsletter = async (req, res) => {
  const { campaign, error } = await getCampaign({
    campaignId: req.params.id,
    organizationId: req.organization._id,
  });
  if (error) return res.status(error.status).json({ success: false, message: error.message });

  const sample =
    (await NewsletterContact.findOne({ campaign: campaign._id }).lean()) || {
      _id: campaign._id, // any id signs fine; this preview link is never mailed
      firstName: 'Alex',
      lastName: 'Rivera',
      email: 'alex@example.com',
      company: 'Example Co',
    };

  const { subject, html, text } = renderForContact(campaign, sample, {
    orgName: req.organization.name,
  });

  res.json({ success: true, data: { subject, html, text, sampleEmail: sample.email } });
};

/* ── Send / schedule / cancel ─────────────────────────────────────────────── */

// 'sent' is included so a partially-failed campaign can be retried. That is safe
// because a re-send only ever requeues recipients whose status is 'failed' —
// anyone already 'sent' keeps that status, and the worker only claims 'pending'.
// A campaign with nothing left to retry is refused below rather than re-blasted.
const SENDABLE_FROM = ['draft', 'scheduled', 'canceled', 'failed', 'sent'];
const MAX_SCHEDULE_DAYS = 90;

// Refuse loudly rather than starting a blast that silently does nothing.
const contentProblem = (campaign) => {
  if (!campaign.subject?.trim()) return 'Add a subject line before sending.';
  if (!campaign.bodyHtml?.trim()) return 'Write some content before sending.';
  return null;
};

const beginSend = async ({ campaign, res, scheduledFor = null }) => {
  if (!SENDABLE_FROM.includes(campaign.status)) {
    return res.status(409).json({
      success: false,
      message: `This newsletter is already ${campaign.status}.`,
    });
  }

  const problem = contentProblem(campaign);
  if (problem) return res.status(400).json({ success: false, message: problem });

  // Give previously failed recipients another go. A failure is very often one
  // shared cause — an invalid key, an unverified domain — so once it's fixed the
  // retry should just work. Only 'failed' rows move; 'sent' rows are untouched,
  // which is what makes re-sending a delivered campaign non-duplicating.
  const { modifiedCount: retrying } = await NewsletterContact.updateMany(
    { campaign: campaign._id, status: 'failed' },
    { $set: { status: 'pending', error: '' } }
  );

  const pending = await NewsletterContact.countDocuments({ campaign: campaign._id, status: 'pending' });
  if (!pending) {
    return res.status(400).json({
      success: false,
      message:
        campaign.status === 'sent'
          ? 'Everyone on this list has already received it. Add new recipients to send again.'
          : 'There are no recipients waiting to receive this newsletter.',
    });
  }

  const total = await NewsletterContact.countDocuments({ campaign: campaign._id });

  campaign.status = scheduledFor ? 'scheduled' : 'sending';
  campaign.scheduledFor = scheduledFor;
  campaign.error = undefined;
  // Reset the counters so a re-send after a cancel doesn't report the old run's
  // numbers. Per-contact status is the real record and is left alone.
  campaign.stats = {
    total,
    sent: await NewsletterContact.countDocuments({ campaign: campaign._id, status: 'sent' }),
    failed: 0,
    skipped: 0,
  };
  await campaign.save();

  const job = await queueNewsletterSend(campaign._id, { scheduledFor });
  campaign.sendJobId = job.id;
  await campaign.save();

  return res.json({
    success: true,
    data: serialize(campaign),
    ...(retrying ? { message: `Retrying ${retrying} failed recipient${retrying === 1 ? '' : 's'}.` } : {}),
  });
};

export const sendNewsletter = async (req, res) => {
  const { campaign, error } = await getCampaign({
    campaignId: req.params.id,
    organizationId: req.organization._id,
  });
  if (error) return res.status(error.status).json({ success: false, message: error.message });

  return beginSend({ campaign, res });
};

export const scheduleNewsletter = async (req, res) => {
  const { campaign, error } = await getCampaign({
    campaignId: req.params.id,
    organizationId: req.organization._id,
  });
  if (error) return res.status(error.status).json({ success: false, message: error.message });

  const when = new Date(req.body.scheduledFor);
  if (Number.isNaN(when.getTime())) {
    return res.status(400).json({ success: false, message: 'A valid send time is required.' });
  }
  if (when.getTime() <= Date.now()) {
    return res.status(400).json({ success: false, message: 'Pick a time in the future.' });
  }
  if (when.getTime() - Date.now() > MAX_SCHEDULE_DAYS * 86400000) {
    return res.status(400).json({ success: false, message: `Schedule at most ${MAX_SCHEDULE_DAYS} days ahead.` });
  }

  return beginSend({ campaign, res, scheduledFor: when });
};

export const cancelNewsletter = async (req, res) => {
  const { campaign, error } = await getCampaign({
    campaignId: req.params.id,
    organizationId: req.organization._id,
  });
  if (error) return res.status(error.status).json({ success: false, message: error.message });

  if (!['scheduled', 'sending'].includes(campaign.status)) {
    return res.status(409).json({ success: false, message: 'There is nothing to cancel.' });
  }

  // A scheduled job can simply be removed. An ACTIVE one must not be — removing
  // a running job doesn't stop the loop, it just orphans it. Flipping the status
  // is what stops it, cooperatively, at its next check.
  const wasScheduled = campaign.status === 'scheduled';
  if (wasScheduled) await cancelQueuedSend(campaign.sendJobId);

  campaign.status = 'canceled';
  campaign.scheduledFor = null;
  campaign.sendJobId = undefined;
  await campaign.save();

  res.json({
    success: true,
    data: serialize(campaign),
    message: wasScheduled ? 'Scheduled send canceled.' : 'Stopping — recipients already sent to will not be re-sent.',
  });
};

/* ── Public unsubscribe ───────────────────────────────────────────────────── */
/**
 * Two endpoints, and the split is load-bearing.
 *
 * GET renders a confirmation page and changes NOTHING. Outlook Safe Links,
 * Gmail's prefetcher and corporate mail scanners fetch every URL in a message
 * on delivery — if GET performed the unsubscribe, a chunk of the list would
 * silently opt itself out the moment the blast landed.
 *
 * POST performs it, and serves both the browser form and RFC 8058 one-click.
 * That isn't a contradiction: one-click's "no confirmation step" rule binds the
 * mailbox provider, and providers only POST when they parsed
 * List-Unsubscribe-Post themselves.
 */

const unsubscribePage = ({ state, email, orgName, action }) => {
  const shell = (title, body) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:460px;margin:64px auto;background:#fff;border-radius:12px;padding:32px;text-align:center;color:#0f172a;">
    ${body}
  </div>
</body></html>`;

  if (state === 'invalid') {
    return shell(
      'Link no longer valid',
      `<h1 style="font-size:20px;margin:0 0 12px;">This link is no longer valid</h1>
       <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0;">
         It may have already been used, or the address may have been removed. No further emails will be sent if you previously unsubscribed.
       </p>`
    );
  }

  if (state === 'done') {
    return shell(
      'Unsubscribed',
      `<h1 style="font-size:20px;margin:0 0 12px;">You're unsubscribed</h1>
       <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0;">
         <strong>${escapeHtml(email)}</strong> will no longer receive emails from ${escapeHtml(orgName)}.
       </p>`
    );
  }

  return shell(
    'Unsubscribe',
    `<h1 style="font-size:20px;margin:0 0 12px;">Unsubscribe from ${escapeHtml(orgName)}?</h1>
     <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 24px;">
       <strong>${escapeHtml(email)}</strong> will stop receiving these emails.
     </p>
     <form method="POST" action="${action}">
       <button type="submit" style="background:#6366f1;color:#fff;border:0;border-radius:8px;padding:12px 28px;font-size:15px;font-weight:600;cursor:pointer;">
         Confirm unsubscribe
       </button>
     </form>`
  );
};

const resolveUnsubTarget = async (req) => {
  const { contactId, sig } = req.params;
  if (!mongoose.isValidObjectId(contactId) || !verifyUnsubToken(contactId, sig)) return null;

  return NewsletterContact.findById(contactId).populate('organization', 'name');
};

export const unsubscribeConfirmPage = async (req, res) => {
  const contact = await resolveUnsubTarget(req);
  res.type('html');

  if (!contact) return res.status(400).send(unsubscribePage({ state: 'invalid' }));

  const orgName = contact.organization?.name || 'this sender';
  if (contact.status === 'unsubscribed') {
    return res.send(unsubscribePage({ state: 'done', email: contact.email, orgName }));
  }

  return res.send(
    unsubscribePage({
      state: 'confirm',
      email: contact.email,
      orgName,
      action: `/api/newsletters/unsubscribe/${req.params.contactId}/${req.params.sig}`,
    })
  );
};

export const unsubscribeConfirm = async (req, res) => {
  const contact = await resolveUnsubTarget(req);

  // One-click providers want a plain 200; browsers want a page.
  const wantsHtml = (req.headers.accept || '').includes('text/html');

  if (!contact) {
    if (!wantsHtml) return res.status(400).json({ success: false, message: 'Invalid unsubscribe link.' });
    return res.status(400).type('html').send(unsubscribePage({ state: 'invalid' }));
  }

  const orgName = contact.organization?.name || 'this sender';
  const organizationId = contact.organization?._id || contact.organization;

  // The permanent record — org-wide, keyed on the address, outliving both the
  // contact and the campaign. Without this, the next import re-subscribes them.
  await NewsletterSuppression.findOneAndUpdate(
    { organization: organizationId, email: contact.email },
    {
      $setOnInsert: {
        organization: organizationId,
        email: contact.email,
        reason: 'unsubscribed',
        sourceCampaign: contact.campaign,
      },
    },
    { upsert: true }
  );

  // Flip every contact row in the org holding this address, not just the one
  // that was mailed. That covers other campaigns, and — because the send
  // worker only claims rows still 'pending' — it also stops an in-flight blast
  // from mailing this person again forty minutes later.
  await NewsletterContact.updateMany(
    { organization: organizationId, email: contact.email, status: { $in: ['pending', 'sent', 'failed'] } },
    { $set: { status: 'unsubscribed' } }
  );

  if (!wantsHtml) return res.json({ success: true });
  return res.type('html').send(unsubscribePage({ state: 'done', email: contact.email, orgName }));
};
