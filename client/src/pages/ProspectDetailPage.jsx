import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Code2, Link2, X as XIcon, Send, CheckCircle,
  Edit3, ExternalLink, MapPin, Briefcase, Activity, GraduationCap, RefreshCw,
  AlertTriangle, Target, Zap, Star, Sparkles, Pause, Play, FileText
} from 'lucide-react';
import EditProspectModal from '../components/prospects/EditProspectModal';

const ACTIVE_PIPELINE_STATUSES = ['pending', 'discovering', 'enriching', 'classifying', 'scoring', 'generating'];

/* ── Skeleton helpers ─────────────────────────────────────────────── */
const Sk = ({ className }) => (
  <div className={`animate-pulse bg-slate-800 rounded ${className}`} />
);

function DetailSkeleton() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* header */}
      <div className="flex items-center gap-4">
        <Sk className="w-5 h-5" />
        <div className="flex-1 space-y-2">
          <Sk className="h-7 w-48" />
          <Sk className="h-4 w-32" />
        </div>
        <Sk className="h-9 w-20 rounded-lg" />
        <Sk className="h-14 w-14 rounded-xl" />
      </div>
      {/* pipeline status placeholder */}
      <Sk className="h-12 w-full rounded-xl" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* left column */}
        <div className="lg:col-span-2 space-y-4">
          {[120, 80, 200, 160].map((h, i) => (
            <Sk key={i} className={`w-full rounded-xl`} style={{ height: h }} />
          ))}
        </div>
        {/* right column */}
        <div className="space-y-4">
          {[100, 60, 110].map((h, i) => (
            <Sk key={i} className="w-full rounded-xl" style={{ height: h }} />
          ))}
        </div>
      </div>
    </div>
  );
}

const Badge = ({ children, color = 'indigo' }) => {
  const colors = {
    indigo: 'bg-indigo-900/50 text-indigo-300 border-indigo-800',
    green:  'bg-green-900/50 text-green-300 border-green-800',
    yellow: 'bg-yellow-900/50 text-yellow-300 border-yellow-800',
    slate:  'bg-slate-800 text-slate-300 border-slate-700',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium capitalize ${colors[color]}`}>
      {children}
    </span>
  );
};

function calculateRadarMetrics(ep, uniqueSkills) {
  const skills = (uniqueSkills || []).map(s => s.toLowerCase());

  // 1. Web3 Native (based on Web3 native score and skills)
  const web3Skills = ['solidity', 'rust', 'smart contract', 'solana', 'ethereum', 'web3', 'hardhat', 'foundry', 'truffle', 'ethers', 'web3.js', 'defi', 'cryptography', 'blockchain', 'ethers.js'];
  const web3SkillCount = skills.filter(s => web3Skills.some(w => s.includes(w))).length;
  const web3Score = Math.max(
    ep.web3NativeScore || 0,
    Math.min(100, (web3SkillCount * 15) + (ep.web3NativeScore ? 20 : 0))
  );

  // 2. Systems & Backend
  const backendSkills = ['node', 'express', 'nest', 'go', 'golang', 'rust', 'python', 'django', 'flask', 'fastapi', 'postgres', 'postgresql', 'mongodb', 'mysql', 'redis', 'docker', 'kubernetes', 'aws', 'backend', 'graphql'];
  const backendSkillCount = skills.filter(s => backendSkills.some(b => s.includes(b))).length;
  const backendScore = Math.min(100, (backendSkillCount * 15) + (skills.includes('node.js') || skills.includes('node') ? 20 : 0));

  // 3. Frontend & UI
  const frontendSkills = ['react', 'vue', 'angular', 'svelte', 'next.js', 'nextjs', 'tailwind', 'tailwindcss', 'css', 'html', 'javascript', 'typescript', 'frontend', 'ui', 'ux', 'sass'];
  const frontendSkillCount = skills.filter(s => frontendSkills.some(f => s.includes(f))).length;
  const frontendScore = Math.min(100, (frontendSkillCount * 15) + (skills.includes('react') || skills.includes('reactjs') ? 20 : 0));

  // 4. OSS Impact
  const stars = ep.githubStats?.stars || 0;
  const repos = ep.githubStats?.repos || 0;
  const ossScore = Math.min(100, (stars * 8) + (repos * 2) + (stars > 0 ? 25 : 0));

  // 5. Ecosystem Breadth
  const uniqueCount = skills.length;
  const breadthScore = Math.min(100, (uniqueCount * 6));

  return [
    { label: 'Web3 & Contracts', value: Math.max(15, web3Score) },
    { label: 'Systems & Backend', value: Math.max(15, backendScore) },
    { label: 'Frontend & UI', value: Math.max(15, frontendScore) },
    { label: 'OSS Impact', value: Math.max(15, ossScore) },
    { label: 'Ecosystem Breadth', value: Math.max(15, breadthScore) }
  ];
}

function SkillRadarChart({ p, ep, uniqueSkills }) {
  let metrics = [];
  
  if (p?.scoreBreakdown && Object.keys(p.scoreBreakdown).length >= 3) {
    metrics = Object.entries(p.scoreBreakdown).map(([label, data]) => ({
      label,
      value: Math.max(15, data.score || 0)
    }));
  } else {
    metrics = calculateRadarMetrics(ep, uniqueSkills);
  }

  const numVertices = Math.max(3, metrics.length);
  const width = 240;
  const height = 240;
  const cx = width / 2;
  const cy = height / 2;
  const r = 80;

  // Angles for each vertex
  const getCoordinates = (index, value) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / numVertices;
    const factor = value / 100;
    const x = cx + r * factor * Math.cos(angle);
    const y = cy + r * factor * Math.sin(angle);
    return { x, y };
  };

  // Generate grid pentagons (for 25%, 50%, 75%, 100%)
  const gridLevels = [25, 50, 75, 100];
  const gridPolygons = gridLevels.map(level => {
    return Array.from({ length: numVertices }).map((_, i) => {
      const { x, y } = getCoordinates(i, level);
      return `${x},${y}`;
    }).join(' ');
  });

  // Candidate path
  const candidatePoints = metrics.map((m, i) => {
    const { x, y } = getCoordinates(i, m.value);
    return { x, y, label: m.label, value: m.value };
  });
  const candidatePath = candidatePoints.map(p => `${p.x},${p.y}`).join(' ');

  // Labels coordinates
  const labelPositions = Array.from({ length: numVertices }).map((_, i) => {
    // Offset labels slightly outward
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / numVertices;
    const textDistance = r + 24;
    const x = cx + textDistance * Math.cos(angle);
    const y = cy + textDistance * Math.sin(angle);
    
    // Adjust text anchor
    let textAnchor = 'middle';
    if (Math.cos(angle) > 0.1) textAnchor = 'start';
    if (Math.cos(angle) < -0.1) textAnchor = 'end';
    
    return { x, y, textAnchor, label: metrics[i].label, value: metrics[i].value };
  });

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col md:flex-row items-center gap-8 relative overflow-hidden group">
      <div className="absolute -left-12 -bottom-12 w-24 h-24 bg-indigo-500/5 rounded-full blur-2xl group-hover:bg-indigo-500/10 transition-all"></div>
      <div className="relative w-[240px] h-[240px] shrink-0 flex items-center justify-center">
        <svg width={width} height={height} className="overflow-visible">
          {/* Grid lines */}
          {gridPolygons.map((points, idx) => (
            <polygon
              key={idx}
              points={points}
              fill="none"
              stroke="#334155"
              strokeWidth="0.8"
              strokeDasharray={idx < 3 ? "2,2" : undefined}
            />
          ))}

          {/* Radial axis lines */}
          {Array.from({ length: numVertices }).map((_, i) => {
            const outer = getCoordinates(i, 100);
            return (
              <line
                key={i}
                x1={cx}
                y1={cy}
                x2={outer.x}
                y2={outer.y}
                stroke="#1e293b"
                strokeWidth="1"
              />
            );
          })}

          {/* Candidate Polygon fill */}
          <polygon
            points={candidatePath}
            fill="url(#radarGradient)"
            stroke="#6366f1"
            strokeWidth="1.5"
          />

          {/* Define Gradient */}
          <defs>
            <radialGradient id="radarGradient" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(99, 102, 241, 0.1)" />
              <stop offset="100%" stopColor="rgba(99, 102, 241, 0.35)" />
            </radialGradient>
          </defs>

          {/* Vertex dots */}
          {candidatePoints.map((p, idx) => (
            <circle
              key={idx}
              cx={p.x}
              cy={p.y}
              r="3.5"
              fill="#818cf8"
              stroke="#0f172a"
              strokeWidth="1.5"
            />
          ))}

          {/* Axis Labels */}
          {labelPositions.map((lp, idx) => (
            <g key={idx}>
              <text
                x={lp.x}
                y={lp.y - 4}
                textAnchor={lp.textAnchor}
                fill="#94a3b8"
                fontSize="9"
                fontWeight="600"
                className="select-none uppercase tracking-wider font-sans"
              >
                {lp.label.split(' & ')[0]}
              </text>
              <text
                x={lp.x}
                y={lp.y + 6}
                textAnchor={lp.textAnchor}
                fill="#818cf8"
                fontSize="9"
                fontWeight="700"
                className="select-none font-sans"
              >
                {lp.value}%
              </text>
            </g>
          ))}
        </svg>
      </div>

      <div className="flex-1 space-y-3 w-full relative z-10">
        <div>
          <h4 className="text-white font-semibold text-sm uppercase tracking-wider">
            Competency Radar
          </h4>
          <p className="text-slate-400 text-xs mt-1 leading-relaxed">
            Visual index of tech capabilities parsed from public profiles, OSS contributions, and code repositories.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 pt-2">
          {metrics.map((m, idx) => (
            <div key={idx} className="bg-slate-950/40 border border-slate-800/80 rounded-lg p-2.5 flex flex-col justify-center">
              <span className="text-[9px] text-slate-500 uppercase font-bold tracking-wider mb-1 truncate">{m.label}</span>
              <span className="text-sm font-extrabold text-white">{m.value}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ProspectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editingMsg, setEditingMsg] = useState(null);
  const [editText, setEditText]     = useState('');
  const [customPrompt, setCustomPrompt] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['prospect', id],
    queryFn: () => api.get(`/prospects/${id}`).then((r) => r.data.data),
    refetchInterval: (d) =>
      !d || ['pending', ...ACTIVE_PIPELINE_STATUSES].includes(d.pipelineStatus)
        ? 5000 : false,
  });

  const rerunMutation = useMutation({
    mutationFn: () => api.post(`/prospects/${id}/retry`),
    onSuccess: () => {
      toast.success('Pipeline re-running…');
      queryClient.invalidateQueries(['prospect', id]);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to restart pipeline'),
  });

  const [showEdit, setShowEdit] = useState(false);

  const approveMutation = useMutation({
    mutationFn: ({ msgId, editedBody }) =>
      api.patch(`/prospects/${id}/messages/${msgId}/approve`, { editedBody }),
    onSuccess: () => {
      toast.success('Message approved');
      queryClient.invalidateQueries(['prospect', id]);
      setEditingMsg(null);
    },
  });

  const sendMutation = useMutation({
    mutationFn: (msgId) => api.post(`/prospects/${id}/messages/${msgId}/send`),
    onSuccess: () => {
      toast.success('Email sent!');
      queryClient.invalidateQueries(['prospect', id]);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to send email'),
  });

  const generateMutation = useMutation({
    mutationFn: () => api.post(`/prospects/${id}/generate-messages`, { customPrompt }),
    onSuccess: () => {
      toast.success('Outreach messages generated!');
      queryClient.invalidateQueries(['prospect', id]);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to generate messages'),
  });

  const pauseMutation = useMutation({
    mutationFn: () => api.post(`/prospects/${id}/pause`),
    onSuccess: (response) => {
      toast.success(response.data.message || 'Pause requested');
      queryClient.invalidateQueries({ queryKey: ['prospect', id] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to pause pipeline'),
  });

  const resumeMutation = useMutation({
    mutationFn: () => api.post(`/prospects/${id}/resume`),
    onSuccess: (response) => {
      toast.success(response.data.message || 'Pipeline resumed');
      queryClient.invalidateQueries({ queryKey: ['prospect', id] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to resume pipeline'),
  });

  if (isLoading) return <DetailSkeleton />;
  if (!data)     return <div className="text-slate-400 py-20 text-center">Prospect not found.</div>;

  const p  = data;
  const ep = p.enrichedProfile || {};
  const isProcessing = ACTIVE_PIPELINE_STATUSES.includes(p.pipelineStatus);
  const isTalent = p.roleClassification?.some(r => r.toLowerCase() === 'talent');
  const allSkillsSet = new Set([
    ...(ep.programmingLanguages || []),
    ...(ep.frameworks || []),
    ...(ep.blockchainEcosystems || []),
    ...(ep.experience?.flatMap(ex => ex.skills || []) || [])
  ]);
  const uniqueSkills = Array.from(allSkillsSet).filter(Boolean);

  return (
    <div className="max-w-4xl mx-auto space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/prospects')} className="text-slate-500 hover:text-white transition">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-white text-2xl font-bold">{p.firstName} {p.lastName}</h1>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <p className="text-slate-400">{ep.currentRole || p.company}</p>
            {ep.location && (
              <span className="flex items-center gap-1 text-slate-500 text-sm">
                <MapPin size={12} /> {ep.location}
              </span>
            )}
            {p.aiProviderUsed && (() => {
              const BADGE = {
                gemini:   { label: '✨ Gemini',    cls: 'bg-violet-900/50 text-violet-300 border border-violet-800' },
                groq:     { label: '⚡ Groq',      cls: 'bg-orange-900/50 text-orange-300 border border-orange-800' },
                fallback: { label: '⚠ Fallback',  cls: 'bg-amber-900/50 text-amber-300 border border-amber-800' },
              };
              const b = BADGE[p.aiProviderUsed];
              return b ? (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${b.cls}`}
                  title={`Prospect data generated by: ${p.aiProviderUsed}`}
                >
                  {b.label}
                </span>
              ) : null;
            })()}
          </div>
        </div>
        <button
          onClick={() => rerunMutation.mutate()}
          disabled={rerunMutation.isPending || isProcessing}
          className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 rounded-lg text-sm transition"
          title="Re-run full enrichment pipeline"
        >
          <RefreshCw size={14} className={rerunMutation.isPending || isProcessing ? 'animate-spin' : ''} />
          Re-run
        </button>
        <button
          onClick={() => setShowEdit(true)}
          className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm transition"
          title="Edit prospect details & context"
        >
          <Edit3 size={14} />
          Edit
        </button>
        {isProcessing && (
          <button
            onClick={() => pauseMutation.mutate()}
            disabled={pauseMutation.isPending}
            className="flex items-center gap-2 px-3 py-2 bg-amber-900/40 hover:bg-amber-800/40 disabled:opacity-40 disabled:cursor-not-allowed text-amber-200 rounded-lg text-sm transition"
            title="Pause after the current step"
          >
            <Pause size={14} />
            Pause
          </button>
        )}
        {p.pipelineStatus === 'paused' && (
          <button
            onClick={() => resumeMutation.mutate()}
            disabled={resumeMutation.isPending}
            className="flex items-center gap-2 px-3 py-2 bg-emerald-900/40 hover:bg-emerald-800/40 disabled:opacity-40 disabled:cursor-not-allowed text-emerald-200 rounded-lg text-sm transition"
            title="Resume enrichment"
          >
            <Play size={14} />
            Resume
          </button>
        )}
        {p.compatibilityScore != null && (
          <div className="flex flex-col items-center gap-1">
            <div className="bg-indigo-900/50 border border-indigo-800 rounded-xl px-4 py-2 text-center">
              <div className="text-indigo-300 text-2xl font-bold">{p.compatibilityScore}</div>
              <div className="text-indigo-500 text-xs">/ 100</div>
            </div>
            {p.scoreLabel && (
              <span className="text-[11px] mt-1 px-3 py-1 rounded-full font-bold bg-indigo-950/40 text-indigo-200 border border-indigo-500/50 shadow-[0_0_12px_rgba(99,102,241,0.4)] capitalize tracking-wide">
                {p.scoreLabel.replace(/_/g, ' ')}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Pipeline status ─────────────────────────────────────────────── */}
      {isProcessing && (
        <div className="bg-indigo-950/50 border border-indigo-800 rounded-xl p-4 flex items-center gap-3">
          <div className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse" />
          <span className="text-indigo-300 text-sm capitalize">Pipeline running: {p.pipelineStatus}…</span>
        </div>
      )}
      {p.pipelineStatus === 'paused' && (
        <div className="bg-amber-950/50 border border-amber-800 rounded-xl p-4 flex items-start gap-3">
          <Pause size={16} className="text-amber-300 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-amber-200 text-sm font-medium">Pipeline paused</p>
            <p className="text-amber-300/80 text-xs mt-0.5">
              Resume will restart the enrichment pipeline from the beginning for this prospect.
            </p>
          </div>
          <button
            onClick={() => resumeMutation.mutate()}
            disabled={resumeMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-800/50 hover:bg-amber-700/50 disabled:opacity-40 text-amber-100 rounded-lg text-xs transition shrink-0"
          >
            <Play size={12} />
            Resume
          </button>
        </div>
      )}
      {p.pipelineStatus === 'failed' && (
        <div className="bg-red-950/50 border border-red-800 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-red-300 text-sm font-medium">Pipeline failed</p>
            {p.pipelineError && (
              <p className="text-red-400/70 text-xs mt-0.5 break-words">
                {(() => {
                  const err = p.pipelineError;
                  // LinkedIn auth/checkpoint messages from the pipeline are already
                  // user-facing and actionable (they name the login helper) — show verbatim.
                  if (err.toLowerCase().includes('linkedin') &&
                      (err.toLowerCase().includes('session') || err.toLowerCase().includes('logged out') || err.toLowerCase().includes('verification'))) {
                    return err;
                  }
                  if (err.includes('413') || err.toLowerCase().includes('too large')) {
                    return "This prospect's profile contains too much data to process at once under your current AI limits. Please upgrade your tier or try again later.";
                  }
                  if (err.includes('429')) {
                    return "Our AI providers are currently experiencing high traffic. Please wait a moment and try again.";
                  }
                  return err;
                })()}
              </p>
            )}
          </div>
          <button
            onClick={() => rerunMutation.mutate()}
            disabled={rerunMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-800/60 hover:bg-red-700/60 disabled:opacity-40 text-red-200 rounded-lg text-xs transition shrink-0"
          >
            <RefreshCw size={12} className={rerunMutation.isPending ? 'animate-spin' : ''} />
            Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* ── LEFT COLUMN ──────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">

          {/* ── User-provided description card (shown only when set) ───── */}
          {p.description && (
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 flex items-start gap-3">
              <FileText size={15} className="text-indigo-400 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Your Notes</p>
                  <button
                    onClick={() => setShowEdit(true)}
                    className="text-slate-600 hover:text-slate-300 transition text-xs flex items-center gap-1"
                  >
                    <Edit3 size={11} /> Edit
                  </button>
                </div>
                <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">{p.description}</p>
              </div>
            </div>
          )}

          {/* ── Quick Analytics ───────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-2">
            {/* Compatibility */}
            {p.compatibilityScore != null && (
              <div className="bg-gradient-to-br from-indigo-900/40 to-slate-900 border border-indigo-800/50 rounded-xl p-4 flex flex-col justify-between relative overflow-hidden group">
                <div className="absolute -right-4 -top-4 w-16 h-16 bg-indigo-500/10 rounded-full blur-xl group-hover:bg-indigo-500/20 transition-all"></div>
                <div className="flex items-center gap-2 text-indigo-400 mb-2">
                  <Target size={15} />
                  <span className="text-xs font-semibold uppercase tracking-wider">Match</span>
                </div>
                <div className="flex items-end gap-1.5">
                  <span className="text-3xl font-bold text-white leading-none">{p.compatibilityScore}</span>
                  <span className="text-indigo-500 text-xs mb-0.5 font-medium">/100</span>
                </div>
                {p.scoreLabel && <p className="text-indigo-300/80 text-[11px] mt-2 capitalize truncate">{p.scoreLabel.replace(/_/g, ' ')}</p>}
              </div>
            )}

            {/* Experience */}
            {ep.yearsOfExperience != null && (
              <div className="bg-gradient-to-br from-blue-900/30 to-slate-900 border border-blue-800/40 rounded-xl p-4 flex flex-col justify-between relative overflow-hidden group">
                <div className="absolute -right-4 -top-4 w-16 h-16 bg-blue-500/10 rounded-full blur-xl group-hover:bg-blue-500/20 transition-all"></div>
                <div className="flex items-center gap-2 text-blue-400 mb-2">
                  <Briefcase size={15} />
                  <span className="text-xs font-semibold uppercase tracking-wider">Experience</span>
                </div>
                <div className="flex items-end gap-1.5">
                  <span className="text-3xl font-bold text-white leading-none">{ep.yearsOfExperience}</span>
                  <span className="text-slate-500 text-xs mb-0.5 font-medium">yrs</span>
                </div>
                {ep.seniority && <p className="text-slate-400 text-[11px] mt-2 capitalize truncate">{ep.seniority} Level</p>}
              </div>
            )}

            {/* Top Strength / Web3 Native */}
            {(() => {
              if (p?.scoreBreakdown && Object.keys(p.scoreBreakdown).length > 0) {
                // Dynamic Top Strength
                const dimensions = Object.entries(p.scoreBreakdown);
                dimensions.sort((a, b) => b[1].weight - a[1].weight); // Sort by highest weight
                const [topName, topData] = dimensions[0];
                return (
                  <div className="bg-gradient-to-br from-purple-900/30 to-slate-900 border border-purple-800/40 rounded-xl p-4 flex flex-col justify-between relative overflow-hidden group">
                    <div className="absolute -right-4 -top-4 w-16 h-16 bg-purple-500/10 rounded-full blur-xl group-hover:bg-purple-500/20 transition-all"></div>
                    <div className="flex items-center gap-2 text-purple-400 mb-2">
                      <Zap size={15} />
                      <span className="text-xs font-semibold uppercase tracking-wider truncate">Top Strength</span>
                    </div>
                    <div className="flex items-end gap-1.5">
                      <span className="text-3xl font-bold text-white leading-none">{topData.score}</span>
                      <span className="text-purple-500/70 text-xs mb-0.5 font-medium">/100</span>
                    </div>
                    <p className="text-purple-400/70 text-[11px] mt-2 truncate capitalize">{topName}</p>
                  </div>
                );
              }
              
              if (ep?.web3NativeScore != null) {
                return (
                  <div className="bg-gradient-to-br from-purple-900/30 to-slate-900 border border-purple-800/40 rounded-xl p-4 flex flex-col justify-between relative overflow-hidden group">
                    <div className="absolute -right-4 -top-4 w-16 h-16 bg-purple-500/10 rounded-full blur-xl group-hover:bg-purple-500/20 transition-all"></div>
                    <div className="flex items-center gap-2 text-purple-400 mb-2">
                      <Zap size={15} />
                      <span className="text-xs font-semibold uppercase tracking-wider">Web3 Native</span>
                    </div>
                    <div className="flex items-end gap-1.5">
                      <span className="text-3xl font-bold text-white leading-none">{ep.web3NativeScore}</span>
                      <span className="text-purple-500/70 text-xs mb-0.5 font-medium">/100</span>
                    </div>
                    <p className="text-purple-400/70 text-[11px] mt-2 truncate">Ecosystem Knowledge</p>
                  </div>
                );
              }
              return null;
            })()}

            {/* GitHub Impact */}
            {ep.githubStats != null && (ep.githubStats.stars != null || ep.githubStats.repos != null) && (
              <div className="bg-gradient-to-br from-emerald-900/30 to-slate-900 border border-emerald-800/40 rounded-xl p-4 flex flex-col justify-between relative overflow-hidden group">
                <div className="absolute -right-4 -top-4 w-16 h-16 bg-emerald-500/10 rounded-full blur-xl group-hover:bg-emerald-500/20 transition-all"></div>
                <div className="flex items-center gap-2 text-emerald-400 mb-2">
                  <Star size={15} />
                  <span className="text-xs font-semibold uppercase tracking-wider">OSS Impact</span>
                </div>
                <div className="flex items-end gap-1.5">
                  <span className="text-3xl font-bold text-white leading-none">{ep.githubStats.stars || 0}</span>
                  <span className="text-emerald-500/70 text-xs mb-0.5 font-medium">stars</span>
                </div>
                <p className="text-emerald-400/70 text-[11px] mt-2 truncate">{ep.githubStats.repos || 0} public repos</p>
              </div>
            )}
          </div>

          {/* Skill Radar Chart */}
          {p.pipelineStatus === 'ready' && (
            <SkillRadarChart p={p} ep={ep} uniqueSkills={uniqueSkills} />
          )}

          {/* Personas */}
          {p.roleClassification?.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                <Sparkles size={16} className="text-indigo-400" /> Personas
              </h3>
              <div className="flex flex-wrap gap-2 mb-3">
                {p.roleClassification.map((r) => <Badge key={r}>{r}</Badge>)}
              </div>

              {Array.isArray(p.personaBreakdown) && p.personaBreakdown.length > 0 ? (
                <div className="space-y-3">
                  {p.personaBreakdown.map((pb, idx) => (
                    <div
                      key={`${pb.persona || 'persona'}-${idx}`}
                      className="rounded-lg border border-slate-800 bg-slate-950/40 p-3"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400" />
                        <span className="text-indigo-300 text-sm font-semibold capitalize">
                          {pb.persona}
                        </span>
                      </div>
                      {pb.fit && (
                        <p className="text-slate-300 text-sm leading-relaxed">
                          <span className="text-slate-500 font-medium">Why they fit: </span>
                          {pb.fit}
                        </p>
                      )}
                      {pb.campaignValue && (
                        <p className="text-slate-300 text-sm leading-relaxed mt-1.5">
                          <span className="text-slate-500 font-medium">Value to this campaign: </span>
                          {pb.campaignValue}
                        </p>
                      )}
                    </div>
                  ))}
                  {p.scoreReasoning && (
                    <p className="text-slate-400 text-sm pt-1 border-t border-slate-800/70">
                      <span className="text-slate-500 font-medium">Overall: </span>
                      {p.scoreReasoning}
                    </p>
                  )}
                </div>
              ) : (
                p.scoreReasoning && <p className="text-slate-400 text-sm">{p.scoreReasoning}</p>
              )}
            </div>
          )}

          {/* Core Skills (Talent Only) */}
          {isTalent && uniqueSkills.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                <Code2 size={16} className="text-indigo-400" /> Core Skills
              </h3>
              <div className="flex flex-wrap gap-2">
                {uniqueSkills.slice(0, 15).map(skill => (
                  <span key={skill} className="flex items-center gap-1.5 bg-slate-800/80 border border-slate-700/80 px-3 py-1.5 rounded-lg text-sm text-slate-300 font-medium">
                     <CheckCircle size={14} className="text-emerald-500/80" />
                     {skill}
                  </span>
                ))}
                {uniqueSkills.length > 15 && (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-500 font-medium">
                    +{uniqueSkills.length - 15} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Profile Summary */}
          {ep.bio && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-2">Profile Summary</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{ep.bio}</p>
            </div>
          )}

          {/* Experience */}
          {ep.experience?.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                <Briefcase size={15} className="text-slate-400" /> Experience
              </h3>
              <div className="space-y-5">
                {ep.experience.map((exp, i) => (
                  <div key={i} className="relative pl-4 border-l border-slate-700">
                    {/* dot */}
                    <div className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-indigo-500 border-2 border-slate-900" />

                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-white font-medium text-sm">{exp.title}</p>
                        <p className="text-indigo-400 text-sm">{exp.company}</p>
                      </div>
                      <div className="text-right shrink-0">
                        {exp.duration && (
                          <p className="text-slate-500 text-xs">{exp.duration}</p>
                        )}
                        {exp.location && (
                          <p className="text-slate-600 text-xs mt-0.5">{exp.location}</p>
                        )}
                      </div>
                    </div>

                    {exp.description && (
                      <p className="text-slate-400 text-xs mt-1.5 leading-relaxed">{exp.description}</p>
                    )}

                    {exp.skills?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {exp.skills.map((s) => <Badge key={s} color="slate">{s}</Badge>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Education */}
          {ep.education?.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                <GraduationCap size={15} className="text-slate-400" /> Education
              </h3>
              <div className="space-y-3">
                {ep.education.map((edu, i) => (
                  <div key={i} className="relative pl-4 border-l border-slate-700">
                    <div className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-slate-600 border-2 border-slate-900" />
                    <p className="text-white text-sm font-medium">{edu.institution}</p>
                    {edu.degree && <p className="text-slate-400 text-xs mt-0.5">{edu.degree}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Technical */}
          {(ep.blockchainEcosystems?.length > 0 || ep.programmingLanguages?.length > 0 || ep.frameworks?.length > 0) && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-3">Technical</h3>
              {ep.blockchainEcosystems?.length > 0 && (
                <div className="mb-3">
                  <p className="text-slate-500 text-xs uppercase mb-1.5">Ecosystems</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ep.blockchainEcosystems.map((e) => <Badge key={e} color="green">{e}</Badge>)}
                  </div>
                </div>
              )}
              {ep.programmingLanguages?.length > 0 && (
                <div className="mb-3">
                  <p className="text-slate-500 text-xs uppercase mb-1.5">Languages</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ep.programmingLanguages.map((l) => <Badge key={l} color="yellow">{l}</Badge>)}
                  </div>
                </div>
              )}
              {ep.frameworks?.length > 0 && (
                <div>
                  <p className="text-slate-500 text-xs uppercase mb-1.5">Frameworks & Tools</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ep.frameworks.map((f) => <Badge key={f} color="slate">{f}</Badge>)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Recent Activity */}
          {ep.recentActivity?.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                <Activity size={15} className="text-slate-400" /> Recent Activity
              </h3>
              <ul className="space-y-2">
                {ep.recentActivity.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-slate-400 text-sm">
                    <span className="text-indigo-500 mt-1">•</span>
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Outreach Messages */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
               Outreach Messages
            </h3>
            
            {p.messages?.length > 0 ? (
              <div className="space-y-4">
                {p.messages.map((msg) => (
                  <div key={msg._id} className="border border-slate-800 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-300 font-medium capitalize text-sm">{msg.channel}</span>
                        {msg.persona && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-900/50 text-indigo-300 capitalize border border-indigo-800">
                            {msg.persona}
                          </span>
                        )}
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        msg.status === 'sent'     ? 'bg-blue-900/50 text-blue-400' :
                        msg.status === 'approved' ? 'bg-green-900/50 text-green-400' :
                                                    'bg-slate-800 text-slate-400'
                      }`}>{msg.status}{msg.sentAt ? ` · ${new Date(msg.sentAt).toLocaleDateString()}` : ''}</span>
                    </div>
                    {msg.subject && (
                      <p className="text-slate-400 text-xs mb-2 font-medium">Subject: {msg.subject}</p>
                    )}

                    {editingMsg === msg._id ? (
                      <div>
                        <textarea
                          className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-slate-300 text-sm focus:outline-none focus:border-indigo-500 resize-none"
                          rows={6}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                        />
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => approveMutation.mutate({ msgId: msg._id, editedBody: editText })}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white rounded-lg text-xs transition"
                          >
                            <CheckCircle size={12} /> Approve
                          </button>
                          <button onClick={() => setEditingMsg(null)} className="text-slate-500 text-xs hover:text-white">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <p className="text-slate-400 text-sm whitespace-pre-wrap leading-relaxed">
                          {msg.editedBody || msg.body}
                        </p>
                        {msg.status === 'draft' && (
                          <div className="flex gap-2 mt-3">
                            <button
                              onClick={() => approveMutation.mutate({ msgId: msg._id })}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white rounded-lg text-xs transition"
                            >
                              <CheckCircle size={12} /> Approve
                            </button>
                            <button
                              onClick={() => { setEditingMsg(msg._id); setEditText(msg.body); }}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-xs transition"
                            >
                              <Edit3 size={12} /> Edit
                            </button>
                          </div>
                        )}
                        {msg.status === 'approved' && (
                          <div className="flex gap-2 mt-3">
                            {msg.channel === 'email' ? (
                              <button
                                onClick={() => sendMutation.mutate(msg._id)}
                                disabled={sendMutation.isPending}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-lg text-xs transition"
                              >
                                <Send size={12} className={sendMutation.isPending ? 'animate-pulse' : ''} />
                                {sendMutation.isPending ? 'Sending…' : 'Send via Email'}
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(msg.editedBody || msg.body);
                                  toast.success('Copied to clipboard');
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-xs transition"
                              >
                                <Edit3 size={12} /> Copy message
                              </button>
                            )}
                            <button
                              onClick={() => { setEditingMsg(msg._id); setEditText(msg.editedBody || msg.body); }}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-xs transition"
                            >
                              <Edit3 size={12} /> Edit
                            </button>
                          </div>
                        )}
                        {msg.status === 'sent' && (
                          <p className="text-blue-400/70 text-xs mt-2 flex items-center gap-1">
                            <Send size={11} /> Sent{msg.sentAt ? ` on ${new Date(msg.sentAt).toLocaleDateString()}` : ''}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-400 text-sm mb-4">No outreach messages generated yet.</p>
            )}

            <div className="mt-6 border-t border-slate-800 pt-6">
              <label className="block text-sm font-medium text-slate-300 mb-2">Custom Generation Prompt (Optional)</label>
              <textarea
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-slate-300 text-sm focus:outline-none focus:border-indigo-500 resize-none mb-3"
                rows={3}
                placeholder="e.g. Focus on their recent talk at EthCC and keep the tone very casual..."
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                disabled={generateMutation.isPending || isProcessing}
              />
              <button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending || isProcessing}
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition"
              >
                <Sparkles size={16} className={generateMutation.isPending ? 'animate-pulse' : ''} />
                {generateMutation.isPending ? 'Generating...' : (p.messages && p.messages.length > 0 ? 'Regenerate Messages' : 'Generate Messages')}
              </button>
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN ─────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Contact & Links */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h3 className="text-white font-semibold mb-3">Contact & Links</h3>
            <div className="space-y-2">
              {ep.linkedinUrl && (
                <a href={ep.linkedinUrl} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition">
                  <Link2 size={14} /> LinkedIn <ExternalLink size={11} className="ml-auto" />
                </a>
              )}
              {ep.githubUrl && (
                <a href={ep.githubUrl} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition">
                  <Code2 size={14} /> GitHub <ExternalLink size={11} className="ml-auto" />
                </a>
              )}
              {ep.xUrl && (
                <a href={ep.xUrl} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition">
                  <XIcon size={14} /> X / Twitter <ExternalLink size={11} className="ml-auto" />
                </a>
              )}
              {ep.telegramHandle && (
                <span className="flex items-center gap-2 text-slate-400 text-sm">
                  <Send size={14} /> {ep.telegramHandle}
                </span>
              )}
              {ep.email && (
                <span className="flex items-center gap-2 text-slate-400 text-sm">
                  @ {ep.email}
                </span>
              )}
            </div>
          </div>

          {/* Best Channel */}
          {p.bestContactChannel && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1 text-sm">Best channel</h3>
              <p className="text-indigo-400 capitalize font-medium">{p.bestContactChannel}</p>
            </div>
          )}

          {/* GitHub Stats */}
          {ep.githubStats && (ep.githubStats.repos || ep.githubStats.stars) && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-3 text-sm">GitHub Stats</h3>
              <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                {[['Repos', ep.githubStats.repos], ['Stars', ep.githubStats.stars]].map(([k, v]) => (
                  <div key={k}>
                    <p className="text-slate-500 text-xs">{k}</p>
                    <p className="text-white font-medium">{v ?? '—'}</p>
                  </div>
                ))}
              </div>
              {ep.githubStats.topLanguages?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {ep.githubStats.topLanguages.map((l) => (
                    <Badge key={l} color="slate">{l}</Badge>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Previous Companies */}
          {ep.previousCompanies?.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-3 text-sm">Previous Companies</h3>
              <div className="space-y-1">
                {ep.previousCompanies.map((c) => (
                  <p key={c} className="text-slate-400 text-sm flex items-center gap-2">
                    <span className="text-slate-600">•</span> {c}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Web3 Score */}
          {ep.web3NativeScore != null && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-2 text-sm">Web3 Native Score</h3>
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-slate-800 rounded-full h-2">
                  <div
                    className="bg-indigo-500 h-2 rounded-full"
                    style={{ width: `${ep.web3NativeScore}%` }}
                  />
                </div>
                <span className="text-white text-sm font-medium">{ep.web3NativeScore}/100</span>
              </div>
            </div>
          )}

        </div>
      </div>

      {showEdit && data && (
        <EditProspectModal
          prospect={data}
          onClose={() => setShowEdit(false)}
          onUpdated={() => queryClient.invalidateQueries({ queryKey: ['prospect', id] })}
        />
      )}
    </div>
  );
}
