import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useLocation } from 'react-router-dom';
import { AlertTriangle, ArrowRight, X, KeyRound, MonitorPlay } from 'lucide-react';
import api from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';

// Dismissal is keyed to the failure event, not to a boolean, and persisted so
// it survives navigation and reload. "Closed" therefore means "closed for THIS
// failure" — the next pipeline run that hits the dead session writes a newer
// lastFailureAt, the key stops matching, and the modal returns. A plain boolean
// would let a user dismiss it once and never be warned again.
const STORAGE_KEY = 'pm-linkedin-session-alert-dismissed';

// What the user was most likely doing when the session died, so the modal opens
// by naming the thing that just broke rather than a generic warning.
const CONTEXT_COPY = {
  'prospect-enrichment': {
    label: 'Prospect enrichment',
    detail:
      'A prospect enrichment just stopped at the LinkedIn profile step. That run failed and will need to be retried once the session is restored.',
  },
  'company-analysis': {
    label: 'Company enrichment',
    detail:
      "A company enrichment just fell back to plain web research because it couldn't read the company's LinkedIn page. It still produced a result, but a weaker one than normal.",
  },
  'company-linkedin-search': {
    label: 'Company LinkedIn lookup',
    detail:
      "A company LinkedIn lookup couldn't verify its candidates against their real About pages, so it fell back to text-only matching — which is measurably more likely to pick the wrong company.",
  },
  // Not a failure — someone disconnected it on purpose. Still worth surfacing
  // once they navigate off Settings, since enrichment is now degraded.
  'manual-revoke': {
    label: 'Disconnected from Settings',
    detail:
      'The LinkedIn session was disconnected manually. Enrichment stays degraded until a new session is connected.',
  },
};

export default function LinkedInSessionModal() {
  const navigate = useNavigate();
  const location = useLocation();
  const role = useAuthStore((s) => s.user?.role);
  // GET /organization/linkedin-session is owner/admin only — don't fire a call
  // that can only 403 for everyone else.
  const canManage = role === 'owner' || role === 'admin';

  const [dismissedKey, setDismissedKey] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null; // private mode / storage disabled — modal simply won't persist
    }
  });

  // Same queryKey as SettingsPage and the banner, so all three share one cache
  // entry and a successful refresh in Settings closes this immediately.
  const { data } = useQuery({
    queryKey: ['organization', 'linkedin-session'],
    queryFn: () => api.get('/organization/linkedin-session').then((r) => r.data.data),
    enabled: canManage,
    retry: false,
    refetchInterval: 60000,
  });

  const isDown = Boolean(data) && data.status !== 'active';
  // Falls back to updatedAt so a session that is down but has never tripped a
  // pipeline still gets exactly one dismissible modal.
  const eventKey = String(data?.lastFailureAt || data?.updatedAt || 'unset');
  // Settings already shows this state inline, right next to the controls that
  // fix it — blocking that page with a modal would cover the fix itself.
  const onSettings = location.pathname.startsWith('/settings');
  const open = canManage && isDown && !onSettings && dismissedKey !== eventKey;

  const close = () => {
    try {
      localStorage.setItem(STORAGE_KEY, eventKey);
    } catch {
      // Non-fatal: dismissal just won't survive a reload.
    }
    setDismissedKey(eventKey);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    // The modal is an interrupt over a scrollable app shell; letting the page
    // behind it scroll makes it read as a floating card rather than a stop.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
    // close() reads nothing but eventKey, so these two are the full dependency
    // set — re-running on every render would rebind the listener needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, eventKey]);

  if (!open) return null;

  const neverConfigured = data.status !== 'dead';
  const context = CONTEXT_COPY[data.lastFailureContext] || null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="linkedin-session-modal-title"
        className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-2xl border border-amber-900/60 bg-slate-900 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4 p-6 pb-4 shrink-0">
          <div className="w-11 h-11 shrink-0 rounded-xl bg-amber-500/10 ring-1 ring-amber-500/25 flex items-center justify-center">
            <AlertTriangle size={20} className="text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="linkedin-session-modal-title" className="text-white text-lg font-bold leading-snug">
              {neverConfigured
                ? 'LinkedIn session is not configured'
                : 'Your LinkedIn session has expired'}
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              You need to log in to LinkedIn again before enrichment can work properly.
            </p>
          </div>
          <button
            onClick={close}
            className="text-slate-600 hover:text-slate-300 transition shrink-0"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Only the explanatory body scrolls — the actions below stay pinned, so
            the fix is one click away even on a short laptop viewport. */}
        <div className="px-6 pb-2 space-y-4 overflow-y-auto">
          {context && (
            <div className="rounded-xl border border-amber-900/50 bg-amber-950/25 p-3.5">
              <p className="text-amber-300 text-[11px] font-semibold uppercase tracking-wide">
                {context.label} — just now
              </p>
              <p className="text-amber-200/80 text-sm mt-1.5 leading-relaxed">{context.detail}</p>
            </div>
          )}

          <div>
            <h3 className="text-slate-200 text-sm font-semibold">What's happening</h3>
            <p className="text-slate-400 text-sm mt-1.5 leading-relaxed">
              ProspectMind uses one shared LinkedIn login to read profiles and company pages. That
              login is no longer authenticated{' '}
              {neverConfigured
                ? 'because it has never been set up.'
                : "— usually because LinkedIn expired the cookie or threw a security checkpoint."}{' '}
              Until it's restored, prospect enrichment will fail at the profile step, and company
              enrichment will fall back to weaker web-only research.
            </p>
          </div>

          <div>
            <h3 className="text-slate-200 text-sm font-semibold">How to fix it</h3>
            <ol className="mt-2 space-y-2.5">
              <li className="flex gap-3">
                <KeyRound size={15} className="text-indigo-400 shrink-0 mt-0.5" />
                <p className="text-slate-400 text-sm leading-relaxed">
                  <span className="text-slate-200 font-medium">Paste a fresh cookie.</span> Open{' '}
                  <span className="text-slate-300">Settings → LinkedIn Session</span>. In a browser
                  where you're logged into LinkedIn, open DevTools → Application → Cookies →{' '}
                  <code className="bg-slate-800 px-1 rounded text-slate-300">
                    https://www.linkedin.com
                  </code>
                  , copy the value of{' '}
                  <code className="bg-slate-800 px-1 rounded text-slate-300">li_at</code>, and paste
                  it there.
                </p>
              </li>
              <li className="flex gap-3">
                <MonitorPlay size={15} className="text-indigo-400 shrink-0 mt-0.5" />
                <p className="text-slate-400 text-sm leading-relaxed">
                  <span className="text-slate-200 font-medium">Or use Live Login.</span> If LinkedIn
                  is showing a checkpoint or captcha the cookie can't get past, use{' '}
                  <span className="text-slate-300">Live Login</span> on the same page to drive a
                  real browser and clear the challenge by hand.
                </p>
              </li>
            </ol>
          </div>

        </div>

        <div className="flex flex-col gap-2 px-6 pb-6 pt-4 shrink-0 border-t border-slate-800/80">
          <button
            onClick={() => {
              close();
              navigate('/settings');
            }}
            className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium transition"
          >
            Go to Settings <ArrowRight size={15} />
          </button>
          <button
            onClick={close}
            className="w-full py-2.5 text-slate-500 hover:text-slate-300 text-sm transition"
          >
            Dismiss for now
          </button>
        </div>
      </div>
    </div>
  );
}
