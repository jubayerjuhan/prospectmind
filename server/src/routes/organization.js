import { Router } from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import Organization from '../models/Organization.js';

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

export default router;
