import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Check, Loader2, Plus } from 'lucide-react';
import api from '../../lib/api';

const fetchSettingResource = (resource) => api.get(`/${resource}`).then((r) => r.data.data);

/**
 * Multi-select for a reusable prompt setting (Persona / Playbook / Signal).
 * Options come from Settings; selecting none means "use every active one".
 */
export default function StrategyPicker({
  resource,
  title,
  description,
  icon: Icon,
  emptyHint,
  selected = [],
  onChange,
}) {
  const { data: items = [], isLoading } = useQuery({
    queryKey: [resource, 'all'],
    queryFn: () => fetchSettingResource(resource),
    staleTime: 30_000,
  });

  const toggle = (id) => {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  };

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10">
            <Icon size={15} className="text-indigo-400" />
          </div>
          <div>
            <h3 className="font-semibold text-white">{title}</h3>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-500">{description}</p>
          </div>
        </div>
        <Link
          to="/settings"
          className="shrink-0 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] text-slate-400 transition hover:border-indigo-500/50 hover:text-indigo-300"
        >
          Manage in Settings
        </Link>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-6 text-xs text-slate-500">
          <Loader2 size={13} className="animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-slate-800 px-4 py-6 text-center">
          <p className="text-sm text-slate-400">{emptyHint}</p>
          <Link
            to="/settings"
            className="mt-2 inline-flex items-center gap-1.5 text-xs text-indigo-400 transition hover:text-indigo-300"
          >
            <Plus size={12} /> Create one in Settings
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {items.map((item) => {
              const isSelected = selected.includes(item._id);
              return (
                <button
                  key={item._id}
                  type="button"
                  onClick={() => toggle(item._id)}
                  className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${
                    isSelected
                      ? 'border-indigo-500/60 bg-indigo-500/10'
                      : 'border-slate-800 bg-slate-950/50 hover:border-slate-700'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                      isSelected ? 'border-indigo-500 bg-indigo-500' : 'border-slate-600'
                    }`}
                  >
                    {isSelected && <Check size={11} className="text-white" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className={`truncate text-sm ${isSelected ? 'text-white' : 'text-slate-300'}`}>
                        {item.name}
                      </span>
                      {item.isActive === false && (
                        <span className="shrink-0 rounded-full bg-slate-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-slate-500">
                          inactive
                        </span>
                      )}
                    </span>
                    {item.appliesTo?.length > 0 && (
                      <span className="mt-1 block text-[10px] uppercase tracking-wide text-slate-600">
                        {item.appliesTo.join(' · ')}
                      </span>
                    )}
                    <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-slate-500">{item.prompt}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-slate-600">
            {selected.length > 0
              ? `${selected.length} selected — only these run for this campaign.`
              : 'Nothing selected — every active one in your organization will be used.'}
          </p>
        </>
      )}
    </section>
  );
}
