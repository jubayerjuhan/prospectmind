import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import toast from 'react-hot-toast';
import { Users, Plus, Loader2, Pencil, Trash2, X, Check } from 'lucide-react';

const EMPTY_DRAFT = { name: '', prompt: '', isActive: true };

export default function PersonasSettings() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState(null); // persona _id being edited, or 'new'
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  const { data: personas = [], isLoading } = useQuery({
    queryKey: ['personas'],
    queryFn: () => api.get('/personas').then((r) => r.data.data),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['personas'] });

  const closeEditor = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  };

  const createMutation = useMutation({
    mutationFn: (payload) => api.post('/personas', payload),
    onSuccess: () => {
      toast.success('Persona created.');
      invalidate();
      closeEditor();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to create persona.'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => api.patch(`/personas/${id}`, payload),
    onSuccess: () => {
      toast.success('Persona updated.');
      invalidate();
      closeEditor();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update persona.'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }) => api.patch(`/personas/${id}`, { isActive }),
    onSuccess: invalidate,
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update persona.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/personas/${id}`),
    onSuccess: () => {
      toast.success('Persona deleted.');
      invalidate();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to delete persona.'),
  });

  const startCreate = () => {
    setEditingId('new');
    setDraft(EMPTY_DRAFT);
  };

  const startEdit = (persona) => {
    setEditingId(persona._id);
    setDraft({ name: persona.name, prompt: persona.prompt, isActive: persona.isActive });
  };

  const saveDraft = () => {
    if (!draft.name.trim()) return toast.error('Persona name is required.');
    if (!draft.prompt.trim()) return toast.error('Persona prompt is required.');
    const payload = { name: draft.name.trim(), prompt: draft.prompt.trim(), isActive: draft.isActive };
    if (editingId === 'new') createMutation.mutate(payload);
    else updateMutation.mutate({ id: editingId, payload });
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const editorForm = (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-3">
      <div>
        <label className="block text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
          Persona Name
        </label>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          placeholder="e.g. Founder hiring Web3 talent"
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-indigo-500 transition"
        />
      </div>
      <div>
        <label className="block text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
          Scoring Prompt
        </label>
        <textarea
          rows={8}
          value={draft.prompt}
          onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))}
          placeholder="Describe how to recognize and score this type of prospect. e.g. 'You are evaluating whether this prospect is a founder hiring Web3 engineers. Consider… Give a score 0-100 with evidence.'"
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-200 text-sm font-mono leading-relaxed focus:outline-none focus:border-indigo-500 transition resize-y"
        />
        <p className="text-slate-500 text-xs mt-1.5">
          This prompt drives how the pipeline scores prospects against this persona.
        </p>
      </div>
      <label className="flex items-center gap-2 cursor-pointer w-fit">
        <input
          type="checkbox"
          checked={draft.isActive}
          onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))}
          className="w-4 h-4 rounded text-indigo-600 bg-slate-800 border-slate-700 focus:ring-indigo-500 focus:ring-offset-slate-900 focus:ring-2"
        />
        <span className="text-slate-300 text-sm">Active (used in scoring)</span>
      </label>
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={closeEditor}
          className="flex items-center gap-1.5 px-4 py-2 text-slate-400 hover:text-slate-200 text-sm transition"
        >
          <X size={15} /> Cancel
        </button>
        <button
          type="button"
          disabled={isSaving}
          onClick={saveDraft}
          className="flex items-center gap-1.5 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium rounded-lg text-sm transition"
        >
          {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
          {editingId === 'new' ? 'Create Persona' : 'Save'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <h2 className="text-white font-semibold text-base flex items-center gap-2">
          <Users size={18} className="text-indigo-400" />
          Personas
        </h2>
        {editingId === null && (
          <button
            type="button"
            onClick={startCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg text-xs transition"
          >
            <Plus size={14} /> New Persona
          </button>
        )}
      </div>

      <div className="bg-indigo-950/20 border border-indigo-900/40 rounded-lg p-3 text-xs text-indigo-300 leading-relaxed">
        Personas describe the <strong>types of prospects</strong> you target (Founder, CTO, Recruiter…). Each carries an
        AI prompt that tells the pipeline how to recognize and score that type. A prospect is scored against every active persona.
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-6 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading personas…
        </div>
      ) : (
        <div className="space-y-2">
          {editingId === 'new' && editorForm}

          {personas.length === 0 && editingId !== 'new' && (
            <div className="text-center py-8">
              <p className="text-slate-400 text-sm">No personas yet.</p>
              <p className="text-slate-500 text-xs mt-1">Create one to define how prospects are scored.</p>
            </div>
          )}

          {personas.map((persona) =>
            editingId === persona._id ? (
              <div key={persona._id}>{editorForm}</div>
            ) : (
              <div
                key={persona._id}
                className="bg-slate-800/40 border border-slate-800 rounded-lg p-4 flex items-start justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-white text-sm font-medium truncate">{persona.name}</p>
                    {persona.isActive ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-medium shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-700/50 text-slate-400 text-[10px] font-medium shrink-0">
                        Inactive
                      </span>
                    )}
                  </div>
                  <p className="text-slate-500 text-xs mt-1 line-clamp-2">{persona.prompt}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    title={persona.isActive ? 'Deactivate' : 'Activate'}
                    onClick={() => toggleMutation.mutate({ id: persona._id, isActive: !persona.isActive })}
                    className="px-2 py-1 text-slate-400 hover:text-indigo-300 text-xs transition"
                  >
                    {persona.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    type="button"
                    title="Edit"
                    onClick={() => startEdit(persona)}
                    className="p-1.5 text-slate-400 hover:text-indigo-300 transition"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    title="Delete"
                    onClick={() => {
                      if (window.confirm(`Delete persona "${persona.name}"? This cannot be undone.`)) {
                        deleteMutation.mutate(persona._id);
                      }
                    }}
                    className="p-1.5 text-slate-400 hover:text-red-400 transition"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
