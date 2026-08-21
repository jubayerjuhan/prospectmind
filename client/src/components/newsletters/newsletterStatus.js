/** Shared status styling for newsletters, mirroring campaigns/prospectStatus.js. */

export const STATUS_COLOR = {
  draft: 'bg-slate-800 text-slate-400',
  scheduled: 'bg-amber-900/50 text-amber-300',
  sending: 'bg-indigo-900/50 text-indigo-300',
  sent: 'bg-emerald-900/50 text-emerald-300',
  failed: 'bg-red-900/50 text-red-300',
  canceled: 'bg-slate-800 text-slate-500',
};

export const RECIPIENT_COLOR = {
  pending: 'bg-slate-800 text-slate-400',
  sending: 'bg-indigo-900/50 text-indigo-300',
  sent: 'bg-emerald-900/50 text-emerald-300',
  failed: 'bg-red-900/50 text-red-300',
  skipped: 'bg-slate-800 text-slate-500',
  unsubscribed: 'bg-amber-900/50 text-amber-300',
};

/** The campaign is mid-flight, so the view should keep polling. */
export const IS_LIVE = (status) => status === 'sending';

export const formatWhen = (value) =>
  value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
