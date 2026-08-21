import { useQuery } from '@tanstack/react-query';
import { X, Loader2 } from 'lucide-react';
import api from '../../lib/api';

/**
 * Shows exactly what the worker would send, and sends nothing.
 *
 * Rendered in a sandboxed iframe: the email template is a full document with
 * its own body styles, and dropping that into the page would let it fight the
 * app shell. `sandbox` with no allowances also means nothing in it can run.
 */
export default function NewsletterPreviewModal({ campaign, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['newsletter-preview', campaign._id],
    queryFn: () => api.get(`/newsletters/${campaign._id}/preview`).then((r) => r.data.data),
  });

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="min-w-0">
            <h2 className="text-white font-semibold truncate">{data?.subject || 'Preview'}</h2>
            {data?.sampleEmail && (
              <p className="text-xs text-slate-500 mt-0.5">Merge tags filled from {data.sampleEmail}</p>
            )}
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white shrink-0"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-hidden p-4">
          {isLoading ? (
            <div className="h-full flex items-center justify-center text-slate-500">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : (
            <iframe
              title="Newsletter preview"
              sandbox=""
              srcDoc={data?.html || ''}
              className="w-full h-full rounded-lg bg-white"
            />
          )}
        </div>
      </div>
    </div>
  );
}
