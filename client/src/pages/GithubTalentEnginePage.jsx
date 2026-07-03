import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { Code2, Plus, Search, Loader2, Play, Pause, CheckSquare, AlertTriangle, Cpu } from 'lucide-react';
import GteCampaignModal from '../components/githubTalent/GteCampaignModal';

const STATUS_COLOR = {
  idle: 'bg-slate-700 text-slate-300',
  running: 'bg-blue-900/50 text-blue-400 border border-blue-800',
  paused: 'bg-amber-900/50 text-amber-300 border border-amber-800',
  completed: 'bg-green-900/50 text-green-400 border border-green-800',
  failed: 'bg-red-900/50 text-red-400 border border-red-800',
};

export default function GithubTalentEnginePage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);

  const { data: response, isLoading } = useQuery({
    queryKey: ['gte-campaigns', search],
    queryFn: () => api.get('/github-talent', { params: { search, limit: 100 } }).then(res => res.data),
    refetchInterval: (data) => data?.data?.some(c => c.status === 'running') ? 3000 : false
  });

  const campaigns = response?.data || [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Code2 size={28} className="text-white" />
            GitHub Talent Engine
          </h1>
          <p className="text-slate-400 mt-1">
            Discover top technical talent directly from GitHub repositories using AI.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium transition"
        >
          <Plus size={18} /> New Campaign
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search campaigns..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 text-white pl-10 pr-4 py-2.5 rounded-xl focus:outline-none focus:border-indigo-500 transition text-sm"
          />
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={32} className="animate-spin text-indigo-500" />
        </div>
      ) : campaigns.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center">
          <div className="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Code2 size={32} className="text-slate-400" />
          </div>
          <h3 className="text-lg font-semibold text-white">No campaigns found</h3>
          <p className="text-slate-400 mt-2 mb-6 max-w-sm mx-auto">
            {search ? 'Try adjusting your search query.' : 'Create your first GitHub Talent Engine campaign to start discovering developers.'}
          </p>
          {!search && (
            <button
              onClick={() => setShowModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition"
            >
              <Plus size={18} /> Create Campaign
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {campaigns.map((campaign) => (
            <div
              key={campaign._id}
              onClick={() => navigate(`/github-talent-engine/${campaign._id}`)}
              className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 hover:border-indigo-500/50 hover:bg-slate-900 transition cursor-pointer flex flex-col h-full"
            >
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-lg font-semibold text-white line-clamp-1 flex-1 mr-3" title={campaign.name}>
                  {campaign.name}
                </h3>
                <span className={`text-xs px-2 py-1 rounded-full font-medium capitalize shrink-0 flex items-center gap-1.5 ${STATUS_COLOR[campaign.status]}`}>
                  {campaign.status === 'running' && <Loader2 size={12} className="animate-spin" />}
                  {campaign.status === 'completed' && <CheckSquare size={12} />}
                  {campaign.status === 'failed' && <AlertTriangle size={12} />}
                  {campaign.status}
                </span>
              </div>

              <p className="text-sm text-slate-400 line-clamp-2 mb-4 flex-1">
                {campaign.talentDescription || 'No description provided.'}
              </p>

              <div className="flex items-center gap-2 text-xs text-slate-500 mb-4 bg-slate-950 p-2.5 rounded-lg border border-slate-800/50">
                <Cpu size={14} className="text-indigo-400 shrink-0" />
                <span className="truncate flex-1">
                  {campaign.aiKeywords?.length 
                    ? campaign.aiKeywords.join(', ')
                    : 'Pending keyword generation'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 border-t border-slate-800 pt-4 mt-auto">
                <div className="text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Repos</p>
                  <p className="text-sm font-semibold text-white">{campaign.totalReposSearched}</p>
                </div>
                <div className="text-center border-l border-slate-800">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Found</p>
                  <p className="text-sm font-semibold text-white">{campaign.totalContributorsFound}</p>
                </div>
                <div className="text-center border-l border-slate-800">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Prospects</p>
                  <p className="text-sm font-semibold text-indigo-400">{campaign.totalProspectsCreated}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && <GteCampaignModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
