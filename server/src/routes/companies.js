import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import {
  analyzeCompanyHandler,
  detectSignalsHandler,
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
router.post('/:id/analyze', analyzeCompanyHandler);
router.post('/:id/detect-signals', detectSignalsHandler);
router.delete('/:id', deleteCompany);

export default router;
