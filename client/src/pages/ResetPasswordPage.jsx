import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { KeyRound, Eye, EyeOff, CheckCircle2, AlertTriangle } from 'lucide-react';

const Logo = () => (
  <div className="text-center mb-8">
    <div className="inline-flex items-center gap-2 mb-2">
      <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center">
        <span className="text-white font-bold text-sm">P</span>
      </div>
      <span className="text-white font-bold text-xl">ProspectMind</span>
    </div>
    <p className="text-slate-400 text-sm">AI-powered prospect intelligence</p>
  </div>
);

export default function ResetPasswordPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await api.post(`/auth/reset-password/${token}`, { password });
      setDone(true);
      toast.success('Password reset! Redirecting…');
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError(err.response?.data?.message || 'Reset failed. The link may have expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Logo />
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8">
          {done ? (
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-green-900/40 border border-green-800 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 size={26} className="text-green-400" />
              </div>
              <h1 className="text-white text-xl font-semibold mb-2">Password updated!</h1>
              <p className="text-slate-400 text-sm">Redirecting you to sign in…</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-indigo-900/40 border border-indigo-800 flex items-center justify-center">
                  <KeyRound size={18} className="text-indigo-400" />
                </div>
                <div>
                  <h1 className="text-white text-xl font-semibold leading-tight">Set new password</h1>
                  <p className="text-slate-400 text-sm">Must be at least 8 characters</p>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 bg-red-950/50 border border-red-800 rounded-lg px-4 py-3 mb-4">
                  <AlertTriangle size={15} className="text-red-400 mt-0.5 shrink-0" />
                  <p className="text-red-300 text-sm">{error}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-slate-400 text-sm mb-1.5">New password</label>
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      required
                      autoFocus
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition pr-10"
                      placeholder="Min 8 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition"
                    >
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-slate-400 text-sm mb-1.5">Confirm password</label>
                  <input
                    type={showPw ? 'text' : 'password'}
                    required
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
                    placeholder="Same as above"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition"
                >
                  {loading ? 'Updating…' : 'Update password'}
                </button>
              </form>

              <p className="text-center mt-5">
                <Link to="/login" className="text-slate-500 hover:text-slate-300 text-sm transition">
                  Back to sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
