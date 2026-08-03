import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import {
  Building2, Search, ChevronLeft, ChevronRight, Sparkles, Loader2, Users,
} from 'lucide-react';

const PAGE_SIZE = 20;

const AVATAR_COLORS = [
  'bg-indigo-600', 'bg-violet-600', 'bg-sky-600', 'bg-emerald-600',
  'bg-amber-600', 'bg-rose-600', 'bg-cyan-600', 'bg-fuchsia-600',
];

const colorForName = (name = '') => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

const initialsForName = (name = '') =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

// Real favicon when we have a verified domain (Google's public favicon
// service — no key needed, 404s with a placeholder for unknown domains,
// which still trips the <img> onError so the fallback below takes over), a
// colored initials tile otherwise. Local error state avoids a retry loop.
function CompanyAvatar({ name, domain }) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = Boolean(domain) && !imgFailed;

  return (
    <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-slate-800 flex items-center justify-center">
      {showImg ? (
        <img
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
          alt=""
          className="w-full h-full object-contain bg-white"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div className={`w-full h-full flex items-center justify-center text-white text-sm font-semibold ${colorForName(name)}`}>
          {initialsForName(name)}
        </div>
      )}
    </div>
  );
}

export default function CompaniesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['companies', search, page],
    queryFn: () =>
      api.get('/companies', { params: { search, limit: PAGE_SIZE, page } }).then((r) => r.data),
    keepPreviousData: true,
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
            const isAnalyzed = Boolean(c.aiAnalysis?.lastAnalyzedAt);
            return (
              <button
                key={c._id}
                type="button"
                onClick={() => navigate(`/companies/${c._id}`)}
                className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-slate-800/40 transition"
              >
                <CompanyAvatar name={c.name} domain={c.domain} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-white text-sm font-medium truncate">{c.name}</span>
                    {/* Two rows can now legitimately share a name, so the
                        domain below is the only thing telling them apart. */}
                    {c.needsReview && (
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-900/50 text-amber-300 border border-amber-800 text-[10px] font-medium shrink-0"
                        title="We could not confirm which company this is — set its website or LinkedIn page."
                      >
                        Unverified
                      </span>
                    )}
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
                  <div className="flex items-center gap-3 mt-0.5 text-xs">
                    <span className={c.domain ? 'text-indigo-400' : 'text-slate-600 italic'}>
                      {c.domain || 'no verified domain'}
                    </span>
                    {c.industry && <span className="text-slate-500">{c.industry}</span>}
                    {c.size && <span className="text-slate-500">{c.size} employees</span>}
                  </div>
                </div>
                <span className="flex items-center gap-1.5 text-slate-400 text-xs shrink-0">
                  <Users size={13} /> {c.prospectCount ?? 0}
                </span>
                <ChevronRight size={16} className="text-slate-600 shrink-0" />
              </button>
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
