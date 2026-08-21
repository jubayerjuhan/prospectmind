import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Trash2, Upload, Search, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import { RECIPIENT_COLOR, IS_LIVE } from './newsletterStatus';
import RecipientCsvImportModal from './RecipientCsvImportModal';

const STATUS_FILTERS = ['', 'pending', 'sent', 'failed', 'unsubscribed'];

export default function RecipientsTab({ campaign }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState([]);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', company: '' });

  const locked = ['sending', 'sent'].includes(campaign.status);

  const { data, isLoading } = useQuery({
    queryKey: ['newsletter-contacts', campaign._id, page, status, search],
    queryFn: () =>
      api
        .get(`/newsletters/${campaign._id}/contacts`, { params: { page, limit: 50, status: status || undefined, search: search || undefined } })
        .then((r) => r.data),
    // While a blast is running the statuses change every second or so; a frozen
    // table is the main thing that makes a send feel broken.
    refetchInterval: IS_LIVE(campaign.status) ? 4000 : false,
    placeholderData: (prev) => prev,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['newsletter-contacts', campaign._id] });
    queryClient.invalidateQueries({ queryKey: ['newsletter', campaign._id] });
    setSelected([]);
  };

  const addOne = useMutation({
    mutationFn: () => api.post(`/newsletters/${campaign._id}/contacts`, form),
    onSuccess: (res) => {
      toast[res.data.suppressed ? 'error' : 'success'](
        res.data.suppressed ? 'Added, but this address has unsubscribed and will be skipped.' : 'Recipient added.'
      );
      setForm({ firstName: '', lastName: '', email: '', company: '' });
      invalidate();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Could not add recipient'),
  });

  const removeMany = useMutation({
    mutationFn: () => api.delete(`/newsletters/${campaign._id}/contacts`, { data: { contactIds: selected } }),
    onSuccess: (res) => { toast.success(`Removed ${res.data.data.removed}.`); invalidate(); },
    onError: (err) => toast.error(err.response?.data?.message || 'Could not remove'),
  });

  const contacts = data?.data || [];
  const pagination = data?.pagination;
  const allSelected = contacts.length > 0 && selected.length === contacts.length;

  return (
    <div className="space-y-5">
      {!locked && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex flex-wrap items-end gap-3">
            {[
              ['email', 'Email', 'ada@example.com'],
              ['firstName', 'First name', 'Ada'],
              ['lastName', 'Last name', 'Lovelace'],
              ['company', 'Company', 'Acme'],
            ].map(([key, label, placeholder]) => (
              <div key={key} className="flex-1 min-w-[140px]">
                <label className="block text-xs text-slate-500 mb-1">{label}</label>
                <input
                  className="input-field"
                  placeholder={placeholder}
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                />
              </div>
            ))}
            <button
              onClick={() => addOne.mutate()}
              disabled={!form.email || addOne.isPending}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-500 disabled:opacity-60 transition"
            >
              {addOne.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Add
            </button>
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 transition"
            >
              <Upload size={15} /> Import CSV
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            className="input-field pl-9"
            placeholder="Search recipients…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="input-field w-44">
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>{s ? s[0].toUpperCase() + s.slice(1) : 'All statuses'}</option>
          ))}
        </select>
        {selected.length > 0 && !locked && (
          <button
            onClick={() => removeMany.mutate()}
            className="flex items-center gap-2 rounded-lg bg-red-900/40 px-4 py-2 text-sm text-red-300 hover:bg-red-900/60 transition"
          >
            <Trash2 size={15} /> Remove {selected.length}
          </button>
        )}
      </div>

      <div className="rounded-xl border border-slate-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="w-10 px-4 py-3">
                {!locked && (
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => setSelected(e.target.checked ? contacts.map((c) => c._id) : [])}
                    className="accent-indigo-500"
                  />
                )}
              </th>
              <th className="text-left px-4 py-3 font-medium">Email</th>
              <th className="text-left px-4 py-3 font-medium">Name</th>
              <th className="text-left px-4 py-3 font-medium">Company</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-t border-slate-800">
                    <td colSpan={5} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-slate-800" /></td>
                  </tr>
                ))
              : contacts.length === 0
                ? (
                  <tr className="border-t border-slate-800">
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                      No recipients yet — add one above or import a CSV.
                    </td>
                  </tr>
                )
                : contacts.map((c) => (
                    <tr key={c._id} className="border-t border-slate-800 hover:bg-slate-900/50">
                      <td className="px-4 py-3">
                        {!locked && (
                          <input
                            type="checkbox"
                            checked={selected.includes(c._id)}
                            onChange={(e) =>
                              setSelected((s) => (e.target.checked ? [...s, c._id] : s.filter((id) => id !== c._id)))
                            }
                            className="accent-indigo-500"
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-300">{c.email}</td>
                      <td className="px-4 py-3 text-slate-400">{[c.firstName, c.lastName].filter(Boolean).join(' ') || '—'}</td>
                      <td className="px-4 py-3 text-slate-400">{c.company || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] ${RECIPIENT_COLOR[c.status] || RECIPIENT_COLOR.pending}`}>
                          {c.status}
                        </span>
                        {c.error && <div className="text-[11px] text-red-400 mt-1 max-w-xs truncate" title={c.error}>{c.error}</div>}
                      </td>
                    </tr>
                  ))}
          </tbody>
        </table>
      </div>

      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{pagination.total} recipients</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 rounded bg-slate-800 disabled:opacity-40 hover:bg-slate-700 transition">Previous</button>
            <span className="px-2 py-1.5">Page {page} of {pagination.pages}</span>
            <button disabled={page >= pagination.pages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 rounded bg-slate-800 disabled:opacity-40 hover:bg-slate-700 transition">Next</button>
          </div>
        </div>
      )}

      {showImport && (
        <RecipientCsvImportModal campaign={campaign} onClose={() => setShowImport(false)} onImported={invalidate} />
      )}
    </div>
  );
}
