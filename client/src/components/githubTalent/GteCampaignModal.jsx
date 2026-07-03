import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { X, Loader2, Sparkles, Code2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';

export default function GteCampaignModal({ onClose }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: '',
    talentDescription: '',
    maxRepos: 10,
    targetEcosystemContext: '',
    preferredAiModel: 'auto',
  });

  const mutation = useMutation({
    mutationFn: (data) => api.post('/github-talent', data).then(res => res.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['gte-campaigns'] });
      toast.success('Campaign created successfully');
      navigate(`/github-talent-engine/${data.data._id}`);
      onClose();
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || 'Failed to create campaign');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.talentDescription.trim()) {
      toast.error('Name and description are required');
      return;
    }
    mutation.mutate(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Code2 size={16} className="text-white" />
            </div>
            <h2 className="text-white font-bold">New Talent Engine Campaign</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto">
          <form id="gte-form" onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Campaign Name *</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 text-white px-4 py-2.5 rounded-xl focus:outline-none focus:border-indigo-500 transition"
                placeholder="e.g. Q3 Senior Rust Engineers"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Talent Description *</label>
              <textarea
                required
                rows={4}
                value={formData.talentDescription}
                onChange={(e) => setFormData({ ...formData, talentDescription: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 text-white px-4 py-3 rounded-xl focus:outline-none focus:border-indigo-500 transition resize-none"
                placeholder="e.g. We are looking for senior smart contract developers with deep experience in Solidity, DeFi protocols, and Foundry."
              />
              <p className="text-xs text-slate-500 mt-1.5 flex items-center gap-1.5">
                <Sparkles size={12} className="text-indigo-400" />
                AI will use this description to generate GitHub search keywords and evaluate prospects.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Ecosystem / Project Context (Optional)</label>
              <input
                type="text"
                value={formData.targetEcosystemContext}
                onChange={(e) => setFormData({ ...formData, targetEcosystemContext: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 text-white px-4 py-2.5 rounded-xl focus:outline-none focus:border-indigo-500 transition"
                placeholder="e.g. Ethereum L2, Zero-knowledge proofs"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Max Repositories to Search</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="1"
                    max="30"
                    value={formData.maxRepos}
                    onChange={(e) => setFormData({ ...formData, maxRepos: Number(e.target.value) })}
                    className="flex-1 accent-indigo-500"
                  />
                  <span className="text-sm font-medium text-white w-8 text-right">{formData.maxRepos}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1.5">
                  More repos = more prospects, but slower to run.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">AI Provider</label>
                <select
                  value={formData.preferredAiModel}
                  onChange={(e) => setFormData({ ...formData, preferredAiModel: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 text-white px-4 py-2.5 rounded-xl focus:outline-none focus:border-indigo-500 transition appearance-none"
                >
                  <option value="auto">Auto (Groq → Gemini)</option>
                  <option value="groq">Groq (Faster)</option>
                  <option value="gemini">Gemini (Smarter)</option>
                </select>
              </div>
            </div>
          </form>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-800 shrink-0 bg-slate-900/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-slate-400 hover:text-white transition font-medium"
            disabled={mutation.isPending}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="gte-form"
            disabled={mutation.isPending}
            className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium transition disabled:opacity-50"
          >
            {mutation.isPending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Generating Keywords...
              </>
            ) : (
              'Create & Generate Keywords'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
