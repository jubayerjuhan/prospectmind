import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link as LinkIcon, Loader2, Search, UserPlus, X } from 'lucide-react';
import api from '../../lib/api';
import toast from 'react-hot-toast';

export default function CampaignImportModal({ campaign, onClose, onImported }) {
  const [url, setUrl] = useState('');
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [preview, setPreview] = useState(null);

  const isConfigured = campaign.campaignDescription?.trim();

  const previewMutation = useMutation({
    mutationFn: (pageUrl) =>
      api.post(`/prospect-lists/${campaign._id}/import-preview`, { url: pageUrl }).then((res) => res.data.data),
    onSuccess: (data) => {
      setPreview(data);
      setSelectedKeys(data.candidates.map((candidate) => candidate.sourceKey));
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to preview import'),
  });

  const confirmMutation = useMutation({
    mutationFn: (candidates) =>
      api.post(`/prospect-lists/${campaign._id}/import-confirm`, { candidates }).then((res) => res.data.data),
    onSuccess: (data) => {
      toast.success(`${data.created} prospects imported into ${campaign.name}`);
      onImported?.();
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to import prospects'),
  });

  const selectedCandidates = useMemo(() => {
    if (!preview?.candidates) return [];
    const keys = new Set(selectedKeys);
    return preview.candidates.filter((candidate) => keys.has(candidate.sourceKey));
  }, [preview, selectedKeys]);

  const toggleSelected = (sourceKey) => {
    setSelectedKeys((prev) =>
      prev.includes(sourceKey) ? prev.filter((key) => key !== sourceKey) : [...prev, sourceKey]
    );
  };

  const handlePreview = (e) => {
    e.preventDefault();
    previewMutation.mutate(url);
  };

  const handleConfirm = () => {
    if (!selectedCandidates.length) return;
    confirmMutation.mutate(selectedCandidates);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div>
            <h2 className="text-white font-semibold">Import prospects from page</h2>
            <p className="text-slate-500 text-sm mt-1">Campaign: {campaign.name}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {!isConfigured && (
          <div className="px-6 py-3 bg-amber-950/40 border-b border-amber-900/50 text-amber-400 text-sm">
            <strong>Action Required:</strong> You must configure the Campaign & Outreach Goal and AI Pipeline Preferences for this campaign before importing prospects. Please close this modal and go to the Campaign Settings tab.
          </div>
        )}

        <form onSubmit={handlePreview} className="px-6 py-4 border-b border-slate-800 flex gap-3">
          <div className="relative flex-1">
            <LinkIcon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              required
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://ethcc.io/ethcc-9/speakers"
              disabled={!isConfigured}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
          <button
            type="submit"
            disabled={previewMutation.isPending || !isConfigured}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition"
          >
            {previewMutation.isPending ? 'Scraping…' : 'Preview import'}
          </button>
        </form>

        <div className="flex-1 overflow-hidden grid lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <div className="overflow-y-auto border-r border-slate-800">
            {!preview ? (
              <div className="h-full flex items-center justify-center text-center px-8">
                <div>
                  <Search size={24} className="mx-auto text-slate-600 mb-3" />
                  <p className="text-slate-300">Enter a page URL to preview importable people.</p>
                  <p className="text-slate-500 text-sm mt-2">
                    The importer will extract names, company, socials, and any detail text it can find.
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium">{preview.metadata?.totalFound || preview.candidates.length} candidates found</p>
                    <p className="text-slate-500 text-xs mt-1">
                      Strategy: {preview.metadata?.strategy || 'unknown'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedKeys(preview.candidates.map((candidate) => candidate.sourceKey))}
                    className="text-xs text-slate-400 hover:text-white transition"
                  >
                    Select all
                  </button>
                </div>

                {preview.candidates.map((candidate) => (
                  <label
                    key={candidate.sourceKey}
                    className="block rounded-xl border border-slate-800 bg-slate-950/70 p-4 hover:bg-slate-800/70 transition cursor-pointer"
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selectedKeys.includes(candidate.sourceKey)}
                        onChange={() => toggleSelected(candidate.sourceKey)}
                        className="mt-1 rounded border-slate-700 bg-slate-950 text-indigo-500 focus:ring-indigo-500"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-white font-medium">{candidate.name}</p>
                            <p className="text-slate-400 text-sm mt-1">
                              {[candidate.company, candidate.role].filter(Boolean).join(' · ') || 'No company/role found'}
                            </p>
                          </div>
                          {candidate.eventContext?.track && (
                            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                              {candidate.eventContext.track}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2 mt-3">
                          {candidate.socials?.linkedinUrl && (
                            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">LinkedIn</span>
                          )}
                          {candidate.socials?.xUrl && (
                            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">X</span>
                          )}
                          {candidate.socials?.githubUrl && (
                            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">GitHub</span>
                          )}
                          {candidate.eventContext?.stageLabel && (
                            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">{candidate.eventContext.stageLabel}</span>
                          )}
                        </div>

                        {(candidate.eventContext?.talkTitle || candidate.eventContext?.description || candidate.detailText) && (
                          <p className="text-slate-500 text-xs leading-relaxed mt-3">
                            {candidate.eventContext?.talkTitle || candidate.eventContext?.description || candidate.detailText}
                          </p>
                        )}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="overflow-y-auto p-4 space-y-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-white font-medium">Import summary</p>
              <p className="text-slate-500 text-sm mt-2">
                {selectedCandidates.length} candidate{selectedCandidates.length === 1 ? '' : 's'} selected for import
              </p>
              {previewMutation.isPending && (
                <div className="flex items-center gap-2 text-slate-400 text-sm mt-3">
                  <Loader2 size={14} className="animate-spin" />
                  Scraping page and extracting candidates…
                </div>
              )}
            </div>

            <div className="space-y-2">
              {selectedCandidates.slice(0, 8).map((candidate) => (
                <div key={candidate.sourceKey} className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
                  <p className="text-slate-200 text-sm font-medium">{candidate.name}</p>
                  <p className="text-slate-500 text-xs mt-1">{candidate.company || candidate.role || 'No company/role found'}</p>
                </div>
              ))}
              {selectedCandidates.length > 8 && (
                <p className="text-slate-500 text-xs">…and {selectedCandidates.length - 8} more</p>
              )}
            </div>

            <button
              type="button"
              disabled={!selectedCandidates.length || confirmMutation.isPending}
              onClick={handleConfirm}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition"
            >
              <UserPlus size={15} />
              {confirmMutation.isPending ? 'Importing…' : 'Create prospects in campaign'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
