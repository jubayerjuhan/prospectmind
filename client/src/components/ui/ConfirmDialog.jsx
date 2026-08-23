import { useEffect } from 'react';
import { AlertTriangle, X, Loader2 } from 'lucide-react';

/**
 * Confirmation before something destructive.
 *
 * Replaces window.confirm for actions that delete data: the native dialog can't
 * say what will actually happen (does deleting from a campaign delete the
 * prospect?), can't show the name of the thing being deleted, and looks like a
 * browser warning rather than part of the app.
 *
 * @param {String}   title        Short, names the action.
 * @param {Node}     message      What will happen — be specific about scope.
 * @param {String}   confirmLabel Verb, matching the title ("Delete prospect").
 * @param {Boolean}  isPending    Disables both buttons and spins the confirm.
 * @param {'danger'|'warning'} tone
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  tone = 'danger',
  isPending = false,
  onConfirm,
  onClose,
}) {
  // Escape closes, like every other modal in the app — but never mid-request,
  // where dismissing would leave the user unsure whether it went through.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !isPending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPending, onClose]);

  const toneStyles =
    tone === 'danger'
      ? { icon: 'text-red-400', iconBg: 'bg-red-500/10 border-red-500/30', button: 'bg-red-600 hover:bg-red-500' }
      : { icon: 'text-amber-400', iconBg: 'bg-amber-500/10 border-amber-500/30', button: 'bg-amber-600 hover:bg-amber-500' };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4"
      onClick={() => !isPending && onClose()}
    >
      <div
        className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-start gap-4 px-6 pt-6">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${toneStyles.iconBg}`}>
            <AlertTriangle size={18} className={toneStyles.icon} />
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <h2 className="text-white font-semibold">{title}</h2>
            <div className="text-slate-400 text-sm mt-1.5 leading-relaxed">{message}</div>
          </div>
          <button
            onClick={onClose}
            disabled={isPending}
            className="text-slate-500 hover:text-white disabled:opacity-40 shrink-0"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex justify-end gap-2 px-6 py-5">
          <button
            onClick={onClose}
            disabled={isPending}
            className="px-4 py-2 rounded-lg text-sm text-slate-300 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 transition"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition ${toneStyles.button}`}
          >
            {isPending && <Loader2 size={14} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
