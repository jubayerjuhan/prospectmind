import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import Organization from '../models/Organization.js';
import {
  createCheckoutSession,
  createBillingPortalSession,
  handleWebhook,
  PLANS,
} from '../services/stripe/stripeService.js';

const router = Router();

// GET /api/billing/plans
router.get('/plans', (req, res) => {
  res.json({ success: true, data: PLANS });
});

// POST /api/billing/checkout
router.post('/checkout', protect, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!['pro', 'enterprise'].includes(plan)) {
      return res.status(400).json({ success: false, message: 'Invalid plan.' });
    }

    const session = await createCheckoutSession({
      organizationId: req.organization._id,
      plan,
      userId: req.user._id,
      successUrl: `${process.env.CLIENT_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${process.env.CLIENT_URL}/billing`,
    });

    res.json({ success: true, url: session.url });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/billing/portal
router.post('/portal', protect, async (req, res) => {
  try {
    if (!req.organization.stripeCustomerId) {
      return res.status(400).json({ success: false, message: 'No billing account found.' });
    }

    const session = await createBillingPortalSession({
      stripeCustomerId: req.organization.stripeCustomerId,
      returnUrl: `${process.env.CLIENT_URL}/billing`,
    });

    res.json({ success: true, url: session.url });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/billing/webhook  (raw body needed — set up in app.js)
router.post('/webhook', async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    const event = await handleWebhook(req.body, sig);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const { organizationId, plan } = session.metadata;

      await Organization.findByIdAndUpdate(organizationId, {
        plan,
        planStatus: 'active',
        stripeCustomerId: session.customer,
        stripeSubscriptionId: session.subscription,
      });
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      await Organization.findOneAndUpdate(
        { stripeSubscriptionId: sub.id },
        { plan: 'free', planStatus: 'canceled' }
      );
    }

    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      await Organization.findOneAndUpdate(
        { stripeCustomerId: invoice.customer },
        { planStatus: 'past_due' }
      );
    }

    res.json({ received: true });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

export default router;
