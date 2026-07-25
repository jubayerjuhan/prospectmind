import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import toast from 'react-hot-toast';
import { Plus, Loader2, Pencil, Trash2, X, Check } from 'lucide-react';

const APPLIES_TO_OPTIONS = ['prospect', 'company'];

/**
 * Generic CRUD section for prompt-driven Settings (Persona / Playbook / Signal).
 * All three share { name, prompt, isActive }; Signals add `appliesTo`.
 */
export default function PromptSettingsSection({
  resource,          // API path segment, e.g. "personas"
  label,             // "Persona"
  icon: Icon,        // lucide icon component
  description,       // section explainer (JSX or string)
  namePlaceholder,
  promptPlaceholder,
  activeHint,        // e.g. "Active (used in scoring)"
  showAppliesTo = false,
}) {
  const queryClient = useQueryClient();
  const emptyDraft = { name: '', prompt: '', isActive: true, appliesTo: ['company'] };
  const [editingId, setEditingId] = useState(null); // doc _id or 'new'
  const [draft, setDraft] = useState(emptyDraft);

  const { data: docs = [], isLoading } = useQuery({
    queryKey: [resource],
    queryFn: () => api.get(`/${resource}`).then((r) => r.data.data),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [resource] });

  const closeEditor = () => {
    setEditingId(null);
    setDraft(emptyDraft);
  };

  const createMutation = useMutation({
    mutationFn: (payload) => api.post(`/${resource}`, payload),
    onSuccess: () => { toast.success(`${label} created.`); invalidate(); closeEditor(); },
    onError: (err) => toast.error(err.response?.data?.message || `Failed to create ${label.toLowerCase()}.`),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => api.patch(`/${resource}/${id}`, payload),
    onSuccess: () => { toast.success(`${label} updated.`); invalidate(); closeEditor(); },
    onError: (err) => toast.error(err.response?.data?.message || `Failed to update ${label.toLowerCase()}.`),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }) => api.patch(`/${resource}/${id}`, { isActive }),
    onSuccess: invalidate,
    onError: (err) => toast.error(err.response?.data?.message || `Failed to update ${label.toLowerCase()}.`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/${resource}/${id}`),
    onSuccess: () => { toast.success(`${label} deleted.`); invalidate(); },
    onError: (err) => toast.error(err.response?.data?.message || `Failed to delete ${label.toLowerCase()}.`),
  });

  const startCreate = () => { setEditingId('new'); setDraft(emptyDraft); };

  const startEdit = (doc) => {
    setEditingId(doc._id);
    setDraft({
      name: doc.name,
      prompt: doc.prompt,
      isActive: doc.isActive,
      appliesTo: Array.isArray(doc.appliesTo) && doc.appliesTo.length ? doc.appliesTo : ['company'],
    });
  };

  const toggleAppliesTo = (value) => {
    setDraft((d) => {
      const has = d.appliesTo.includes(value);
      const next = has ? d.appliesTo.filter((v) => v !== value) : [...d.appliesTo, value];
      return { ...d, appliesTo: next };
    });
  };

  const saveDraft = () => {
    if (!draft.name.trim()) return toast.error(`${label} name is required.`);
    if (!draft.prompt.trim()) return toast.error(`${label} prompt is required.`);
    if (showAppliesTo && draft.appliesTo.length === 0) {
      return toast.error(`${label} must apply to at least one of: prospect, company.`);
    }
    const payload = {
      name: draft.name.trim(),
      prompt: draft.prompt.trim(),
      isActive: draft.isActive,
      ...(showAppliesTo ? { appliesTo: draft.appliesTo } : {}),
    };
    if (editingId === 'new') createMutation.mutate(payload);
    else updateMutation.mutate({ id: editingId, payload });
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const editorForm = (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-3">
      <div>
        <label className="block text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
          {label} Name
        </label>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          placeholder={namePlaceholder}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-indigo-500 transition"
        />
      </div>
      <div>
        <label className="block text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
          Prompt
        </label>
        <textarea
          rows={8}
          value={draft.prompt}
          onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))}
          placeholder={promptPlaceholder}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-200 text-sm font-mono leading-relaxed focus:outline-none focus:border-indigo-500 transition resize-y"
        />
      </div>
      {showAppliesTo && (
        <div>
          <label className="block text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
            Applies To
          </label>
          <div className="flex items-center gap-4">
            {APPLIES_TO_OPTIONS.map((opt) => (
              <label key={opt} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.appliesTo.includes(opt)}
                  onChange={() => toggleAppliesTo(opt)}
                  className="w-4 h-4 rounded text-indigo-600 bg-slate-800 border-slate-700 focus:ring-indigo-500 focus:ring-offset-slate-900 focus:ring-2"
                />
                <span className="text-slate-300 text-sm capitalize">{opt}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      <label className="flex items-center gap-2 cursor-pointer w-fit">
        <input
          type="checkbox"
          checked={draft.isActive}
          onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))}
          className="w-4 h-4 rounded text-indigo-600 bg-slate-800 border-slate-700 focus:ring-indigo-500 focus:ring-offset-slate-900 focus:ring-2"
        />
        <span className="text-slate-300 text-sm">{activeHint || 'Active'}</span>
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
          {editingId === 'new' ? `Create ${label}` : 'Save'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <h2 className="text-white font-semibold text-base flex items-center gap-2">
          <Icon size={18} className="text-indigo-400" />
          {label}s
        </h2>
        {editingId === null && (
          <button
            type="button"
            onClick={startCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg text-xs transition"
          >
            <Plus size={14} /> New {label}
          </button>
        )}
      </div>

      <div className="bg-indigo-950/20 border border-indigo-900/40 rounded-lg p-3 text-xs text-indigo-300 leading-relaxed">
        {description}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-6 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-2">
          {editingId === 'new' && editorForm}

          {docs.length === 0 && editingId !== 'new' && (
            <div className="text-center py-8">
              <p className="text-slate-400 text-sm">No {label.toLowerCase()}s yet.</p>
            </div>
          )}

          {docs.map((doc) =>
            editingId === doc._id ? (
              <div key={doc._id}>{editorForm}</div>
            ) : (
              <div
                key={doc._id}
                className="bg-slate-800/40 border border-slate-800 rounded-lg p-4 flex items-start justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-white text-sm font-medium truncate">{doc.name}</p>
                    {doc.isActive ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-medium shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-700/50 text-slate-400 text-[10px] font-medium shrink-0">
                        Inactive
                      </span>
                    )}
                    {showAppliesTo && Array.isArray(doc.appliesTo) && (
                      <span className="text-slate-500 text-[10px] shrink-0">
                        → {doc.appliesTo.join(', ')}
                      </span>
                    )}
                  </div>
                  <p className="text-slate-500 text-xs mt-1 line-clamp-2">{doc.prompt}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    title={doc.isActive ? 'Deactivate' : 'Activate'}
                    onClick={() => toggleMutation.mutate({ id: doc._id, isActive: !doc.isActive })}
                    className="px-2 py-1 text-slate-400 hover:text-indigo-300 text-xs transition"
                  >
                    {doc.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    type="button"
                    title="Edit"
                    onClick={() => startEdit(doc)}
                    className="p-1.5 text-slate-400 hover:text-indigo-300 transition"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    title="Delete"
                    onClick={() => {
                      if (window.confirm(`Delete ${label.toLowerCase()} "${doc.name}"? This cannot be undone.`)) {
                        deleteMutation.mutate(doc._id);
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
