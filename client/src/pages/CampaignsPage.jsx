import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import toast from 'react-hot-toast';
import {
  Search,
  RefreshCw,
  ChevronRight,
  ChevronLeft,
  Save,
  Pencil,
  Trash2,
  FolderPlus,
  CheckSquare,
  Megaphone,
  Plus,
  Link as LinkIcon,
  Pause,
  Play,
} from 'lucide-react';
import AddProspectModal from '../components/prospects/AddProspectModal';
import CampaignImportModal from '../components/prospects/CampaignImportModal';
import ProspectListModal from '../components/prospects/ProspectListModal';

const STATUS_COLOR = {
  pending: 'bg-slate-700 text-slate-300',
  ready: 'bg-green-900/50 text-green-400',
  failed: 'bg-red-900/50 text-red-400',
  discovering: 'bg-blue-900/50 text-blue-400',
  enriching: 'bg-purple-900/50 text-purple-400',
  classifying: 'bg-yellow-900/50 text-yellow-400',
  scoring: 'bg-orange-900/50 text-orange-400',
  generating: 'bg-indigo-900/50 text-indigo-400',
  paused: 'bg-amber-900/50 text-amber-300',
};

const PRIORITY_COLOR = { high: 'text-green-400', medium: 'text-yellow-400', low: 'text-slate-500' };
const PRIORITY_OPTIONS = ['high', 'medium', 'low'];
const PAGE_SIZE = 20;
const EMPTY_MODAL = { open: false, mode: 'create', defaultType: 'manual', initialValues: null };
const ACTIVE_PIPELINE_STATUSES = ['discovering', 'enriching', 'classifying', 'scoring', 'generating'];

export default function CampaignsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState([]);
  const [targetListId, setTargetListId] = useState('');
  const [listModal, setListModal] = useState(EMPTY_MODAL);
  const [showAddProspect, setShowAddProspect] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  const activeListId = searchParams.get('list');
  const activeView = activeListId ? { kind: 'list', id: activeListId } : { kind: 'all' };
  const isAllCampaignsSource = !activeListId;

  const listsQuery = useQuery({
    queryKey: ['prospect-lists'],
    queryFn: () => api.get('/prospect-lists', { params: { limit: 100 } }).then((r) => r.data),
    staleTime: 30_000,
  });

  const prospectsQuery = useQuery({
    queryKey: ['prospects', 'campaign-source', search, statusFilter, priorityFilter, page],
    queryFn: () =>
      api.get('/prospects', {
        params: { search, status: statusFilter, priority: priorityFilter, limit: PAGE_SIZE, page },
      }).then((r) => r.data),
    refetchInterval: isAllCampaignsSource ? 8000 : false,
    keepPreviousData: true,
    enabled: isAllCampaignsSource,
  });

  const activeListQuery = useQuery({
    queryKey: ['prospect-list', activeView.id, page],
    queryFn: () =>
      api.get(`/prospect-lists/${activeView.id}`, {
        params: { page, limit: PAGE_SIZE },
      }).then((r) => r.data),
    enabled: activeView.kind === 'list' && Boolean(activeView.id),
    refetchInterval: activeView.kind === 'list' ? 8000 : false,
    keepPreviousData: true,
  });

  const retryMutation = useMutation({
    mutationFn: (id) => api.post(`/prospects/${id}/retry`),
    onSuccess: () => {
      toast.success('Pipeline restarted');
      queryClient.invalidateQueries({ queryKey: ['prospects'] });
      queryClient.invalidateQueries({ queryKey: ['prospect-list'] });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: (id) => api.post(`/prospects/${id}/pause`),
    onSuccess: (response) => {
      toast.success(response.data.message || 'Pause requested');
      queryClient.invalidateQueries({ queryKey: ['prospects'] });
      queryClient.invalidateQueries({ queryKey: ['prospect-list'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to pause pipeline'),
  });

  const resumeMutation = useMutation({
    mutationFn: (id) => api.post(`/prospects/${id}/resume`),
    onSuccess: (response) => {
      toast.success(response.data.message || 'Pipeline resumed');
      queryClient.invalidateQueries({ queryKey: ['prospects'] });
      queryClient.invalidateQueries({ queryKey: ['prospect-list'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to resume pipeline'),
  });

  const createListMutation = useMutation({
    mutationFn: (payload) => api.post('/prospect-lists', payload).then((r) => r.data.data),
    onSuccess: (list) => {
      toast.success('Campaign created');
      queryClient.invalidateQueries({ queryKey: ['prospect-lists'] });
      setListModal(EMPTY_MODAL);
      setSearchParams({ list: list._id });
      setPage(1);
      setSelectedIds([]);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to create campaign'),
  });

  const updateListMutation = useMutation({
    mutationFn: ({ id, payload }) => api.patch(`/prospect-lists/${id}`, payload).then((r) => r.data.data),
    onSuccess: (list) => {
      toast.success('Campaign updated');
      queryClient.invalidateQueries({ queryKey: ['prospect-lists'] });
      queryClient.invalidateQueries({ queryKey: ['prospect-list', list._id] });
      setListModal(EMPTY_MODAL);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update campaign'),
  });

  const deleteListMutation = useMutation({
    mutationFn: (id) => api.delete(`/prospect-lists/${id}`),
    onSuccess: () => {
      toast.success('Campaign deleted');
      queryClient.invalidateQueries({ queryKey: ['prospect-lists'] });
      setSearchParams({});
      setPage(1);
      setSelectedIds([]);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to delete campaign'),
  });

  const addToListMutation = useMutation({
    mutationFn: ({ listId, prospectIds }) => api.post(`/prospect-lists/${listId}/prospects`, { prospectIds }),
    onSuccess: () => {
      toast.success('Prospects added to campaign');
      queryClient.invalidateQueries({ queryKey: ['prospect-lists'] });
      queryClient.invalidateQueries({ queryKey: ['prospect-list'] });
      setSelectedIds([]);
      setTargetListId('');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to add prospects to campaign'),
  });

  const removeFromListMutation = useMutation({
    mutationFn: ({ listId, prospectIds }) =>
      api.delete(`/prospect-lists/${listId}/prospects`, { data: { prospectIds } }),
    onSuccess: () => {
      toast.success('Prospects removed from campaign');
      queryClient.invalidateQueries({ queryKey: ['prospect-lists'] });
      queryClient.invalidateQueries({ queryKey: ['prospect-list', activeView.id] });
      setSelectedIds([]);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to remove prospects from campaign'),
  });

  const lists = listsQuery.data?.data || [];
  const manualLists = lists.filter((list) => list.type === 'manual');
  const currentListMeta = activeView.kind === 'list' ? lists.find((list) => list._id === activeView.id) : null;
  const activeListData = activeListQuery.data?.data;
  const activeList = activeListData || currentListMeta;
  const currentRows = isAllCampaignsSource ? prospectsQuery.data?.data || [] : activeListData?.prospects || [];
  const pagination = isAllCampaignsSource ? prospectsQuery.data?.pagination : activeListQuery.data?.pagination;
  const total = pagination?.total ?? currentListMeta?.prospectCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selectedCount = selectedIds.length;
  const isLoading = isAllCampaignsSource ? prospectsQuery.isLoading : activeListQuery.isLoading;
  const viewTitle = isAllCampaignsSource ? 'Campaigns' : activeList?.name || 'Campaign';
  const viewSubtitle = isAllCampaignsSource
    ? 'Create campaigns and assign prospects to each one.'
    : `${total} prospect${total === 1 ? '' : 's'} in this campaign`;
  const currentListFilters = activeList?.filters || { search: '', status: '', priority: '' };

  const handleSearch = (val) => {
    setSearch(val);
    setPage(1);
    setSelectedIds([]);
    if (!isAllCampaignsSource) setSearchParams({});
  };

  const handleStatus = (val) => {
    setStatusFilter(val);
    setPage(1);
    setSelectedIds([]);
    if (!isAllCampaignsSource) setSearchParams({});
  };

  const handlePriority = (val) => {
    setPriorityFilter(val);
    setPage(1);
    setSelectedIds([]);
    if (!isAllCampaignsSource) setSearchParams({});
  };

  const toggleSelected = (prospectId) => {
    setSelectedIds((prev) =>
      prev.includes(prospectId) ? prev.filter((id) => id !== prospectId) : [...prev, prospectId]
    );
  };

  const toggleSelectAll = () => {
    const rowIds = currentRows.map((row) => row._id);
    const allSelected = rowIds.length > 0 && rowIds.every((id) => selectedIds.includes(id));
    setSelectedIds(allSelected ? [] : rowIds);
  };

  const openCreateCampaign = () => {
    setListModal({ open: true, mode: 'create', defaultType: 'manual', initialValues: null });
  };

  const openSaveDynamicCampaign = () => {
    setListModal({
      open: true,
      mode: 'create',
      defaultType: 'dynamic',
      initialValues: {
        type: 'dynamic',
        filters: { search, status: statusFilter, priority: priorityFilter },
      },
    });
  };

  const openEditCampaign = () => {
    if (!activeList) return;
    setListModal({
      open: true,
      mode: 'edit',
      defaultType: activeList.type,
      initialValues: {
        name: activeList.name,
        type: activeList.type,
        filters: activeList.filters || { search: '', status: '', priority: '' },
      },
    });
  };

  const handleListModalSubmit = ({ name, type, filters }) => {
    if (listModal.mode === 'edit' && activeView.kind === 'list') {
      const payload = { name };
      if (activeList?.type === 'dynamic') payload.filters = filters;
      updateListMutation.mutate({ id: activeView.id, payload });
      return;
    }

    const payload = { name, type };
    if (type === 'dynamic') payload.filters = filters;
    else payload.prospectIds = selectedIds;
    createListMutation.mutate(payload);
  };

  const handleDeleteCampaign = () => {
    if (!activeList) return;
    if (!window.confirm(`Delete campaign "${activeList.name}"?`)) return;
    deleteListMutation.mutate(activeView.id);
  };

  const handleAddSelectedToCampaign = () => {
    if (!targetListId || selectedIds.length === 0) return;
    addToListMutation.mutate({ listId: targetListId, prospectIds: selectedIds });
  };

  const handleRemoveSelectedFromCampaign = () => {
    if (activeView.kind !== 'list' || activeList?.type !== 'manual' || selectedIds.length === 0) return;
    removeFromListMutation.mutate({ listId: activeView.id, prospectIds: selectedIds });
  };

  const handleManualProspectCreated = (prospect) => {
    if (!activeList?._id || activeList.type !== 'manual') return;
    addToListMutation.mutate({ listId: activeList._id, prospectIds: [prospect._id] });
  };

  const refreshCampaignData = () => {
    queryClient.invalidateQueries({ queryKey: ['prospect-lists'] });
    queryClient.invalidateQueries({ queryKey: ['prospect-list'] });
    queryClient.invalidateQueries({ queryKey: ['prospects'] });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="space-y-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-white font-semibold">Campaigns</p>
              <p className="text-slate-500 text-xs mt-1">Different prospect lists for outreach plays</p>
            </div>
            <Megaphone size={16} className="text-slate-500" />
          </div>

          <button
            onClick={() => {
              setSearchParams({});
              setPage(1);
              setSelectedIds([]);
            }}
            className={`w-full text-left rounded-xl px-3 py-3 transition ${
              isAllCampaignsSource ? 'bg-indigo-600/20 border border-indigo-500/30' : 'bg-slate-950/70 hover:bg-slate-800/70 border border-slate-800'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-white text-sm font-medium">Prospect Source</p>
                <p className="text-slate-500 text-xs mt-1">Browse prospects and assign them to campaigns</p>
              </div>
              <span className="text-xs text-slate-400">{prospectsQuery.data?.pagination?.total ?? '...'}</span>
            </div>
          </button>

          <div className="mt-3 space-y-2 max-h-[26rem] overflow-y-auto pr-1">
            {listsQuery.isLoading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-16 rounded-xl bg-slate-800/70 animate-pulse" />
              ))
            ) : lists.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-center">
                <p className="text-slate-400 text-sm">No campaigns yet.</p>
                <p className="text-slate-600 text-xs mt-1">Create one and start grouping prospects.</p>
              </div>
            ) : (
              lists.map((list) => {
                const isActive = activeView.kind === 'list' && activeView.id === list._id;
                return (
                  <button
                    key={list._id}
                    onClick={() => {
                      setSearchParams({ list: list._id });
                      setPage(1);
                      setSelectedIds([]);
                    }}
                    className={`w-full text-left rounded-xl px-3 py-3 transition border ${
                      isActive
                        ? 'bg-indigo-600/20 border-indigo-500/30'
                        : 'bg-slate-950/70 hover:bg-slate-800/70 border-slate-800'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium truncate">{list.name}</p>
                        <p className="text-slate-500 text-xs mt-1">
                          {list.type === 'dynamic' ? 'Dynamic campaign' : 'Manual campaign'}
                        </p>
                      </div>
                      <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
                        {list.prospectCount}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-2">
          <button
            onClick={openCreateCampaign}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-sm transition"
          >
            <FolderPlus size={15} /> New campaign
          </button>
          <button
            onClick={openSaveDynamicCampaign}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-medium transition"
          >
            <Save size={15} /> Save filtered campaign
          </button>
        </div>
      </aside>

      <div className="space-y-6 min-w-0">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h1 className="text-white text-2xl font-bold">{viewTitle}</h1>
            <p className="text-slate-400 mt-1">{viewSubtitle}</p>
            {!isAllCampaignsSource && activeList?.type === 'dynamic' && (
              <div className="flex flex-wrap gap-2 mt-3">
                <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300">
                  Search: {currentListFilters.search || 'Any'}
                </span>
                <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300">
                  Status: {currentListFilters.status || 'Any'}
                </span>
                <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300">
                  Priority: {currentListFilters.priority || 'Any'}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activeView.kind === 'list' && activeList?.type === 'manual' && (
              <>
                <button
                  onClick={() => setShowAddProspect(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition"
                >
                  <Plus size={15} /> Manual add
                </button>
                <button
                  onClick={() => setShowImportModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm transition"
                >
                  <LinkIcon size={15} /> Import from URL
                </button>
              </>
            )}
            {activeView.kind === 'list' && (
              <>
                <button
                  onClick={openEditCampaign}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm transition"
                >
                  <Pencil size={15} /> Edit campaign
                </button>
                <button
                  onClick={handleDeleteCampaign}
                  disabled={deleteListMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-red-950/60 hover:bg-red-900/60 text-red-300 rounded-lg text-sm transition disabled:opacity-60"
                >
                  <Trash2 size={15} /> Delete campaign
                </button>
              </>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1 sm:w-80">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search name or company…"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-60"
                  value={search}
                  onChange={(e) => handleSearch(e.target.value)}
                  disabled={!isAllCampaignsSource}
                />
              </div>
              <select
                className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-300 text-sm focus:outline-none disabled:opacity-60"
                value={statusFilter}
                onChange={(e) => handleStatus(e.target.value)}
                disabled={!isAllCampaignsSource}
              >
                <option value="">All statuses</option>
                {Object.keys(STATUS_COLOR).map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
              <select
                className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-300 text-sm focus:outline-none disabled:opacity-60"
                value={priorityFilter}
                onChange={(e) => handlePriority(e.target.value)}
                disabled={!isAllCampaignsSource}
              >
                <option value="">All priorities</option>
                {PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority} value={priority}>{priority}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {selectedCount > 0 && (
                <span className="inline-flex items-center gap-2 rounded-full bg-indigo-600/15 px-3 py-1 text-xs text-indigo-300">
                  <CheckSquare size={13} /> {selectedCount} selected
                </span>
              )}

              {manualLists.length > 0 && (
                <>
                  <select
                    value={targetListId}
                    onChange={(e) => setTargetListId(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-300 text-sm focus:outline-none"
                  >
                    <option value="">Choose campaign</option>
                    {manualLists.map((list) => (
                      <option key={list._id} value={list._id}>{list.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleAddSelectedToCampaign}
                    disabled={!targetListId || selectedCount === 0 || addToListMutation.isPending}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded-lg text-sm transition"
                  >
                    Add selected
                  </button>
                </>
              )}

              {activeView.kind === 'list' && activeList?.type === 'manual' && (
                <button
                  onClick={handleRemoveSelectedFromCampaign}
                  disabled={selectedCount === 0 || removeFromListMutation.isPending}
                  className="px-4 py-2 bg-red-950/60 hover:bg-red-900/60 disabled:opacity-50 text-red-300 rounded-lg text-sm transition"
                >
                  Remove selected
                </button>
              )}
            </div>
          </div>

          {!isAllCampaignsSource && (
            <p className="text-slate-500 text-xs">
              {activeList?.type === 'dynamic'
                ? 'This campaign auto-updates from its saved filters.'
                : 'This campaign stores prospect references only. You can manually add prospects or import them from a public page URL.'}
            </p>
          )}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="px-4 py-3 w-12">
                  <input
                    type="checkbox"
                    className="rounded border-slate-700 bg-slate-950 text-indigo-500 focus:ring-indigo-500"
                    checked={currentRows.length > 0 && currentRows.every((row) => selectedIds.includes(row._id))}
                    onChange={toggleSelectAll}
                  />
                </th>
                {['Name', 'Company', 'Role', 'Score', 'Priority', 'Status', ''].map((heading) => (
                  <th key={heading} className="text-left text-slate-500 font-medium px-4 py-3 text-xs uppercase tracking-wide">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-slate-800 rounded animate-pulse" style={{ width: j === 0 || j === 7 ? 24 : '80%' }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : currentRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center text-slate-500 py-12">
                    {isAllCampaignsSource
                      ? search || statusFilter || priorityFilter
                        ? 'No prospects match your filters.'
                        : 'No prospects available yet.'
                      : 'This campaign does not contain any prospects yet.'}
                  </td>
                </tr>
              ) : (
                currentRows.map((prospect) => (
                  <tr
                    key={prospect._id}
                    className="hover:bg-slate-800/50 cursor-pointer transition"
                    onClick={() => navigate(`/prospects/${prospect._id}`)}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="rounded border-slate-700 bg-slate-950 text-indigo-500 focus:ring-indigo-500"
                        checked={selectedIds.includes(prospect._id)}
                        onChange={() => toggleSelected(prospect._id)}
                      />
                    </td>
                    <td className="px-4 py-3 text-white font-medium">{prospect.firstName} {prospect.lastName}</td>
                    <td className="px-4 py-3 text-slate-400">{prospect.company || '—'}</td>
                    <td className="px-4 py-3 text-slate-400 capitalize">{prospect.primaryAngle || prospect.typeHint || '—'}</td>
                    <td className="px-4 py-3">
                      {prospect.compatibilityScore != null ? <span className="text-indigo-400 font-bold">{prospect.compatibilityScore}</span> : '—'}
                    </td>
                    <td className={`px-4 py-3 font-medium capitalize ${PRIORITY_COLOR[prospect.outreachPriority] || 'text-slate-500'}`}>
                      {prospect.outreachPriority || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[prospect.pipelineStatus] || ''}`}>
                        {prospect.pipelineStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {ACTIVE_PIPELINE_STATUSES.includes(prospect.pipelineStatus) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              pauseMutation.mutate(prospect._id);
                            }}
                            className="text-slate-500 hover:text-amber-300 transition"
                            title="Pause pipeline"
                          >
                            <Pause size={14} />
                          </button>
                        )}
                        {prospect.pipelineStatus === 'paused' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              resumeMutation.mutate(prospect._id);
                            }}
                            className="text-slate-500 hover:text-green-400 transition"
                            title="Resume pipeline"
                          >
                            <Play size={14} />
                          </button>
                        )}
                        {prospect.pipelineStatus === 'failed' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              retryMutation.mutate(prospect._id);
                            }}
                            className="text-slate-500 hover:text-yellow-400 transition"
                            title="Retry pipeline"
                          >
                            <RefreshCw size={14} />
                          </button>
                        )}
                        <ChevronRight size={14} className="text-slate-600" />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="px-4 py-3 border-t border-slate-800 flex items-center justify-between">
              <span className="text-slate-500 text-xs">
                Page {page} of {totalPages} · {total} prospects
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setPage((current) => Math.max(1, current - 1));
                    setSelectedIds([]);
                  }}
                  disabled={page === 1}
                  className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 rounded-lg text-xs transition"
                >
                  <ChevronLeft size={13} /> Prev
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((n) => n === 1 || n === totalPages || Math.abs(n - page) <= 1)
                  .reduce((acc, n, i, arr) => {
                    if (i > 0 && arr[i - 1] !== n - 1) acc.push('…');
                    acc.push(n);
                    return acc;
                  }, [])
                  .map((item, i) =>
                    item === '…' ? (
                      <span key={`ellipsis-${i}`} className="text-slate-600 text-xs px-1">…</span>
                    ) : (
                      <button
                        key={item}
                        onClick={() => {
                          setPage(item);
                          setSelectedIds([]);
                        }}
                        className={`w-7 h-7 rounded-lg text-xs font-medium transition ${
                          item === page ? 'bg-indigo-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                        }`}
                      >
                        {item}
                      </button>
                    )
                  )}
                <button
                  onClick={() => {
                    setPage((current) => Math.min(totalPages, current + 1));
                    setSelectedIds([]);
                  }}
                  disabled={page === totalPages}
                  className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 rounded-lg text-xs transition"
                >
                  Next <ChevronRight size={13} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {listModal.open && (
        <ProspectListModal
          key={`${listModal.mode}-${listModal.defaultType}-${activeView.id || 'new'}`}
          mode={listModal.mode}
          defaultType={listModal.defaultType}
          initialValues={listModal.initialValues}
          initialFilters={{ search, status: statusFilter, priority: priorityFilter }}
          selectedCount={selectedCount}
          entityLabel="campaign"
          isSubmitting={createListMutation.isPending || updateListMutation.isPending}
          onClose={() => setListModal(EMPTY_MODAL)}
          onSubmit={handleListModalSubmit}
        />
      )}
      {showAddProspect && activeList?.type === 'manual' && (
        <AddProspectModal
          onClose={() => setShowAddProspect(false)}
          onCreated={handleManualProspectCreated}
        />
      )}
      {showImportModal && activeList?.type === 'manual' && (
        <CampaignImportModal
          campaign={activeList}
          onClose={() => setShowImportModal(false)}
          onImported={refreshCampaignData}
        />
      )}
    </div>
  );
}
