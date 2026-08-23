import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { parseCsvText, splitName } from '../../lib/csv';
import toast from 'react-hot-toast';
import { X, Upload, FileSpreadsheet } from 'lucide-react';

const TARGET_FIELDS = [
  { value: 'ignore', label: 'Ignore' },
  { value: 'fullName', label: 'Full name (will be split)' },
  { value: 'firstName', label: 'First name' },
  { value: 'lastName', label: 'Last name' },
  { value: 'company', label: 'Company' },
  { value: 'rawEmail', label: 'Email' },
  { value: 'rawLinkedin', label: 'LinkedIn' },
  { value: 'rawPhone', label: 'Phone' },
  { value: 'rawGithub', label: 'GitHub' },
  { value: 'rawX', label: 'X / Twitter' },
  { value: 'rawTelegram', label: 'Telegram' },
  { value: 'rawWebsite', label: 'Website / Portfolio' },
  { value: 'context', label: 'Other (kept as context)' },
];

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Best-effort auto-mapping of CSV headers to target fields, by keyword match. */
const autoMapHeader = (header) => {
  const h = norm(header);
  if (!h) return 'ignore';
  if ((h.includes('first') && h.includes('name'))) return 'firstName';
  if ((h.includes('last') && h.includes('name'))) return 'lastName';
  if (h.includes('name') && !h.includes('user') && !h.includes('company') && !h.includes('account')) return 'fullName';
  if (h.includes('email')) return 'rawEmail';
  if (h.includes('linkedin')) return 'rawLinkedin';
  if (h.includes('phone') || h.includes('mobile') || h.includes('whatsapp')) return 'rawPhone';
  if (h.includes('github')) return 'rawGithub';
  if (h.includes('twitter') || h === 'x' || h.includes('xurl') || h.includes('twitterx')) return 'rawX';
  if (h.includes('telegram')) return 'rawTelegram';
  if (h.includes('portfolio') || h.includes('website') || h.includes('site')) return 'rawWebsite';
  if (h.includes('company') || h.includes('organization') || h.includes('organisation')) return 'company';
  if (h.includes('location') || h.includes('stackoverflow') || h.includes('wallet')) return 'context';
  return 'ignore';
};

/** Turn one parsed CSV row + column mapping into an import candidate. */
const buildCandidate = (values, headers, mapping) => {
  const byField = {};
  const contextParts = [];

  headers.forEach((header, i) => {
    const field = mapping[header];
    const value = (values[i] || '').trim();
    if (!value || field === 'ignore') return;
    if (field === 'context') {
      contextParts.push(`${header}: ${value}`);
    } else {
      byField[field] = value;
    }
  });

  let firstName = byField.firstName || '';
  let lastName = byField.lastName || '';
  if (!firstName && byField.fullName) {
    const split = splitName(byField.fullName);
    firstName = split.firstName;
    lastName = lastName || split.lastName;
  }

  return {
    firstName,
    lastName,
    company: byField.company || '',
    rawEmail: byField.rawEmail || '',
    rawLinkedin: byField.rawLinkedin || '',
    rawPhone: byField.rawPhone || '',
    rawGithub: byField.rawGithub || '',
    rawX: byField.rawX || '',
    rawTelegram: byField.rawTelegram || '',
    rawWebsite: byField.rawWebsite || '',
    description: contextParts.join('; '),
  };
};

export default function CampaignCsvImportModal({ campaign, onClose, onImported }) {
  const queryClient = useQueryClient();
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [typeHint, setTypeHint] = useState('unknown');

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const table = parseCsvText(String(ev.target.result));
      if (table.length < 2) {
        toast.error('That file has no data rows.');
        return;
      }
      const [headerRow, ...dataRows] = table;
      const cleanHeaders = headerRow.map((h) => h.trim());
      setHeaders(cleanHeaders);
      setRows(dataRows);
      const initialMapping = {};
      cleanHeaders.forEach((h) => { initialMapping[h] = autoMapHeader(h); });
      setMapping(initialMapping);
    };
    reader.readAsText(file);
  };

  const candidates = useMemo(() => {
    if (!headers.length) return [];
    return rows
      .map((row) => buildCandidate(row, headers, mapping))
      .filter((c) => c.firstName)
      .map((c) => ({ ...c, typeHint }));
  }, [headers, rows, mapping, typeHint]);

  const skippedCount = rows.length - candidates.length;

  const mutation = useMutation({
    mutationFn: () => api.post(`/prospect-lists/${campaign._id}/prospects/bulk-import`, { candidates }),
    onSuccess: (res) => {
      const { created, skipped } = res.data.data;
      toast.success(
        `Imported ${created} prospect${created === 1 ? '' : 's'}${skipped ? ` (${skipped} skipped as duplicates or over limit)` : ''} — press Start enrichment when ready.`
      );
      if (res.data.campaignSettingsMissing) {
        toast('Set a campaign goal in Strategy before enriching these prospects.', { icon: '⚠️' });
      }
      queryClient.invalidateQueries({ queryKey: ['prospects'] });
      queryClient.invalidateQueries({ queryKey: ['prospect-lists'] });
      queryClient.invalidateQueries({ queryKey: ['prospect-list'] });
      onImported?.();
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Import failed'),
  });

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 flex-shrink-0">
          <h2 className="text-white font-semibold flex items-center gap-2">
            <FileSpreadsheet size={18} className="text-indigo-400" /> Import CSV into "{campaign?.name}"
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          {!headers.length ? (
            <div className="bg-slate-800/50 border border-dashed border-slate-700 rounded-xl p-8 text-center">
              <Upload size={24} className="mx-auto mb-2 text-slate-500" />
              <p className="text-slate-400 text-sm mb-1">Upload a CSV file</p>
              <p className="text-slate-600 text-xs mb-3">
                Any column layout works — you'll map columns to fields next. We need at least a name;
                LinkedIn, email, and other contact info are picked up automatically where possible.
              </p>
              <label className="inline-block px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm cursor-pointer transition">
                Choose file
                <input type="file" accept=".csv" className="hidden" onChange={handleFile} />
              </label>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-slate-300 text-sm">
                  <span className="font-medium">{fileName}</span> — {rows.length} row{rows.length === 1 ? '' : 's'} found
                </p>
                <label className="text-xs text-indigo-400 hover:text-indigo-300 cursor-pointer">
                  Choose a different file
                  <input type="file" accept=".csv" className="hidden" onChange={handleFile} />
                </label>
              </div>

              <div>
                <p className="text-slate-400 text-xs mb-2">Map each column to a field</p>
                <div className="border border-slate-800 rounded-xl divide-y divide-slate-800 max-h-56 overflow-y-auto">
                  {headers.map((header) => (
                    <div key={header} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="text-slate-300 text-xs truncate flex-1">{header}</span>
                      <select
                        className="input-field text-xs w-52 flex-shrink-0"
                        value={mapping[header] || 'ignore'}
                        onChange={(e) => setMapping((prev) => ({ ...prev, [header]: e.target.value }))}
                      >
                        {TARGET_FIELDS.map((f) => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <label className="text-slate-400 text-xs">Import as</label>
                <select className="input-field text-xs w-40" value={typeHint} onChange={(e) => setTypeHint(e.target.value)}>
                  <option value="unknown">Unknown</option>
                  <option value="talent">Talent</option>
                  <option value="client">Client</option>
                </select>
              </div>

              <div className="bg-slate-800 rounded-lg px-4 py-3">
                <p className="text-slate-300 text-sm mb-2">
                  {candidates.length} prospect{candidates.length === 1 ? '' : 's'} ready to import
                  {skippedCount > 0 && <span className="text-slate-500"> — {skippedCount} row{skippedCount === 1 ? '' : 's'} skipped (no name)</span>}
                </p>
                {candidates.length > 0 && (
                  <div className="max-h-40 overflow-y-auto text-xs text-slate-500 space-y-1">
                    {candidates.slice(0, 6).map((c, i) => (
                      <div key={i} className="truncate">
                        {c.firstName} {c.lastName}
                        {c.rawEmail && ` · ${c.rawEmail}`}
                        {c.rawLinkedin && ` · ${c.rawLinkedin}`}
                      </div>
                    ))}
                    {candidates.length > 6 && <div>…and {candidates.length - 6} more</div>}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex gap-2 px-6 py-4 border-t border-slate-800 flex-shrink-0">
          <button onClick={onClose} className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm transition">Cancel</button>
          <button
            disabled={candidates.length === 0 || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition"
          >
            {mutation.isPending ? 'Importing…' : `Import ${candidates.length} prospect${candidates.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
