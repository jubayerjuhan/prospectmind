import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import {
  getCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  archiveCampaign,
  runCampaign,
  pauseCampaign,
  resumeCampaign,
  getCampaignStatus,
  generateKeywordsPreview
} from '../controllers/githubTalentController.js';

const router = Router();

router.use(protect);

router.get('/', getCampaigns);
router.post('/', createCampaign);
router.post('/keywords-preview', generateKeywordsPreview);
router.get('/:id', getCampaign);
router.patch('/:id', updateCampaign);
router.delete('/:id', archiveCampaign);
router.post('/:id/run', runCampaign);
router.post('/:id/pause', pauseCampaign);
router.post('/:id/resume', resumeCampaign);
router.get('/:id/status', getCampaignStatus);

export default router;
