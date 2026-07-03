import { Router } from 'express';
import authRoutes from './auth.js';
import prospectRoutes from './prospects.js';
import prospectListRoutes from './prospectLists.js';
import billingRoutes from './billing.js';
import organizationRoutes from './organization.js';
import githubTalentRoutes from './githubTalent.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/prospects', prospectRoutes);
router.use('/prospect-lists', prospectListRoutes);
router.use('/billing', billingRoutes);
router.use('/organization', organizationRoutes);
router.use('/github-talent', githubTalentRoutes);

router.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

export default router;
