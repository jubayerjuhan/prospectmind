import { useState } from 'react';
import { X } from 'lucide-react';

const EMPTY_FILTERS = { search: '', status: '', priority: '' };
const STATUS_OPTIONS = ['', 'pending', 'ready', 'failed', 'discovering', 'enriching', 'classifying', 'scoring', 'generating'];
const PRIORITY_OPTIONS = ['', 'high', 'medium', 'low'];

export default function ProspectListModal({
  mode = 'create',
  defaultType = 'manual',
  initialValues,
  initialFilters = EMPTY_FILTERS,
  selectedCount = 0,
  entityLabel = 'prospect list',
  onClose,
  onSubmit,
  isSubmitting,
}) {
  const [name, setName] = useState(initialValues?.name || '');
  const [type, setType] = useState(initialValues?.type || defaultType);
  const [filters, setFilters] = useState(initialValues?.filters || initialFilters);

  const isEdit = mode === 'edit';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <h2 className="text-white font-semibold">
            {isEdit
              ? `Edit ${entityLabel}`
              : type === 'dynamic'
                ? 'Save filtered view'
                : `Create ${entityLabel}`}
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({
              name,
              type,
              filters,
            });
          }}
          className="px-6 py-5 space-y-4"
        >
          <div>
            <label className="text-slate-400 text-xs block mb-1">List name</label>
            <input
              required
              className="input-field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="High-intent founders"
            />
          </div>

          {!isEdit && (
            <div>
              <label className="text-slate-400 text-xs block mb-1">List type</label>
              <select className="input-field" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="manual">Manual list</option>
                <option value="dynamic">Dynamic saved filter</option>
              </select>
            </div>
          )}

          {type === 'manual' ? (
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
              <p className="text-slate-300 text-sm">This list stores prospect references only.</p>
              <p className="text-slate-500 text-xs mt-1">
                {selectedCount > 0
                  ? `${selectedCount} selected prospects will be added when you create the ${entityLabel}.`
                  : `Create an empty ${entityLabel} now and add prospects later.`}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 space-y-3">
              <div>
                <label className="text-slate-400 text-xs block mb-1">Search</label>
                <input
                  className="input-field"
                  value={filters.search}
                  onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                  placeholder="Name or company"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 text-xs block mb-1">Status</label>
                  <select
                    className="input-field"
                    value={filters.status}
                    onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option || 'all'} value={option}>
                        {option || 'All statuses'}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 text-xs block mb-1">Priority</label>
                  <select
                    className="input-field"
                    value={filters.priority}
                    onChange={(e) => setFilters((prev) => ({ ...prev, priority: e.target.value }))}
                  >
                    {PRIORITY_OPTIONS.map((option) => (
                      <option key={option || 'all'} value={option}>
                        {option || 'All priorities'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-slate-500 text-xs">
                This view stays linked to the current filters and updates automatically as matching prospects change.
              </p>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition"
            >
              {isSubmitting ? 'Saving…' : isEdit ? 'Save changes' : `Create ${entityLabel}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
