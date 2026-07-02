import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import {
  addProspectsToList,
  archiveProspectList,
  createProspectList,
  getProspectList,
  getProspectLists,
  importProspectPreview,
  importProspectsConfirm,
  removeProspectsFromList,
  updateProspectList,
} from '../controllers/prospectListController.js';

const router = Router();

router.use(protect);

router.get('/', getProspectLists);
router.post('/', createProspectList);
router.get('/:id', getProspectList);
router.patch('/:id', updateProspectList);
router.delete('/:id', archiveProspectList);
router.post('/:id/prospects', addProspectsToList);
router.delete('/:id/prospects', removeProspectsFromList);
router.post('/:id/import-preview', importProspectPreview);
router.post('/:id/import-confirm', importProspectsConfirm);

export default router;
