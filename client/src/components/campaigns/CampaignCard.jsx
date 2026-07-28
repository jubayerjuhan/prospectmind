import { Users, Megaphone, Filter, AlertTriangle, Sparkles, ArrowRight } from 'lucide-react';

const OUTREACH_BADGE = {
  idle: { label: 'No outreach yet', cls: 'bg-slate-800 text-slate-400' },
  generating: { label: 'Writing…', cls: 'bg-indigo-500/15 text-indigo-300' },
  ready: { label: 'Outreach ready', cls: 'bg-emerald-500/15 text-emerald-300' },
  failed: { label: 'Outreach failed', cls: 'bg-red-500/15 text-red-300' },
};

/** One campaign tile in the gallery. */
export default function CampaignCard({ campaign, onOpen }) {
  const outreach = campaign.outreach || {};
  const badge = OUTREACH_BADGE[outreach.status] || OUTREACH_BADGE.idle;
  const strategyCount =
    (campaign.personas?.length || 0) + (campaign.playbooks?.length || 0) + (campaign.signals?.length || 0);
  const needsGoal = !campaign.campaignDescription?.trim();

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative flex flex-col text-left rounded-2xl border border-slate-800 bg-slate-900 p-5 transition hover:border-indigo-500/40 hover:bg-slate-900/80 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
    >
      <div className="absolute -right-12 -top-12 h-28 w-28 rounded-full bg-indigo-500/5 blur-2xl transition group-hover:bg-indigo-500/15" />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-white">{campaign.name}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
            {campaign.type === 'dynamic' ? <Filter size={11} /> : <Megaphone size={11} />}
            {campaign.type === 'dynamic' ? 'Auto-updating' : 'Manual'}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium ${badge.cls}`}>{badge.label}</span>
      </div>

      <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-xs leading-relaxed text-slate-400">
        {campaign.campaignDescription?.trim() || 'No campaign goal set yet.'}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950/70 px-2.5 py-1.5 text-slate-300">
          <Users size={11} className="text-indigo-400" />
          {campaign.prospectCount ?? 0} prospects
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950/70 px-2.5 py-1.5 text-slate-300">
          <Sparkles size={11} className="text-indigo-400" />
          {strategyCount > 0 ? `${strategyCount} strategy item${strategyCount === 1 ? '' : 's'}` : 'Org defaults'}
        </span>
        {outreach.generatedCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950/70 px-2.5 py-1.5 text-slate-300">
            {outreach.generatedCount} sequence{outreach.generatedCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-slate-800/80 pt-3">
        {needsGoal ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-400">
            <AlertTriangle size={11} /> Needs a goal before the AI can run
          </span>
        ) : (
          <span className="text-[11px] text-slate-600">
            Updated {new Date(campaign.updatedAt).toLocaleDateString()}
          </span>
        )}
        <ArrowRight size={14} className="text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-indigo-400" />
      </div>
    </button>
  );
}
