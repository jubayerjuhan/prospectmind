import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import toast from 'react-hot-toast';
import { X, Zap, ArrowRight, AlertTriangle } from 'lucide-react';

/* ── Upgrade wall shown when the plan limit is hit ──────────────────── */
function UpgradePrompt({ onClose }) {
  const navigate = useNavigate();
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md text-center p-8">
        <div className="w-14 h-14 rounded-2xl bg-indigo-900/50 border border-indigo-800 flex items-center justify-center mx-auto mb-5">
          <Zap size={24} className="text-indigo-400" />
        </div>
        <h2 className="text-white text-xl font-bold mb-2">You've hit your plan limit</h2>
        <p className="text-slate-400 text-sm leading-relaxed mb-6">
          You've used all prospect slots on your current plan. Upgrade to add more prospects and unlock unlimited AI enrichment.
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => { onClose(); navigate('/billing'); }}
            className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium transition"
          >
            View upgrade options <ArrowRight size={15} />
          </button>
          <button
            onClick={onClose}
            className="w-full py-2.5 text-slate-500 hover:text-slate-300 text-sm transition"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main modal ────────────────────────────────────────────────────── */
/**
 * @param {{ onClose: Function, onCreated?: Function, campaignContext?: { campaignId: string, hasCampaignSettings: boolean } | null }} props
 *
 * When campaignContext is provided, uses the atomic POST /prospect-lists/:id/add-and-create
 * endpoint so the prospect is created and added to the campaign in one shot.
 * The pipeline is only queued if the campaign has settings configured.
 */
export default function AddProspectModal({ onClose, onCreated, campaignContext = null }) {
  const queryClient = useQueryClient();
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [form, setForm] = useState({
    firstName: '', lastName: '', company: '', typeHint: 'unknown',
    rawEmail: '', rawLinkedin: '', rawX: '', rawTelegram: '', rawGithub: '',
    description: '',
  });

  const isInCampaign = Boolean(campaignContext?.campaignId);
  const campaignSettingsMissing = isInCampaign && !campaignContext?.hasCampaignSettings;

  const mutation = useMutation({
    mutationFn: (data) => {
      if (isInCampaign) {
        // Atomic endpoint: creates prospect + adds to campaign in one DB operation
        return api.post(`/prospect-lists/${campaignContext.campaignId}/add-and-create`, data);
      }
      return api.post('/prospects', data);
    },
    onSuccess: (response) => {
      const settingsMissing = response.data.campaignSettingsMissing;
      if (settingsMissing) {
        toast.success('Prospect added — configure Campaign Settings to start the AI pipeline.');
      } else {
        toast.success('Prospect added — pipeline starting…');
      }
      queryClient.invalidateQueries({ queryKey: ['prospects'] });
      queryClient.invalidateQueries({ queryKey: ['prospect-lists'] });
      queryClient.invalidateQueries({ queryKey: ['prospect-list'] });
      onCreated?.(response.data.data);
      onClose();
    },
    onError: (err) => {
      const status = err.response?.status;
      const message = err.response?.data?.message || '';
      if (status === 403 && (message.toLowerCase().includes('limit') || message.toLowerCase().includes('plan'))) {
        setShowUpgrade(true);
      } else {
        toast.error(message || 'Failed to add prospect');
      }
    },
  });

  if (showUpgrade) return <UpgradePrompt onClose={onClose} />;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 flex-shrink-0">
          <h2 className="text-white font-semibold">Add prospect</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18} /></button>
        </div>

        {/* Campaign settings warning banner */}
        {campaignSettingsMissing && (
          <div className="mx-6 mt-4 flex items-start gap-3 rounded-xl border border-amber-800/60 bg-amber-950/30 px-4 py-3 flex-shrink-0">
            <AlertTriangle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-amber-300 text-xs font-semibold">Campaign settings not configured</p>
              <p className="text-amber-400/80 text-xs mt-0.5 leading-relaxed">
                The AI pipeline won't start until you fill in <strong>Campaign Description</strong> and{' '}
                <strong>Target Ecosystem</strong> in Campaign Settings. The prospect will be added but stay in{' '}
                <em>pending</em> status.
              </p>
            </div>
          </div>
        )}

        <form
          onSubmit={(e) => { e.preventDefault(); mutation.mutate(form); }}
          className="px-6 py-5 space-y-4 overflow-y-auto"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-slate-400 text-xs block mb-1">First name *</label>
              <input required className="input-field" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
            </div>
            <div>
              <label className="text-slate-400 text-xs block mb-1">Last name</label>
              <input className="input-field" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-slate-400 text-xs block mb-1">Company</label>
              <input className="input-field" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
            </div>
            <div>
              <label className="text-slate-400 text-xs block mb-1">Type hint</label>
              <select className="input-field" value={form.typeHint} onChange={(e) => setForm({ ...form, typeHint: e.target.value })}>
                <option value="unknown">Unknown</option>
                <option value="talent">Talent</option>
                <option value="client">Client</option>
              </select>
            </div>
          </div>

          {/* Description — the key new field */}
          <div>
            <label className="text-slate-400 text-xs block mb-1">
              Additional Context <span className="text-slate-600">(optional)</span>
            </label>
            <textarea
              className="input-field resize-none"
              rows={3}
              placeholder="Describe what you know about this person — their role, background, where you met them, etc. The AI uses this to better verify identity and enrich their profile."
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <div className="border-t border-slate-800 pt-3">
            <p className="text-slate-500 text-xs mb-3">Optional hints (any you have)</p>
            {[
              ['Email', 'rawEmail', 'email'],
              ['LinkedIn URL', 'rawLinkedin', 'text'],
              ['X/Twitter URL', 'rawX', 'text'],
              ['Telegram handle', 'rawTelegram', 'text'],
              ['GitHub URL', 'rawGithub', 'text'],
            ].map(([label, key, type]) => (
              <div key={key} className="mb-2">
                <label className="text-slate-400 text-xs block mb-1">{label}</label>
                <input type={type} className="input-field" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm transition">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition">
              {mutation.isPending ? 'Adding…' : 'Add & enrich'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
