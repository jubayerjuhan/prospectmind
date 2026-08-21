import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import {
  listNewsletters,
  createNewsletter,
  getNewsletter,
  updateNewsletter,
  archiveNewsletter,
  listContacts,
  addContact,
  importContacts,
  removeContacts,
  previewNewsletter,
  sendNewsletter,
  scheduleNewsletter,
  cancelNewsletter,
  unsubscribeConfirmPage,
  unsubscribeConfirm,
} from '../controllers/newsletterController.js';

const router = Router();

/* ═══════════════════════════════════════════════════════════════════════════
 * PUBLIC — no authentication. These MUST stay above router.use(protect).
 *
 * A recipient clicking Unsubscribe in their mail client has no account and no
 * token; authority comes from the HMAC in the URL instead. Do not add anything
 * else in this block, and do not move `protect` below it.
 *
 * GET only renders a confirmation page. It must never mutate: Outlook Safe
 * Links and Gmail's prefetcher fetch every URL in a delivered email, so a
 * GET-unsubscribes design would opt out part of the list on delivery.
 * ═══════════════════════════════════════════════════════════════════════════ */
router.get('/unsubscribe/:contactId/:sig', unsubscribeConfirmPage);
router.post('/unsubscribe/:contactId/:sig', unsubscribeConfirm);

/* ═══════════════════════════════════════════════════════════════════════════
 * Everything below is authenticated and org-scoped.
 * ═══════════════════════════════════════════════════════════════════════════ */
router.use(protect);

router.get('/', listNewsletters);
router.post('/', createNewsletter);
router.get('/:id', getNewsletter);
router.patch('/:id', updateNewsletter);
router.delete('/:id', archiveNewsletter);

router.get('/:id/contacts', listContacts);
router.post('/:id/contacts', addContact);
router.post('/:id/contacts/import', importContacts);
router.delete('/:id/contacts', removeContacts);

router.get('/:id/preview', previewNewsletter);
router.post('/:id/send', sendNewsletter);
router.post('/:id/schedule', scheduleNewsletter);
router.post('/:id/cancel', cancelNewsletter);

export default router;
