import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { X, Send, Clock, Loader2, AlertTriangle } from 'lucide-react';
import api from '../../lib/api';

/** Local datetime for <input type="datetime-local">, defaulting to an hour out. */
const defaultLocal = () => {
  const d = new Date(Date.now() + 3600_000 - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

export default function SendNewsletterModal({ campaign, recipientCount, onClose, onDone }) {
  // A campaign that already sent is here to retry its failures, not to re-blast.
  const retrying = campaign.status === 'sent' && campaign.stats.failed > 0;
  const targetCount = retrying ? campaign.stats.failed : recipientCount;
  const queryClient = useQueryClient();
  const [mode, setMode] = useState('now');
  const [when, setWhen] = useState(defaultLocal);

  const mutation = useMutation({
    mutationFn: () =>
      mode === 'now'
        ? api.post(`/newsletters/${campaign._id}/send`)
        // The input is local time; the API stores UTC.
        : api.post(`/newsletters/${campaign._id}/schedule`, { scheduledFor: new Date(when).toISOString() }),
    onSuccess: (res) => {
      toast.success(res.data.message || (mode === 'now' ? 'Sending started.' : 'Newsletter scheduled.'));
      queryClient.invalidateQueries({ queryKey: ['newsletters'] });
      queryClient.invalidateQueries({ queryKey: ['newsletter', campaign._id] });
      onDone?.();
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Could not start the send'),
  });

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <h2 className="text-white font-semibold">Send “{campaign.name}”</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="rounded-lg bg-slate-800/60 px-4 py-3 text-sm">
            <div className="text-slate-400">Subject</div>
            <div className="text-white mt-0.5">{campaign.subject}</div>
            <div className="text-slate-400 mt-3">{retrying ? 'Retrying' : 'Recipients'}</div>
            <div className="text-white mt-0.5">
              {targetCount} {retrying ? 'previously failed' : 'waiting'}
            </div>
          </div>

          <div className="flex gap-2">
            {[
              { id: 'now', icon: Send, label: 'Send now' },
              { id: 'later', icon: Clock, label: 'Schedule' },
            ].map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => setMode(id)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm transition border ${
                  mode === id
                    ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>

          {mode === 'later' && (
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Send at (your local time)</label>
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="input-field" />
            </div>
          )}

          <div className="flex gap-2.5 rounded-lg bg-amber-900/20 border border-amber-900/40 px-4 py-3 text-xs text-amber-200/90">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <span>
              {retrying
                ? 'Only the recipients that failed will be retried — anyone who already received this will not get it twice.'
                : 'Once sending starts the content is locked, and anyone who unsubscribes is excluded automatically. Make sure these recipients agreed to hear from you.'}
            </span>
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-slate-800">
          <button onClick={onClose} className="flex-1 py-2 bg-slate-800 text-slate-300 rounded-lg text-sm hover:bg-slate-700 transition">
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !targetCount}
            className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition flex items-center justify-center gap-2"
          >
            {mutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {mode === 'now' ? `${retrying ? 'Retry' : 'Send to'} ${targetCount}` : 'Schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}
