import { useNavigate } from 'react-router-dom';
import { ChevronRight, ChevronLeft, Pause, Play, RefreshCw, Sparkles, Loader2, Trash2, MinusCircle } from 'lucide-react';
import {
  STATUS_COLOR, STATUS_LABEL, PRIORITY_COLOR, ACTIVE_PIPELINE_STATUSES,
  AI_PROVIDER_BADGE, isPausing, companyLabel,
} from './prospectStatus';

/** The prospect table shared by the campaign view and the prospect pool. */
export default function ProspectTable({
  rows,
  isLoading,
  emptyMessage,
  selectedIds,
  onToggle,
  onToggleAll,
  onRetry,
  onStart,
  onPause,
  onResume,
  onDelete,
  // Only the campaign view passes this: removing from a campaign and deleting
  // the prospect are different actions, and the row has to offer both without
  // implying one does the other.
  onRemoveFromCampaign,
  page,
  totalPages,
  total,
  onPageChange,
}) {
  const navigate = useNavigate();
  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.includes(row._id));

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="w-12 px-4 py-3">
                <input
                  type="checkbox"
                  className="rounded border-slate-700 bg-slate-950 text-indigo-500 focus:ring-indigo-500"
                  checked={allSelected}
                  onChange={onToggleAll}
                />
              </th>
              {['Name', 'Company', 'Role', 'Score', 'Priority', 'Status', 'AI', ''].map((heading) => (
                <th
                  key={heading}
                  className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 9 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded bg-slate-800" style={{ width: j === 0 || j === 8 ? 24 : '80%' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-14 text-center text-sm text-slate-500">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((prospect) => (
                <tr
                  key={prospect._id}
                  className="cursor-pointer transition hover:bg-slate-800/40"
                  onClick={() => navigate(`/prospects/${prospect._id}`)}
                >
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="rounded border-slate-700 bg-slate-950 text-indigo-500 focus:ring-indigo-500"
                      checked={selectedIds.includes(prospect._id)}
                      onChange={() => onToggle(prospect._id)}
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-white">
                    {prospect.firstName} {prospect.lastName}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{companyLabel(prospect)}</td>
                  <td className="px-4 py-3 capitalize text-slate-400">
                    {prospect.primaryAngle || prospect.typeHint || '—'}
                  </td>
                  <td className="px-4 py-3">
                    {prospect.compatibilityScore != null ? (
                      <span className="font-bold text-indigo-400">{prospect.compatibilityScore}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={`px-4 py-3 font-medium capitalize ${PRIORITY_COLOR[prospect.outreachPriority] || 'text-slate-500'}`}>
                    {prospect.outreachPriority || '—'}
                  </td>
                  <td className="px-4 py-3">
                    {isPausing(prospect) ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300">
                        <Loader2 size={11} className="animate-spin" />
                        Pausing…
                      </span>
                    ) : (
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[prospect.pipelineStatus] || ''}`}>
                        {ACTIVE_PIPELINE_STATUSES.includes(prospect.pipelineStatus) && (
                          <Loader2 size={11} className="animate-spin" />
                        )}
                        {STATUS_LABEL[prospect.pipelineStatus] || prospect.pipelineStatus}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {prospect.aiProviderUsed && AI_PROVIDER_BADGE[prospect.aiProviderUsed] ? (
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${AI_PROVIDER_BADGE[prospect.aiProviderUsed].cls}`}>
                        {AI_PROVIDER_BADGE[prospect.aiProviderUsed].label}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {prospect.pipelineStatus === 'not-started' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onStart?.(prospect._id); }}
                          className="flex items-center gap-1 rounded-md bg-indigo-500/15 px-2 py-1 text-xs font-medium text-indigo-300 transition hover:bg-indigo-500/25"
                          title="Start enrichment"
                        >
                          <Sparkles size={12} />
                          Start
                        </button>
                      )}
                      {ACTIVE_PIPELINE_STATUSES.includes(prospect.pipelineStatus) && !isPausing(prospect) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onPause(prospect._id); }}
                          className="text-slate-500 transition hover:text-amber-300"
                          title="Pause pipeline"
                        >
                          <Pause size={14} />
                        </button>
                      )}
                      {prospect.pipelineStatus === 'paused' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onResume(prospect._id); }}
                          className="text-slate-500 transition hover:text-emerald-400"
                          title="Resume pipeline"
                        >
                          <Play size={14} />
                        </button>
                      )}
                      {prospect.pipelineStatus === 'failed' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onRetry(prospect._id); }}
                          className="text-slate-500 transition hover:text-yellow-400"
                          title="Retry pipeline"
                        >
                          <RefreshCw size={14} />
                        </button>
                      )}
                      {onRemoveFromCampaign && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onRemoveFromCampaign(prospect); }}
                          className="text-slate-500 transition hover:text-amber-300"
                          title="Remove from this campaign (keeps the prospect)"
                        >
                          <MinusCircle size={14} />
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onDelete(prospect); }}
                          className="text-slate-500 transition hover:text-red-400"
                          title="Delete prospect"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                      <ChevronRight size={14} className="text-slate-600" />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-800 px-4 py-3">
          <span className="text-xs text-slate-500">
            Page {page} of {totalPages} · {total} prospects
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(Math.max(1, page - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft size={13} /> Prev
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((n) => n === 1 || n === totalPages || Math.abs(n - page) <= 1)
              .reduce((acc, n, i, arr) => {
                if (i > 0 && arr[i - 1] !== n - 1) acc.push('…');
                acc.push(n);
                return acc;
              }, [])
              .map((item, i) =>
                item === '…' ? (
                  <span key={`ellipsis-${i}`} className="px-1 text-xs text-slate-600">…</span>
                ) : (
                  <button
                    key={item}
                    onClick={() => onPageChange(item)}
                    className={`h-7 w-7 rounded-lg text-xs font-medium transition ${
                      item === page ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {item}
                  </button>
                )
              )}
            <button
              onClick={() => onPageChange(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
