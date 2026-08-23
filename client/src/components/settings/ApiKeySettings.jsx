import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { KeyRound, Copy, Check, Loader2, AlertTriangle, Plug } from 'lucide-react';
import api from '../../lib/api';
import ConfirmDialog from '../ui/ConfirmDialog';

/**
 * The organization's API key, for external tools (lemlist and friends) pulling
 * generated outreach.
 *
 * The plaintext key exists in exactly one place and one moment: the response to
 * the POST that created it. Only a hash is stored, so this component holds the
 * key in local state and says plainly that it will not be shown again — a UI
 * that implied otherwise would leave users unable to recover a key they
 * assumed they could re-read.
 */
export default function ApiKeySettings() {
  const queryClient = useQueryClient();
  const [freshKey, setFreshKey] = useState(null);   // only after a create/rotate
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(null); // 'rotate' | 'revoke'

  const keyQuery = useQuery({
    queryKey: ['organization-api-key'],
    queryFn: () => api.get('/organization/api-key').then((r) => r.data.data),
  });

  const info = keyQuery.data;

  const createMutation = useMutation({
    mutationFn: () => api.post('/organization/api-key'),
    onSuccess: (res) => {
      setFreshKey(res.data.data.key);
      setCopied(false);
      setConfirming(null);
      queryClient.invalidateQueries({ queryKey: ['organization-api-key'] });
      toast.success('API key created — copy it now');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Could not create the key'),
  });

  const revokeMutation = useMutation({
    mutationFn: () => api.delete('/organization/api-key'),
    onSuccess: () => {
      setFreshKey(null);
      setConfirming(null);
      queryClient.invalidateQueries({ queryKey: ['organization-api-key'] });
      toast.success('API key revoked');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Could not revoke the key'),
  });

  const copyKey = () => {
    navigator.clipboard.writeText(freshKey).then(
      () => { setCopied(true); toast.success('Copied'); },
      () => toast.error('Could not copy — select the key and copy it manually')
    );
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 mt-6">
      <div className="flex items-start gap-3 pb-4 border-b border-slate-800">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10">
          <Plug size={15} className="text-indigo-400" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-white">API access</h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
            One key per organization, for tools that pull your generated outreach — lemlist, Zapier, or
            anything that can send an HTTP header. It only grants read access to a campaign's generated
            sequences, nothing else.
          </p>
        </div>
      </div>

      {freshKey && (
        <div className="mt-4 rounded-xl border border-amber-800/60 bg-amber-950/30 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-400" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-amber-300">Copy this now — it cannot be shown again</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200">
                  {freshKey}
                </code>
                <button
                  onClick={copyKey}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-200 transition hover:bg-slate-700"
                >
                  {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {keyQuery.isLoading ? (
          <span className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 size={13} className="animate-spin" /> Loading…
          </span>
        ) : info?.exists ? (
          <>
            <span className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 font-mono text-xs text-slate-300">
              <KeyRound size={13} className="text-slate-500" />
              pm_live_••••••••{info.last4}
            </span>
            <span className="text-xs text-slate-500">
              created {new Date(info.createdAt).toLocaleDateString()}
              {info.lastUsedAt
                ? ` · last used ${new Date(info.lastUsedAt).toLocaleString()}`
                : ' · never used'}
            </span>
            <button
              onClick={() => setConfirming('rotate')}
              className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 transition hover:border-indigo-500/50 hover:text-indigo-300"
            >
              Rotate
            </button>
            <button
              onClick={() => setConfirming('revoke')}
              className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 transition hover:border-red-500/50 hover:text-red-300"
            >
              Revoke
            </button>
          </>
        ) : (
          <button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {createMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
            Create API key
          </button>
        )}
      </div>

      <div className="mt-5 border-t border-slate-800 pt-4">
        <p className="text-xs font-medium text-slate-400">Pulling a campaign's leads</p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-slate-400">
{`curl -H "x-api-key: YOUR_KEY" \\
  ${api.defaults.baseURL}/prospect-lists/CAMPAIGN_ID/outreach/leads`}
        </pre>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
          Returns each prospect's contact details plus the generated messages as flat fields
          (<code className="text-slate-500">step1Message</code>, <code className="text-slate-500">step2Subject</code>…),
          ready to map onto lemlist variables. The campaign id is in the URL when you open a campaign.
          Add <code className="text-slate-500">?includeSkipped=true</code> to include prospects that were skipped.
        </p>
      </div>

      {confirming && (
        <ConfirmDialog
          title={confirming === 'rotate' ? 'Rotate API key?' : 'Revoke API key?'}
          message={
            confirming === 'rotate'
              ? 'A new key is issued and the current one stops working immediately. Anything still using the old key will start failing until you update it.'
              : 'The current key stops working immediately and no replacement is issued. Anything using it will start failing.'
          }
          confirmLabel={confirming === 'rotate' ? 'Rotate key' : 'Revoke key'}
          tone={confirming === 'rotate' ? 'warning' : 'danger'}
          isPending={createMutation.isPending || revokeMutation.isPending}
          onConfirm={() => (confirming === 'rotate' ? createMutation.mutate() : revokeMutation.mutate())}
          onClose={() => setConfirming(null)}
        />
      )}
    </div>
  );
}
