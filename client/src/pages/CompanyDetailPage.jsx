import { useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Building2, Sparkles, Loader2, ExternalLink, Users, RefreshCw,
  ChevronRight, Radar, Search, Mail, Phone, AtSign, Code2, MessageCircle, User,
  MapPin, CalendarDays, Globe, Briefcase, Check, Copy, AlertTriangle, Layers,
  Clock, Plus, CheckSquare, Square, Target, UserPlus, BookOpen,
} from 'lucide-react';
import { STATUS_LABEL } from '../components/campaigns/prospectStatus';

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

// Each contact channel gets its own accent so a long list stays scannable.
const CONTACT_ACCENT = {
  email: 'text-sky-300 bg-sky-500/10 ring-sky-500/20',
  phone: 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/20',
  twitter: 'text-cyan-300 bg-cyan-500/10 ring-cyan-500/20',
  linkedin: 'text-blue-300 bg-blue-500/10 ring-blue-500/20',
  telegram: 'text-sky-300 bg-sky-500/10 ring-sky-500/20',
  discord: 'text-violet-300 bg-violet-500/10 ring-violet-500/20',
  github: 'text-slate-300 bg-slate-500/10 ring-slate-500/20',
  person: 'text-amber-300 bg-amber-500/10 ring-amber-500/20',
};

const contactHref = (contact) => {
  if (contact.type === 'email') return `mailto:${contact.value}`;
  if (contact.type === 'phone') return `tel:${contact.value}`;
  return contact.value;
};


const STATUS_COLOR = {
  'not-started': 'bg-slate-800/80 text-slate-400 ring-slate-700',
  pending: 'bg-slate-800 text-slate-300 ring-slate-700',
  ready: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/25',
  failed: 'bg-red-500/10 text-red-300 ring-red-500/25',
  paused: 'bg-amber-500/10 text-amber-300 ring-amber-500/25',
};

const AVATAR_COLORS = [
  'from-indigo-500 to-violet-600', 'from-violet-500 to-fuchsia-600',
  'from-sky-500 to-indigo-600', 'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600', 'from-rose-500 to-pink-600',
];

const colorForName = (name = '') => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

const initialsForName = (name = '') =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

// Score bands mirror the prospect detail page so a number means the same thing
// everywhere in the app.
const scoreTier = (score) => {
  if (score >= 80) return 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/25';
  if (score >= 60) return 'text-indigo-300 bg-indigo-500/10 ring-indigo-500/25';
  if (score >= 40) return 'text-amber-300 bg-amber-500/10 ring-amber-500/25';
  return 'text-slate-400 bg-slate-800 ring-slate-700';
};

// Signal results are Mixed in the schema — render whatever primitive came back
// rather than silently dropping non-strings.
const renderSignalResult = (result) => {
  if (result == null || result === '') return null;
  if (typeof result === 'string') return result;
  if (typeof result === 'boolean') return result ? 'Detected' : 'Not detected';
  if (typeof result === 'number') return String(result);
  return null;
};

/* ── Building blocks ──────────────────────────────────────────────── */

function CompanyLogo({ name, domain, size = 'lg' }) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = Boolean(domain) && !imgFailed;
  const box = size === 'lg' ? 'w-16 h-16 rounded-2xl text-xl' : 'w-9 h-9 rounded-xl text-xs';

  return (
    <div className={`${box} overflow-hidden shrink-0 bg-slate-900 ring-1 ring-white/10 shadow-lg shadow-black/40 flex items-center justify-center`}>
      {showImg ? (
        <img
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=128`}
          alt=""
          className="w-full h-full object-contain bg-white"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div className={`w-full h-full flex items-center justify-center bg-gradient-to-br ${colorForName(name)} text-white font-bold`}>
          {initialsForName(name)}
        </div>
      )}
    </div>
  );
}

function MetaChip({ icon: Icon, children }) {
  if (!children) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 ring-1 ring-white/10 px-2.5 py-1 text-[12px] text-slate-300">
      <Icon size={12} className="text-slate-400 shrink-0" />
      <span className="truncate max-w-[220px]">{children}</span>
    </span>
  );
}

function LinkPill({ href, icon: Icon, children }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full bg-white/5 ring-1 ring-white/10 px-2.5 py-1 text-[12px] text-slate-300 hover:bg-indigo-500/15 hover:text-indigo-200 hover:ring-indigo-400/30 transition"
    >
      <Icon size={12} className="shrink-0" />
      {children}
    </a>
  );
}

function StatTile({ icon: Icon, label, value, accent, delay = 0 }) {
  return (
    <div
      className="animate-rise group relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition hover:border-slate-700 hover:bg-slate-900"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className={`absolute -right-6 -top-6 h-16 w-16 rounded-full blur-2xl opacity-40 transition group-hover:opacity-70 ${accent}`} />
      <div className="relative flex items-center gap-3">
        <Icon size={16} className="text-slate-500 shrink-0" />
        <div className="min-w-0">
          <p className="text-white text-xl font-bold leading-none tabular-nums">{value}</p>
          <p className="text-slate-500 text-[11px] font-medium uppercase tracking-wide mt-1.5 truncate">{label}</p>
        </div>
      </div>
    </div>
  );
}

function Card({ icon: Icon, title, count, action, children, delay = 0, className = '' }) {
  return (
    <section
      className={`animate-rise rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm shadow-lg shadow-black/20 ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-800/80">
        <h3 className="flex items-center gap-2.5 text-white font-semibold text-sm">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/10 ring-1 ring-indigo-500/20 text-indigo-300">
            <Icon size={14} />
          </span>
          {title}
          {count != null && (
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-400 tabular-nums">
              {count}
            </span>
          )}
        </h3>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function GhostButton({ onClick, disabled, pending, icon: Icon, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700/70 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-indigo-500/40 hover:bg-indigo-500/10 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-700/70 disabled:hover:bg-slate-800/60 disabled:hover:text-slate-300"
    >
      {pending ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
      {children}
    </button>
  );
}

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy to clipboard.');
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy"
      className="shrink-0 rounded-md p-1.5 text-slate-500 opacity-0 transition hover:bg-slate-800 hover:text-slate-200 group-hover:opacity-100 focus:opacity-100"
    >
      {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
    </button>
  );
}

function EmptyState({ icon: Icon, children }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-800 px-4 py-8 text-center">
      <Icon size={20} className="text-slate-700" />
      <p className="max-w-sm text-sm text-slate-500">{children}</p>
    </div>
  );
}

/* ── Skeleton ─────────────────────────────────────────────────────── */

const Sk = ({ className = '' }) => <div className={`animate-pulse rounded bg-slate-800 ${className}`} />;

function CompanySkeleton() {
  return (
    <div className="space-y-6">
      <Sk className="h-4 w-28" />
      <Sk className="h-44 w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Sk key={i} className="h-[74px] rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Sk className="h-40 rounded-2xl" />
          <Sk className="h-56 rounded-2xl" />
        </div>
        <div className="space-y-5">
          <Sk className="h-48 rounded-2xl" />
          <Sk className="h-64 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

/* ── Signal picker ────────────────────────────────────────────────── */

/**
 * Choose which company Signals to run against this company.
 *
 * Detection is neither free nor instant — each signal is its own Google search
 * plus its own AI call — so running the org's whole catalogue to learn one
 * thing is the wrong default on a page about a single company. The pipeline
 * still runs everything active; this is the manual, per-company path.
 *
 * Inactive Signals are listed but unchecked: picking one explicitly runs it
 * without having to activate it org-wide, which matches how campaigns treat an
 * explicit selection.
 */
function SignalPicker({ items, selected, onToggle, onSelectAll, onRun, onCancel, pending }) {
  const allSelected = items.length > 0 && selected.length === items.length;

  return (
    <div className="mb-4 rounded-xl border border-indigo-500/25 bg-indigo-500/[0.04] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Signals to detect</p>
        <button
          type="button"
          onClick={() => onSelectAll(!allSelected)}
          className="text-[11px] text-slate-500 transition hover:text-indigo-300"
        >
          {allSelected ? 'Clear all' : 'Select all'}
        </button>
      </div>

      <div className="space-y-1.5">
        {items.map((s) => {
          const isSelected = selected.includes(s._id);
          const Box = isSelected ? CheckSquare : Square;
          return (
            <button
              key={s._id}
              type="button"
              onClick={() => onToggle(s._id)}
              className={`flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition ${
                isSelected
                  ? 'border-indigo-500/50 bg-indigo-500/10'
                  : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
              }`}
            >
              <Box
                size={15}
                className={`mt-0.5 shrink-0 ${isSelected ? 'text-indigo-400' : 'text-slate-600'}`}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={`truncate text-sm ${isSelected ? 'text-white' : 'text-slate-300'}`}>
                    {s.name}
                  </span>
                  {s.isActive === false && (
                    <span className="shrink-0 rounded-full bg-slate-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-slate-500">
                      inactive
                    </span>
                  )}
                </span>
                <span className="mt-0.5 line-clamp-1 block text-[11px] leading-relaxed text-slate-500">
                  {s.prompt}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3.5 flex items-center justify-between gap-3 border-t border-slate-800/70 pt-3">
        <Link to="/settings" className="text-[11px] text-slate-500 transition hover:text-indigo-300">
          Manage in Settings
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-2.5 py-1.5 text-xs text-slate-500 transition hover:text-slate-300"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onRun}
            disabled={pending || selected.length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? <Loader2 size={13} className="animate-spin" /> : <Radar size={13} />}
            {pending ? 'Detecting…' : `Detect ${selected.length} signal${selected.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Prospect finder ──────────────────────────────────────────────── */

/**
 * Configure a prospect search for this company.
 *
 * A Playbook is mandatory: without one the search has no idea who it is looking
 * for and would return the company's whole staff list. Personas are optional
 * and additive — the Playbook says why we're approaching this company, the
 * Personas narrow it to the roles worth approaching.
 */
function ProspectFinderPicker({
  companyName, playbooks, personas, playbookId, onPlaybookChange,
  selectedPersonaIds, onTogglePersona, onRun, onCancel, pending,
}) {
  const selectedPlaybook = playbooks.find((p) => p._id === playbookId);

  if (playbooks.length === 0) {
    return (
      <div className="mb-4 rounded-xl border border-dashed border-slate-800 px-4 py-5 text-center">
        <p className="text-sm text-slate-400">
          A playbook tells the search what kind of people you want at {companyName}.
        </p>
        <Link
          to="/settings"
          className="mt-2 inline-flex items-center gap-1.5 text-xs text-indigo-400 transition hover:text-indigo-300"
        >
          <Plus size={12} /> Create one in Settings
        </Link>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-xl border border-indigo-500/25 bg-indigo-500/[0.04] p-4">
      <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400">Playbook</p>
      <div className="space-y-1.5">
        {playbooks.map((p) => {
          const isSelected = p._id === playbookId;
          return (
            <button
              key={p._id}
              type="button"
              onClick={() => onPlaybookChange(p._id)}
              className={`flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition ${
                isSelected
                  ? 'border-indigo-500/50 bg-indigo-500/10'
                  : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
              }`}
            >
              <BookOpen size={15} className={`mt-0.5 shrink-0 ${isSelected ? 'text-indigo-400' : 'text-slate-600'}`} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={`truncate text-sm ${isSelected ? 'text-white' : 'text-slate-300'}`}>{p.name}</span>
                  {p.isActive === false && (
                    <span className="shrink-0 rounded-full bg-slate-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-slate-500">
                      inactive
                    </span>
                  )}
                </span>
                <span className={`mt-0.5 block text-[11px] leading-relaxed text-slate-500 ${isSelected ? '' : 'line-clamp-1'}`}>
                  {p.prompt}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {personas.length > 0 && (
        <>
          <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Personas <span className="font-normal normal-case tracking-normal text-slate-600">— optional, narrows to specific roles</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {personas.map((p) => {
              const isSelected = selectedPersonaIds.includes(p._id);
              return (
                <button
                  key={p._id}
                  type="button"
                  onClick={() => onTogglePersona(p._id)}
                  title={p.prompt}
                  className={`rounded-full px-2.5 py-1 text-[12px] ring-1 transition ${
                    isSelected
                      ? 'bg-indigo-500/15 text-indigo-200 ring-indigo-400/40'
                      : 'bg-slate-950/40 text-slate-400 ring-slate-800 hover:text-slate-200 hover:ring-slate-700'
                  }`}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="mt-3.5 flex items-center justify-between gap-3 border-t border-slate-800/70 pt-3">
        <Link to="/settings" className="text-[11px] text-slate-500 transition hover:text-indigo-300">
          Manage in Settings
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-2.5 py-1.5 text-xs text-slate-500 transition hover:text-slate-300"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onRun}
            disabled={pending || !selectedPlaybook}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? <Loader2 size={13} className="animate-spin" /> : <Target size={13} />}
            {pending ? 'Searching…' : 'Find prospects'}
          </button>
        </div>
      </div>

      {pending && (
        <p className="mt-2.5 text-[11px] leading-relaxed text-slate-500">
          Planning searches, scanning results, and checking each person against the playbook. This takes a moment.
        </p>
      )}
    </div>
  );
}

/**
 * Review what the search found before anything becomes a prospect.
 *
 * Importing is what costs the plan limit and starts the enrichment pipeline, so
 * the user picks — nothing here is a prospect until they say so.
 */
function CandidateReview({ candidates, selected, onToggle, onSelectAll, onImport, onDismiss, pending, playbookName, lastRunAt }) {
  const allSelected = candidates.length > 0 && selected.length === candidates.length;

  return (
    <div className="mb-4 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            {candidates.length} candidate{candidates.length === 1 ? '' : 's'} found
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            {playbookName ? `via "${playbookName}"` : 'Not yet imported'}
            {lastRunAt && ` · ${new Date(lastRunAt).toLocaleString()}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onSelectAll(!allSelected)}
          className="shrink-0 text-[11px] text-slate-500 transition hover:text-indigo-300"
        >
          {allSelected ? 'Clear all' : 'Select all'}
        </button>
      </div>

      <div className="space-y-1.5">
        {candidates.map((c) => {
          const fullName = `${c.firstName || ''} ${c.lastName || ''}`.trim();
          const isSelected = selected.includes(c._id);
          const Box = isSelected ? CheckSquare : Square;
          const confidence = typeof c.confidence === 'number' ? Math.round(c.confidence * 100) : null;

          return (
            <div
              key={c._id}
              className={`flex items-start gap-2.5 rounded-lg border p-2.5 transition ${
                isSelected ? 'border-indigo-500/50 bg-indigo-500/10' : 'border-slate-800 bg-slate-950/40'
              }`}
            >
              <button
                type="button"
                onClick={() => onToggle(c._id)}
                className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
              >
                <Box size={15} className={`mt-0.5 shrink-0 ${isSelected ? 'text-indigo-400' : 'text-slate-600'}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={`truncate text-sm font-medium ${isSelected ? 'text-white' : 'text-slate-300'}`}>
                      {fullName || 'Unnamed'}
                    </span>
                    {confidence != null && (
                      <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums ring-1 ${scoreTier(confidence)}`}>
                        {confidence}%
                      </span>
                    )}
                  </span>
                  {c.role && <span className="mt-0.5 block truncate text-xs text-slate-400">{c.role}</span>}
                  {c.matchReason && (
                    <span className="mt-1 block text-[11px] leading-relaxed text-slate-500">{c.matchReason}</span>
                  )}
                </span>
              </button>
              {c.linkedinUrl && (
                <a
                  href={c.linkedinUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="Open LinkedIn profile"
                  className="shrink-0 rounded-md p-1.5 text-slate-500 transition hover:bg-slate-800 hover:text-indigo-300"
                >
                  <ExternalLink size={13} />
                </a>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3.5 flex items-center justify-between gap-3 border-t border-slate-800/70 pt-3">
        <button
          type="button"
          onClick={onDismiss}
          className="text-[11px] text-slate-500 transition hover:text-slate-300"
        >
          Dismiss results
        </button>
        <button
          type="button"
          onClick={onImport}
          disabled={pending || selected.length === 0}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
          {pending ? 'Importing…' : `Import ${selected.length} prospect${selected.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────── */

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

  // Shares its cache entry with the campaign StrategyPicker, so a signal edited
  // in Settings shows up here without a bespoke invalidation.
  const { data: allSignals = [], isLoading: signalsLoading } = useQuery({
    queryKey: ['signals', 'all'],
    queryFn: () => api.get('/signals').then((r) => r.data.data),
    staleTime: 30_000,
  });

  // Only company-applicable Signals can say anything about a Company; a
  // prospect-only one would be run against context it was never written for.
  const companySignals = useMemo(
    () => allSignals.filter((s) => s.appliesTo?.includes('company')),
    [allSignals]
  );

  const [pickerOpen, setPickerOpen] = useState(false);
  // null = the user hasn't touched the checkboxes, so the default below applies.
  // Kept as an override rather than seeded state: the signal list arrives
  // asynchronously, and seeding on arrival would re-tick boxes underneath
  // someone who had already started unticking them.
  const [selectedOverride, setSelectedOverride] = useState(null);

  // Default to what a run did before it was selectable — every active company
  // signal — so the common case stays one extra click rather than a checklist
  // the user has to fill in from scratch.
  const defaultSelection = useMemo(
    () => companySignals.filter((s) => s.isActive !== false).map((s) => s._id),
    [companySignals]
  );
  const selectedSignalIds = selectedOverride ?? defaultSelection;

  const detectSignalsMutation = useMutation({
    mutationFn: (signalIds) => api.post(`/companies/${id}/detect-signals`, { signalIds }),
    onSuccess: (res) => {
      const n = res.data?.detected ?? 0;
      toast.success(n > 0 ? `${n} signal result(s) stored.` : 'Nothing detected for the selected signals.');
      setPickerOpen(false);
      setSelectedOverride(null);
      queryClient.invalidateQueries({ queryKey: ['company', id] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Signal detection failed.'),
  });

  /* ── Prospect finder ──────────────────────────────────────────── */

  // Shared cache entries with the campaign tabs, so a playbook or persona
  // edited in Settings is reflected here without a bespoke invalidation.
  const { data: playbooks = [] } = useQuery({
    queryKey: ['playbooks', 'all'],
    queryFn: () => api.get('/playbooks').then((r) => r.data.data),
    staleTime: 30_000,
  });
  const { data: personas = [] } = useQuery({
    queryKey: ['personas', 'all'],
    queryFn: () => api.get('/personas').then((r) => r.data.data),
    staleTime: 30_000,
  });

  const [finderOpen, setFinderOpen] = useState(false);
  const [playbookId, setPlaybookId] = useState('');
  const [selectedPersonaIds, setSelectedPersonaIds] = useState([]);
  // Which candidates the user has ticked for import. Kept separate from the
  // candidates themselves, which are server state.
  const [selectedCandidateIds, setSelectedCandidateIds] = useState([]);
  // Local-only "I'm done with these results" — the candidates stay on the
  // record (a re-run costs real searches) but stop occupying the card.
  const [resultsDismissed, setResultsDismissed] = useState(false);

  // Default to the playbook this company was last searched with, then the
  // newest active one. Held as an override rather than seeded state for the
  // same reason as the signal selection: playbooks arrive asynchronously, and
  // seeding on arrival would move the selection under someone already choosing.
  const effectivePlaybookId = useMemo(() => {
    if (playbookId) return playbookId;
    const last = company?.prospectSearch?.playbook;
    if (last && playbooks.some((p) => p._id === last)) return last;
    return playbooks.find((p) => p.isActive !== false)?._id || '';
  }, [playbookId, company?.prospectSearch?.playbook, playbooks]);

  const findProspectsMutation = useMutation({
    mutationFn: () => api.post(`/companies/${id}/find-prospects`, { playbookId: effectivePlaybookId, personaIds: selectedPersonaIds }),
    onSuccess: (res) => {
      const n = res.data?.found ?? 0;
      toast.success(
        n > 0
          ? `${n} candidate(s) found — review and import.`
          : 'No matching people found. Try a broader playbook or add personas.'
      );
      setFinderOpen(false);
      setResultsDismissed(false);
      setSelectedCandidateIds([]);
      queryClient.invalidateQueries({ queryKey: ['company', id] });
    },
    onError: (err) => {
      if (err.response?.data?.code === 'NO_VERIFIED_IDENTITY') {
        toast.error("Set this company's website or LinkedIn page first.");
      } else {
        toast.error(err.response?.data?.message || 'Prospect search failed.');
      }
    },
  });

  const importProspectsMutation = useMutation({
    mutationFn: (candidateIds) => api.post(`/companies/${id}/import-prospects`, { candidateIds }),
    onSuccess: (res) => {
      const n = res.data?.imported ?? 0;
      const skipped = res.data?.skipped ?? 0;
      toast.success(
        skipped > 0
          ? `${n} prospect(s) imported — ${skipped} skipped (plan limit).`
          : `${n} prospect(s) imported. Enrichment has started.`
      );
      setSelectedCandidateIds([]);
      queryClient.invalidateQueries({ queryKey: ['company', id] });
      queryClient.invalidateQueries({ queryKey: ['prospects'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Import failed.'),
  });

  const findContactsMutation = useMutation({
    mutationFn: (force) => api.post(`/companies/${id}/find-contacts`, { force }),
    onSuccess: (res) => {
      const n = res.data?.found ?? 0;
      const contactsMsg = n > 0 ? `${n} contact(s) found.` : 'No contacts found on the website.';
      toast.success(res.data?.linkedinFound ? `${contactsMsg} LinkedIn page found.` : contactsMsg);
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

  const findLinkedinMutation = useMutation({
    mutationFn: (force) => api.post(`/companies/${id}/find-linkedin`, { force }),
    onSuccess: (res) => {
      toast.success(res.data?.found ? 'LinkedIn page found.' : 'No confident LinkedIn match found.');
      queryClient.invalidateQueries({ queryKey: ['company', id] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'LinkedIn search failed.'),
  });

  if (isLoading) return <CompanySkeleton />;

  if (!company) {
    return (
      <div className="py-20 text-center">
        <Building2 size={28} className="mx-auto mb-3 text-slate-700" />
        <p className="text-slate-400">Company not found.</p>
        <button onClick={() => navigate('/companies')} className="mt-2 text-sm text-indigo-400 hover:underline">
          Back to companies
        </button>
      </div>
    );
  }

  const isAnalyzed = Boolean(company.aiAnalysis?.lastAnalyzedAt);
  const prospects = company.prospects || [];
  // Candidates awaiting a decision. Imported ones stay on the record so a
  // re-run never re-offers someone already in the pipeline, but they belong in
  // the prospect list below, not in the review panel.
  const pendingCandidates = (company.prospectSearch?.candidates || []).filter((c) => !c.imported);
  const searchFailed = company.prospectSearch?.status === 'failed' && Boolean(company.prospectSearch?.error);
  // Anything rendered above the prospect list means the list can no longer
  // bleed to the card's top edge — its -m-5 would ride over the panel.
  const hasFinderPanel = finderOpen || (pendingCandidates.length > 0 && !resultsDismissed) || searchFailed;
  const signals = Array.isArray(company.signals) ? company.signals : [];
  const contacts = Array.isArray(company.contacts) ? company.contacts : [];
  const openRoles = company.atsBoard?.openRoles;
  const sources = Array.isArray(company.sourceRefs)
    ? [...new Set(company.sourceRefs.map((s) => s.source).filter(Boolean))]
    : [];

  const facts = [
    { icon: Globe, label: 'Domain', value: company.domain },
    { icon: Briefcase, label: 'Industry', value: company.industry },
    { icon: Users, label: 'Company size', value: company.size ? `${company.size} employees` : '' },
    { icon: MapPin, label: 'Headquarters', value: company.headquarters },
    { icon: CalendarDays, label: 'Founded', value: company.founded },
  ].filter((f) => f.value);

  return (
    <div className="space-y-6">
      {/* Back */}
      <button
        onClick={() => navigate('/companies')}
        className="group flex items-center gap-1.5 text-sm text-slate-400 transition hover:text-slate-200"
      >
        <ArrowLeft size={15} className="transition group-hover:-translate-x-0.5" /> Companies
      </button>

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <div className="animate-rise relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 shadow-xl shadow-black/30">
        {/* Ambient glow */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="animate-drift absolute -left-24 -top-32 h-72 w-72 rounded-full bg-indigo-600/25 blur-3xl" />
          <div className="absolute -right-16 -top-24 h-64 w-64 rounded-full bg-violet-600/20 blur-3xl" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-400/40 to-transparent" />
        </div>

        <div className="relative p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 gap-4">
              <CompanyLogo name={company.name} domain={company.domain} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="truncate text-2xl font-bold tracking-tight text-white">{company.name}</h1>
                  {isAnalyzed ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium text-violet-200 ring-1 ring-violet-400/30">
                      <Sparkles size={11} /> Analyzed
                    </span>
                  ) : (
                    <span className="inline-flex shrink-0 items-center rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-400 ring-1 ring-slate-700">
                      Not analyzed
                    </span>
                  )}
                  {company.needsReview && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300 ring-1 ring-amber-500/25">
                      <AlertTriangle size={11} /> Needs review
                    </span>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <MetaChip icon={Briefcase}>{company.industry}</MetaChip>
                  <MetaChip icon={Users}>{company.size ? `${company.size} employees` : ''}</MetaChip>
                  <MetaChip icon={MapPin}>{company.headquarters}</MetaChip>
                  <MetaChip icon={CalendarDays}>{company.founded}</MetaChip>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {company.website && (
                    <LinkPill href={company.website} icon={Globe}>
                      {company.domain || 'Website'}
                    </LinkPill>
                  )}
                  {company.linkedinUrl ? (
                    <LinkPill href={company.linkedinUrl} icon={ExternalLink}>LinkedIn</LinkPill>
                  ) : (
                    <button
                      type="button"
                      disabled={findLinkedinMutation.isPending}
                      onClick={() => findLinkedinMutation.mutate(false)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-[12px] text-slate-400 ring-1 ring-white/10 transition hover:bg-indigo-500/15 hover:text-indigo-200 hover:ring-indigo-400/30 disabled:opacity-40"
                    >
                      {findLinkedinMutation.isPending
                        ? <Loader2 size={12} className="animate-spin" />
                        : <Search size={12} />}
                      {findLinkedinMutation.isPending ? 'Searching…' : 'Find LinkedIn'}
                    </button>
                  )}
                  {company.atsBoard?.url && (
                    <LinkPill href={company.atsBoard.url} icon={Layers}>
                      {company.atsBoard.provider || 'Job board'}
                    </LinkPill>
                  )}
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={analyzeMutation.isPending}
              onClick={() => analyzeMutation.mutate(isAnalyzed)}
              className="group relative flex shrink-0 items-center gap-2 self-start overflow-hidden rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-900/40 transition hover:from-indigo-500 hover:to-violet-500 hover:shadow-indigo-800/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {analyzeMutation.isPending ? (
                <Loader2 size={15} className="animate-spin" />
              ) : isAnalyzed ? (
                <RefreshCw size={15} className="transition group-hover:rotate-90" />
              ) : (
                <Sparkles size={15} />
              )}
              {analyzeMutation.isPending ? 'Analyzing…' : isAnalyzed ? 'Re-analyze' : 'Analyze company'}
            </button>
          </div>

          {company.needsReview && company.reviewReason && (
            <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-400" />
              <p className="text-sm leading-relaxed text-amber-200/90">
                <span className="font-medium">Identity unverified.</span> {company.reviewReason}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Stats ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          icon={Users}
          label="Prospects"
          value={company.prospectCount ?? prospects.length}
          accent="bg-indigo-500"
          delay={40}
        />
        <StatTile icon={Radar} label="Signals" value={signals.length} accent="bg-violet-500" delay={80} />
        <StatTile icon={AtSign} label="Contacts" value={contacts.length} accent="bg-sky-500" delay={120} />
        <StatTile
          icon={Layers}
          label="Open roles"
          value={typeof openRoles === 'number' ? openRoles : '—'}
          accent="bg-emerald-500"
          delay={160}
        />
      </div>

      {/* ── Body ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
        {/* Left column */}
        <div className="space-y-5 lg:col-span-2">
          <Card icon={Sparkles} title="AI Analysis" delay={200}>
            {isAnalyzed && company.aiAnalysis?.summary ? (
              <>
                <p className="whitespace-pre-line text-sm leading-relaxed text-slate-300">
                  {company.aiAnalysis.summary}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-800/80 pt-3">
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                    <Clock size={11} />
                    {new Date(company.aiAnalysis.lastAnalyzedAt).toLocaleString()}
                  </span>
                  {sources.map((s) => (
                    <span
                      key={s}
                      className="rounded-full bg-slate-800/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <EmptyState icon={Sparkles}>
                No AI analysis yet. Run one to get an independent company summary, industry, and size estimate.
              </EmptyState>
            )}
          </Card>

          <Card
            icon={Radar}
            title="Business Signals"
            count={signals.length || null}
            delay={240}
            action={
              <GhostButton
                onClick={() => setPickerOpen((open) => !open)}
                disabled={detectSignalsMutation.isPending || signalsLoading}
                pending={detectSignalsMutation.isPending}
                icon={Radar}
              >
                {detectSignalsMutation.isPending ? 'Detecting…' : 'Detect signals'}
                {/* The button no longer runs anything on its own — without a
                    disclosure caret the card looks identical to the version
                    that did, and the picker reads as nothing having happened. */}
                {!detectSignalsMutation.isPending && (
                  <ChevronRight
                    size={13}
                    className={`transition-transform ${pickerOpen ? 'rotate-90' : ''}`}
                  />
                )}
              </GhostButton>
            }
          >
            {pickerOpen && (
              companySignals.length > 0 ? (
                <SignalPicker
                  items={companySignals}
                  selected={selectedSignalIds}
                  pending={detectSignalsMutation.isPending}
                  onToggle={(signalId) =>
                    setSelectedOverride(
                      selectedSignalIds.includes(signalId)
                        ? selectedSignalIds.filter((s) => s !== signalId)
                        : [...selectedSignalIds, signalId]
                    )
                  }
                  onSelectAll={(all) =>
                    setSelectedOverride(all ? companySignals.map((s) => s._id) : [])
                  }
                  onRun={() => detectSignalsMutation.mutate(selectedSignalIds)}
                  onCancel={() => {
                    setPickerOpen(false);
                    setSelectedOverride(null);
                  }}
                />
              ) : (
                <div className="mb-4 rounded-xl border border-dashed border-slate-800 px-4 py-5 text-center">
                  <p className="text-sm text-slate-400">No company signals defined yet.</p>
                  <Link
                    to="/settings"
                    className="mt-2 inline-flex items-center gap-1.5 text-xs text-indigo-400 transition hover:text-indigo-300"
                  >
                    <Plus size={12} /> Create one in Settings
                  </Link>
                </div>
              )
            )}

            {signals.length > 0 ? (
              <div className="space-y-3">
                {signals.map((s, i) => {
                  const result = renderSignalResult(s.result);
                  const confidence = typeof s.confidence === 'number'
                    ? Math.max(0, Math.min(100, s.confidence <= 1 ? s.confidence * 100 : s.confidence))
                    : null;
                  return (
                    <div
                      key={i}
                      className="group rounded-xl border border-slate-800 bg-slate-950/50 p-4 transition hover:border-indigo-500/30 hover:bg-slate-950"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold text-indigo-300">{s.name || 'Signal'}</p>
                        {confidence != null && (
                          <span className="shrink-0 text-[11px] font-medium tabular-nums text-slate-400">
                            {Math.round(confidence)}% confidence
                          </span>
                        )}
                      </div>
                      {confidence != null && (
                        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-400 transition-[width] duration-700"
                            style={{ width: `${confidence}%` }}
                          />
                        </div>
                      )}
                      {result && <p className="mt-2 text-sm leading-relaxed text-slate-300">{result}</p>}
                      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                        {s.source && (
                          <span className="rounded-full bg-slate-800/80 px-2 py-0.5 uppercase tracking-wide">{s.source}</span>
                        )}
                        {s.detectedAt && (
                          <span className="inline-flex items-center gap-1">
                            <Clock size={10} /> {new Date(s.detectedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState icon={Radar}>
                No signals detected yet. Signals you define in Settings will be detected here (hiring activity,
                funding, launches…).
              </EmptyState>
            )}
          </Card>

          <Card
            icon={Users}
            title={`Prospects at ${company.name}`}
            count={company.prospectCount ?? prospects.length}
            delay={280}
            className="overflow-hidden"
            action={
              <GhostButton
                onClick={() => setFinderOpen((open) => !open)}
                disabled={findProspectsMutation.isPending}
                pending={findProspectsMutation.isPending}
                icon={Target}
              >
                <span className="max-w-[180px] truncate">
                  {findProspectsMutation.isPending ? 'Searching…' : `Find ${company.name}'s prospects`}
                </span>
                {!findProspectsMutation.isPending && (
                  <ChevronRight size={13} className={`transition-transform ${finderOpen ? 'rotate-90' : ''}`} />
                )}
              </GhostButton>
            }
          >
            {finderOpen && (
              <ProspectFinderPicker
                companyName={company.name}
                playbooks={playbooks}
                personas={personas}
                playbookId={effectivePlaybookId}
                onPlaybookChange={setPlaybookId}
                selectedPersonaIds={selectedPersonaIds}
                onTogglePersona={(personaId) =>
                  setSelectedPersonaIds((ids) =>
                    ids.includes(personaId) ? ids.filter((p) => p !== personaId) : [...ids, personaId]
                  )
                }
                onRun={() => findProspectsMutation.mutate()}
                onCancel={() => setFinderOpen(false)}
                pending={findProspectsMutation.isPending}
              />
            )}

            {pendingCandidates.length > 0 && !resultsDismissed && (
              <CandidateReview
                candidates={pendingCandidates}
                selected={selectedCandidateIds}
                pending={importProspectsMutation.isPending}
                playbookName={company.prospectSearch?.playbookName}
                lastRunAt={company.prospectSearch?.lastRunAt}
                onToggle={(candidateId) =>
                  setSelectedCandidateIds((ids) =>
                    ids.includes(candidateId) ? ids.filter((c) => c !== candidateId) : [...ids, candidateId]
                  )
                }
                onSelectAll={(all) => setSelectedCandidateIds(all ? pendingCandidates.map((c) => c._id) : [])}
                onImport={() => importProspectsMutation.mutate(selectedCandidateIds)}
                onDismiss={() => {
                  setResultsDismissed(true);
                  setSelectedCandidateIds([]);
                }}
              />
            )}

            {searchFailed && (
              <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/[0.07] px-4 py-3">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red-400" />
                <p className="text-sm leading-relaxed text-red-200/90">
                  <span className="font-medium">Last search failed.</span> {company.prospectSearch.error}
                </p>
              </div>
            )}

            {prospects.length === 0 ? (
              <EmptyState icon={Users}>
                No prospects linked to this company yet. Attach a playbook and run a search to find people
                worth reaching at {company.name}.
              </EmptyState>
            ) : (
              <div
                className={`divide-y divide-slate-800/60 ${
                  hasFinderPanel ? '-mx-5 -mb-5 border-t border-slate-800/60' : '-m-5'
                }`}
              >
                {prospects.map((p) => {
                  const fullName = `${p.firstName || ''} ${p.lastName || ''}`.trim();
                  return (
                    <button
                      key={p._id}
                      type="button"
                      onClick={() => navigate(`/prospects/${p._id}`)}
                      className="group flex w-full items-center gap-3.5 px-5 py-3 text-left transition hover:bg-indigo-500/[0.06]"
                    >
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-[11px] font-bold text-white ${colorForName(fullName)}`}
                      >
                        {initialsForName(fullName)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">{fullName || 'Unnamed prospect'}</p>
                        {p.enrichedProfile?.currentRole && (
                          <p className="mt-0.5 truncate text-xs text-slate-500">{p.enrichedProfile.currentRole}</p>
                        )}
                      </div>
                      {p.compatibilityScore != null && (
                        <span
                          className={`shrink-0 rounded-lg px-2 py-1 text-xs font-bold tabular-nums ring-1 ${scoreTier(p.compatibilityScore)}`}
                        >
                          {p.compatibilityScore}
                        </span>
                      )}
                      <span
                        className={`hidden shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ring-1 sm:inline-flex ${
                          STATUS_COLOR[p.pipelineStatus] || 'bg-slate-800 text-slate-400 ring-slate-700'
                        }`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                        {STATUS_LABEL[p.pipelineStatus] || p.pipelineStatus}
                      </span>
                      <ChevronRight
                        size={15}
                        className="shrink-0 text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-indigo-400"
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-5">
          <Card
            icon={AtSign}
            title="Contacts"
            count={contacts.length || null}
            delay={220}
            action={
              <GhostButton
                onClick={() => findContactsMutation.mutate(Boolean(company.contactsScannedAt))}
                disabled={findContactsMutation.isPending || !company.website}
                pending={findContactsMutation.isPending}
                icon={Search}
                title={!company.website ? "Set this company's website first" : undefined}
              >
                {findContactsMutation.isPending
                  ? 'Scanning…'
                  : company.contactsScannedAt
                  ? 'Re-scan'
                  : 'Find contacts'}
              </GhostButton>
            }
          >
            {contacts.length > 0 ? (
              <div className="space-y-2">
                {contacts.map((c, i) => {
                  const Icon = CONTACT_ICON[c.type] || AtSign;
                  const accent = CONTACT_ACCENT[c.type] || CONTACT_ACCENT.person;
                  return (
                    <div
                      key={i}
                      className="group flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3 transition hover:border-slate-700 hover:bg-slate-950"
                    >
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ${accent}`}>
                        <Icon size={14} />
                      </span>
                      <div className="min-w-0 flex-1">
                        {c.name && (
                          <p className="truncate text-sm font-medium text-white">
                            {c.name}
                            {c.role ? <span className="font-normal text-slate-500"> · {c.role}</span> : ''}
                          </p>
                        )}
                        <a
                          href={contactHref(c)}
                          target={c.type === 'email' || c.type === 'phone' ? undefined : '_blank'}
                          rel="noreferrer"
                          className="block truncate text-sm text-indigo-300 transition hover:text-indigo-200 hover:underline"
                        >
                          {c.value}
                        </a>
                      </div>
                      <CopyButton value={c.value} />
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState icon={AtSign}>
                {company.contactsScannedAt
                  ? 'No contacts found on the website.'
                  : company.website
                  ? 'Scan the website to find contact emails and social profiles.'
                  : 'Set a website to enable contact scanning.'}
              </EmptyState>
            )}
          </Card>

          {facts.length > 0 && (
            <Card icon={Building2} title="Company facts" delay={260}>
              <dl className="divide-y divide-slate-800/60">
                {facts.map(({ icon: Icon, label, value }) => (
                  <div key={label} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <Icon size={13} className="shrink-0 text-slate-600" />
                    <dt className="w-28 shrink-0 text-xs text-slate-500">{label}</dt>
                    <dd className="min-w-0 flex-1 truncate text-right text-sm text-slate-200">{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}

          {company.atsBoard?.provider && (
            <Card icon={Layers} title="Hiring board" delay={300}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium capitalize text-white">{company.atsBoard.provider}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {typeof openRoles === 'number' ? `${openRoles} open role${openRoles === 1 ? '' : 's'}` : 'Role count unknown'}
                    {company.atsBoard.lastCheckedAt &&
                      ` · checked ${new Date(company.atsBoard.lastCheckedAt).toLocaleDateString()}`}
                  </p>
                </div>
                {company.atsBoard.url && (
                  <a
                    href={company.atsBoard.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700/70 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-indigo-500/40 hover:bg-indigo-500/10 hover:text-indigo-200"
                  >
                    <ExternalLink size={13} /> Open
                  </a>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
