import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import {
  X, Loader2, Globe, Code2, AtSign, MessageCircle, MapPin, Calendar, BookmarkPlus, CheckCircle2,
} from 'lucide-react';

export default function CompanyFinderDetailModal({ source, slug, name, onClose }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['company-finder-detail', source, slug],
    queryFn: () => api.get(`/company-finder/companies/${source}/${slug}`).then((r) => r.data.data),
  });

  const saveMutation = useMutation({
    mutationFn: () => api.post(`/company-finder/companies/${source}/${slug}/save`).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      toast.success('Saved to Companies');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to save company'),
  });

  const stripHtml = (val) => (typeof val === 'string' ? val.replace(/<[^>]*>/g, '').trim() : val);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
          <h2 className="text-white font-bold truncate">{data?.name || name}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition shrink-0 ml-3">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 text-slate-400 text-sm py-16">
              <Loader2 size={16} className="animate-spin" /> Loading company profile…
            </div>
          ) : !data ? (
            <p className="text-slate-400 text-sm py-8 text-center">Could not load this company.</p>
          ) : (
            <>
              {data.about && <p className="text-slate-300 text-sm">{stripHtml(data.about)}</p>}

              <div className="space-y-2.5">
                {data.website && (
                  <a
                    href={data.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2.5 text-sm text-indigo-400 hover:text-indigo-300 transition"
                  >
                    <Globe size={15} className="shrink-0" /> <span className="truncate">{data.website}</span>
                  </a>
                )}
                {data.twitter && (
                  <a
                    href={data.twitter}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2.5 text-sm text-indigo-400 hover:text-indigo-300 transition"
                  >
                    <AtSign size={15} className="shrink-0" /> <span className="truncate">{data.twitter}</span>
                  </a>
                )}
                {data.github && (
                  <a
                    href={data.github}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2.5 text-sm text-indigo-400 hover:text-indigo-300 transition"
                  >
                    <Code2 size={15} className="shrink-0" /> <span className="truncate">{data.github}</span>
                  </a>
                )}
                {data.discord && (
                  <a
                    href={data.discord}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2.5 text-sm text-indigo-400 hover:text-indigo-300 transition"
                  >
                    <MessageCircle size={15} className="shrink-0" /> <span className="truncate">{data.discord}</span>
                  </a>
                )}
                {data.location && (
                  <p className="flex items-center gap-2.5 text-sm text-slate-400">
                    <MapPin size={15} className="shrink-0" /> <span className="truncate">{data.location}</span>
                  </p>
                )}
                {data.foundedDate && (
                  <p className="flex items-center gap-2.5 text-sm text-slate-400">
                    <Calendar size={15} className="shrink-0" /> Founded {stripHtml(data.foundedDate)}
                  </p>
                )}
                {!data.website && !data.twitter && !data.github && !data.discord && (
                  <p className="text-slate-500 text-xs italic">
                    No website or social links on file for this company yet.
                  </p>
                )}
              </div>

              <a
                href={data.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs text-slate-500 hover:text-slate-400 transition"
              >
                View on CryptoJobsList →
              </a>
            </>
          )}
        </div>

        {data && (
          <div className="flex items-center gap-3 px-6 py-4 border-t border-slate-800 shrink-0">
            {saveMutation.isSuccess ? (
              <button
                type="button"
                onClick={() => navigate(`/companies/${saveMutation.data._id}`)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-900/50 border border-green-800 text-green-400 rounded-xl font-medium transition"
              >
                <CheckCircle2 size={16} /> Saved — View Company
              </button>
            ) : (
              <button
                type="button"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-xl font-medium transition"
              >
                {saveMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <BookmarkPlus size={16} />}
                Save to Companies
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
