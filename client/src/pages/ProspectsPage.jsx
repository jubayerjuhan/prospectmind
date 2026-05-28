import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { Plus, Search, RefreshCw, ChevronRight, Upload, ChevronLeft } from 'lucide-react';
import AddProspectModal from '../components/prospects/AddProspectModal';
import BulkUploadModal from '../components/prospects/BulkUploadModal';

const STATUS_COLOR = {
  pending: 'bg-slate-700 text-slate-300',
  ready: 'bg-green-900/50 text-green-400',
  failed: 'bg-red-900/50 text-red-400',
  discovering: 'bg-blue-900/50 text-blue-400',
  enriching: 'bg-purple-900/50 text-purple-400',
  classifying: 'bg-yellow-900/50 text-yellow-400',
  scoring: 'bg-orange-900/50 text-orange-400',
  generating: 'bg-indigo-900/50 text-indigo-400',
};

const PRIORITY_COLOR = { high: 'text-green-400', medium: 'text-yellow-400', low: 'text-slate-500' };

const PAGE_SIZE = 20;

export default function ProspectsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['prospects', search, statusFilter, page],
    queryFn: () =>
      api.get('/prospects', {
        params: { search, status: statusFilter, limit: PAGE_SIZE, page },
      }).then((r) => r.data),
    refetchInterval: 8000,
    keepPreviousData: true,
  });

  const retryMutation = useMutation({
    mutationFn: (id) => api.post(`/prospects/${id}/retry`),
    onSuccess: () => {
      toast.success('Pipeline restarted');
      queryClient.invalidateQueries(['prospects']);
    },
  });

  const prospects = data?.data || [];
  const total = data?.pagination?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Reset to page 1 whenever filters change
  const handleSearch = (val) => { setSearch(val); setPage(1); };
  const handleStatus = (val) => { setStatusFilter(val); setPage(1); };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-2xl font-bold">Prospects</h1>
          <p className="text-slate-400 mt-1">{total} total</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBulk(true)}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm transition"
          >
            <Upload size={15} /> Bulk import
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition"
          >
            <Plus size={15} /> Add prospect
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search name or company…"
            className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
        <select
          className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-300 text-sm focus:outline-none"
          value={statusFilter}
          onChange={(e) => handleStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {Object.keys(STATUS_COLOR).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800">
              {['Name', 'Company', 'Role', 'Score', 'Priority', 'Status', ''].map((h) => (
                <th key={h} className="text-left text-slate-500 font-medium px-4 py-3 text-xs uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {isLoading ? (
              /* Skeleton rows */
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 7 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 bg-slate-800 rounded animate-pulse" style={{ width: j === 6 ? 24 : '80%' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : prospects.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-slate-500 py-12">
                  {search || statusFilter ? 'No prospects match your filters.' : 'No prospects yet — add your first one.'}
                </td>
              </tr>
            ) : (
              prospects.map((p) => (
                <tr
                  key={p._id}
                  className="hover:bg-slate-800/50 cursor-pointer transition"
                  onClick={() => navigate(`/prospects/${p._id}`)}
                >
                  <td className="px-4 py-3 text-white font-medium">{p.firstName} {p.lastName}</td>
                  <td className="px-4 py-3 text-slate-400">{p.company || '—'}</td>
                  <td className="px-4 py-3 text-slate-400 capitalize">{p.primaryAngle || p.typeHint || '—'}</td>
                  <td className="px-4 py-3">
                    {p.compatibilityScore != null ? (
                      <div className="flex flex-col">
                        <span className="text-indigo-400 font-bold">{p.compatibilityScore}</span>
                        {p.scoreLabel && (
                          <span className="text-indigo-500/70 text-xs capitalize">{p.scoreLabel}</span>
                        )}
                      </div>
                    ) : '—'}
                  </td>
                  <td className={`px-4 py-3 font-medium capitalize ${PRIORITY_COLOR[p.outreachPriority] || 'text-slate-500'}`}>
                    {p.outreachPriority || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[p.pipelineStatus] || ''}`}>
                      {p.pipelineStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {p.pipelineStatus === 'failed' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); retryMutation.mutate(p._id); }}
                          className="text-slate-500 hover:text-yellow-400 transition"
                          title="Retry pipeline"
                        >
                          <RefreshCw size={14} />
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

        {/* ── Pagination ────────────────────────────────────────────── */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-slate-800 flex items-center justify-between">
            <span className="text-slate-500 text-xs">
              Page {page} of {totalPages} · {total} prospects
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 rounded-lg text-xs transition"
              >
                <ChevronLeft size={13} /> Prev
              </button>
              {/* Page number pills — show up to 5 around current page */}
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((n) => n === 1 || n === totalPages || Math.abs(n - page) <= 1)
                .reduce((acc, n, i, arr) => {
                  if (i > 0 && arr[i - 1] !== n - 1) acc.push('…');
                  acc.push(n);
                  return acc;
                }, [])
                .map((item, i) =>
                  item === '…' ? (
                    <span key={`ellipsis-${i}`} className="text-slate-600 text-xs px-1">…</span>
                  ) : (
                    <button
                      key={item}
                      onClick={() => setPage(item)}
                      className={`w-7 h-7 rounded-lg text-xs font-medium transition ${
                        item === page
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                      }`}
                    >
                      {item}
                    </button>
                  )
                )}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 rounded-lg text-xs transition"
              >
                Next <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}
      </div>

      {showAdd && <AddProspectModal onClose={() => setShowAdd(false)} />}
      {showBulk && <BulkUploadModal onClose={() => setShowBulk(false)} />}
    </div>
  );
}
