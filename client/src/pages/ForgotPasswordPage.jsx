import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';

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

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Logo />
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8">
          {sent ? (
            /* ── Success state ── */
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-green-900/40 border border-green-800 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 size={26} className="text-green-400" />
              </div>
              <h1 className="text-white text-xl font-semibold mb-2">Check your inbox</h1>
              <p className="text-slate-400 text-sm leading-relaxed mb-6">
                If <span className="text-slate-300">{email}</span> is registered, you'll get a password reset link shortly. Check your spam folder if it doesn't arrive.
              </p>
              <Link to="/login" className="text-indigo-400 hover:text-indigo-300 text-sm flex items-center justify-center gap-1.5">
                <ArrowLeft size={14} /> Back to sign in
              </Link>
            </div>
          ) : (
            /* ── Form ── */
            <>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-indigo-900/40 border border-indigo-800 flex items-center justify-center">
                  <Mail size={18} className="text-indigo-400" />
                </div>
                <div>
                  <h1 className="text-white text-xl font-semibold leading-tight">Forgot password?</h1>
                  <p className="text-slate-400 text-sm">We'll email you a reset link</p>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-slate-400 text-sm mb-1.5">Email address</label>
                  <input
                    type="email"
                    required
                    autoFocus
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition"
                >
                  {loading ? 'Sending…' : 'Send reset link'}
                </button>
              </form>

              <p className="text-slate-500 text-sm text-center mt-6">
                <Link to="/login" className="text-indigo-400 hover:text-indigo-300 flex items-center justify-center gap-1.5">
                  <ArrowLeft size={13} /> Back to sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
