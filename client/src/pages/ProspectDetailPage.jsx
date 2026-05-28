import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Code2, Link2, X as XIcon, Send, CheckCircle,
  Edit3, ExternalLink, MapPin, Briefcase, Activity, GraduationCap, RefreshCw,
  AlertTriangle,
} from 'lucide-react';

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

export default function ProspectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editingMsg, setEditingMsg] = useState(null);
  const [editText, setEditText]     = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['prospect', id],
    queryFn: () => api.get(`/prospects/${id}`).then((r) => r.data.data),
    refetchInterval: (d) =>
      !d || ['pending','discovering','enriching','classifying','scoring','generating'].includes(d.pipelineStatus)
        ? 5000 : false,
  });

  const rerunMutation = useMutation({
    mutationFn: () => api.post(`/prospects/${id}/retry`),
    onSuccess: () => {
      toast.success('Pipeline re-running…');
      queryClient.invalidateQueries(['prospect', id]);
    },
    onError: () => toast.error('Failed to restart pipeline'),
  });

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

  if (isLoading) return <DetailSkeleton />;
  if (!data)     return <div className="text-slate-400 py-20 text-center">Prospect not found.</div>;

  const p  = data;
  const ep = p.enrichedProfile || {};
  const isProcessing = !['ready','failed','pending'].includes(p.pipelineStatus);

  return (
    <div className="max-w-4xl mx-auto space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/prospects')} className="text-slate-500 hover:text-white transition">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-white text-2xl font-bold">{p.firstName} {p.lastName}</h1>
          <div className="flex items-center gap-3 mt-0.5">
            <p className="text-slate-400">{ep.currentRole || p.company}</p>
            {ep.location && (
              <span className="flex items-center gap-1 text-slate-500 text-sm">
                <MapPin size={12} /> {ep.location}
              </span>
            )}
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
        {p.compatibilityScore != null && (
          <div className="flex flex-col items-center gap-1">
            <div className="bg-indigo-900/50 border border-indigo-800 rounded-xl px-4 py-2 text-center">
              <div className="text-indigo-300 text-2xl font-bold">{p.compatibilityScore}</div>
              <div className="text-indigo-500 text-xs">/ 100</div>
            </div>
            {p.scoreLabel && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-indigo-900/40 text-indigo-300 border border-indigo-800 capitalize">
                {p.scoreLabel}
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
      {p.pipelineStatus === 'failed' && (
        <div className="bg-red-950/50 border border-red-800 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-red-300 text-sm font-medium">Pipeline failed</p>
            {p.pipelineError && (
              <p className="text-red-400/70 text-xs mt-0.5 break-words">{p.pipelineError}</p>
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

          {/* Classification */}
          {p.roleClassification?.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-3">Classification</h3>
              <div className="flex flex-wrap gap-2 mb-3">
                {p.roleClassification.map((r) => <Badge key={r}>{r}</Badge>)}
              </div>
              {p.scoreReasoning && <p className="text-slate-400 text-sm">{p.scoreReasoning}</p>}
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
          {p.messages?.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-4">Outreach Messages</h3>
              <div className="space-y-4">
                {p.messages.map((msg) => (
                  <div key={msg._id} className="border border-slate-800 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-slate-300 font-medium capitalize text-sm">{msg.channel}</span>
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
            </div>
          )}
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
    </div>
  );
}
