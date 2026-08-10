import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../lib/api';
import {
  Building2, Search, ChevronLeft, ChevronRight, Sparkles, Loader2, Users,
  Merge, ArrowLeftRight, AlertTriangle,
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

/** One line of a duplicate pair — what this record is and what it knows. */
function DuplicateSide({ company, role }) {
  const isKeeper = role === 'keep';

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
        isKeeper ? 'border-emerald-500/40 bg-emerald-500/[0.06]' : 'border-slate-800 bg-slate-950/40'
      }`}
    >
      <CompanyAvatar name={company.name} domain={company.domain} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-white">{company.name}</span>
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
              isKeeper ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'
            }`}
          >
            {isKeeper ? 'keeps' : 'merges in'}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px]">
          <span className={company.domain ? 'text-indigo-400' : 'italic text-slate-600'}>
            {company.domain || company.linkedinKey || 'no verified domain'}
          </span>
          {company.industry && <span className="text-slate-500">{company.industry}</span>}
          {company.size && <span className="text-slate-500">{company.size} employees</span>}
          <span className="text-slate-500">
            {company.prospectCount ?? 0} prospect{(company.prospectCount ?? 0) === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Possible duplicates, shown for review rather than merged silently.
 *
 * A merge deletes a record, so the pair is laid out with the survivor marked
 * before anything happens, and the sides can be swapped — the server's pick is
 * a default, not a decision.
 */
function DuplicateReview({ pairs, onMerge, pendingId }) {
  const [flipped, setFlipped] = useState({});

  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-4">
      <div className="mb-3 flex items-start gap-2.5">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-400" />
        <div>
          <p className="text-sm font-medium text-amber-200">
            {pairs.length} possible duplicate{pairs.length === 1 ? '' : 's'}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">
            Same name, one brand across two domains. Merging keeps every field, contact and signal
            from both, moves the prospects across, and cannot be undone.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {pairs.map((pair) => {
          const pairId = `${pair.primary._id}:${pair.duplicate._id}`;
          const isFlipped = Boolean(flipped[pairId]);
          const keeper = isFlipped ? pair.duplicate : pair.primary;
          const merged = isFlipped ? pair.primary : pair.duplicate;
          const isPending = pendingId === pairId;

          return (
            <div key={pairId} className="rounded-lg border border-slate-800/70 bg-slate-900/50 p-2.5">
              <div className="space-y-1.5">
                <DuplicateSide company={keeper} role="keep" />
                <DuplicateSide company={merged} role="merge" />
              </div>

              <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-slate-800/70 pt-2.5">
                <button
                  type="button"
                  onClick={() => setFlipped((f) => ({ ...f, [pairId]: !isFlipped }))}
                  disabled={isPending}
                  className="flex items-center gap-1.5 text-[11px] text-slate-500 transition hover:text-slate-300 disabled:opacity-40"
                >
                  <ArrowLeftRight size={12} /> Keep the other one instead
                </button>
                <button
                  type="button"
                  onClick={() => onMerge({ pairId, primaryId: keeper._id, duplicateId: merged._id })}
                  disabled={isPending}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isPending ? <Loader2 size={13} className="animate-spin" /> : <Merge size={13} />}
                  {isPending ? 'Merging…' : 'Merge'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CompaniesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [mergingPairId, setMergingPairId] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['companies', search, page],
    queryFn: () =>
      api.get('/companies', { params: { search, limit: PAGE_SIZE, page } }).then((r) => r.data),
    keepPreviousData: true,
  });

  // Unpaginated and unfiltered on purpose: a duplicate the search box happens
  // to hide is still a duplicate, and there are only ever a handful.
  const { data: duplicates = [] } = useQuery({
    queryKey: ['company-duplicates'],
    queryFn: () => api.get('/companies/duplicates').then((r) => r.data.data),
    staleTime: 60_000,
  });

  const mergeMutation = useMutation({
    mutationFn: ({ primaryId, duplicateId }) =>
      api.post(`/companies/${primaryId}/merge`, { duplicateId }),
    onSuccess: (res) => {
      const moved = res.data?.movedProspects ?? 0;
      toast.success(
        moved > 0
          ? `Merged "${res.data?.mergedName}" — ${moved} prospect(s) moved across.`
          : `Merged "${res.data?.mergedName}".`
      );
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['company-duplicates'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Merge failed.'),
    onSettled: () => setMergingPairId(''),
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

      {duplicates.length > 0 && (
        <DuplicateReview
          pairs={duplicates}
          pendingId={mergingPairId}
          onMerge={({ pairId, primaryId, duplicateId }) => {
            setMergingPairId(pairId);
            mergeMutation.mutate({ primaryId, duplicateId });
          }}
        />
      )}

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
