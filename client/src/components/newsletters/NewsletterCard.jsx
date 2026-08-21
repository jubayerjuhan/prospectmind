import { Mail, Users, Clock } from 'lucide-react';
import { STATUS_COLOR, formatWhen } from './newsletterStatus';

export default function NewsletterCard({ newsletter, onOpen }) {
  const { name, subject, status, stats, scheduledFor } = newsletter;

  return (
    <button
      onClick={onOpen}
      className="group w-full text-left bg-slate-900 border border-slate-800 rounded-2xl p-5 transition hover:border-slate-700 hover:bg-slate-900/80"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-white font-semibold truncate">{name}</h3>
          <p className="text-sm text-slate-500 truncate mt-0.5">
            {subject || <span className="italic text-slate-600">No subject yet</span>}
          </p>
        </div>
        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_COLOR[status] || STATUS_COLOR.draft}`}>
          {status}
        </span>
      </div>

      <div className="flex items-center gap-4 mt-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <Users size={13} /> {stats?.total || 0} recipients
        </span>
        {status === 'sent' && (
          <span className="flex items-center gap-1.5 text-emerald-400">
            <Mail size={13} /> {stats?.sent || 0} sent
            {stats?.failed > 0 && <span className="text-red-400">· {stats.failed} failed</span>}
          </span>
        )}
        {status === 'scheduled' && (
          <span className="flex items-center gap-1.5 text-amber-400">
            <Clock size={13} /> {formatWhen(scheduledFor)}
          </span>
        )}
      </div>
    </button>
  );
}
