/** Shared status/priority styling for prospect rows. */

export const STATUS_COLOR = {
  'not-started': 'bg-slate-800/80 text-slate-400 border border-slate-700',
  pending: 'bg-slate-800 text-slate-300',
  ready: 'bg-emerald-500/15 text-emerald-400',
  failed: 'bg-red-500/15 text-red-400',
  discovering: 'bg-blue-500/15 text-blue-400',
  enriching: 'bg-purple-500/15 text-purple-400',
  classifying: 'bg-yellow-500/15 text-yellow-400',
  scoring: 'bg-orange-500/15 text-orange-400',
  generating: 'bg-indigo-500/15 text-indigo-400',
  paused: 'bg-amber-500/15 text-amber-300',
};

/** Status text as a user should read it — the raw enum leaks our vocabulary. */
export const STATUS_LABEL = {
  'not-started': 'Not started',
  pending: 'Queued',
  discovering: 'Finding them',
  enriching: 'Enriching',
  classifying: 'Classifying',
  scoring: 'Scoring',
  generating: 'Writing outreach',
  paused: 'Paused',
  ready: 'Ready',
  failed: 'Failed',
};

export const PRIORITY_COLOR = { high: 'text-emerald-400', medium: 'text-yellow-400', low: 'text-slate-500' };

export const ACTIVE_PIPELINE_STATUSES = [
  'pending',
  'discovering',
  'enriching',
  'classifying',
  'scoring',
  'generating',
];

export const AI_PROVIDER_BADGE = {
  gemini: { label: '✨ Gemini', cls: 'bg-violet-500/15 text-violet-300' },
  groq: { label: '⚡ Groq', cls: 'bg-orange-500/15 text-orange-300' },
  fallback: { label: '⚠ Fallback', cls: 'bg-amber-500/15 text-amber-300' },
};

/**
 * A pause was requested but the run is still mid-layer.
 *
 * Pausing is cooperative once a prospect is actually running — the runner only
 * checks between layers — so there is a real window where the prospect is
 * flagged paused and still working. Showing "Paused" there would be a lie the
 * next poll contradicts; the UI says "Pausing…" instead.
 */
export const isPausing = (prospect) =>
  Boolean(prospect?.pipelinePaused) && ACTIVE_PIPELINE_STATUSES.includes(prospect?.pipelineStatus);

/** Anything the server is currently working on, or about to. */
export const isBusy = (prospect) => ACTIVE_PIPELINE_STATUSES.includes(prospect?.pipelineStatus);

/** Poll fast while any row is moving, then stop — see the v5 note in frontend.md. */
export const livePollInterval = (rows = []) => (rows.some(isBusy) ? 2500 : false);

/**
 * What to call a prospect's employer in a list.
 *
 * `company` is the raw string the prospect was created with — frequently empty
 * for an imported or finder-sourced row. `companyRef` is the Company the
 * pipeline actually resolved and linked, which is what the detail page shows.
 * Falling back to it stops a row reading "—" for a prospect whose company is
 * plainly visible one click away.
 */
// A Company created from an employer LinkedIn URL that never resolved to a real
// name keeps its identity key as the name ("id:89222342"). That is an internal
// handle, not something to show a user — "—" is the honest label until the
// company analyzer fills the real name in.
const isIdentityKeyName = (name = '') => /^id:\d+$/.test(name.trim());

export const companyLabel = (prospect) => {
  const raw = prospect?.company?.trim();
  if (raw) return raw;

  const linked = prospect?.companyRef?.name?.trim();
  if (linked && !isIdentityKeyName(linked)) return linked;

  return '—';
};
