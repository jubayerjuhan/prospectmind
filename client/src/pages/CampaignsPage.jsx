import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import toast from 'react-hot-toast';
import {
  Search, ArrowLeft, Megaphone, Plus, Link as LinkIcon, Pause, Play, Pencil, Trash2,
  Users, Target, Send, Filter, Database, Save, AlertTriangle, Sparkles, FolderPlus,
} from 'lucide-react';
import AddProspectModal from '../components/prospects/AddProspectModal';
import CampaignImportModal from '../components/prospects/CampaignImportModal';
import ProspectListModal from '../components/prospects/ProspectListModal';
import CampaignCard from '../components/campaigns/CampaignCard';
import CampaignStrategyTab from '../components/campaigns/CampaignStrategyTab';
import CampaignOutreachTab from '../components/campaigns/CampaignOutreachTab';
import ProspectTable from '../components/campaigns/ProspectTable';
import { STATUS_COLOR } from '../components/campaigns/prospectStatus';

const PAGE_SIZE = 20;
const PRIORITY_OPTIONS = ['high', 'medium', 'low'];
const EMPTY_MODAL = { open: false, mode: 'create', defaultType: 'manual', initialValues: null };

const TABS = [
  { id: 'prospects', label: 'Prospects', icon: Users },
  { id: 'strategy', label: 'Strategy', icon: Target },
  { id: 'outreach', label: 'Outreach', icon: Send },
];

/** Fire-and-forget POST on a prospect or campaign, then refresh the views. */
const usePostAction = (buildPath, fallbackMessage, onDone) =>
  useMutation({
    mutationFn: (id) => api.post(buildPath(id)),
    onSuccess: (res) => {
      toast.success(res.data?.message || fallbackMessage);
      onDone();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Action failed'),
  });

/**
 * Campaigns — the single home for a campaign's audience, its strategy
 * (goal + Personas/Playbooks/Signals from Settings) and its outreach.
 * Outreach used to be a separate top-level page; it is the third tab now.
 */
export default function CampaignsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const activeListId = searchParams.get('list');
  const view = searchParams.get('view'); // 'pool' → browse every prospect
  const tab = searchParams.get('tab') || 'prospects';
  const isPool = !activeListId && view === 'pool';
  const isGallery = !activeListId && !isPool;

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState([]);
  const [targetListId, setTargetListId] = useState('');
  const [listModal, setListModal] = useState(EMPTY_MODAL);
  const [showAddProspect, setShowAddProspect] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  const goTo = (params) => {
    setSearchParams(params);
    setPage(1);
    setSelectedIds([]);
  };

  const listsQuery = useQuery({
    queryKey: ['prospect-lists'],
    queryFn: () => api.get('/prospect-lists', { params: { limit: 100 } }).then((r) => r.data),
    staleTime: 30_000,
  });

  const poolQuery = useQuery({
    queryKey: ['prospects', 'pool', search, statusFilter, priorityFilter, page],
    queryFn: () =>
      api
        .get('/prospects', { params: { search, status: statusFilter, priority: priorityFilter, limit: PAGE_SIZE, page } })
        .then((r) => r.data),
    refetchInterval: isPool ? 8000 : false,
    keepPreviousData: true,
    enabled: isPool,
  });

  const activeListQuery = useQuery({
    queryKey: ['prospect-list', activeListId, page],
    queryFn: () => api.get(`/prospect-lists/${activeListId}`, { params: { page, limit: PAGE_SIZE } }).then((r) => r.data),
    enabled: Boolean(activeListId),
    refetchInterval: activeListId ? 8000 : false,
    keepPreviousData: true,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['prospect-lists'] });
    queryClient.invalidateQueries({ queryKey: ['prospect-list'] });
    queryClient.invalidateQueries({ queryKey: ['prospects'] });
  };

  const retryMutation = usePostAction((id) => `/prospects/${id}/retry`, 'Pipeline restarted', invalidateAll);
  const pauseMutation = usePostAction((id) => `/prospects/${id}/pause`, 'Pause requested', invalidateAll);
  const resumeMutation = usePostAction((id) => `/prospects/${id}/resume`, 'Pipeline resumed', invalidateAll);
  const pauseCampaignMutation = usePostAction((id) => `/prospect-lists/${id}/pause`, 'Campaign paused', invalidateAll);
  const resumeCampaignMutation = usePostAction((id) => `/prospect-lists/${id}/resume`, 'Campaign resumed', invalidateAll);

  const createListMutation = useMutation({
    mutationFn: (payload) => api.post('/prospect-lists', payload).then((r) => r.data.data),
    onSuccess: (list) => {
      toast.success('Campaign created');
      queryClient.invalidateQueries({ queryKey: ['prospect-lists'] });
      setListModal(EMPTY_MODAL);
      goTo({ list: list._id, tab: 'strategy' });
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
      goTo({});
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to delete campaign'),
  });

  const addToListMutation = useMutation({
    mutationFn: ({ listId, prospectIds }) => api.post(`/prospect-lists/${listId}/prospects`, { prospectIds }),
    onSuccess: () => {
      toast.success('Prospects added to campaign');
      invalidateAll();
      setSelectedIds([]);
      setTargetListId('');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to add prospects'),
  });

  const removeFromListMutation = useMutation({
    mutationFn: ({ listId, prospectIds }) => api.delete(`/prospect-lists/${listId}/prospects`, { data: { prospectIds } }),
    onSuccess: () => {
      toast.success('Prospects removed from campaign');
      invalidateAll();
      setSelectedIds([]);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to remove prospects'),
  });

  const lists = listsQuery.data?.data || [];
  const manualLists = lists.filter((list) => list.type === 'manual');
  const activeListData = activeListQuery.data?.data;
  const activeList = activeListData || lists.find((list) => list._id === activeListId);

  const rows = isPool ? poolQuery.data?.data || [] : activeListData?.prospects || [];
  const pagination = isPool ? poolQuery.data?.pagination : activeListQuery.data?.pagination;
  const total = pagination?.total ?? activeList?.prospectCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isLoadingRows = isPool ? poolQuery.isLoading : activeListQuery.isLoading;

  const toggleSelected = (id) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  const toggleSelectAll = () => {
    const ids = rows.map((row) => row._id);
    setSelectedIds(ids.length > 0 && ids.every((id) => selectedIds.includes(id)) ? [] : ids);
  };

  const handleListModalSubmit = ({ name, type, filters }) => {
    if (listModal.mode === 'edit' && activeListId) {
      const payload = { name };
      if (activeList?.type === 'dynamic') payload.filters = filters;
      updateListMutation.mutate({ id: activeListId, payload });
      return;
    }
    const payload = { name, type };
    if (type === 'dynamic') payload.filters = filters;
    else payload.prospectIds = selectedIds;
    createListMutation.mutate(payload);
  };

  // ── Gallery ───────────────────────────────────────────────────────────────
  if (isGallery) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2.5 text-2xl font-bold text-white">
              <Megaphone className="text-indigo-400" size={24} /> Campaigns
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm text-slate-400">
              A campaign holds its audience, its goal, the personas, playbooks and signals it runs on, and the
              outreach it produces — all in one place.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => goTo({ view: 'pool' })}
              className="flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-300 transition hover:border-indigo-500/50 hover:text-indigo-300"
            >
              <Database size={15} /> Prospect pool
            </button>
            <button
              onClick={() => setListModal({ open: true, mode: 'create', defaultType: 'manual', initialValues: null })}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-indigo-950/50 transition hover:bg-indigo-500"
            >
              <Plus size={15} /> New campaign
            </button>
          </div>
        </div>

        {listsQuery.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-52 animate-pulse rounded-2xl bg-slate-900" />
            ))}
          </div>
        ) : lists.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/50 py-20 text-center">
            <Sparkles size={32} className="mx-auto mb-4 text-slate-700" />
            <p className="font-medium text-white">No campaigns yet</p>
            <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-slate-500">
              Create one, describe your goal, pick the personas and playbook it should run on, then add prospects and
              generate outreach.
            </p>
            <button
              onClick={() => setListModal({ open: true, mode: 'create', defaultType: 'manual', initialValues: null })}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-500"
            >
              <Plus size={15} /> Create your first campaign
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {lists.map((campaign) => (
              <CampaignCard
                key={campaign._id}
                campaign={campaign}
                onOpen={() => goTo({ list: campaign._id })}
              />
            ))}
          </div>
        )}

        {listModal.open && (
          <ProspectListModal
            mode={listModal.mode}
            defaultType={listModal.defaultType}
            initialValues={listModal.initialValues}
            initialFilters={{ search, status: statusFilter, priority: priorityFilter }}
            selectedCount={selectedIds.length}
            entityLabel="campaign"
            isSubmitting={createListMutation.isPending}
            onClose={() => setListModal(EMPTY_MODAL)}
            onSubmit={handleListModalSubmit}
          />
        )}
      </div>
    );
  }

  // ── Prospect pool ─────────────────────────────────────────────────────────
  if (isPool) {
    return (
      <div className="space-y-5">
        <button
          onClick={() => goTo({})}
          className="flex items-center gap-1.5 text-sm text-slate-400 transition hover:text-slate-200"
        >
          <ArrowLeft size={15} /> Campaigns
        </button>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2.5 text-2xl font-bold text-white">
              <Database className="text-indigo-400" size={22} /> Prospect pool
            </h1>
            <p className="mt-1.5 text-sm text-slate-400">
              Every prospect in your organization. Select some and assign them to a campaign.
            </p>
          </div>
          <button
            onClick={() =>
              setListModal({
                open: true,
                mode: 'create',
                defaultType: 'dynamic',
                initialValues: { type: 'dynamic', filters: { search, status: statusFilter, priority: priorityFilter } },
              })
            }
            className="flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-300 transition hover:border-indigo-500/50 hover:text-indigo-300"
          >
            <Save size={15} /> Save filters as campaign
          </button>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative sm:w-72">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search name or company…"
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 py-2 pl-9 pr-4 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); setSelectedIds([]); }}
                />
              </div>
              <select
                className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300 focus:outline-none"
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setPage(1); setSelectedIds([]); }}
              >
                <option value="">All statuses</option>
                {Object.keys(STATUS_COLOR).map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
              <select
                className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300 focus:outline-none"
                value={priorityFilter}
                onChange={(e) => { setPriorityFilter(e.target.value); setPage(1); setSelectedIds([]); }}
              >
                <option value="">All priorities</option>
                {PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority} value={priority}>{priority}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {selectedIds.length > 0 && (
                <span className="rounded-full bg-indigo-500/15 px-3 py-1 text-xs text-indigo-300">
                  {selectedIds.length} selected
                </span>
              )}
              {manualLists.length > 0 && (
                <>
                  <select
                    value={targetListId}
                    onChange={(e) => setTargetListId(e.target.value)}
                    className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300 focus:outline-none"
                  >
                    <option value="">Choose campaign</option>
                    {manualLists.map((list) => (
                      <option key={list._id} value={list._id}>{list.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => addToListMutation.mutate({ listId: targetListId, prospectIds: selectedIds })}
                    disabled={!targetListId || selectedIds.length === 0 || addToListMutation.isPending}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white transition hover:bg-indigo-500 disabled:opacity-40"
                  >
                    Add to campaign
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        <ProspectTable
          rows={rows}
          isLoading={isLoadingRows}
          emptyMessage={
            search || statusFilter || priorityFilter ? 'No prospects match your filters.' : 'No prospects yet.'
          }
          selectedIds={selectedIds}
          onToggle={toggleSelected}
          onToggleAll={toggleSelectAll}
          onRetry={(id) => retryMutation.mutate(id)}
          onPause={(id) => pauseMutation.mutate(id)}
          onResume={(id) => resumeMutation.mutate(id)}
          page={page}
          totalPages={totalPages}
          total={total}
          onPageChange={(next) => { setPage(next); setSelectedIds([]); }}
        />

        {listModal.open && (
          <ProspectListModal
            mode={listModal.mode}
            defaultType={listModal.defaultType}
            initialValues={listModal.initialValues}
            initialFilters={{ search, status: statusFilter, priority: priorityFilter }}
            selectedCount={selectedIds.length}
            entityLabel="campaign"
            isSubmitting={createListMutation.isPending}
            onClose={() => setListModal(EMPTY_MODAL)}
            onSubmit={handleListModalSubmit}
          />
        )}
      </div>
    );
  }

  // ── Campaign workspace ────────────────────────────────────────────────────
  const isManual = activeList?.type === 'manual';
  const needsGoal = !activeList?.campaignDescription?.trim();
  const outreachSummary = activeList?.outreach || {};

  return (
    <div className="space-y-5">
      <button
        onClick={() => goTo({})}
        className="flex items-center gap-1.5 text-sm text-slate-400 transition hover:text-slate-200"
      >
        <ArrowLeft size={15} /> All campaigns
      </button>

      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full bg-indigo-500/5 blur-3xl" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2.5 text-2xl font-bold text-white">
              <span className="truncate">{activeList?.name || 'Campaign'}</span>
              <span className="shrink-0 rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-medium capitalize text-slate-400">
                {activeList?.type === 'dynamic' ? (
                  <span className="flex items-center gap-1"><Filter size={10} /> auto</span>
                ) : (
                  'manual'
                )}
              </span>
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <Users size={13} className="text-indigo-400" /> {total} prospect{total === 1 ? '' : 's'}
              </span>
              <span className="flex items-center gap-1.5">
                <Target size={13} className="text-indigo-400" />
                {(activeList?.personas?.length || 0)} persona{activeList?.personas?.length === 1 ? '' : 's'} ·{' '}
                {(activeList?.playbooks?.length || 0)} playbook{activeList?.playbooks?.length === 1 ? '' : 's'} ·{' '}
                {(activeList?.signals?.length || 0)} signal{activeList?.signals?.length === 1 ? '' : 's'}
              </span>
              <span className="flex items-center gap-1.5">
                <Send size={13} className="text-indigo-400" />
                {outreachSummary.generatedCount || 0} sequence{outreachSummary.generatedCount === 1 ? '' : 's'}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isManual && (
              <>
                <button
                  onClick={() => setShowAddProspect(true)}
                  className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
                >
                  <Plus size={15} /> Add prospect
                </button>
                <button
                  onClick={() => setShowImportModal(true)}
                  className="flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-700"
                >
                  <LinkIcon size={15} /> Import from URL
                </button>
                <button
                  onClick={() => pauseCampaignMutation.mutate(activeList._id)}
                  className="rounded-lg bg-slate-800 p-2 text-slate-400 transition hover:text-amber-300"
                  title="Pause pipeline for this campaign"
                >
                  <Pause size={15} />
                </button>
                <button
                  onClick={() => resumeCampaignMutation.mutate(activeList._id)}
                  className="rounded-lg bg-slate-800 p-2 text-slate-400 transition hover:text-emerald-300"
                  title="Resume pipeline for this campaign"
                >
                  <Play size={15} />
                </button>
              </>
            )}
            <button
              onClick={() =>
                setListModal({
                  open: true,
                  mode: 'edit',
                  defaultType: activeList.type,
                  initialValues: {
                    name: activeList.name,
                    type: activeList.type,
                    filters: activeList.filters || { search: '', status: '', priority: '' },
                  },
                })
              }
              className="rounded-lg bg-slate-800 p-2 text-slate-400 transition hover:text-white"
              title="Rename campaign"
            >
              <Pencil size={15} />
            </button>
            <button
              onClick={() => {
                if (window.confirm(`Delete campaign "${activeList.name}"?`)) deleteListMutation.mutate(activeListId);
              }}
              className="rounded-lg bg-slate-800 p-2 text-slate-400 transition hover:text-red-400"
              title="Delete campaign"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>

        {needsGoal && (
          <button
            onClick={() => setSearchParams({ list: activeListId, tab: 'strategy' })}
            className="mt-4 flex w-full items-start gap-3 rounded-xl border border-amber-800/50 bg-amber-950/20 px-4 py-3 text-left transition hover:bg-amber-950/30"
          >
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-400" />
            <span>
              <span className="block text-xs font-semibold text-amber-300">This campaign has no goal yet</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-amber-400/80">
                The AI pipeline won't discover or enrich prospects until you describe what this campaign is for.
                Open the Strategy tab to set it.
              </span>
            </span>
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-800">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setSearchParams({ list: activeListId, tab: id })}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === id
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'prospects' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              {activeList?.type === 'dynamic'
                ? 'This campaign auto-updates from its saved filters.'
                : 'Add prospects manually or import them from a public page URL.'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {selectedIds.length > 0 && (
                <span className="rounded-full bg-indigo-500/15 px-3 py-1 text-xs text-indigo-300">
                  {selectedIds.length} selected
                </span>
              )}
              {isManual && (
                <button
                  onClick={() => removeFromListMutation.mutate({ listId: activeListId, prospectIds: selectedIds })}
                  disabled={selectedIds.length === 0 || removeFromListMutation.isPending}
                  className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300 transition hover:bg-red-950/60 hover:text-red-300 disabled:opacity-40"
                >
                  Remove selected
                </button>
              )}
              <button
                onClick={() => goTo({ view: 'pool' })}
                className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-indigo-500/50 hover:text-indigo-300"
              >
                <FolderPlus size={14} /> From prospect pool
              </button>
            </div>
          </div>

          <ProspectTable
            rows={rows}
            isLoading={isLoadingRows}
            emptyMessage="No prospects in this campaign yet."
            selectedIds={selectedIds}
            onToggle={toggleSelected}
            onToggleAll={toggleSelectAll}
            onRetry={(id) => retryMutation.mutate(id)}
            onPause={(id) => pauseMutation.mutate(id)}
            onResume={(id) => resumeMutation.mutate(id)}
            page={page}
            totalPages={totalPages}
            total={total}
            onPageChange={(next) => { setPage(next); setSelectedIds([]); }}
          />
        </div>
      )}

      {/* Keyed by campaign id so switching campaigns remounts with fresh drafts. */}
      {tab === 'strategy' && activeListData && (
        <CampaignStrategyTab key={activeListData._id} campaign={activeListData} />
      )}
      {tab === 'outreach' && activeListData && (
        <CampaignOutreachTab key={activeListData._id} campaign={activeListData} />
      )}

      {listModal.open && (
        <ProspectListModal
          key={`${listModal.mode}-${activeListId}`}
          mode={listModal.mode}
          defaultType={listModal.defaultType}
          initialValues={listModal.initialValues}
          initialFilters={{ search, status: statusFilter, priority: priorityFilter }}
          selectedCount={selectedIds.length}
          entityLabel="campaign"
          isSubmitting={updateListMutation.isPending || createListMutation.isPending}
          onClose={() => setListModal(EMPTY_MODAL)}
          onSubmit={handleListModalSubmit}
        />
      )}
      {showAddProspect && isManual && (
        <AddProspectModal
          onClose={() => setShowAddProspect(false)}
          onCreated={invalidateAll}
          campaignContext={{
            campaignId: activeList._id,
            hasCampaignSettings: Boolean(activeList.campaignDescription?.trim()),
          }}
        />
      )}
      {showImportModal && isManual && (
        <CampaignImportModal
          campaign={activeList}
          onClose={() => setShowImportModal(false)}
          onImported={invalidateAll}
        />
      )}
    </div>
  );
}
