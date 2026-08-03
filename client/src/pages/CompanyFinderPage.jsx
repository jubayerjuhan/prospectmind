import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import { Radar, Search, ChevronLeft, ChevronRight, Loader2, BadgeCheck, Briefcase } from 'lucide-react';
import CompanyFinderDetailModal from '../components/companyFinder/CompanyFinderDetailModal';

const SOURCE = 'cryptojobslist';

const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'verified', label: 'Verified' },
  { value: 'recent', label: 'Recently Active' },
  { value: 'active-jobs', label: 'Active Jobs' },
];

export default function CompanyFinderPage() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('relevance');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null); // { slug, name } for the detail modal

  // Debounce the search box — each keystroke would otherwise trigger a live
  // Puppeteer navigation on the backend, not a cheap DB query.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['company-finder', SOURCE, search, sort, page],
    queryFn: () =>
      api
        .get('/company-finder/companies', { params: { source: SOURCE, q: search, sort, page } })
        .then((r) => r.data),
    keepPreviousData: true,
  });

  const companies = data?.data || [];
  const pagination = data?.pagination || { total: 0, pages: 1 };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Radar size={28} className="text-white" />
          Company Finder
        </h1>
        <p className="text-slate-400 mt-1">
          Discover companies from CryptoJobsList and save the ones worth prospecting.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search companies…"
            className="w-full bg-slate-900 border border-slate-800 text-white pl-9 pr-4 py-2.5 rounded-xl focus:outline-none focus:border-indigo-500 transition text-sm"
          />
        </div>

        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setPage(1);
          }}
          className="bg-slate-900 border border-slate-800 text-white px-3 py-2.5 rounded-xl text-sm focus:outline-none focus:border-indigo-500 transition"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {!isLoading && (
        <p className="text-slate-500 text-xs">
          Showing {companies.length ? (page - 1) * (pagination.limit || 40) + 1 : 0}–
          {(page - 1) * (pagination.limit || 40) + companies.length} of {pagination.total} companies
          {isFetching && <Loader2 size={12} className="inline animate-spin ml-2" />}
        </p>
      )}

      {/* Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={32} className="animate-spin text-indigo-500" />
        </div>
      ) : companies.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center">
          <div className="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Radar size={32} className="text-slate-400" />
          </div>
          <h3 className="text-lg font-semibold text-white">No companies found</h3>
          <p className="text-slate-400 mt-2 max-w-sm mx-auto">Try a different search term or sort option.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {companies.map((c) => (
            <button
              key={c.sourceId || c.slug}
              type="button"
              onClick={() => setSelected(c)}
              className="text-left bg-slate-900/50 border border-slate-800 rounded-2xl p-5 hover:border-indigo-500/50 hover:bg-slate-900 transition flex flex-col"
            >
              <div className="flex items-start gap-3 mb-3">
                {c.logo ? (
                  <img src={c.logo} alt="" className="w-10 h-10 rounded-lg object-cover bg-slate-800 shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center text-slate-500 text-sm font-semibold shrink-0">
                    {c.name?.[0]?.toUpperCase() || '?'}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-white font-semibold truncate" title={c.name}>
                      {c.name}
                    </h3>
                    {c.verified && <BadgeCheck size={15} className="text-indigo-400 shrink-0" />}
                  </div>
                  {c.tagline && <p className="text-slate-400 text-xs line-clamp-1 mt-0.5">{c.tagline}</p>}
                </div>
              </div>

              {c.tags?.length > 0 && (
                <p className="text-slate-500 text-xs mb-3 line-clamp-1">{c.tags.join(' · ')}</p>
              )}

              <div className="flex items-center gap-1.5 text-indigo-400 text-xs mt-auto pt-2">
                <Briefcase size={13} />
                {c.activeJobs > 0 ? `${c.activeJobs} Open Vacancies` : 'No open vacancies'}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-slate-500 text-xs">
            Page {page} of {pagination.pages}
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
              disabled={page >= pagination.pages}
              onClick={() => setPage((p) => p + 1)}
              className="p-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 rounded-lg transition"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}

      {selected && (
        <CompanyFinderDetailModal source={SOURCE} slug={selected.slug} name={selected.name} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
