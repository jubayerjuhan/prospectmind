import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import toast from 'react-hot-toast';
import {
  Rocket, Plus, Loader2, ChevronRight, X, Check, Trash2,
} from 'lucide-react';

const CHANNELS = ['email', 'linkedin', 'x', 'telegram'];

const STATUS_BADGE = {
  draft: 'bg-slate-700 text-slate-300',
  generating: 'bg-indigo-900/50 text-indigo-300',
  ready: 'bg-green-900/50 text-green-400',
  failed: 'bg-red-900/50 text-red-400',
};

const EMPTY_DRAFT = {
  name: '',
  targetList: '',
  persona: '',
  playbook: '',
  sequence: [{ channel: 'email', delayDays: 0 }],
};

export default function OutreachPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ['outreach-campaigns'],
    queryFn: () => api.get('/campaigns').then((r) => r.data.data),
    refetchInterval: (q) =>
      (q.state.data || []).some((c) => c.status === 'generating') ? 4000 : false,
  });

  const { data: lists = [] } = useQuery({
    queryKey: ['prospect-lists', 'all'],
    queryFn: () => api.get('/prospect-lists', { params: { limit: 100 } }).then((r) => r.data.data),
    enabled: showCreate,
  });
  const { data: personas = [] } = useQuery({
    queryKey: ['personas', 'active'],
    queryFn: () => api.get('/personas', { params: { active: 'true' } }).then((r) => r.data.data),
    enabled: showCreate,
  });
  const { data: playbooks = [] } = useQuery({
    queryKey: ['playbooks', 'active'],
    queryFn: () => api.get('/playbooks', { params: { active: 'true' } }).then((r) => r.data.data),
    enabled: showCreate,
  });

  const createMutation = useMutation({
    mutationFn: (payload) => api.post('/campaigns', payload),
    onSuccess: (res) => {
      toast.success('Campaign created.');
      queryClient.invalidateQueries({ queryKey: ['outreach-campaigns'] });
      setShowCreate(false);
      setDraft(EMPTY_DRAFT);
      navigate(`/outreach/${res.data.data._id}`);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to create campaign.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/campaigns/${id}`),
    onSuccess: () => {
      toast.success('Campaign deleted.');
      queryClient.invalidateQueries({ queryKey: ['outreach-campaigns'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to delete campaign.'),
  });

  const submitCreate = () => {
    if (!draft.name.trim()) return toast.error('Campaign name is required.');
    if (!draft.targetList) return toast.error('Pick a target list.');
    if (!draft.persona) return toast.error('Pick a persona.');
    if (!draft.playbook) return toast.error('Pick a playbook.');
    createMutation.mutate(draft);
  };

  const setStep = (i, patch) =>
    setDraft((d) => ({
      ...d,
      sequence: d.sequence.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    }));

  const selectCls =
    'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-indigo-500 transition';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-2xl font-bold flex items-center gap-2">
            <Rocket className="text-indigo-400" size={24} /> Outreach
          </h1>
          <p className="text-slate-400 mt-1">
            Campaigns combine a target list, a persona and a playbook into a generated outreach sequence — using existing analysis only.
          </p>
        </div>
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg text-sm transition"
          >
            <Plus size={16} /> New Campaign
          </button>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <h2 className="text-white font-semibold text-base border-b border-slate-800 pb-3">New Outreach Campaign</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">Name</label>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="e.g. Web3 founders — July"
                className={selectCls}
              />
            </div>
            <div>
              <label className="block text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">Target List</label>
              <select value={draft.targetList} onChange={(e) => setDraft((d) => ({ ...d, targetList: e.target.value }))} className={selectCls}>
                <option value="">Select a list…</option>
                {lists.map((l) => (
                  <option key={l._id} value={l._id}>{l.name} ({l.prospectCount ?? '?'} prospects)</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">Persona</label>
              <select value={draft.persona} onChange={(e) => setDraft((d) => ({ ...d, persona: e.target.value }))} className={selectCls}>
                <option value="">Select a persona…</option>
                {personas.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">Playbook</label>
              <select value={draft.playbook} onChange={(e) => setDraft((d) => ({ ...d, playbook: e.target.value }))} className={selectCls}>
                <option value="">Select a playbook…</option>
                {playbooks.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">Sequence</label>
            <div className="space-y-2">
              {draft.sequence.map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-slate-500 text-xs w-12 shrink-0">Step {i + 1}</span>
                  <select value={s.channel} onChange={(e) => setStep(i, { channel: e.target.value })} className={`${selectCls} w-36`}>
                    {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <div className="flex items-center gap-1.5 text-slate-400 text-xs">
                    <input
                      type="number"
                      min={0}
                      value={s.delayDays}
                      onChange={(e) => setStep(i, { delayDays: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                      className="w-16 bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
                    />
                    day(s) after previous
                  </div>
                  {draft.sequence.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, sequence: d.sequence.filter((_, idx) => idx !== i) }))}
                      className="p-1.5 text-slate-500 hover:text-red-400 transition"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => setDraft((d) => ({ ...d, sequence: [...d.sequence, { channel: 'linkedin', delayDays: 3 }] }))}
                className="flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 text-xs transition"
              >
                <Plus size={13} /> Add step
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => { setShowCreate(false); setDraft(EMPTY_DRAFT); }}
              className="flex items-center gap-1.5 px-4 py-2 text-slate-400 hover:text-slate-200 text-sm transition"
            >
              <X size={15} /> Cancel
            </button>
            <button
              type="button"
              disabled={createMutation.isPending}
              onClick={submitCreate}
              className="flex items-center gap-1.5 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium rounded-lg text-sm transition"
            >
              {createMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              Create Campaign
            </button>
          </div>
        </div>
      )}

      {/* Campaign list */}
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 text-slate-400 text-sm py-16">
          <Loader2 size={16} className="animate-spin" /> Loading campaigns…
        </div>
      ) : campaigns.length === 0 && !showCreate ? (
        <div className="text-center py-16 bg-slate-900 border border-slate-800 rounded-xl">
          <Rocket size={32} className="mx-auto text-slate-600 mb-3" />
          <p className="text-slate-400 text-sm">No outreach campaigns yet.</p>
          <p className="text-slate-500 text-xs mt-1">Create one to generate a personalized sequence for a target list.</p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl divide-y divide-slate-800/70 overflow-hidden">
          {campaigns.map((c) => (
            <div key={c._id} className="flex items-center gap-3 pr-3 hover:bg-slate-800/40 transition">
              <button
                type="button"
                onClick={() => navigate(`/outreach/${c._id}`)}
                className="flex-1 flex items-center gap-4 px-5 py-4 text-left min-w-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-white text-sm font-medium truncate">{c.name}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0 ${STATUS_BADGE[c.status] || STATUS_BADGE.draft}`}>
                      {c.status === 'generating' ? 'generating…' : c.status}
                    </span>
                  </div>
                  <p className="text-slate-500 text-xs mt-0.5 truncate">
                    {c.targetList?.name || 'list'} · {c.persona?.name || 'persona'} · {c.playbook?.name || 'playbook'} · {c.sequence?.length || 0} step(s)
                  </p>
                </div>
                <ChevronRight size={16} className="text-slate-600 shrink-0" />
              </button>
              <button
                type="button"
                title="Delete"
                onClick={() => {
                  if (window.confirm(`Delete campaign "${c.name}"?`)) deleteMutation.mutate(c._id);
                }}
                className="p-1.5 text-slate-500 hover:text-red-400 transition shrink-0"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
