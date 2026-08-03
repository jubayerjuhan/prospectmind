import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { getSources, browseCompanies, getCompanyDetail, saveCompany } from '../controllers/companyFinderController.js';

const router = Router();

router.use(protect);

router.get('/sources', getSources);
router.get('/companies', browseCompanies);
router.get('/companies/:source/:slug', getCompanyDetail);
router.post('/companies/:source/:slug/save', saveCompany);

export default router;
