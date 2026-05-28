import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import {
  getProspects,
  getProspect,
  createProspect,
  bulkCreateProspects,
  retryPipeline,
  approveMessage,
  sendMessage,
  archiveProspect,
} from '../controllers/prospectController.js';

const router = Router();

router.use(protect);

router.get('/', getProspects);
router.post('/', createProspect);
router.post('/bulk', bulkCreateProspects);

router.get('/:id', getProspect);
router.delete('/:id', archiveProspect);
router.post('/:id/retry', retryPipeline);
router.patch('/:id/messages/:messageId/approve', approveMessage);
router.post('/:id/messages/:messageId/send', sendMessage);

export default router;
