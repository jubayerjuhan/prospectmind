import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Rocket, Loader2, Play, RefreshCw, Users, Sparkles, AlertTriangle,
} from 'lucide-react';

const STATUS_BADGE = {
  draft: 'bg-slate-700 text-slate-300',
  generating: 'bg-indigo-900/50 text-indigo-300',
  ready: 'bg-green-900/50 text-green-400',
  failed: 'bg-red-900/50 text-red-400',
};

export default function OutreachCampaignDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: campaign, isLoading } = useQuery({
    queryKey: ['outreach-campaign', id],
    queryFn: () => api.get(`/campaigns/${id}`).then((r) => r.data.data),
    refetchInterval: (q) => (q.state.data?.status === 'generating' ? 3000 : false),
  });

  const executeMutation = useMutation({
    mutationFn: () => api.post(`/campaigns/${id}/execute`),
    onSuccess: () => {
      toast.success('Generation started — sequences will appear as they finish.');
      queryClient.invalidateQueries({ queryKey: ['outreach-campaign', id] });
      queryClient.invalidateQueries({ queryKey: ['outreach-campaigns'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to start execution.'),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 text-slate-400 text-sm py-20">
        <Loader2 size={16} className="animate-spin" /> Loading campaign…
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="text-center py-20">
        <p className="text-slate-400">Campaign not found.</p>
        <button onClick={() => navigate('/outreach')} className="text-indigo-400 text-sm mt-2 hover:underline">
          Back to outreach
        </button>
      </div>
    );
  }

  const isGenerating = campaign.status === 'generating';
  const hasResults = (campaign.results || []).length > 0;
  const generated = (campaign.results || []).filter((r) => r.status === 'generated');
  const skipped = (campaign.results || []).filter((r) => r.status === 'skipped');

  return (
    <div className="space-y-6 max-w-5xl">
      <button
        onClick={() => navigate('/outreach')}
        className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 text-sm transition"
      >
        <ArrowLeft size={15} /> Outreach
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-white text-2xl font-bold flex items-center gap-2.5">
            <Rocket className="text-indigo-400 shrink-0" size={24} />
            <span className="truncate">{campaign.name}</span>
            <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${STATUS_BADGE[campaign.status]}`}>
              {isGenerating ? 'generating…' : campaign.status}
            </span>
          </h1>
          <p className="text-slate-400 text-sm mt-1.5">
            {campaign.targetList?.name} · persona: <span className="text-slate-300">{campaign.persona?.name}</span> · playbook:{' '}
            <span className="text-slate-300">{campaign.playbook?.name}</span>
          </p>
          <p className="text-slate-500 text-xs mt-1">
            Sequence: {(campaign.sequence || []).map((s) => `${s.channel}${s.delayDays ? ` +${s.delayDays}d` : ''}`).join(' → ')}
            {campaign.lastExecutedAt && <> · last generated {new Date(campaign.lastExecutedAt).toLocaleString()}</>}
          </p>
        </div>
        <button
          type="button"
          disabled={isGenerating || executeMutation.isPending}
          onClick={() => executeMutation.mutate()}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium rounded-lg text-sm transition shrink-0"
        >
          {isGenerating || executeMutation.isPending ? (
            <Loader2 size={15} className="animate-spin" />
          ) : hasResults ? (
            <RefreshCw size={15} />
          ) : (
            <Play size={15} />
          )}
          {isGenerating ? 'Generating…' : hasResults ? 'Regenerate' : 'Generate Sequences'}
        </button>
      </div>

      {campaign.status === 'failed' && campaign.executionError && (
        <div className="flex items-start gap-2 bg-red-950/30 border border-red-900/50 rounded-lg p-3 text-red-300 text-sm">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {campaign.executionError}
        </div>
      )}

      {/* Results */}
      {!hasResults && !isGenerating ? (
        <div className="text-center py-16 bg-slate-900 border border-slate-800 rounded-xl">
          <Sparkles size={32} className="mx-auto text-slate-600 mb-3" />
          <p className="text-slate-400 text-sm">No sequences generated yet.</p>
          <p className="text-slate-500 text-xs mt-1">
            Generation uses each prospect's existing analysis — it never re-runs the pipeline.
          </p>
        </div>
      ) : (
        <>
          {hasResults && (
            <p className="text-slate-400 text-sm flex items-center gap-2">
              <Users size={15} className="text-indigo-400" />
              {generated.length} sequence(s) generated{skipped.length > 0 && <> · {skipped.length} skipped</>}
            </p>
          )}

          {generated.map((r) => (
            <div key={r.prospect} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <button
                  type="button"
                  onClick={() => navigate(`/prospects/${r.prospect}`)}
                  className="text-white font-semibold hover:text-indigo-300 transition text-left"
                >
                  {r.prospectName}
                </button>
                {typeof r.personaScore === 'number' && (
                  <span className="text-indigo-300 text-sm font-bold shrink-0" title="Stored persona score">
                    {r.personaScore}/100
                  </span>
                )}
              </div>
              <div className="space-y-3">
                {(r.messages || []).map((m) => (
                  <div key={m.stepOrder} className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
                    <p className="text-slate-500 text-[11px] font-semibold uppercase tracking-wider mb-2">
                      Step {m.stepOrder} · {m.channel}
                      {m.delayDays > 0 && <> · +{m.delayDays} day(s)</>}
                      {m.subject && <span className="text-slate-400 normal-case tracking-normal font-normal"> — {m.subject}</span>}
                    </p>
                    <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-line">{m.body}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {skipped.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-slate-400 text-sm font-semibold mb-3">Skipped</h3>
              <div className="space-y-1.5">
                {skipped.map((r) => (
                  <p key={r.prospect} className="text-slate-500 text-xs">
                    <span className="text-slate-400">{r.prospectName}</span> — {r.skipReason}
                  </p>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
