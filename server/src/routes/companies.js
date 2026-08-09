import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import {
  analyzeCompanyHandler,
  detectSignalsHandler,
  findContactsHandler,
  findLinkedinHandler,
  findProspectsHandler,
  importProspectsHandler,
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
router.post('/:id/find-contacts', findContactsHandler);
router.post('/:id/find-linkedin', findLinkedinHandler);
router.post('/:id/find-prospects', findProspectsHandler);
router.post('/:id/import-prospects', importProspectsHandler);
router.delete('/:id', deleteCompany);

export default router;
