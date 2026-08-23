import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import {
  getProspects,
  getProspect,
  createProspect,
  updateProspect,
  bulkCreateProspects,
  startPipeline,
  pausePipeline,
  resumePipeline,
  approveMessage,
  sendMessage,
  archiveProspect,
  generateMessages,
} from '../controllers/prospectController.js';

const router = Router();

router.use(protect);

router.get('/', getProspects);
router.post('/', createProspect);
router.post('/bulk', bulkCreateProspects);

router.get('/:id', getProspect);
router.patch('/:id', updateProspect);
router.delete('/:id', archiveProspect);
router.post('/:id/start', startPipeline);   // first run — prospects are created 'not-started'
router.post('/:id/retry', startPipeline);   // same operation, different wording to the user
router.post('/:id/pause', pausePipeline);
router.post('/:id/resume', resumePipeline);
router.patch('/:id/messages/:messageId/approve', approveMessage);
router.post('/:id/messages/:messageId/send', sendMessage);
router.post('/:id/generate-messages', generateMessages);

export default router;
