import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import Playbook from '../models/Playbook.js';
import { makePromptSettingController } from '../controllers/promptSettingController.js';

const ctrl = makePromptSettingController(Playbook, 'Playbook');

const router = Router();

router.use(protect);

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.get('/:id', ctrl.getOne);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

export default router;
