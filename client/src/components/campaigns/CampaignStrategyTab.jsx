import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Target, Users, BookOpen, Radar, Save, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import MicButton from '../ui/MicButton';
import StrategyPicker from './StrategyPicker';

const toDraft = (campaign) => ({
  campaignDescription: campaign?.campaignDescription || '',
  targetEcosystemContext: campaign?.targetEcosystemContext || '',
  personas: campaign?.personas || [],
  playbooks: campaign?.playbooks || [],
  signals: campaign?.signals || [],
});

/**
 * Everything that tells the AI what this campaign is for: the goal plus the
 * reusable Personas / Playbooks / Signals picked from Settings.
 */
export default function CampaignStrategyTab({ campaign }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => toDraft(campaign));

  const saveMutation = useMutation({
    mutationFn: (payload) => api.patch(`/prospect-lists/${campaign._id}`, payload).then((r) => r.data.data),
    onSuccess: () => {
      toast.success('Campaign strategy saved');
      queryClient.invalidateQueries({ queryKey: ['prospect-lists'] });
      queryClient.invalidateQueries({ queryKey: ['prospect-list', campaign._id] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to save campaign strategy'),
  });

  const patch = (updates) => setDraft((prev) => ({ ...prev, ...updates }));

  return (
    <div className="space-y-5">
      {/* Campaign goal */}
      <section className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="pointer-events-none absolute -right-16 -top-16 h-32 w-32 rounded-full bg-indigo-500/5 blur-2xl" />
        <div className="flex items-start gap-3 border-b border-slate-800 pb-4">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10">
            <Target size={15} className="text-indigo-400" />
          </div>
          <div>
            <h3 className="font-semibold text-white">Campaign goal</h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
              Describe what you want out of this campaign in plain language. Every AI step — scoring, signal
              detection and the outreach writer — reads this. The pipeline won't run without it.
            </p>
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Goal &amp; context</label>
            <MicButton
              onTranscript={(text) =>
                patch({
                  campaignDescription: draft.campaignDescription.trim()
                    ? `${draft.campaignDescription.trim()} ${text}`
                    : text,
                })
              }
            />
          </div>
          <textarea
            value={draft.campaignDescription}
            onChange={(e) => patch({ campaignDescription: e.target.value })}
            rows={6}
            className="w-full resize-none rounded-xl border border-slate-700 bg-slate-950/60 p-4 text-sm text-slate-200 placeholder-slate-600 transition focus:border-indigo-500 focus:outline-none"
            placeholder="Example: We are GoodHive.io. We want to reach top Rust/Solana developers to join our talent pool, and web3 startup CEOs to sell our recruiting services…"
          />
        </div>

        <div className="mt-4">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-400">
            Ecosystem / market context <span className="normal-case text-slate-600">(optional)</span>
          </label>
          <input
            type="text"
            value={draft.targetEcosystemContext}
            onChange={(e) => patch({ targetEcosystemContext: e.target.value })}
            placeholder="e.g. Solana + Base ecosystem, seed to Series A"
            className="w-full rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 transition focus:border-indigo-500 focus:outline-none"
          />
        </div>
      </section>

      <StrategyPicker
        resource="personas"
        title="Personas"
        icon={Users}
        description="Who this campaign targets. Each prospect is scored against every persona you pick, and outreach addresses them as their best-matching one."
        emptyHint="No personas defined yet."
        selected={draft.personas}
        onChange={(personas) => patch({ personas })}
      />

      <StrategyPicker
        resource="playbooks"
        title="Playbooks"
        icon={BookOpen}
        description="How this campaign communicates — positioning, tone and call to action. Pick more than one to write the same list with different angles; you choose which to use on the Outreach tab."
        emptyHint="No playbooks defined yet."
        selected={draft.playbooks}
        onChange={(playbooks) => patch({ playbooks })}
      />

      <StrategyPicker
        resource="signals"
        title="Signals"
        icon={Radar}
        description="What the pipeline watches for on these prospects and their companies — hiring activity, funding, launches. Detected signals become personalization hooks in outreach."
        emptyHint="No signals defined yet."
        selected={draft.signals}
        onChange={(signals) => patch({ signals })}
      />

      {/* Save */}
      <div className="sticky bottom-4 flex justify-end">
        <button
          type="button"
          onClick={() => saveMutation.mutate(draft)}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white shadow-lg shadow-indigo-950/50 transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {saveMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          Save strategy
        </button>
      </div>
    </div>
  );
}
