import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import {
  addProspectsToList,
  addAndCreateProspect,
  bulkImportProspectsToList,
  archiveProspectList,
  createProspectList,
  getProspectList,
  getProspectLists,
  importProspectPreview,
  importProspectsConfirm,
  removeProspectsFromList,
  updateProspectList,
  startCampaign,
  pauseCampaign,
  resumeCampaign,
  getCampaignOutreach,
  generateCampaignOutreach,
} from '../controllers/prospectListController.js';

const router = Router();

router.use(protect);

router.get('/', getProspectLists);
router.post('/', createProspectList);
router.get('/:id', getProspectList);
router.patch('/:id', updateProspectList);
router.delete('/:id', archiveProspectList);
router.post('/:id/prospects', addProspectsToList);
router.post('/:id/add-and-create', addAndCreateProspect);
router.post('/:id/prospects/bulk-import', bulkImportProspectsToList);
router.delete('/:id/prospects', removeProspectsFromList);
router.post('/:id/import-preview', importProspectPreview);
router.post('/:id/import-confirm', importProspectsConfirm);
router.get('/:id/outreach', getCampaignOutreach);
router.post('/:id/outreach/generate', generateCampaignOutreach);
router.post('/:id/start', startCampaign);
router.post('/:id/pause', pauseCampaign);
router.post('/:id/resume', resumeCampaign);

export default router;
