import { Router } from 'express';
import { protect, apiKeyOrProtect } from '../middleware/auth.js';
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
  exportCampaignOutreach,
  getCampaignOutreachLeads,
  startLemlistPush,
  getLemlistPushStatus,
  getLemlistPushPreview,
} from '../controllers/prospectListController.js';

const router = Router();

// Mounted BEFORE the blanket protect: this is the one route an external
// integration (lemlist) calls, so it accepts an organization API key as well as
// a session. Everything below stays session-only.
router.get('/:id/outreach/leads', apiKeyOrProtect, getCampaignOutreachLeads);

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
router.get('/:id/outreach/export', exportCampaignOutreach);
router.get('/:id/lemlist-push/preview', getLemlistPushPreview);
router.post('/:id/lemlist-push', startLemlistPush);
router.get('/:id/lemlist-push', getLemlistPushStatus);
router.post('/:id/start', startCampaign);
router.post('/:id/pause', pauseCampaign);
router.post('/:id/resume', resumeCampaign);

export default router;
