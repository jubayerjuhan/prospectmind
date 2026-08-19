/**
 * Score + the context it was scored against.
 *
 * `compatibilityScore` means nothing on its own — the same prospect scores
 * differently depending on whether Layer 4 saw a campaign goal, the org-level
 * fallback, or nothing at all. The pipeline records that in
 * `prospect.scoringContext`; this renders it so the number can be read honestly.
 */

const CHIP_BASE =
  'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium border whitespace-nowrap w-fit';

const CHIP_STYLE = {
  campaign: 'bg-indigo-950/50 text-indigo-300 border-indigo-800/70',
  organization: 'bg-slate-800 text-slate-400 border-slate-700',
  none: 'bg-amber-950/40 text-amber-300 border-amber-800/70',
  unknown: 'bg-transparent text-slate-600 border-slate-800',
};

const PERSONA_SOURCE_LABEL = {
  campaign: 'Personas targeted by this campaign',
  'org-active': 'Personas (all active in the org — no campaign selection)',
  none: 'Personas',
};

/** Prettify the raw enum: `low_priority` → `Low priority`. */
export const formatScoreLabel = (label = '') =>
  label ? label.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '';

/**
 * Which of the four states this prospect is in. `unknown` covers prospects
 * scored before scoringContext existed — showing "No campaign goal" for those
 * would be a guess, not a fact.
 */
const resolveState = (context) => {
  if (!context || !context.scoredAt) return 'unknown';
  return context.goalSource || 'none';
};

const CHIP_TEXT = {
  campaign: (context) => (
    <>
      <span aria-hidden="true">🎯</span>
      {context.campaignName || 'Campaign'}
    </>
  ),
  organization: () => 'Org default goal',
  none: () => 'No campaign goal',
  unknown: () => 'Context not recorded',
};

/**
 * The `title` text. Native tooltip on purpose — the app has no tooltip
 * primitive, and the AI-provider badge already explains itself the same way.
 */
const buildTooltip = ({ context, reasoning, movedToCampaign }) => {
  const state = resolveState(context);
  const lines = [];

  if (state === 'unknown') {
    lines.push('This prospect was scored before ProspectMind recorded scoring context.');
    lines.push('Re-run the pipeline to capture what it is scored against.');
  } else {
    if (state === 'campaign') {
      lines.push(`Scored against the goal of campaign "${context.campaignName || 'Untitled'}".`);
    } else if (state === 'organization') {
      lines.push('Scored against the organization-level default goal (this prospect is in no campaign).');
    } else {
      lines.push('Scored with NO campaign goal — this prospect belongs to no campaign and the org has no default goal set.');
      lines.push('The number reflects general profile quality against your personas, not fit to any objective.');
    }

    if (context.ecosystem) lines.push(`Ecosystem: ${context.ecosystem}`);

    const personaLabel = PERSONA_SOURCE_LABEL[context.personaSource] || PERSONA_SOURCE_LABEL.none;
    lines.push(
      context.personaNames?.length
        ? `${personaLabel}: ${context.personaNames.join(', ')}`
        : 'No personas were available to score against.'
    );

    if (movedToCampaign) {
      lines.push(`Note: this prospect now sits in "${movedToCampaign}" — re-run the pipeline to score it against that campaign.`);
    }
  }

  if (reasoning) lines.push('', `Reasoning: ${reasoning}`);

  return lines.join('\n');
};

/**
 * The context chip on its own, for surfaces that render the score themselves.
 *
 * @param {Object}  context           prospect.scoringContext
 * @param {string}  reasoning         prospect.scoreReasoning
 * @param {string}  movedToCampaign   name of the campaign the prospect is in
 *                                    NOW, when it differs from the one it was
 *                                    scored against
 */
export function ScoringContextChip({ context, reasoning, movedToCampaign }) {
  const state = resolveState(context);

  return (
    <span
      className={`${CHIP_BASE} ${CHIP_STYLE[state]}`}
      title={buildTooltip({ context, reasoning, movedToCampaign })}
    >
      {CHIP_TEXT[state](context || {})}
    </span>
  );
}

export default function ScoreCell({ score, label, reasoning, context }) {
  if (score == null) return <span className="text-slate-500">—</span>;

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-col">
        <span className="text-indigo-400 font-bold">{score}</span>
        {label && <span className="text-indigo-500/70 text-xs">{formatScoreLabel(label)}</span>}
      </div>
      <ScoringContextChip context={context} reasoning={reasoning} />
    </div>
  );
}
