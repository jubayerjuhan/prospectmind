import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Code2, Play, Pause, Loader2, Save, Cpu, Users, Settings2, ShieldAlert
} from 'lucide-react';

const STATUS_COLOR = {
  pending: 'bg-slate-700 text-slate-300',
  ready: 'bg-green-900/50 text-green-400',
  failed: 'bg-red-900/50 text-red-400',
  discovering: 'bg-blue-900/50 text-blue-400',
  enriching: 'bg-purple-900/50 text-purple-400',
  classifying: 'bg-yellow-900/50 text-yellow-400',
  scoring: 'bg-orange-900/50 text-orange-400',
  generating: 'bg-indigo-900/50 text-indigo-400',
  paused: 'bg-amber-900/50 text-amber-300',
};

const PRIORITY_COLOR = { high: 'text-green-400', medium: 'text-yellow-400', low: 'text-slate-500' };

export default function GithubTalentCampaignDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('prospects');
  
  // Settings Form State
  const [settings, setSettings] = useState(null);

  const { data: response, isLoading } = useQuery({
    queryKey: ['gte-campaign', id],
    queryFn: () => api.get(`/github-talent/${id}`).then(res => res.data),
    refetchInterval: (data) => data?.data?.status === 'running' ? 3000 : false,
  });

  const campaign = response?.data;
  const prospects = campaign?.prospectListId?.prospects || [];

  useEffect(() => {
    if (campaign && !settings) {
      setSettings({
        name: campaign.name || '',
        talentDescription: campaign.talentDescription || '',
        targetEcosystemContext: campaign.targetEcosystemContext || '',
        maxRepos: campaign.maxRepos || 10,
        preferredAiModel: 'gemini' // Gemini is the only active provider for now (Groq on hold)
      });
    }
  }, [campaign, settings]);

  const runMutation = useMutation({
    mutationFn: () => api.post(`/github-talent/${id}/run`),
    onSuccess: () => {
      toast.success('Campaign started fresh!');
      queryClient.invalidateQueries({ queryKey: ['gte-campaign', id] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to start campaign')
  });

  const pauseMutation = useMutation({
    mutationFn: () => api.post(`/github-talent/${id}/pause`),
    onSuccess: () => {
      toast.success('Campaign paused');
      queryClient.invalidateQueries({ queryKey: ['gte-campaign', id] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to pause campaign')
  });

  const resumeMutation = useMutation({
    mutationFn: () => api.post(`/github-talent/${id}/resume`),
    onSuccess: () => {
      toast.success('Campaign resumed');
      queryClient.invalidateQueries({ queryKey: ['gte-campaign', id] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to resume campaign')
  });

  const updateMutation = useMutation({
    mutationFn: (data) => api.patch(`/github-talent/${id}`, data),
    onSuccess: (data) => {
      if (data.data.keywordsUpdated) {
        toast.success('Settings saved and keywords regenerated!');
      } else {
        toast.success('Settings saved!');
      }
      queryClient.invalidateQueries({ queryKey: ['gte-campaign', id] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to save settings')
  });

  const handleSaveSettings = () => {
    updateMutation.mutate(settings);
  };

  if (isLoading) {
    return <div className="flex justify-center p-20"><Loader2 size={32} className="animate-spin text-indigo-500" /></div>;
  }

  if (!campaign) {
    return <div className="p-20 text-center text-white">Campaign not found</div>;
  }

  const isRunning = campaign.status === 'running';

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <button
            onClick={() => navigate('/github-talent-engine')}
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition mb-4"
          >
            <ArrowLeft size={16} /> Back to Campaigns
          </button>
          
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <Code2 size={28} className="text-white" />
              {campaign.name}
            </h1>
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize flex items-center gap-1.5 border
              ${campaign.status === 'running' ? 'bg-blue-900/50 text-blue-400 border-blue-800' : 
                campaign.status === 'completed' ? 'bg-green-900/50 text-green-400 border-green-800' :
                'bg-slate-800 text-slate-300 border-slate-700'}`}
            >
              {isRunning && <Loader2 size={12} className="animate-spin" />}
              {campaign.status}
            </span>
          </div>
          
          <div className="flex items-center gap-6 mt-3 text-sm text-slate-400">
            <p><strong className="text-white">{campaign.totalReposSearched}</strong> Repos Searched</p>
            <p><strong className="text-white">{campaign.totalContributorsFound}</strong> Contributors Found</p>
            <p><strong className="text-indigo-400">{campaign.totalProspectsCreated}</strong> Prospects Created</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isRunning ? (
            <button
              onClick={() => pauseMutation.mutate()}
              disabled={pauseMutation.isPending}
              className="flex items-center gap-2 px-6 py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold transition disabled:opacity-50"
            >
              {pauseMutation.isPending ? <Loader2 size={18} className="animate-spin" /> : <Pause size={18} />}
              Pause Campaign
            </button>
          ) : campaign.status === 'paused' ? (
            <button
              onClick={() => resumeMutation.mutate()}
              disabled={resumeMutation.isPending}
              className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition disabled:opacity-50 shadow-lg shadow-indigo-900/20"
            >
              {resumeMutation.isPending ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
              Resume Campaign
            </button>
          ) : (
            <button
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending}
              className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition disabled:opacity-50 shadow-lg shadow-indigo-900/20"
            >
              {runMutation.isPending ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
              {campaign.status === 'completed' || campaign.status === 'failed' ? 'Start Fresh Run' : 'Run Campaign'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800">
        <button
          onClick={() => setTab('prospects')}
          className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition ${
            tab === 'prospects' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <Users size={16} /> Prospects ({campaign.prospectCount})
        </button>
        <button
          onClick={() => setTab('settings')}
          className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition ${
            tab === 'settings' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <Settings2 size={16} /> Settings
        </button>
      </div>

      {/* Prospects Tab */}
      {tab === 'prospects' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          {prospects.length === 0 ? (
            <div className="p-12 text-center">
              <Users size={32} className="text-slate-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white">No prospects yet</h3>
              <p className="text-slate-400 mt-2">Click 'Run Campaign' to start scraping GitHub for talent.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-950/50 border-b border-slate-800">
                    <th className="px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Prospect</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider text-center">Score</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Label</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider text-center">Priority</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {prospects.map((p) => (
                    <tr
                      key={p._id}
                      onClick={() => navigate(`/prospects/${p._id}`)}
                      className="hover:bg-slate-800/50 transition cursor-pointer"
                    >
                      <td className="px-5 py-4">
                        <p className="text-white font-medium">{p.firstName} {p.lastName}</p>
                        {p.company && <p className="text-xs text-slate-500 mt-0.5">{p.company}</p>}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_COLOR[p.pipelineStatus] || STATUS_COLOR.pending}`}>
                          {p.pipelineStatus}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-center">
                        {p.compatibilityScore !== undefined ? (
                          <span className={`font-mono font-bold ${
                            p.compatibilityScore >= 80 ? 'text-green-400' :
                            p.compatibilityScore >= 50 ? 'text-yellow-400' : 'text-red-400'
                          }`}>
                            {p.compatibilityScore}
                          </span>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-xs text-slate-300 bg-slate-800 px-2 py-1 rounded capitalize">
                          {p.scoreLabel?.replace(/_/g, ' ') || 'Pending'}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-center">
                        <span className={`text-xs font-semibold uppercase ${PRIORITY_COLOR[p.outreachPriority] || 'text-slate-600'}`}>
                          {p.outreachPriority || '-'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Settings Tab */}
      {tab === 'settings' && settings && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Settings2 size={18} className="text-indigo-400" /> Campaign Configuration
              </h3>
              
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Campaign Name</label>
                  <input
                    type="text"
                    value={settings.name}
                    onChange={(e) => setSettings({ ...settings, name: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 text-white px-4 py-2.5 rounded-xl focus:outline-none focus:border-indigo-500 transition"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Talent Description</label>
                  <textarea
                    rows={4}
                    value={settings.talentDescription}
                    onChange={(e) => setSettings({ ...settings, talentDescription: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 text-white px-4 py-3 rounded-xl focus:outline-none focus:border-indigo-500 transition resize-none"
                  />
                  <p className="text-xs text-slate-500 mt-1">If you change this and save, AI will automatically regenerate the search keywords.</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Ecosystem / Project Context</label>
                  <input
                    type="text"
                    value={settings.targetEcosystemContext}
                    onChange={(e) => setSettings({ ...settings, targetEcosystemContext: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 text-white px-4 py-2.5 rounded-xl focus:outline-none focus:border-indigo-500 transition"
                  />
                </div>
                
                <div className="pt-4 border-t border-slate-800 flex justify-end">
                  <button
                    onClick={handleSaveSettings}
                    disabled={updateMutation.isPending}
                    className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium transition disabled:opacity-50"
                  >
                    {updateMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          </div>
          
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Cpu size={18} className="text-indigo-400" /> AI Keywords
              </h3>
              <p className="text-sm text-slate-400 mb-4">
                These keywords are used to search the GitHub API for repositories matching your talent description.
              </p>
              
              <div className="space-y-2">
                {campaign.aiKeywords?.map((keyword, i) => (
                  <div key={i} className="bg-slate-950 border border-slate-800 px-3 py-2 rounded-lg text-sm text-indigo-300 font-mono">
                    {keyword}
                  </div>
                ))}
              </div>
            </div>
            
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <ShieldAlert size={18} className="text-indigo-400" /> Engine Limits
              </h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Max Repositories</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="1"
                      max="30"
                      value={settings.maxRepos}
                      onChange={(e) => setSettings({ ...settings, maxRepos: Number(e.target.value) })}
                      className="flex-1 accent-indigo-500"
                    />
                    <span className="text-sm font-medium text-white w-8 text-right">{settings.maxRepos}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">Up to 100 contributors are scraped per repo.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
