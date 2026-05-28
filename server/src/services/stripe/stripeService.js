import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const PLANS = {
  free: { name: 'Free', prospects: 50, price: 0 },
  pro: { name: 'Pro', prospects: 500, price: 49 },
  enterprise: { name: 'Enterprise', prospects: Infinity, price: 199 },
};

export const createCheckoutSession = async ({ organizationId, plan, userId, successUrl, cancelUrl }) => {
  const priceId = plan === 'pro' ? process.env.STRIPE_PRO_PRICE_ID : process.env.STRIPE_ENTERPRISE_PRICE_ID;

  return stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { organizationId: organizationId.toString(), userId: userId.toString(), plan },
  });
};

export const createBillingPortalSession = async ({ stripeCustomerId, returnUrl }) => {
  return stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  });
};

export const handleWebhook = async (payload, sig) => {
  return stripe.webhooks.constructEvent(payload, sig, process.env.STRIPE_WEBHOOK_SECRET);
};

export default stripe;
