import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { X, Upload, FileSpreadsheet, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import { parseCsvText, normHeader, splitName } from '../../lib/csv';

/**
 * Recipient CSV import. Parsing happens here, not on the server — the user has
 * to confirm the column mapping before anything is uploaded, so the request
 * body is structured JSON rather than a file.
 */

const TARGET_FIELDS = [
  { value: 'ignore', label: 'Ignore' },
  { value: 'email', label: 'Email (required)' },
  { value: 'fullName', label: 'Full name (will be split)' },
  { value: 'firstName', label: 'First name' },
  { value: 'lastName', label: 'Last name' },
  { value: 'company', label: 'Company' },
];

const autoMapHeader = (header) => {
  const h = normHeader(header);
  if (!h) return 'ignore';
  if (h.includes('email') || h === 'mail') return 'email';
  if (h.includes('first') && h.includes('name')) return 'firstName';
  if (h.includes('last') && h.includes('name')) return 'lastName';
  if (h.includes('name') && !h.includes('user') && !h.includes('company')) return 'fullName';
  if (h.includes('company') || h.includes('organization') || h.includes('organisation')) return 'company';
  return 'ignore';
};

const buildContact = (values, headers, mapping) => {
  const byField = {};
  headers.forEach((header, i) => {
    const field = mapping[header];
    const value = (values[i] || '').trim();
    if (!value || field === 'ignore') return;
    byField[field] = value;
  });

  if (byField.fullName && !byField.firstName) {
    const split = splitName(byField.fullName);
    byField.firstName = split.firstName;
    byField.lastName = byField.lastName || split.lastName;
  }
  delete byField.fullName;

  return byField;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RecipientCsvImportModal({ campaign, onClose, onImported }) {
  const queryClient = useQueryClient();
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [fileName, setFileName] = useState('');

  const handleFile = (file) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const table = parseCsvText(String(ev.target.result));
      if (table.length < 2) {
        toast.error('That file has no data rows.');
        return;
      }
      const [head, ...body] = table;
      setHeaders(head);
      setRows(body);
      setMapping(Object.fromEntries(head.map((h) => [h, autoMapHeader(h)])));
    };
    reader.readAsText(file);
  };

  const { contacts, invalid } = useMemo(() => {
    const built = rows.map((r) => buildContact(r, headers, mapping));
    return {
      contacts: built.filter((c) => EMAIL_RE.test(c.email || '')),
      invalid: built.filter((c) => !EMAIL_RE.test(c.email || '')).length,
    };
  }, [rows, headers, mapping]);

  const hasEmailColumn = Object.values(mapping).includes('email');

  const mutation = useMutation({
    mutationFn: () => api.post(`/newsletters/${campaign._id}/contacts/import`, { contacts }),
    onSuccess: (res) => {
      const { created, skipped, suppressed } = res.data.data;
      const notes = [
        skipped ? `${skipped} skipped` : null,
        suppressed ? `${suppressed} on the unsubscribe list` : null,
      ].filter(Boolean);
      toast.success(`Imported ${created} recipient${created === 1 ? '' : 's'}${notes.length ? ` (${notes.join(', ')})` : ''}.`);
      queryClient.invalidateQueries({ queryKey: ['newsletter-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['newsletter', campaign._id] });
      onImported?.();
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Import failed'),
  });

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <h2 className="text-white font-semibold">Import recipients</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 overflow-y-auto space-y-5">
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-700 rounded-xl py-8 cursor-pointer hover:border-slate-600 transition">
            <FileSpreadsheet size={24} className="text-slate-500" />
            <span className="text-sm text-slate-400">
              {fileName || 'Choose a CSV file'}
            </span>
            <span className="text-xs text-slate-600">Needs at least an email column</span>
            <input type="file" accept=".csv" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
          </label>

          {headers.length > 0 && (
            <>
              <div>
                <h3 className="text-sm font-medium text-slate-300 mb-2">Match your columns</h3>
                <div className="space-y-2">
                  {headers.map((header) => (
                    <div key={header} className="flex items-center gap-3">
                      <span className="flex-1 text-sm text-slate-400 truncate">{header}</span>
                      <select
                        value={mapping[header] || 'ignore'}
                        onChange={(e) => setMapping((m) => ({ ...m, [header]: e.target.value }))}
                        className="input-field w-52"
                      >
                        {TARGET_FIELDS.map((f) => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              <div className="text-xs text-slate-500">
                {contacts.length} recipient{contacts.length === 1 ? '' : 's'} ready
                {invalid > 0 && <span className="text-amber-400"> · {invalid} row{invalid === 1 ? '' : 's'} without a valid email will be skipped</span>}
              </div>

              {contacts.length > 0 && (
                <div className="rounded-lg border border-slate-800 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-800/60 text-slate-400">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Email</th>
                        <th className="text-left px-3 py-2 font-medium">Name</th>
                        <th className="text-left px-3 py-2 font-medium">Company</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-300">
                      {contacts.slice(0, 5).map((c, i) => (
                        <tr key={i} className="border-t border-slate-800">
                          <td className="px-3 py-2">{c.email}</td>
                          <td className="px-3 py-2">{[c.firstName, c.lastName].filter(Boolean).join(' ') || '—'}</td>
                          <td className="px-3 py-2">{c.company || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-slate-800">
          <button onClick={onClose} className="flex-1 py-2 bg-slate-800 text-slate-300 rounded-lg text-sm hover:bg-slate-700 transition">
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!contacts.length || !hasEmailColumn || mutation.isPending}
            className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition flex items-center justify-center gap-2"
          >
            {mutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            Import {contacts.length || ''}
          </button>
        </div>
      </div>
    </div>
  );
}
