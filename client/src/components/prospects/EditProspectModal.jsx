import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import toast from 'react-hot-toast';
import { X, Save, Loader2 } from 'lucide-react';
import MicButton from '../ui/MicButton';

/**
 * Edit Prospect Modal
 *
 * Allows editing: description, typeHint, rawEmail, rawLinkedin, rawX,
 * rawTelegram, rawGithub.
 *
 * Calls PATCH /api/prospects/:id
 *
 * @param {{ prospect: object, onClose: Function, onUpdated?: Function }} props
 */
export default function EditProspectModal({ prospect, onClose, onUpdated }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    description: prospect.description || '',
    typeHint: prospect.typeHint || 'unknown',
    rawEmail: prospect.rawEmail || '',
    rawLinkedin: prospect.rawLinkedin || '',
    rawX: prospect.rawX || '',
    rawTelegram: prospect.rawTelegram || '',
    rawGithub: prospect.rawGithub || '',
  });

  const mutation = useMutation({
    mutationFn: (data) => api.patch(`/prospects/${prospect._id}`, data),
    onSuccess: (response) => {
      toast.success('Prospect updated');
      queryClient.invalidateQueries({ queryKey: ['prospect', prospect._id] });
      queryClient.invalidateQueries({ queryKey: ['prospects'] });
      onUpdated?.(response.data.data);
      onClose();
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || 'Failed to update prospect');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    mutation.mutate(form);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 flex-shrink-0">
          <div>
            <h2 className="text-white font-semibold">Edit prospect</h2>
            <p className="text-slate-500 text-xs mt-0.5">
              {prospect.firstName} {prospect.lastName}
              {prospect.company ? ` · ${prospect.company}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 overflow-y-auto">

          {/* Description — the most important new field */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
                Additional Context
              </label>
              <MicButton
                onTranscript={(text) =>
                  setForm((prev) => ({
                    ...prev,
                    description: prev.description.trim() ? `${prev.description.trim()} ${text}` : text,
                  }))
                }
              />
            </div>
            <p className="text-slate-600 text-xs mb-2 leading-relaxed">
              Add background info you have about this person. The AI will use this as verified context
              when enriching their profile — it won't contradict scraped data, but will fill in gaps.
            </p>
            <textarea
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-indigo-500 transition resize-none placeholder-slate-500"
              rows={5}
              placeholder="e.g. Met at ETHDenver 2025. Works at Uniswap as a senior Solidity engineer, focused on v4 hooks. Has a PhD in CS from MIT. Was previously at Paradigm."
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          {/* Type hint */}
          <div>
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wider block mb-2">Type</label>
            <select
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-indigo-500 transition"
              value={form.typeHint}
              onChange={(e) => setForm({ ...form, typeHint: e.target.value })}
            >
              <option value="unknown">Unknown</option>
              <option value="talent">Talent</option>
              <option value="client">Client</option>
            </select>
          </div>

          {/* Social hints */}
          <div className="border-t border-slate-800 pt-4">
            <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">
              Contact Hints
            </p>
            {[
              ['Email', 'rawEmail', 'email', 'someone@example.com'],
              ['LinkedIn URL', 'rawLinkedin', 'text', 'https://linkedin.com/in/username'],
              ['X / Twitter URL', 'rawX', 'text', 'https://x.com/username'],
              ['Telegram handle', 'rawTelegram', 'text', '@username'],
              ['GitHub URL', 'rawGithub', 'text', 'https://github.com/username'],
            ].map(([label, key, type, placeholder]) => (
              <div key={key} className="mb-3">
                <label className="text-slate-400 text-xs block mb-1">{label}</label>
                <input
                  type={type}
                  placeholder={placeholder}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-indigo-500 transition placeholder-slate-600"
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </div>
            ))}
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex-1 flex items-center justify-center gap-2 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition"
            >
              {mutation.isPending ? (
                <><Loader2 size={14} className="animate-spin" /> Saving…</>
              ) : (
                <><Save size={14} /> Save changes</>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
