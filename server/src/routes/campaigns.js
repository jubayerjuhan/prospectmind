import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import {
  createCampaign,
  deleteCampaign,
  executeCampaignHandler,
  getCampaign,
  getCampaigns,
  updateCampaign,
} from '../controllers/campaignController.js';

const router = Router();

router.use(protect);

router.get('/', getCampaigns);
router.post('/', createCampaign);
router.get('/:id', getCampaign);
router.patch('/:id', updateCampaign);
router.post('/:id/execute', executeCampaignHandler);
router.delete('/:id', deleteCampaign);

export default router;
