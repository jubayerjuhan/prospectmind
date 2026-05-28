import { useQuery, useMutation } from '@tanstack/react-query';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';
import { CheckCircle } from 'lucide-react';

const PLAN_FEATURES = {
  free: ['50 prospects / month', 'AI enrichment + classification', 'Message generation', '1 workspace'],
  pro: ['500 prospects / month', 'Everything in Free', 'CSV bulk import', 'Priority pipeline', 'Email sending via Resend'],
  enterprise: ['Unlimited prospects', 'Everything in Pro', 'Custom integrations', 'Dedicated support', 'SLA guarantee'],
};

export default function BillingPage() {
  const organization = useAuthStore((s) => s.organization);

  const { data: usageData } = useQuery({
    queryKey: ['usage'],
    queryFn: () => api.get('/organization/usage').then((r) => r.data.data),
  });

  const checkoutMutation = useMutation({
    mutationFn: (plan) => api.post('/billing/checkout', { plan }).then((r) => r.data),
    onSuccess: (data) => { window.location.href = data.url; },
    onError: (err) => toast.error(err.response?.data?.message || 'Checkout failed'),
  });

  const portalMutation = useMutation({
    mutationFn: () => api.post('/billing/portal').then((r) => r.data),
    onSuccess: (data) => { window.location.href = data.url; },
    onError: (err) => toast.error(err.response?.data?.message || 'Could not open billing portal'),
  });

  const currentPlan = usageData?.plan || 'free';

  const plans = [
    { key: 'free', name: 'Free', price: '$0', period: 'forever' },
    { key: 'pro', name: 'Pro', price: '$49', period: 'per month' },
    { key: 'enterprise', name: 'Enterprise', price: '$199', period: 'per month' },
  ];

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-white text-2xl font-bold">Billing & Plans</h1>
        <p className="text-slate-400 mt-1">
          Current plan: <span className="text-indigo-400 capitalize font-medium">{currentPlan}</span>
          {usageData && ` · ${usageData.used}/${usageData.limit === Infinity ? '∞' : usageData.limit} prospects used this month`}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map(({ key, name, price, period }) => {
          const isCurrent = key === currentPlan;
          return (
            <div
              key={key}
              className={`bg-slate-900 border rounded-xl p-6 flex flex-col ${
                isCurrent ? 'border-indigo-500' : 'border-slate-800'
              }`}
            >
              <div className="mb-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-white font-semibold">{name}</h3>
                  {isCurrent && <span className="text-xs bg-indigo-600 text-white px-2 py-0.5 rounded-full">Current</span>}
                </div>
                <div className="mt-2">
                  <span className="text-white text-2xl font-bold">{price}</span>
                  <span className="text-slate-500 text-sm ml-1">{period}</span>
                </div>
              </div>

              <ul className="space-y-2 flex-1 mb-5">
                {PLAN_FEATURES[key].map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-400">
                    <CheckCircle size={14} className="text-green-500 mt-0.5 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>

              {key !== 'free' && !isCurrent && (
                <button
                  onClick={() => checkoutMutation.mutate(key)}
                  disabled={checkoutMutation.isPending}
                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition"
                >
                  Upgrade to {name}
                </button>
              )}
              {isCurrent && key !== 'free' && (
                <button
                  onClick={() => portalMutation.mutate()}
                  disabled={portalMutation.isPending}
                  className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-sm transition"
                >
                  Manage subscription
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
