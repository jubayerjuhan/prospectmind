import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { transcribe } from '../controllers/aiController.js';

const router = Router();
router.use(protect);

router.post('/transcribe', transcribe);

export default router;
