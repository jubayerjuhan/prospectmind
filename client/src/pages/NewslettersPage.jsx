import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Mail, Plus, ArrowLeft, Eye, Send, Ban, Loader2, Trash2, Clock, CheckCircle2, AlertCircle, RefreshCw,
} from 'lucide-react';
import api from '../lib/api';
import NewsletterCard from '../components/newsletters/NewsletterCard';
import NewsletterEditor from '../components/newsletters/NewsletterEditor';
import RecipientsTab from '../components/newsletters/RecipientsTab';
import SendNewsletterModal from '../components/newsletters/SendNewsletterModal';
import NewsletterPreviewModal from '../components/newsletters/NewsletterPreviewModal';
import { STATUS_COLOR, IS_LIVE, formatWhen } from '../components/newsletters/newsletterStatus';

/**
 * Gallery + workspace in one page, switched by search params rather than nested
 * routes — the same shape CampaignsPage uses.
 */
export default function NewslettersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const activeId = searchParams.get('id');
  const tab = searchParams.get('tab') || 'content';

  const [showSend, setShowSend] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [draft, setDraft] = useState(null);

  const { data: newsletters, isLoading } = useQuery({
    queryKey: ['newsletters'],
    queryFn: () => api.get('/newsletters', { params: { limit: 100 } }).then((r) => r.data.data),
  });

  const { data: active } = useQuery({
    queryKey: ['newsletter', activeId],
    queryFn: () => api.get(`/newsletters/${activeId}`).then((r) => r.data.data),
    enabled: Boolean(activeId),
    refetchInterval: (query) => (IS_LIVE(query.state.data?.status) ? 4000 : false),
  });

  // Local draft so typing doesn't round-trip on every keystroke, re-seeded when
  // a different newsletter is opened. Adjusting state during render rather than
  // in an effect: React re-runs the render immediately with the new state and
  // never commits the stale one, so the editor can't flash the previous body.
  const [draftFor, setDraftFor] = useState(null);
  if (active && draftFor !== active._id) {
    setDraftFor(active._id);
    setDraft({ subject: active.subject, bodyHtml: active.bodyHtml, fromName: active.fromName, replyTo: active.replyTo });
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['newsletters'] });
    if (activeId) queryClient.invalidateQueries({ queryKey: ['newsletter', activeId] });
  };

  const create = useMutation({
    mutationFn: (name) => api.post('/newsletters', { name }),
    onSuccess: (res) => {
      toast.success('Newsletter created.');
      invalidate();
      setSearchParams({ id: res.data.data._id, tab: 'content' });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Could not create'),
  });

  const save = useMutation({
    mutationFn: () => api.patch(`/newsletters/${activeId}`, draft),
    onSuccess: () => { toast.success('Saved.'); invalidate(); },
    onError: (err) => toast.error(err.response?.data?.message || 'Could not save'),
  });

  const cancel = useMutation({
    mutationFn: () => api.post(`/newsletters/${activeId}/cancel`),
    onSuccess: (res) => { toast.success(res.data.message); invalidate(); },
    onError: (err) => toast.error(err.response?.data?.message || 'Could not cancel'),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/newsletters/${activeId}`),
    onSuccess: () => { toast.success('Newsletter deleted.'); invalidate(); setSearchParams({}); },
    onError: (err) => toast.error(err.response?.data?.message || 'Could not delete'),
  });

  const newNewsletter = () => {
    const name = window.prompt('Name this newsletter');
    if (name?.trim()) create.mutate(name.trim());
  };

  /* ── Gallery ────────────────────────────────────────────────────────────── */
  if (!activeId) {
    return (
      <div className="animate-rise">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-white flex items-center gap-2.5">
              <Mail size={22} className="text-indigo-400" /> Newsletters
            </h1>
            <p className="text-sm text-slate-500 mt-1">Write once, send to a list of people.</p>
          </div>
          <button
            onClick={newNewsletter}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-500 transition"
          >
            <Plus size={15} /> New newsletter
          </button>
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-slate-900" />)}
          </div>
        ) : !newsletters?.length ? (
          <div className="rounded-2xl border border-dashed border-slate-800 py-16 text-center">
            <Mail size={28} className="mx-auto text-slate-700" />
            <p className="mt-3 text-slate-400">No newsletters yet</p>
            <p className="mt-1 text-sm text-slate-600">Create one, add recipients, and send.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {newsletters.map((n) => (
              <NewsletterCard key={n._id} newsletter={n} onOpen={() => setSearchParams({ id: n._id, tab: 'content' })} />
            ))}
          </div>
        )}
      </div>
    );
  }

  /* ── Workspace ──────────────────────────────────────────────────────────── */
  if (!active || !draft) return <div className="h-64 animate-pulse rounded-2xl bg-slate-900" />;

  const locked = ['sending', 'sent'].includes(active.status);
  const dirty =
    draft.subject !== active.subject || draft.bodyHtml !== active.bodyHtml ||
    draft.fromName !== active.fromName || draft.replyTo !== active.replyTo;

  return (
    <div className="animate-rise">
      <button onClick={() => setSearchParams({})} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-white transition mb-5">
        <ArrowLeft size={15} /> All newsletters
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-white truncate">{active.name}</h1>
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_COLOR[active.status]}`}>{active.status}</span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            {active.recipientCount} recipient{active.recipientCount === 1 ? '' : 's'}
            {active.status === 'scheduled' && <> · sending {formatWhen(active.scheduledFor)}</>}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => setShowPreview(true)} className="flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 transition">
            <Eye size={15} /> Preview
          </button>
          {['scheduled', 'sending'].includes(active.status) ? (
            <button onClick={() => cancel.mutate()} className="flex items-center gap-2 rounded-lg bg-red-900/40 px-4 py-2 text-sm text-red-300 hover:bg-red-900/60 transition">
              {cancel.isPending ? <Loader2 size={15} className="animate-spin" /> : <Ban size={15} />} Cancel
            </button>
          ) : active.status === 'sent' && active.stats.failed > 0 ? (
            // A delivered campaign can still have failures worth retrying. The
            // server only requeues 'failed' recipients, so this can't re-send to
            // anyone who already got it.
            <button onClick={() => setShowSend(true)} className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm text-white hover:bg-amber-500 transition">
              <RefreshCw size={15} /> Retry {active.stats.failed} failed
            </button>
          ) : active.status !== 'sent' ? (
            <button onClick={() => setShowSend(true)} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-500 transition">
              <Send size={15} /> Send
            </button>
          ) : null}
          {!locked && (
            <button
              onClick={() => window.confirm('Delete this newsletter?') && remove.mutate()}
              title="Delete"
              className="rounded-lg bg-slate-800 p-2 text-slate-500 hover:text-red-400 transition"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>

      {(active.status === 'sending' || active.status === 'sent' || active.status === 'failed') && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Recipients', active.stats.total, 'text-white', null],
            ['Sent', active.stats.sent, 'text-emerald-400', CheckCircle2],
            ['Failed', active.stats.failed, 'text-red-400', AlertCircle],
            ['Skipped', active.stats.skipped, 'text-slate-400', Ban],
          ].map(([label, value, color, Icon]) => (
            <div key={label} className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                {Icon && <Icon size={12} />} {label}
              </div>
              <div className={`text-xl font-semibold mt-1 ${color}`}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {active.status === 'sending' && (
        <div className="mb-6 flex items-center gap-2.5 rounded-lg bg-indigo-900/20 border border-indigo-900/40 px-4 py-3 text-sm text-indigo-200">
          <Loader2 size={15} className="animate-spin" />
          Sending in progress — this page updates as it goes.
        </div>
      )}
      {active.error && (
        <div className="mb-6 flex items-center gap-2.5 rounded-lg bg-red-900/20 border border-red-900/40 px-4 py-3 text-sm text-red-200">
          <AlertCircle size={15} /> {active.error}
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-800 mb-6">
        {[['content', 'Content'], ['recipients', 'Recipients']].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setSearchParams({ id: activeId, tab: id })}
            className={`px-4 py-2.5 text-sm transition border-b-2 -mb-px ${
              tab === id ? 'border-indigo-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'content' ? (
        <div className="space-y-4">
          {locked && (
            <div className="flex items-center gap-2.5 rounded-lg bg-slate-800/60 px-4 py-3 text-sm text-slate-400">
              <Clock size={15} /> This newsletter has been sent, so its content is locked.
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">From name</label>
              <input className="input-field" disabled={locked} value={draft.fromName}
                onChange={(e) => setDraft((d) => ({ ...d, fromName: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Reply-to</label>
              <input className="input-field" disabled={locked} value={draft.replyTo}
                onChange={(e) => setDraft((d) => ({ ...d, replyTo: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Subject</label>
            <input className="input-field" disabled={locked} placeholder="What we shipped this month"
              value={draft.subject} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Content</label>
            <NewsletterEditor
              // Remount to re-seed when a different newsletter is opened — see
              // the note in NewsletterEditor about why it isn't controlled.
              key={active._id}
              initialValue={active.bodyHtml}
              disabled={locked}
              onChange={(html) => setDraft((d) => ({ ...d, bodyHtml: html }))}
            />
            <p className="mt-2 text-xs text-slate-600">
              Merge tags like <code className="text-slate-400">{'{{firstName}}'}</code> are filled in per recipient.
              Use <code className="text-slate-400">{'{{firstName|there}}'}</code> to set a fallback. They don&apos;t work inside links.
            </p>
          </div>

          {!locked && (
            <div className="flex justify-end">
              <button
                onClick={() => save.mutate()}
                disabled={!dirty || save.isPending}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm text-white hover:bg-indigo-500 disabled:opacity-60 transition"
              >
                {save.isPending && <Loader2 size={15} className="animate-spin" />}
                {dirty ? 'Save changes' : 'Saved'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <RecipientsTab campaign={active} />
      )}

      {showSend && (
        <SendNewsletterModal
          campaign={active}
          recipientCount={active.recipientCount}
          onClose={() => setShowSend(false)}
          onDone={invalidate}
        />
      )}
      {showPreview && <NewsletterPreviewModal campaign={active} onClose={() => setShowPreview(false)} />}
    </div>
  );
}
