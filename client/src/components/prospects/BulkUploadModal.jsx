import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import toast from 'react-hot-toast';
import { X, Upload } from 'lucide-react';

const parseCSV = (text) => {
  const [headerLine, ...rows] = text.trim().split('\n');
  const headers = headerLine.split(',').map((h) => h.trim().toLowerCase().replace(/\s+/g, ''));
  return rows.map((row) => {
    const vals = row.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    const obj = {};
    headers.forEach((h, i) => (obj[h] = vals[i] || ''));
    return {
      firstName: obj.firstname || obj['first_name'] || obj.first || '',
      lastName: obj.lastname || obj['last_name'] || obj.last || '',
      company: obj.company || obj.organization || '',
      typeHint: obj.typehint || obj.type || 'unknown',
      rawEmail: obj.email || '',
      rawLinkedin: obj.linkedin || obj.linkedinurl || '',
      rawX: obj.x || obj.twitter || obj.xurl || '',
      rawTelegram: obj.telegram || '',
      rawGithub: obj.github || obj.githuburl || '',
    };
  }).filter((p) => p.firstName);
};

export default function BulkUploadModal({ onClose }) {
  const queryClient = useQueryClient();
  const [prospects, setProspects] = useState([]);
  const [fileName, setFileName] = useState('');

  const mutation = useMutation({
    mutationFn: (data) => api.post('/prospects/bulk', { prospects: data }),
    onSuccess: (res) => {
      toast.success(`${res.data.data.created} prospects added!`);
      queryClient.invalidateQueries(['prospects']);
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Upload failed'),
  });

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseCSV(ev.target.result);
      setProspects(parsed);
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <h2 className="text-white font-semibold">Bulk CSV Import</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="bg-slate-800/50 border border-dashed border-slate-700 rounded-xl p-6 text-center">
            <Upload size={24} className="mx-auto mb-2 text-slate-500" />
            <p className="text-slate-400 text-sm mb-1">Upload a CSV file</p>
            <p className="text-slate-600 text-xs">Columns: firstName, lastName, company, typeHint, email, linkedin, x, telegram, github</p>
            <label className="mt-3 inline-block px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm cursor-pointer transition">
              Choose file
              <input type="file" accept=".csv" className="hidden" onChange={handleFile} />
            </label>
          </div>

          {fileName && (
            <div className="bg-slate-800 rounded-lg px-4 py-3">
              <p className="text-slate-300 text-sm">
                <span className="font-medium">{fileName}</span> — {prospects.length} prospects parsed
              </p>
              {prospects.length > 0 && (
                <div className="mt-2 max-h-32 overflow-y-auto text-xs text-slate-500 space-y-1">
                  {prospects.slice(0, 5).map((p, i) => (
                    <div key={i}>{p.firstName} {p.lastName} {p.company && `@ ${p.company}`}</div>
                  ))}
                  {prospects.length > 5 && <div>…and {prospects.length - 5} more</div>}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm transition">Cancel</button>
            <button
              disabled={prospects.length === 0 || mutation.isPending}
              onClick={() => mutation.mutate(prospects)}
              className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition"
            >
              {mutation.isPending ? 'Uploading…' : `Import ${prospects.length} prospects`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
