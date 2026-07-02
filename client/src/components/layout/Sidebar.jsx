import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LayoutDashboard, Users, CreditCard, Settings, LogOut, Zap, Megaphone } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import api from '../../lib/api';

const nav = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/prospects', icon: Users, label: 'Prospects' },
  { to: '/campaigns', icon: Megaphone, label: 'Campaigns' },
  { to: '/billing', icon: CreditCard, label: 'Billing' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

const PLAN_STYLES = {
  free:       { badge: 'bg-slate-800 text-slate-400', bar: 'bg-slate-500' },
  pro:        { badge: 'bg-indigo-900/60 text-indigo-300', bar: 'bg-indigo-500' },
  enterprise: { badge: 'bg-purple-900/60 text-purple-300', bar: 'bg-purple-500' },
};

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, organization, logout } = useAuthStore();

  const { data: usageData } = useQuery({
    queryKey: ['usage'],
    queryFn: () => api.get('/organization/usage').then((r) => r.data.data),
    // Refetch every 2 minutes — keeps sidebar fresh without hammering the API
    staleTime: 2 * 60 * 1000,
  });

  const { data: prospectListsData } = useQuery({
    queryKey: ['prospect-lists'],
    queryFn: () => api.get('/prospect-lists', { params: { limit: 100 } }).then((r) => r.data.data),
    staleTime: 30_000,
  });

  const handleLogout = async () => {
    await api.post('/auth/logout').catch(() => {});
    logout();
    navigate('/login');
  };

  const plan = usageData?.plan || organization?.plan || 'free';
  const used = usageData?.used ?? 0;
  const limit = usageData?.limit;
  const pct = usageData?.percentUsed ?? 0;
  const isUnlimited = limit === Infinity || limit === null;
  const styles = PLAN_STYLES[plan] || PLAN_STYLES.free;
  // Turn bar amber when ≥ 80%
  const barColor = pct >= 80 ? 'bg-amber-500' : styles.bar;
  const prospectLists = prospectListsData || [];
  const activeListId = location.pathname === '/campaigns'
    ? new URLSearchParams(location.search).get('list')
    : null;

  return (
    <aside className="w-56 shrink-0 bg-slate-950 border-r border-slate-800 flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-indigo-500 rounded-lg flex items-center justify-center">
            <Zap size={14} className="text-white" />
          </div>
          <span className="text-white font-bold text-base">ProspectMind</span>
        </div>
        {organization && (
          <p className="text-slate-500 text-xs mt-2 truncate">{organization.name}</p>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
                isActive
                  ? 'bg-indigo-600/20 text-indigo-300 font-medium'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}

        {prospectLists.length > 0 && (
          <div className="pt-4">
            <div className="px-3 pb-2 flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-600">
              <Megaphone size={12} />
              Campaigns
            </div>
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {prospectLists.map((list) => {
                const isActive = location.pathname === '/campaigns' && activeListId === list._id;
                return (
                  <NavLink
                    key={list._id}
                    to={`/campaigns?list=${list._id}`}
                    className={() =>
                      `flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs transition ${
                        isActive
                          ? 'bg-indigo-600/20 text-indigo-300'
                          : 'text-slate-500 hover:text-white hover:bg-slate-800'
                      }`
                    }
                  >
                    <span className="truncate">{list.name}</span>
                    <span className="shrink-0 text-[10px] text-slate-500">{list.prospectCount}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>
        )}
      </nav>

      {/* ── Plan badge + usage bar ── */}
      {usageData && (
        <div className="px-3 pb-3">
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-3 space-y-2">
            {/* Plan name + badge */}
            <div className="flex items-center justify-between">
              <span className="text-slate-400 text-xs">Plan</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${styles.badge}`}>
                {plan}
              </span>
            </div>

            {/* Usage bar */}
            {!isUnlimited && (
              <>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${barColor}`}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
                <p className="text-slate-500 text-xs">
                  {used} / {limit} prospects
                  {pct >= 80 && (
                    <span className="text-amber-400 ml-1">· {100 - pct}% left</span>
                  )}
                </p>
              </>
            )}
            {isUnlimited && (
              <p className="text-slate-500 text-xs">{used} prospects · unlimited</p>
            )}
          </div>
        </div>
      )}

      {/* User */}
      <div className="px-3 py-4 border-t border-slate-800">
        <div className="flex items-center gap-3 px-3 py-2 mb-1">
          <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold">
            {user?.name?.[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-medium truncate">{user?.name}</p>
            <p className="text-slate-500 text-xs truncate">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-500 hover:text-white hover:bg-slate-800 transition w-full"
        >
          <LogOut size={15} /> Sign out
        </button>
      </div>
    </aside>
  );
}
