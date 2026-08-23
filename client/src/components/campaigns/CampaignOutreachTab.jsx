import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Mail, Briefcase, AtSign, MessageCircle, Send, Plus, Trash2, Play, RefreshCw, Loader2,
  AlertTriangle, Sparkles, Save, Copy, ChevronDown, ChevronUp, Clock, Download,
} from 'lucide-react';
import api from '../../lib/api';

const CHANNELS = [
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'linkedin', label: 'LinkedIn', icon: Briefcase },
  { value: 'x', label: 'X', icon: AtSign },
  { value: 'telegram', label: 'Telegram', icon: MessageCircle },
];

const channelMeta = (channel) => CHANNELS.find((c) => c.value === channel) || CHANNELS[0];

const STATUS_BADGE = {
  idle: 'bg-slate-800 text-slate-400',
  generating: 'bg-indigo-500/15 text-indigo-300',
  ready: 'bg-emerald-500/15 text-emerald-300',
  failed: 'bg-red-500/15 text-red-300',
};

/** One prospect's generated sequence, collapsible. */
function SequenceCard({ result, onOpenProspect }) {
  const [open, setOpen] = useState(false);

  const copyAll = () => {
    const text = (result.messages || [])
      .map((m) => `Step ${m.stepOrder} · ${m.channel}${m.subject ? `\nSubject: ${m.subject}` : ''}\n\n${m.body}`)
      .join('\n\n———\n\n');
    navigator.clipboard.writeText(text).then(
      () => toast.success(`Copied ${result.prospectName}'s sequence`),
      () => toast.error('Could not copy to clipboard')
    );
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
      <div className="flex items-center gap-3 px-5 py-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {open ? <ChevronUp size={15} className="shrink-0 text-slate-500" /> : <ChevronDown size={15} className="shrink-0 text-slate-500" />}
          <span className="min-w-0">
            <span className="block truncate font-semibold text-white">{result.prospectName}</span>
            <span className="mt-0.5 block text-xs text-slate-500">
              {result.messages?.length || 0} step{result.messages?.length === 1 ? '' : 's'}
              {result.personaName && <> · as {result.personaName}</>}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-3">
          {typeof result.personaScore === 'number' && (
            <span className="text-sm font-bold text-indigo-300" title="Stored persona score">
              {result.personaScore}
            </span>
          )}
          <button type="button" onClick={copyAll} className="text-slate-500 transition hover:text-indigo-300" title="Copy sequence">
            <Copy size={14} />
          </button>
          <button
            type="button"
            onClick={() => onOpenProspect(result.prospect)}
            className="text-xs text-slate-500 transition hover:text-indigo-300"
          >
            Profile
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-3 border-t border-slate-800 px-5 py-4">
          {(result.messages || []).map((m) => {
            const Icon = channelMeta(m.channel).icon;
            return (
              <div key={m.stepOrder} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wider text-slate-500">
                  <span className="flex items-center gap-1.5 text-indigo-400">
                    <Icon size={12} /> Step {m.stepOrder} · {m.channel}
                  </span>
                  {m.delayDays > 0 && (
                    <span className="flex items-center gap-1 text-slate-600">
                      <Clock size={11} /> +{m.delayDays}d
                    </span>
                  )}
                </div>
                {m.subject && <p className="mb-2 text-sm font-medium text-slate-200">{m.subject}</p>}
                <p className="whitespace-pre-line text-sm leading-relaxed text-slate-300">{m.body}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The outreach half of a campaign: define the sequence, generate messages from
 * stored analysis, and read the results. Generation never re-runs the pipeline.
 */
export default function CampaignOutreachTab({ campaign }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sequence, setSequence] = useState(campaign.sequence?.length ? campaign.sequence : [{ stepOrder: 1, channel: 'email', delayDays: 0 }]);
  const [playbookId, setPlaybookId] = useState('');

  const { data: playbooks = [] } = useQuery({
    queryKey: ['playbooks', 'all'],
    queryFn: () => api.get('/playbooks').then((r) => r.data.data),
    staleTime: 30_000,
  });

  const outreachQuery = useQuery({
    queryKey: ['campaign-outreach', campaign._id],
    queryFn: () => api.get(`/prospect-lists/${campaign._id}/outreach`).then((r) => r.data.data),
    refetchInterval: (q) => (q.state.data?.status === 'generating' ? 3000 : false),
  });

  const outreach = outreachQuery.data;
  const isGenerating = outreach?.status === 'generating';
  const results = outreach?.results || [];
  const generated = results.filter((r) => r.status === 'generated');
  const skipped = results.filter((r) => r.status === 'skipped');

  // Playbooks selected for this campaign, else everything the org has.
  const campaignPlaybooks = campaign.playbooks?.length
    ? playbooks.filter((p) => campaign.playbooks.includes(p._id))
    : playbooks;

  const saveSequenceMutation = useMutation({
    mutationFn: () => api.patch(`/prospect-lists/${campaign._id}`, { sequence }),
    onSuccess: () => {
      toast.success('Sequence saved');
      queryClient.invalidateQueries({ queryKey: ['prospect-list', campaign._id] });
      queryClient.invalidateQueries({ queryKey: ['prospect-lists'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to save sequence'),
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      await api.patch(`/prospect-lists/${campaign._id}`, { sequence });
      return api.post(`/prospect-lists/${campaign._id}/outreach/generate`, playbookId ? { playbookId } : {});
    },
    onSuccess: () => {
      toast.success('Writing sequences — they appear here as they finish.');
      queryClient.invalidateQueries({ queryKey: ['campaign-outreach', campaign._id] });
      queryClient.invalidateQueries({ queryKey: ['prospect-lists'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to start generation'),
  });

  // The file is built server-side, so this is a normal authenticated request
  // whose response happens to be a file — not a plain <a href>, which would
  // carry no bearer token and come back 401.
  const exportMutation = useMutation({
    mutationFn: () =>
      api.get(`/prospect-lists/${campaign._id}/outreach/export`, { responseType: 'blob' }),
    onSuccess: (res) => {
      // Prefer the filename the server chose; it already carries the campaign
      // name and the date.
      const disposition = res.headers['content-disposition'] || '';
      const named = /filename="?([^"]+)"?/.exec(disposition)?.[1];
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = named || 'outreach.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success('CSV downloaded');
    },
    onError: async (err) => {
      // An error response arrives as a Blob too, so the JSON message inside it
      // has to be read back out rather than plucked off err.response.data.
      let message = 'Export failed';
      try {
        const parsed = JSON.parse(await err.response?.data?.text?.());
        message = parsed?.message || message;
      } catch { /* keep the generic message */ }
      toast.error(message);
    },
  });

  const setStep = (index, patch) =>
    setSequence((steps) => steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const removeStep = (index) =>
    setSequence((steps) => steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, stepOrder: i + 1 })));

  const addStep = () =>
    setSequence((steps) => [...steps, { stepOrder: steps.length + 1, channel: 'linkedin', delayDays: 3 }]);

  const noPlaybooks = campaignPlaybooks.length === 0;

  return (
    <div className="space-y-5">
      {/* Sequence builder */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10">
              <Send size={15} className="text-indigo-400" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Sequence</h3>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
                The touches every prospect gets. If someone isn't reachable on a step's channel, that step falls back
                to a channel they do have.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => saveSequenceMutation.mutate()}
            disabled={saveSequenceMutation.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-indigo-500/50 hover:text-indigo-300 disabled:opacity-50"
          >
            {saveSequenceMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save sequence
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {sequence.map((step, index) => (
            <div key={index} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-xs font-bold text-indigo-300">
                {index + 1}
              </span>
              <div className="flex flex-1 flex-wrap items-center gap-2">
                {CHANNELS.map(({ value, label, icon: ChannelIcon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setStep(index, { channel: value })}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition ${
                      step.channel === value
                        ? 'border-indigo-500/60 bg-indigo-500/10 text-indigo-300'
                        : 'border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <ChannelIcon size={12} /> {label}
                  </button>
                ))}
              </div>
              {index > 0 && (
                <label className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Clock size={12} />
                  <input
                    type="number"
                    min={0}
                    value={step.delayDays ?? 0}
                    onChange={(e) => setStep(index, { delayDays: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                    className="w-14 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none"
                  />
                  days later
                </label>
              )}
              {sequence.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeStep(index)}
                  className="text-slate-600 transition hover:text-red-400"
                  aria-label={`Remove step ${index + 1}`}
                >
                  <Trash2 size={14} />
                </button>
              )}
          </div>
        ))}
          <button
            type="button"
            onClick={addStep}
            className="flex items-center gap-1.5 text-xs text-indigo-400 transition hover:text-indigo-300"
          >
            <Plus size={13} /> Add follow-up step
          </button>
        </div>
      </section>

      {/* Generate */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 flex-1">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Write with playbook
            </label>
            <select
              value={playbookId}
              onChange={(e) => setPlaybookId(e.target.value)}
              disabled={noPlaybooks}
              className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-200 transition focus:border-indigo-500 focus:outline-none disabled:opacity-50"
            >
              <option value="">
                {noPlaybooks ? 'No playbooks available' : `Campaign default (${campaignPlaybooks[0]?.name})`}
              </option>
              {campaignPlaybooks.map((p) => (
                <option key={p._id} value={p._id}>{p.name}</option>
              ))}
            </select>
            <p className="mt-2 text-[11px] text-slate-600">
              {campaign.playbooks?.length
                ? 'Choose any playbook selected for this campaign on the Strategy tab.'
                : 'No playbook selected for this campaign — pick one on the Strategy tab to lock it in.'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => generateMutation.mutate()}
            disabled={isGenerating || generateMutation.isPending || noPlaybooks}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-indigo-950/50 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isGenerating || generateMutation.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : generated.length > 0 ? (
              <RefreshCw size={15} />
            ) : (
              <Play size={15} />
            )}
            {isGenerating ? 'Writing…' : generated.length > 0 ? 'Regenerate' : 'Generate outreach'}
          </button>
          <button
            type="button"
            onClick={() => exportMutation.mutate()}
            disabled={generated.length === 0 || exportMutation.isPending}
            className="flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-300 transition hover:border-indigo-500/50 hover:text-indigo-300 disabled:cursor-not-allowed disabled:opacity-40"
            title="Download every prospect's contacts and generated messages as a CSV"
          >
            {exportMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            Export CSV
          </button>
        </div>

        {outreach && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-800 pt-4 text-xs">
            <span className={`rounded-full px-2.5 py-1 font-medium ${STATUS_BADGE[outreach.status] || STATUS_BADGE.idle}`}>
              {outreach.status === 'generating' ? 'generating…' : outreach.status}
            </span>
            {outreach.playbook?.name && <span className="text-slate-500">playbook: {outreach.playbook.name}</span>}
            {outreach.lastGeneratedAt && (
              <span className="text-slate-600">last run {new Date(outreach.lastGeneratedAt).toLocaleString()}</span>
            )}
          </div>
        )}

        {outreach?.status === 'failed' && outreach.error && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-300">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {outreach.error}
          </div>
        )}
      </section>

      {/* Results */}
      {outreachQuery.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
          <Loader2 size={15} className="animate-spin" /> Loading outreach…
        </div>
      ) : generated.length === 0 && !isGenerating ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 py-16 text-center">
          <Sparkles size={30} className="mx-auto mb-3 text-slate-700" />
          <p className="text-sm text-slate-400">No sequences written yet.</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-600">
            Generation only uses analysis the pipeline already stored for these prospects — it never re-runs
            enrichment, so it's fast and cheap to redo.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {generated.length > 0 && (
            <p className="text-sm text-slate-400">
              {generated.length} sequence{generated.length === 1 ? '' : 's'} ready
              {skipped.length > 0 && <span className="text-slate-600"> · {skipped.length} skipped</span>}
            </p>
          )}
          {generated.map((result) => (
            <SequenceCard
              key={result.prospect}
              result={result}
              onOpenProspect={(id) => navigate(`/prospects/${id}`)}
            />
          ))}
        </div>
      )}

      {skipped.length > 0 && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-400">Skipped ({skipped.length})</h3>
          <div className="space-y-1.5">
            {skipped.map((result) => (
              <p key={result.prospect} className="text-xs text-slate-500">
                <span className="text-slate-400">{result.prospectName}</span> — {result.skipReason}
              </p>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
