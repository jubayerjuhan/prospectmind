import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { Save, Settings, Shield, Zap, Loader2, KeyRound, RefreshCw, ChevronDown, Monitor, X, Unplug } from 'lucide-react';
import RFB from '@novnc/novnc';
import { useAuthStore } from '../stores/authStore';
import PersonasSettings from '../components/settings/PersonasSettings';
import PlaybooksSettings from '../components/settings/PlaybooksSettings';
import SignalsSettings from '../components/settings/SignalsSettings';
import ApiKeySettings from '../components/settings/ApiKeySettings';
import LemlistSettings from '../components/settings/LemlistSettings';

// Live Login streams a real browser over VNC-over-WebSocket, bridged by
// server/src/services/scraper/vncBridge.js at the same path/origin as the
// REST API — just swap the scheme and hand the JWT as a query param, since a
// browser WebSocket can't set an Authorization header.
const buildVncUrl = (token) => {
  const httpBase = api.defaults.baseURL || 'http://localhost:5001/api';
  const wsBase = httpBase.replace(/^http/i, 'ws');
  return `${wsBase}/organization/linkedin-session/live/vnc?token=${encodeURIComponent(token)}`;
};

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canManageLinkedInSession = user?.role === 'owner' || user?.role === 'admin';
  // Same roles, named for what it gates — the server enforces it with
  // requireRole('owner', 'admin') on the /organization/api-key routes.
  const canManageApiKey = user?.role === 'owner' || user?.role === 'admin';

  // Settings local state
  const [name, setName] = useState('');
  const [autoEnrich, setAutoEnrich] = useState(false);
  const [outreachReviewRequired, setOutreachReviewRequired] = useState(true);

  // LinkedIn session refresh state
  const [liAt, setLiAt] = useState('');
  const [jsessionId, setJsessionId] = useState('');
  const [showJsessionField, setShowJsessionField] = useState(false);
  // Disconnecting drops a cookie jar that can't be restored, so it takes a
  // second, deliberate click rather than firing straight off the first one.
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const linkedInSessionQuery = useQuery({
    queryKey: ['organization', 'linkedin-session'],
    queryFn: () => api.get('/organization/linkedin-session').then((r) => r.data.data),
    enabled: canManageLinkedInSession,
  });

  const refreshSessionMutation = useMutation({
    mutationFn: () => api.post('/organization/linkedin-session', { liAt, jsessionId: jsessionId || undefined }),
    onSuccess: () => {
      toast.success('LinkedIn session refreshed and verified.');
      setLiAt('');
      setJsessionId('');
      queryClient.invalidateQueries(['organization', 'linkedin-session']);
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || 'Failed to refresh LinkedIn session.');
    },
  });

  const disconnectSessionMutation = useMutation({
    mutationFn: () => api.delete('/organization/linkedin-session'),
    onSuccess: () => {
      toast.success('LinkedIn session disconnected.');
      setConfirmDisconnect(false);
      queryClient.invalidateQueries(['organization', 'linkedin-session']);
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || 'Failed to disconnect LinkedIn session.');
    },
  });

  // Live Login — streamed interactive browser (see buildVncUrl above)
  const [liveLoginOpen, setLiveLoginOpen] = useState(false);
  const liveCanvasRef = useRef(null);
  const rfbRef = useRef(null);

  const closeLivePanel = () => {
    rfbRef.current?.disconnect();
    rfbRef.current = null;
    setLiveLoginOpen(false);
  };

  const startLiveMutation = useMutation({
    mutationFn: () => api.post('/organization/linkedin-session/live'),
    onSuccess: () => setLiveLoginOpen(true),
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to start live login.'),
  });

  const stopLiveMutation = useMutation({
    mutationFn: () => api.delete('/organization/linkedin-session/live'),
    onSuccess: () => closeLivePanel(),
  });

  const liveStatusQuery = useQuery({
    queryKey: ['organization', 'linkedin-session', 'live'],
    queryFn: () => api.get('/organization/linkedin-session/live').then((r) => r.data.data),
    enabled: liveLoginOpen,
    refetchInterval: liveLoginOpen ? 3000 : false,
  });

  // React to status changes coming back from the poll above
  useEffect(() => {
    const status = liveStatusQuery.data?.status;
    if (!liveLoginOpen || !status) return;
    if (status === 'success') {
      toast.success('LinkedIn session refreshed and verified.');
      queryClient.invalidateQueries(['organization', 'linkedin-session']);
      closeLivePanel();
    } else if (status === 'timeout' || status === 'failed') {
      toast.error(status === 'timeout' ? 'Live login timed out.' : 'Live login failed.');
      closeLivePanel();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveStatusQuery.data?.status, liveLoginOpen]);

  // Mount the RFB (VNC) client onto the canvas div once the panel is open
  useEffect(() => {
    if (!liveLoginOpen || !liveCanvasRef.current || rfbRef.current) return;
    const token = useAuthStore.getState().accessToken;
    const rfb = new RFB(liveCanvasRef.current, buildVncUrl(token));
    rfb.scaleViewport = true;
    rfb.resizeSession = false;
    rfbRef.current = rfb;
    return () => {
      rfb.disconnect();
      if (rfbRef.current === rfb) rfbRef.current = null;
    };
  }, [liveLoginOpen]);

  // Fetch organization settings
  const { data: orgData, isLoading } = useQuery({
    queryKey: ['organization', 'me'],
    queryFn: () => api.get('/organization/me').then((r) => r.data.data),
  });

  // Populate state once data is loaded
  useEffect(() => {
    if (orgData) {
      setName(orgData.name || '');
      if (orgData.settings) {
        setAutoEnrich(!!orgData.settings.autoEnrich);
        setOutreachReviewRequired(orgData.settings.outreachReviewRequired !== false);
      }
    }
  }, [orgData]);

  // Mutation to save settings
  const saveMutation = useMutation({
    mutationFn: (updates) => api.patch('/organization/me', updates),
    onSuccess: (res) => {
      toast.success('Settings updated successfully!');
      queryClient.invalidateQueries(['organization', 'me']);
      queryClient.invalidateQueries(['usage']);
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || 'Failed to update settings');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    saveMutation.mutate({
      name,
      settings: {
        autoEnrich,
        outreachReviewRequired,
      },
    });
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        <p className="text-slate-400 text-sm">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-white text-2xl font-bold flex items-center gap-2">
          <Settings className="text-indigo-400" size={24} />
          Organization Settings
        </h1>
        <p className="text-slate-400 mt-1">
          Configure your workspace name and AI pipeline defaults
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        
        {/* Workspace Info Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <h2 className="text-white font-semibold text-base flex items-center gap-2 border-b border-slate-800 pb-3">
            <Shield size={18} className="text-indigo-400" />
            General Information
          </h2>
          <div>
            <label className="block text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
              Organization Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-indigo-500 transition"
              placeholder="e.g. Acme Recruiting"
            />
          </div>
        </div>

        {/* Pipeline Preferences Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
          <h2 className="text-white font-semibold text-base flex items-center gap-2 border-b border-slate-800 pb-3">
            <Zap size={18} className="text-indigo-400" />
            AI Pipeline Defaults
          </h2>

          <div className="bg-indigo-950/20 border border-indigo-900/40 rounded-lg p-3 text-xs text-indigo-300 leading-relaxed">
            <strong>Note:</strong> Campaign-specific goals and ecosystem context are now configured <strong>per-campaign</strong> inside the Campaigns page. The settings below apply globally across all pipeline runs.
          </div>

          <div className="space-y-3 pt-2">
            {/* Auto-enrich toggle */}
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={autoEnrich}
                onChange={(e) => setAutoEnrich(e.target.checked)}
                className="mt-1 w-4 h-4 rounded text-indigo-600 bg-slate-800 border-slate-700 focus:ring-indigo-500 focus:ring-offset-slate-900 focus:ring-2"
              />
              <div>
                <p className="text-white text-sm font-medium group-hover:text-indigo-300 transition">
                  Auto-Enrich Prospects
                </p>
                <p className="text-slate-500 text-xs mt-0.5">
                  Automatically start the enrichment pipeline as soon as a prospect is manually added or imported.
                </p>
              </div>
            </label>

            {/* Review required toggle */}
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={outreachReviewRequired}
                onChange={(e) => setOutreachReviewRequired(e.target.checked)}
                className="mt-1 w-4 h-4 rounded text-indigo-600 bg-slate-800 border-slate-700 focus:ring-indigo-500 focus:ring-offset-slate-900 focus:ring-2"
              />
              <div>
                <p className="text-white text-sm font-medium group-hover:text-indigo-300 transition">
                  Require Outreach Review
                </p>
                <p className="text-slate-500 text-xs mt-0.5">
                  Keep outreach messages in draft state until manually edited and approved before sending.
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* LinkedIn Session Card (owner/admin only) */}
        {canManageLinkedInSession && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <h2 className="text-white font-semibold text-base flex items-center gap-2 border-b border-slate-800 pb-3">
              <KeyRound size={18} className="text-indigo-400" />
              LinkedIn Session
            </h2>

            <div className="bg-indigo-950/20 border border-indigo-900/40 rounded-lg p-3 text-xs text-indigo-300 leading-relaxed">
              <strong>How this works:</strong> log into linkedin.com in your own browser, open DevTools →
              Application → Cookies → <strong>https://www.linkedin.com</strong>, copy the value of the{' '}
              <code className="bg-indigo-900/40 px-1 rounded">li_at</code> cookie, and paste it below. This
              refreshes the shared session the scraper uses — no server access needed.
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Status:</span>
              {linkedInSessionQuery.isLoading ? (
                <Loader2 size={13} className="text-slate-500 animate-spin" />
              ) : linkedInSessionQuery.data?.status === 'active' ? (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-xs font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Active
                </span>
              ) : linkedInSessionQuery.data?.status === 'dead' ? (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 text-xs font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400" /> Dead — needs refresh
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-xs font-medium">
                  Not configured
                </span>
              )}
              {linkedInSessionQuery.data?.lastVerifiedAt && (
                <span className="text-slate-500 text-xs">
                  · last verified {new Date(linkedInSessionQuery.data.lastVerifiedAt).toLocaleString()}
                </span>
              )}
            </div>

            <div>
              <label className="block text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
                li_at cookie
              </label>
              <input
                type="password"
                value={liAt}
                onChange={(e) => setLiAt(e.target.value)}
                placeholder="Paste the li_at cookie value"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-200 text-sm font-mono focus:outline-none focus:border-indigo-500 transition"
              />
            </div>

            <button
              type="button"
              onClick={() => setShowJsessionField((v) => !v)}
              className="flex items-center gap-1 text-slate-500 hover:text-slate-300 text-xs transition"
            >
              <ChevronDown size={13} className={`transition-transform ${showJsessionField ? 'rotate-180' : ''}`} />
              Optional: also set JSESSIONID
            </button>

            {showJsessionField && (
              <div>
                <label className="block text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
                  JSESSIONID cookie (optional)
                </label>
                <input
                  type="text"
                  value={jsessionId}
                  onChange={(e) => setJsessionId(e.target.value)}
                  placeholder="Paste the JSESSIONID cookie value"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-200 text-sm font-mono focus:outline-none focus:border-indigo-500 transition"
                />
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                disabled={!liAt.trim() || refreshSessionMutation.isPending}
                onClick={() => refreshSessionMutation.mutate()}
                className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded-lg text-sm transition"
              >
                {refreshSessionMutation.isPending ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <RefreshCw size={15} />
                )}
                Refresh Session
              </button>
            </div>

            {/* Live Login — for checkpoints/captchas the cookie paste above can't clear */}
            <div className="border-t border-slate-800 pt-4 space-y-3">
              <div>
                <p className="text-white text-sm font-medium flex items-center gap-2">
                  <Monitor size={15} className="text-indigo-400" />
                  Live Login
                </p>
                <p className="text-slate-500 text-xs mt-0.5">
                  Opens a real Chrome window running on the server that you drive remotely, right here, until it
                  reaches your feed — use this when LinkedIn throws a checkpoint or captcha the cookie above can't
                  get past.
                </p>
              </div>

              {!liveLoginOpen ? (
                <button
                  type="button"
                  disabled={startLiveMutation.isPending}
                  onClick={() => startLiveMutation.mutate()}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-40 text-slate-200 font-medium rounded-lg text-sm transition"
                >
                  {startLiveMutation.isPending ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Monitor size={15} />
                  )}
                  Open Live Browser
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-xs">
                      {liveStatusQuery.data?.status === 'running'
                        ? 'Waiting for you to log in…'
                        : 'Starting…'}
                    </span>
                    <button
                      type="button"
                      onClick={() => stopLiveMutation.mutate()}
                      disabled={stopLiveMutation.isPending}
                      className="flex items-center gap-1 text-slate-500 hover:text-red-400 text-xs transition"
                    >
                      <X size={13} /> Cancel
                    </button>
                  </div>
                  <div
                    ref={liveCanvasRef}
                    className="w-full aspect-[1280/920] bg-black rounded-lg border border-slate-700 overflow-hidden"
                  />
                </div>
              )}
            </div>

            {/* Disconnect — hidden entirely when there's no session to revoke */}
            {linkedInSessionQuery.data?.status === 'active' && (
              <div className="border-t border-slate-800 pt-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium flex items-center gap-2">
                      <Unplug size={15} className="text-red-400" />
                      Disconnect session
                    </p>
                    <p className="text-slate-500 text-xs mt-0.5 leading-relaxed">
                      Drops the stored cookies so the scraper can no longer act as this LinkedIn
                      account. Prospect enrichment will fail and company enrichment will fall back to
                      web-only research until you connect a new session. This can't be undone —
                      reconnecting means pasting a fresh <code className="bg-slate-800 px-1 rounded">li_at</code>{' '}
                      or using Live Login.
                    </p>
                  </div>
                  {confirmDisconnect ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setConfirmDisconnect(false)}
                        className="px-3 py-2 text-slate-500 hover:text-slate-300 text-sm transition"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={disconnectSessionMutation.isPending}
                        onClick={() => disconnectSessionMutation.mutate()}
                        className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-medium rounded-lg text-sm transition"
                      >
                        {disconnectSessionMutation.isPending ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <Unplug size={15} />
                        )}
                        Confirm disconnect
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDisconnect(true)}
                      className="shrink-0 flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-red-950/40 border border-slate-700 hover:border-red-900/60 text-slate-200 hover:text-red-300 font-medium rounded-lg text-sm transition"
                    >
                      <Unplug size={15} />
                      Disconnect
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Submit Action */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-xl text-sm transition shadow-lg shadow-indigo-950/45 cursor-pointer"
          >
            {saveMutation.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Save size={16} />
            )}
            Save Changes
          </button>
        </div>

      </form>

      {/* Prompt-driven settings — first-class Personas / Playbooks / Signals (v2 redesign, Phase B) */}
      <PersonasSettings />
      <PlaybooksSettings />
      <SignalsSettings />
      {canManageApiKey && <ApiKeySettings />}
      {canManageApiKey && <LemlistSettings />}
    </div>
  );
}
