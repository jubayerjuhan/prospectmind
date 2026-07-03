import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { Save, Settings, Shield, Zap, Loader2 } from 'lucide-react';

export default function SettingsPage() {
  const queryClient = useQueryClient();
  
  // Settings local state
  const [name, setName] = useState('');
  const [autoEnrich, setAutoEnrich] = useState(false);
  const [outreachReviewRequired, setOutreachReviewRequired] = useState(true);

  // Fetch organization settings
  const { data: orgData, isLoading } = useQuery({
    queryKey: ['organization', 'me'],
    queryFn: () => api.get('/organization/me').then((r) => r.data.data),
  });

  // Populate state once data is loaded
  useEffect(() => {
    if (orgData) {
      setName(orgData.name || '');
      if (orgData.settings) {
        setAutoEnrich(!!orgData.settings.autoEnrich);
        setOutreachReviewRequired(orgData.settings.outreachReviewRequired !== false);
      }
    }
  }, [orgData]);

  // Mutation to save settings
  const saveMutation = useMutation({
    mutationFn: (updates) => api.patch('/organization/me', updates),
    onSuccess: (res) => {
      toast.success('Settings updated successfully!');
      queryClient.invalidateQueries(['organization', 'me']);
      queryClient.invalidateQueries(['usage']);
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || 'Failed to update settings');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    saveMutation.mutate({
      name,
      settings: {
        autoEnrich,
        outreachReviewRequired,
      },
    });
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        <p className="text-slate-400 text-sm">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-white text-2xl font-bold flex items-center gap-2">
          <Settings className="text-indigo-400" size={24} />
          Organization Settings
        </h1>
        <p className="text-slate-400 mt-1">
          Configure your workspace name and AI pipeline defaults
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        
        {/* Workspace Info Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <h2 className="text-white font-semibold text-base flex items-center gap-2 border-b border-slate-800 pb-3">
            <Shield size={18} className="text-indigo-400" />
            General Information
          </h2>
          <div>
            <label className="block text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
              Organization Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-indigo-500 transition"
              placeholder="e.g. Acme Recruiting"
            />
          </div>
        </div>

        {/* Pipeline Preferences Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
          <h2 className="text-white font-semibold text-base flex items-center gap-2 border-b border-slate-800 pb-3">
            <Zap size={18} className="text-indigo-400" />
            AI Pipeline Defaults
          </h2>

          <div className="bg-indigo-950/20 border border-indigo-900/40 rounded-lg p-3 text-xs text-indigo-300 leading-relaxed">
            <strong>Note:</strong> Campaign-specific goals and ecosystem context are now configured <strong>per-campaign</strong> inside the Campaigns page. The settings below apply globally across all pipeline runs.
          </div>

          <div className="space-y-3 pt-2">
            {/* Auto-enrich toggle */}
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={autoEnrich}
                onChange={(e) => setAutoEnrich(e.target.checked)}
                className="mt-1 w-4 h-4 rounded text-indigo-600 bg-slate-800 border-slate-700 focus:ring-indigo-500 focus:ring-offset-slate-900 focus:ring-2"
              />
              <div>
                <p className="text-white text-sm font-medium group-hover:text-indigo-300 transition">
                  Auto-Enrich Prospects
                </p>
                <p className="text-slate-500 text-xs mt-0.5">
                  Automatically start the enrichment pipeline as soon as a prospect is manually added or imported.
                </p>
              </div>
            </label>

            {/* Review required toggle */}
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={outreachReviewRequired}
                onChange={(e) => setOutreachReviewRequired(e.target.checked)}
                className="mt-1 w-4 h-4 rounded text-indigo-600 bg-slate-800 border-slate-700 focus:ring-indigo-500 focus:ring-offset-slate-900 focus:ring-2"
              />
              <div>
                <p className="text-white text-sm font-medium group-hover:text-indigo-300 transition">
                  Require Outreach Review
                </p>
                <p className="text-slate-500 text-xs mt-0.5">
                  Keep outreach messages in draft state until manually edited and approved before sending.
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Submit Action */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-xl text-sm transition shadow-lg shadow-indigo-950/45 cursor-pointer"
          >
            {saveMutation.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Save size={16} />
            )}
            Save Changes
          </button>
        </div>

      </form>
    </div>
  );
}
