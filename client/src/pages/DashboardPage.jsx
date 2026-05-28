import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { Users, TrendingUp, CheckCircle, Clock, Sparkles, ArrowRight, Plus } from 'lucide-react';

const StatCard = ({ label, value, icon: Icon, color }) => (
  <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
    <div className="flex items-center justify-between mb-3">
      <span className="text-slate-400 text-sm">{label}</span>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
        <Icon size={16} className="text-white" />
      </div>
    </div>
    <span className="text-white text-2xl font-bold">{value ?? '—'}</span>
  </div>
);

const StatCardSkeleton = () => (
  <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 animate-pulse">
    <div className="flex items-center justify-between mb-3">
      <div className="h-4 w-32 bg-slate-800 rounded" />
      <div className="w-8 h-8 bg-slate-800 rounded-lg" />
    </div>
    <div className="h-8 w-12 bg-slate-800 rounded" />
  </div>
);

const statusColors = {
  pending: 'bg-slate-700 text-slate-300',
  ready: 'bg-green-900/50 text-green-400',
  failed: 'bg-red-900/50 text-red-400',
  discovering: 'bg-blue-900/50 text-blue-400',
  enriching: 'bg-purple-900/50 text-purple-400',
  classifying: 'bg-yellow-900/50 text-yellow-400',
  scoring: 'bg-orange-900/50 text-orange-400',
  generating: 'bg-indigo-900/50 text-indigo-400',
};

export default function DashboardPage() {
  const navigate = useNavigate();

  const { data: prospectsData, isLoading: prospectsLoading } = useQuery({
    queryKey: ['prospects', 'dashboard'],
    queryFn: () => api.get('/prospects?limit=5').then((r) => r.data),
  });

  const { data: usageData, isLoading: usageLoading } = useQuery({
    queryKey: ['usage'],
    queryFn: () => api.get('/organization/usage').then((r) => r.data),
  });

  const prospects = prospectsData?.data || [];
  const usage = usageData?.data;
  const isLoading = prospectsLoading || usageLoading;
  const hasProspects = prospects.length > 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-white text-2xl font-bold">Dashboard</h1>
        <p className="text-slate-400 mt-1">Your prospect intelligence overview</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard label="Prospects this month" value={usage?.used} icon={Users} color="bg-indigo-600" />
            <StatCard label="Plan limit" value={usage?.limit === Infinity ? '∞' : usage?.limit} icon={TrendingUp} color="bg-purple-600" />
            <StatCard label="Ready" value={prospects.filter((p) => p.pipelineStatus === 'ready').length} icon={CheckCircle} color="bg-green-600" />
            <StatCard label="Processing" value={prospects.filter((p) => !['ready', 'failed', 'pending'].includes(p.pipelineStatus)).length} icon={Clock} color="bg-yellow-600" />
          </>
        )}
      </div>

      {/* Usage bar */}
      {usage && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-white font-medium">Monthly usage</span>
            <span className="text-slate-400 text-sm capitalize">{usage.plan} plan</span>
          </div>
          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all"
              style={{ width: `${Math.min(usage.percentUsed, 100)}%` }}
            />
          </div>
          <p className="text-slate-500 text-sm mt-2">
            {usage.used} / {usage.limit === Infinity ? 'Unlimited' : usage.limit} prospects used
          </p>
        </div>
      )}

      {/* Recent prospects */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-white font-semibold">Recent prospects</h2>
          {hasProspects && (
            <button
              onClick={() => navigate('/prospects')}
              className="text-indigo-400 text-sm hover:text-indigo-300 flex items-center gap-1"
            >
              View all <ArrowRight size={13} />
            </button>
          )}
        </div>

        {isLoading ? (
          /* Skeleton rows */
          <div className="divide-y divide-slate-800">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="px-5 py-3 flex items-center justify-between animate-pulse">
                <div className="space-y-1.5">
                  <div className="h-4 w-32 bg-slate-800 rounded" />
                  <div className="h-3 w-20 bg-slate-800 rounded" />
                </div>
                <div className="h-5 w-16 bg-slate-800 rounded-full" />
              </div>
            ))}
          </div>
        ) : !hasProspects ? (
          /* ── Empty state ── */
          <div className="py-16 px-8 flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-indigo-900/40 border border-indigo-800/60 flex items-center justify-center mb-5">
              <Sparkles size={28} className="text-indigo-400" />
            </div>
            <h3 className="text-white font-semibold text-lg mb-2">Add your first prospect</h3>
            <p className="text-slate-400 text-sm max-w-xs leading-relaxed mb-6">
              ProspectMind enriches any name + company into a full AI-scored profile with hyper-personalized outreach messages — in seconds.
            </p>
            <button
              onClick={() => navigate('/prospects')}
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-medium transition"
            >
              <Plus size={15} /> Add prospect
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {prospects.map((p) => (
              <div
                key={p._id}
                className="px-5 py-3 flex items-center justify-between hover:bg-slate-800/50 transition cursor-pointer"
                onClick={() => navigate(`/prospects/${p._id}`)}
              >
                <div>
                  <span className="text-white font-medium">{p.firstName} {p.lastName}</span>
                  {p.company && <span className="text-slate-500 text-sm ml-2">@ {p.company}</span>}
                </div>
                <div className="flex items-center gap-3">
                  {p.compatibilityScore != null && (
                    <span className="text-indigo-400 font-bold text-sm">{p.compatibilityScore}/100</span>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[p.pipelineStatus] || 'bg-slate-700 text-slate-300'}`}>
                    {p.pipelineStatus}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
