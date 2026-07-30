import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, ArrowRight, X } from 'lucide-react';
import api from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';

// The scraper shares ONE LinkedIn identity across the whole platform, so when
// that session dies every enrichment fails at the same step with the same
// error. Until now the only signals were an email alert and the Settings page —
// neither of which a user sees while wondering why a pipeline just failed. This
// surfaces the state on every page, with the fix one click away.
export default function LinkedInSessionBanner() {
  const [dismissed, setDismissed] = useState(false);
  const location = useLocation();
  const role = useAuthStore((s) => s.user?.role);
  // GET /organization/linkedin-session is owner/admin only — don't fire a call
  // that can only 403 for everyone else.
  const canManage = role === 'owner' || role === 'admin';

  // Same queryKey as SettingsPage, so the two share a cache entry and a refresh
  // there clears this banner immediately.
  const { data } = useQuery({
    queryKey: ['organization', 'linkedin-session'],
    queryFn: () => api.get('/organization/linkedin-session').then((r) => r.data.data),
    enabled: canManage,
    retry: false,
    refetchInterval: 60000,
  });

  if (!canManage || dismissed || !data) return null;
  if (data.status === 'active') return null;
  // Settings already shows this state inline, next to the controls that fix it.
  if (location.pathname.startsWith('/settings')) return null;

  const neverConfigured = data.status !== 'dead';

  return (
    <div className="mb-6 rounded-xl border border-amber-800/50 bg-amber-950/30 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="text-amber-200 font-semibold text-sm">
            {neverConfigured
              ? 'LinkedIn session is not configured'
              : 'LinkedIn session has expired'}
          </h3>
          <p className="text-amber-200/70 text-sm mt-1 leading-relaxed">
            Prospect enrichment needs an authenticated LinkedIn session and will fail at the
            profile-scraping step until this is fixed. Anything you run in the meantime will stop
            with a “could not be authenticated” error.
          </p>
          <p className="text-amber-200/70 text-sm mt-2 leading-relaxed">
            <span className="text-amber-200/90 font-medium">To fix it: </span>
            open Settings → LinkedIn Session and paste a fresh{' '}
            <code className="bg-amber-900/40 px-1 rounded text-amber-100">li_at</code> cookie from a
            browser where you are logged into LinkedIn. If LinkedIn is showing a checkpoint or
            captcha that the cookie can’t get past, use <span className="text-amber-200/90">Live Login</span>{' '}
            on the same page to drive a real browser instead.
          </p>
          <Link
            to="/settings"
            className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-700/50 text-amber-200 text-sm font-medium transition"
          >
            Fix in Settings <ArrowRight size={14} />
          </Link>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-amber-500/60 hover:text-amber-300 transition shrink-0"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
