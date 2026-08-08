import { Router } from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import Organization from '../models/Organization.js';
import LinkedInSession from '../models/LinkedInSession.js';
import { refreshLinkedInSessionFromCookie } from '../services/scraper/linkedinScraper.js';
import * as linkedinLiveLogin from '../services/scraper/linkedinLiveLogin.js';

const router = Router();
router.use(protect);

// GET /api/organization/me
router.get('/me', async (req, res) => {
  try {
    const org = await Organization.findById(req.organization._id).populate('members.user', 'name email avatar');
    res.json({ success: true, data: org });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PATCH /api/organization/me
router.patch('/me', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const allowed = ['name', 'settings'];
    const updates = Object.keys(req.body)
      .filter((k) => allowed.includes(k))
      .reduce((acc, k) => ({ ...acc, [k]: req.body[k] }), {});

    const org = await Organization.findByIdAndUpdate(req.organization._id, updates, { new: true });
    res.json({ success: true, data: org });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/organization/usage
router.get('/usage', async (req, res) => {
  try {
    const org = req.organization;
    res.json({
      success: true,
      data: {
        plan: org.plan,
        planStatus: org.planStatus,
        used: org.usage.prospectsThisMonth,
        limit: org.getProspectLimit(),
        percentUsed: Math.round((org.usage.prospectsThisMonth / org.getProspectLimit()) * 100),
        resetsAt: org.usage.lastResetAt,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/organization/linkedin-session — status for the Settings page
router.get('/linkedin-session', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const session = await LinkedInSession.findOne({})
      .select('status lastVerifiedAt updatedAt updatedBy lastFailureAt lastFailureContext')
      .populate('updatedBy', 'name email');
    res.json({ success: true, data: session || { status: 'unset' } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/organization/linkedin-session — refresh from a pasted li_at cookie
router.post('/linkedin-session', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { liAt, jsessionId } = req.body;
    if (!liAt || typeof liAt !== 'string' || liAt.trim().length < 20) {
      return res.status(400).json({ success: false, message: 'A valid li_at cookie value is required.' });
    }

    const result = await refreshLinkedInSessionFromCookie({
      liAt: liAt.trim(),
      jsessionId: jsessionId?.trim() || null,
      updatedBy: req.user._id,
    });

    if (!result.ok) {
      return res.status(400).json({ success: false, message: result.message || 'That cookie did not authenticate.' });
    }
    res.json({ success: true, message: 'LinkedIn session refreshed and verified.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/organization/linkedin-session — disconnect the shared session
// Drops the stored cookie jar so the scraper has nothing to authenticate with.
// Genuinely destructive: the jar is the self-refreshing session LinkedIn has
// been rotating, and it cannot be restored — reconnecting means pasting a fresh
// li_at or running Live Login. Use it to hand back access, or to force the
// dead-session state deliberately.
router.delete('/linkedin-session', requireRole('owner', 'admin'), async (req, res) => {
  try {
    // Stop the live-login browser too, if one is up — leaving it running against
    // a session we just revoked would silently re-save a jar moments later.
    await linkedinLiveLogin.stop().catch(() => null);

    await LinkedInSession.findOneAndUpdate(
      {},
      {
        cookies: null,
        seedLiAt: null,
        status: 'dead',
        updatedBy: req.user._id,
        lastFailureAt: new Date(),
        lastFailureContext: 'manual-revoke',
        $unset: { lastVerifiedAt: '' },
      },
      { upsert: true }
    );

    res.json({ success: true, message: 'LinkedIn session disconnected.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ── Live LinkedIn Login (streamed, headless-server-safe interactive login) ──
// Starts a real, visible Chrome inside the production container (see
// linkedinLiveLogin.js) that an owner/admin drives remotely over VNC,
// streamed into the Settings page via vncBridge.js. Use this when the
// cookie-paste flow above can't help — e.g. LinkedIn threw a checkpoint/
// captcha that only an interactive session can clear.

// POST /api/organization/linkedin-session/live — start (idempotent)
router.post('/linkedin-session/live', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const status = await linkedinLiveLogin.start();
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/organization/linkedin-session/live — status poll
router.get('/linkedin-session/live', requireRole('owner', 'admin'), (req, res) => {
  res.json({ success: true, data: linkedinLiveLogin.getStatus() });
});

// DELETE /api/organization/linkedin-session/live — cancel/stop
router.delete('/linkedin-session/live', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const status = await linkedinLiveLogin.stop();
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
