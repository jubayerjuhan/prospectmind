import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Send, Loader2, Check, Unplug, ExternalLink } from 'lucide-react';
import api from '../../lib/api';
import ConfirmDialog from '../ui/ConfirmDialog';

/**
 * Connects the organization's lemlist account so campaigns can be pushed to
 * lemlist with one click.
 *
 * Opposite direction from ApiKeySettings: that key is one WE issue for a tool
 * to read our data; this key is one LEMLIST issues, that WE hold to write into
 * their account. So there is nothing to "reveal once" here — the plaintext is
 * never sent back down, only connection metadata (see server/.../lemlist route).
 * The server verifies the key against lemlist's own API before storing it, so
 * a typo surfaces immediately as a rejected connect, not a silently broken push
 * discovered later.
 */
export default function LemlistSettings() {
  const queryClient = useQueryClient();
  const [keyInput, setKeyInput] = useState('');
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  const statusQuery = useQuery({
    queryKey: ['organization-lemlist'],
    queryFn: () => api.get('/organization/lemlist').then((r) => r.data.data),
  });

  const info = statusQuery.data;

  const connectMutation = useMutation({
    mutationFn: (apiKey) => api.post('/organization/lemlist', { apiKey }),
    onSuccess: (res) => {
      setKeyInput('');
      queryClient.invalidateQueries({ queryKey: ['organization-lemlist'] });
      const teamName = res.data.data?.teamName;
      toast.success(teamName ? `Connected to lemlist team "${teamName}"` : 'lemlist connected');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Could not connect — check the key and try again'),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => api.delete('/organization/lemlist'),
    onSuccess: () => {
      setConfirmingDisconnect(false);
      queryClient.invalidateQueries({ queryKey: ['organization-lemlist'] });
      toast.success('lemlist disconnected');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Could not disconnect'),
  });

  const submit = (e) => {
    e.preventDefault();
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    connectMutation.mutate(trimmed);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 mt-6">
      <div className="flex items-start gap-3 pb-4 border-b border-slate-800">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10">
          <Send size={15} className="text-indigo-400" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-white">lemlist</h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
            Connect your lemlist account to push a campaign's generated sequence straight into lemlist —
            one lemlist campaign per reachable channel, with every generated message carried over as a
            lead variable. Find your key at{' '}
            <span className="inline-flex items-center gap-1 text-slate-400">
              app.lemlist.com <ExternalLink size={10} />
            </span>{' '}
            → Settings → Team → Integrations.
          </p>
        </div>
      </div>

      <div className="mt-4">
        {statusQuery.isLoading ? (
          <span className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 size={13} className="animate-spin" /> Loading…
          </span>
        ) : info?.connected ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
              <Check size={13} />
              Connected · ••••••••{info.last4}
            </span>
            <span className="text-xs text-slate-500">
              connected {new Date(info.connectedAt).toLocaleDateString()}
              {info.lastVerifiedAt ? ` · last verified ${new Date(info.lastVerifiedAt).toLocaleString()}` : ''}
            </span>
            <button
              onClick={() => setConfirmingDisconnect(true)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 transition hover:border-red-500/50 hover:text-red-300"
            >
              <Unplug size={13} />
              Disconnect
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="Paste your lemlist API key"
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
            />
            <button
              type="submit"
              disabled={connectMutation.isPending || !keyInput.trim()}
              className="flex shrink-0 items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {connectMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Connect
            </button>
          </form>
        )}
      </div>

      {!info?.connected && (
        <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
          The key is verified against lemlist before it's saved — an invalid or revoked key is rejected
          immediately rather than stored broken. Once connected, a "Push to lemlist" button appears on
          any campaign with generated outreach.
        </p>
      )}

      {confirmingDisconnect && (
        <ConfirmDialog
          title="Disconnect lemlist?"
          message="ProspectMind can no longer push campaigns to lemlist until you reconnect. Campaigns already pushed are untouched — lemlist has no way to delete a campaign, so nothing there changes either way."
          confirmLabel="Disconnect"
          tone="danger"
          isPending={disconnectMutation.isPending}
          onConfirm={() => disconnectMutation.mutate()}
          onClose={() => setConfirmingDisconnect(false)}
        />
      )}
    </div>
  );
}
