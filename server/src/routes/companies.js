import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import {
  createCompany,
  deleteCompany,
  getCompanies,
  getCompany,
  updateCompany,
} from '../controllers/companyController.js';

const router = Router();

router.use(protect);

router.get('/', getCompanies);
router.post('/', createCompany);
router.get('/:id', getCompany);
router.patch('/:id', updateCompany);
router.delete('/:id', deleteCompany);

export default router;
