import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';

// Plain-language label per stage, so a user can see WHERE a run is without
// reading the pipeline's internal status names ('discovering', 'classifying').
const STEP_LABEL = {
  start: 'Getting started',
  discovery: 'Finding them online',
  enrichment: 'Gathering their profile',
  company: 'Identifying their company',
  classification: 'Understanding their role',
  scoring: 'Scoring the fit',
  personas: 'Matching personas',
  signals: 'Looking for signals',
  done: 'Finished',
};

const LEVEL_STYLE = {
  info:    { text: 'text-slate-300',  dot: 'bg-slate-500',   Icon: null },
  success: { text: 'text-emerald-300', dot: 'bg-emerald-500', Icon: CheckCircle2 },
  warn:    { text: 'text-amber-300',  dot: 'bg-amber-500',   Icon: AlertTriangle },
  error:   { text: 'text-red-300',    dot: 'bg-red-500',     Icon: XCircle },
};

const timeOf = (at) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * Live trace of what the pipeline is doing to this prospect.
 *
 * While a run is active it stays open and pinned to the newest line; once the
 * run ends it collapses to a summary the user can expand, so a finished
 * prospect page isn't dominated by the log of how it got there.
 */
export default function PipelineActivity({ activity = [], isProcessing, status }) {
  const [open, setOpen] = useState(isProcessing);
  const endRef = useRef(null);

  // Re-open automatically when a new run starts (e.g. after Re-run).
  useEffect(() => {
    if (isProcessing) setOpen(true);
  }, [isProcessing]);

  // Follow the newest line, but only while the log is live — otherwise
  // expanding a finished run would yank the page down to the bottom.
  useEffect(() => {
    if (open && isProcessing) endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activity.length, open, isProcessing]);

  if (!activity.length && !isProcessing) return null;

  const latest = activity[activity.length - 1];
  const currentStep = latest?.step ? STEP_LABEL[latest.step] : null;

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-800/40 transition"
      >
        {isProcessing ? (
          <Loader2 size={15} className="text-indigo-400 animate-spin shrink-0" />
        ) : (
          <span className="w-[15px] flex justify-center shrink-0">
            <span className={`w-2 h-2 rounded-full ${status === 'failed' ? 'bg-red-500' : 'bg-emerald-500'}`} />
          </span>
        )}

        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-200 font-medium truncate">
            {isProcessing ? currentStep || 'Working…' : 'Activity log'}
          </p>
          {latest && (
            <p className="text-xs text-slate-400 truncate mt-0.5">{latest.message}</p>
          )}
        </div>

        {open ? (
          <ChevronDown size={16} className="text-slate-500 shrink-0" />
        ) : (
          <ChevronRight size={16} className="text-slate-500 shrink-0" />
        )}
      </button>

      {open && activity.length > 0 && (
        <ul className="max-h-64 overflow-y-auto border-t border-slate-800 px-4 py-3 space-y-2">
          {activity.map((entry, i) => {
            const style = LEVEL_STYLE[entry.level] || LEVEL_STYLE.info;
            const isLast = i === activity.length - 1;
            return (
              <li key={`${entry.at}-${i}`} className="flex items-start gap-3 text-xs">
                <span className="text-slate-600 tabular-nums shrink-0 pt-px">{timeOf(entry.at)}</span>
                {style.Icon ? (
                  <style.Icon size={13} className={`${style.text} shrink-0 mt-px`} />
                ) : (
                  <span className="shrink-0 mt-1.5 flex w-[13px] justify-center">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${style.dot} ${
                        isLast && isProcessing ? 'animate-pulse' : ''
                      }`}
                    />
                  </span>
                )}
                <span className={`${style.text} leading-relaxed`}>{entry.message}</span>
              </li>
            );
          })}
          <li ref={endRef} />
        </ul>
      )}
    </div>
  );
}
