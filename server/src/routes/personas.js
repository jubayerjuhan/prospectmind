import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import {
  createPersona,
  deletePersona,
  getPersona,
  getPersonas,
  updatePersona,
} from '../controllers/personaController.js';

const router = Router();

router.use(protect);

router.get('/', getPersonas);
router.post('/', createPersona);
router.get('/:id', getPersona);
router.patch('/:id', updatePersona);
router.delete('/:id', deletePersona);

export default router;
