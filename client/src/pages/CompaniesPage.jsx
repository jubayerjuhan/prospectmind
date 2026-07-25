import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import toast from 'react-hot-toast';
import {
  Building2, Search, ChevronLeft, ChevronRight, ChevronDown, Sparkles,
  Loader2, ExternalLink, Users, RefreshCw,
} from 'lucide-react';

const PAGE_SIZE = 20;

export default function CompaniesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['companies', search, page],
    queryFn: () =>
      api.get('/companies', { params: { search, limit: PAGE_SIZE, page } }).then((r) => r.data),
    keepPreviousData: true,
  });

  const analyzeMutation = useMutation({
    mutationFn: ({ id, force }) => api.post(`/companies/${id}/analyze`, { force }),
    onSuccess: (res) => {
      toast.success(res.data?.analyzed ? 'Company analyzed.' : 'No public context found to analyze.');
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Analysis failed.'),
  });

  const companies = data?.data || [];
  const total = data?.pagination?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleSearch = (val) => {
    setSearch(val);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-2xl font-bold flex items-center gap-2">
            <Building2 className="text-indigo-400" size={24} /> Companies
          </h1>
          <p className="text-slate-400 mt-1">
            {total} total · analyzed independently and reused across every prospect
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search companies…"
          className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-4 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-indigo-500 transition"
        />
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 text-slate-400 text-sm py-16">
          <Loader2 size={16} className="animate-spin" /> Loading companies…
        </div>
      ) : companies.length === 0 ? (
        <div className="text-center py-16 bg-slate-900 border border-slate-800 rounded-xl">
          <Building2 size={32} className="mx-auto text-slate-600 mb-3" />
          <p className="text-slate-400 text-sm">No companies yet.</p>
          <p className="text-slate-500 text-xs mt-1">
            Companies are created automatically when prospects run through the pipeline.
          </p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl divide-y divide-slate-800/70 overflow-hidden">
          {companies.map((c) => {
            const isExpanded = expandedId === c._id;
            const isAnalyzed = Boolean(c.aiAnalysis?.lastAnalyzedAt);
            const isAnalyzing =
              analyzeMutation.isPending && analyzeMutation.variables?.id === c._id;

            return (
              <div key={c._id}>
                {/* Row */}
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : c._id)}
                  className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-slate-800/40 transition"
                >
                  <ChevronDown
                    size={16}
                    className={`text-slate-500 shrink-0 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-white text-sm font-medium truncate">{c.name}</span>
                      {isAnalyzed ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-900/50 text-violet-300 border border-violet-800 text-[10px] font-medium shrink-0">
                          <Sparkles size={10} /> Analyzed
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-800 text-slate-500 text-[10px] font-medium shrink-0">
                          Not analyzed
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                      {c.industry && <span>{c.industry}</span>}
                      {c.size && <span>{c.size} employees</span>}
                      {c.domain && <span className="text-slate-600">{c.domain}</span>}
                    </div>
                  </div>
                  <span className="flex items-center gap-1.5 text-slate-400 text-xs shrink-0">
                    <Users size={13} /> {c.prospectCount ?? 0}
                  </span>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-5 pb-5 pt-1 pl-[3.25rem] space-y-3 bg-slate-950/30">
                    {isAnalyzed && c.aiAnalysis?.summary ? (
                      <>
                        <p className="text-slate-300 text-sm leading-relaxed">{c.aiAnalysis.summary}</p>
                        <p className="text-slate-600 text-[11px]">
                          Analyzed {new Date(c.aiAnalysis.lastAnalyzedAt).toLocaleString()}
                          {Array.isArray(c.sourceRefs) && c.sourceRefs.length > 0 && (
                            <> · sources: {[...new Set(c.sourceRefs.map((s) => s.source))].join(', ')}</>
                          )}
                        </p>
                      </>
                    ) : (
                      <p className="text-slate-500 text-sm">
                        No AI analysis yet. Run one to get an independent company summary.
                      </p>
                    )}

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        disabled={isAnalyzing}
                        onClick={() =>
                          analyzeMutation.mutate({ id: c._id, force: isAnalyzed })
                        }
                        className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium rounded-lg text-xs transition"
                      >
                        {isAnalyzing ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : isAnalyzed ? (
                          <RefreshCw size={13} />
                        ) : (
                          <Sparkles size={13} />
                        )}
                        {isAnalyzing ? 'Analyzing…' : isAnalyzed ? 'Re-analyze' : 'Analyze'}
                      </button>
                      {c.website && (
                        <a
                          href={c.website}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-slate-400 hover:text-indigo-300 text-xs transition"
                        >
                          <ExternalLink size={12} /> Website
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-slate-500 text-xs">
            Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="p-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 rounded-lg transition"
            >
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="p-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 rounded-lg transition"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
