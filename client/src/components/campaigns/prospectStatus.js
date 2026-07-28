/** Shared status/priority styling for prospect rows. */

export const STATUS_COLOR = {
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
