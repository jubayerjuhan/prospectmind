import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Building2, Sparkles, Loader2, ExternalLink, Users, RefreshCw,
  ChevronRight, Radar, Search, Mail, Phone, AtSign, Code2, MessageCircle, User,
} from 'lucide-react';

const CONTACT_ICON = {
  email: Mail,
  phone: Phone,
  twitter: AtSign,
  linkedin: ExternalLink,
  telegram: MessageCircle,
  discord: MessageCircle,
  github: Code2,
  person: User,
};

const contactHref = (contact) => {
  if (contact.type === 'email') return `mailto:${contact.value}`;
  if (contact.type === 'phone') return `tel:${contact.value}`;
  return contact.value;
};

const STATUS_COLOR = {
  pending: 'bg-slate-700 text-slate-300',
  ready: 'bg-green-900/50 text-green-400',
  failed: 'bg-red-900/50 text-red-400',
  paused: 'bg-amber-900/50 text-amber-300',
};

export default function CompanyDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: company, isLoading } = useQuery({
    queryKey: ['company', id],
    queryFn: () => api.get(`/companies/${id}`).then((r) => r.data.data),
  });

  const analyzeMutation = useMutation({
    mutationFn: (force) => api.post(`/companies/${id}/analyze`, { force }),
    onSuccess: (res) => {
      toast.success(res.data?.analyzed ? 'Company analyzed.' : 'No public context found to analyze.');
      queryClient.invalidateQueries({ queryKey: ['company', id] });
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Analysis failed.'),
  });

  const detectSignalsMutation = useMutation({
    mutationFn: () => api.post(`/companies/${id}/detect-signals`),
    onSuccess: (res) => {
      const n = res.data?.detected ?? 0;
      toast.success(n > 0 ? `${n} signal result(s) stored.` : 'No active company signals to run.');
      queryClient.invalidateQueries({ queryKey: ['company', id] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Signal detection failed.'),
  });

  const findContactsMutation = useMutation({
    mutationFn: (force) => api.post(`/companies/${id}/find-contacts`, { force }),
    onSuccess: (res) => {
      const n = res.data?.found ?? 0;
      toast.success(n > 0 ? `${n} contact(s) found.` : 'No contacts found on the website.');
      queryClient.invalidateQueries({ queryKey: ['company', id] });
    },
    onError: (err) => {
      if (err.response?.data?.code === 'NO_WEBSITE') {
        toast.error("Set this company's website first.");
      } else {
        toast.error(err.response?.data?.message || 'Contact scan failed.');
      }
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 text-slate-400 text-sm py-20">
        <Loader2 size={16} className="animate-spin" /> Loading company…
      </div>
    );
  }

  if (!company) {
    return (
      <div className="text-center py-20">
        <p className="text-slate-400">Company not found.</p>
        <button onClick={() => navigate('/companies')} className="text-indigo-400 text-sm mt-2 hover:underline">
          Back to companies
        </button>
      </div>
    );
  }

  const isAnalyzed = Boolean(company.aiAnalysis?.lastAnalyzedAt);
  const prospects = company.prospects || [];

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Back */}
      <button
        onClick={() => navigate('/companies')}
        className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 text-sm transition"
      >
        <ArrowLeft size={15} /> Companies
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-white text-2xl font-bold flex items-center gap-2.5">
            <Building2 className="text-indigo-400 shrink-0" size={24} />
            <span className="truncate">{company.name}</span>
            {isAnalyzed ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-900/50 text-violet-300 border border-violet-800 text-[11px] font-medium shrink-0">
                <Sparkles size={11} /> Analyzed
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-800 text-slate-500 text-[11px] font-medium shrink-0">
                Not analyzed
              </span>
            )}
          </h1>
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1.5 text-sm text-slate-400">
            {company.industry && <span>{company.industry}</span>}
            {company.size && <span>{company.size} employees</span>}
            {company.domain && <span className="text-slate-500">{company.domain}</span>}
            {company.website && (
              <a
                href={company.website}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-slate-400 hover:text-indigo-300 transition"
              >
                <ExternalLink size={12} /> Website
              </a>
            )}
          </div>
        </div>
        <button
          type="button"
          disabled={analyzeMutation.isPending}
          onClick={() => analyzeMutation.mutate(isAnalyzed)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium rounded-lg text-sm transition shrink-0"
        >
          {analyzeMutation.isPending ? (
            <Loader2 size={15} className="animate-spin" />
          ) : isAnalyzed ? (
            <RefreshCw size={15} />
          ) : (
            <Sparkles size={15} />
          )}
          {analyzeMutation.isPending ? 'Analyzing…' : isAnalyzed ? 'Re-analyze' : 'Analyze'}
        </button>
      </div>

      {/* AI Analysis */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
          <Sparkles size={16} className="text-indigo-400" /> AI Analysis
        </h3>
        {isAnalyzed && company.aiAnalysis?.summary ? (
          <>
            <p className="text-slate-300 text-sm leading-relaxed">{company.aiAnalysis.summary}</p>
            <p className="text-slate-600 text-[11px] mt-3">
              Analyzed {new Date(company.aiAnalysis.lastAnalyzedAt).toLocaleString()}
              {Array.isArray(company.sourceRefs) && company.sourceRefs.length > 0 && (
                <> · sources: {[...new Set(company.sourceRefs.map((s) => s.source))].join(', ')}</>
              )}
            </p>
          </>
        ) : (
          <p className="text-slate-500 text-sm">
            No AI analysis yet. Run one to get an independent company summary, industry, and size estimate.
          </p>
        )}
      </div>

      {/* Signals (populated once Signal detection ships) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-semibold flex items-center gap-2">
            <Radar size={16} className="text-indigo-400" /> Business Signals
          </h3>
          <button
            type="button"
            disabled={detectSignalsMutation.isPending}
            onClick={() => detectSignalsMutation.mutate()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 font-medium rounded-lg text-xs transition"
          >
            {detectSignalsMutation.isPending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Radar size={13} />
            )}
            {detectSignalsMutation.isPending ? 'Detecting…' : 'Detect signals'}
          </button>
        </div>
        {Array.isArray(company.signals) && company.signals.length > 0 ? (
          <div className="space-y-3">
            {company.signals.map((s, i) => (
              <div key={i} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <p className="text-indigo-300 text-sm font-semibold">{s.name || 'Signal'}</p>
                {typeof s.result === 'string' && (
                  <p className="text-slate-300 text-sm mt-1 leading-relaxed">{s.result}</p>
                )}
                <p className="text-slate-600 text-[11px] mt-1.5">
                  {s.source && <>source: {s.source} · </>}
                  {s.detectedAt && <>detected {new Date(s.detectedAt).toLocaleDateString()}</>}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-slate-500 text-sm">
            No signals detected yet. Signals you define in Settings will be detected here (hiring activity, funding, launches…).
          </p>
        )}
      </div>

      {/* Contacts */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-semibold flex items-center gap-2">
            <AtSign size={16} className="text-indigo-400" /> Contacts
          </h3>
          <button
            type="button"
            disabled={findContactsMutation.isPending || !company.website}
            title={!company.website ? "Set this company's website first" : undefined}
            onClick={() => findContactsMutation.mutate(Boolean(company.contactsScannedAt))}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 font-medium rounded-lg text-xs transition"
          >
            {findContactsMutation.isPending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Search size={13} />
            )}
            {findContactsMutation.isPending ? 'Scanning…' : company.contactsScannedAt ? 'Re-scan' : 'Find contacts'}
          </button>
        </div>
        {Array.isArray(company.contacts) && company.contacts.length > 0 ? (
          <div className="space-y-2">
            {company.contacts.map((c, i) => {
              const Icon = CONTACT_ICON[c.type] || AtSign;
              return (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                  <Icon size={15} className="text-indigo-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    {c.name && (
                      <p className="text-white text-sm font-medium truncate">
                        {c.name}
                        {c.role ? ` · ${c.role}` : ''}
                      </p>
                    )}
                    <a
                      href={contactHref(c)}
                      target={c.type === 'email' || c.type === 'phone' ? undefined : '_blank'}
                      rel="noreferrer"
                      className="text-indigo-300 text-sm hover:underline truncate block"
                    >
                      {c.value}
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-slate-500 text-sm">
            {company.contactsScannedAt
              ? 'No contacts found on the website.'
              : company.website
              ? 'Scan the website to find contact emails and social profiles.'
              : 'Set a website to enable contact scanning.'}
          </p>
        )}
      </div>

      {/* Prospects at this company */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
          <Users size={16} className="text-indigo-400" /> Prospects at {company.name}
          <span className="text-slate-500 text-sm font-normal">({company.prospectCount ?? prospects.length})</span>
        </h3>
        {prospects.length === 0 ? (
          <p className="text-slate-500 text-sm">No prospects linked to this company yet.</p>
        ) : (
          <div className="divide-y divide-slate-800/70 -mx-5">
            {prospects.map((p) => (
              <button
                key={p._id}
                type="button"
                onClick={() => navigate(`/prospects/${p._id}`)}
                className="w-full flex items-center gap-4 px-5 py-3 text-left hover:bg-slate-800/40 transition"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-white text-sm font-medium truncate">
                    {p.firstName} {p.lastName || ''}
                  </p>
                  {p.enrichedProfile?.currentRole && (
                    <p className="text-slate-500 text-xs truncate mt-0.5">{p.enrichedProfile.currentRole}</p>
                  )}
                </div>
                {p.compatibilityScore != null && (
                  <span className="text-indigo-300 text-sm font-bold shrink-0">{p.compatibilityScore}</span>
                )}
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0 ${STATUS_COLOR[p.pipelineStatus] || 'bg-slate-800 text-slate-400'}`}
                >
                  {p.pipelineStatus}
                </span>
                <ChevronRight size={15} className="text-slate-600 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
