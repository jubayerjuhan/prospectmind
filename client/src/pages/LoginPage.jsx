import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import api from '../lib/api';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', form);
      setAuth(data.user, data.accessToken, data.refreshToken);
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">P</span>
            </div>
            <span className="text-white font-bold text-xl">ProspectMind</span>
          </div>
          <p className="text-slate-400 text-sm">AI-powered prospect intelligence</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8">
          <h1 className="text-white text-2xl font-semibold mb-6">Welcome back</h1>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-slate-400 text-sm mb-1.5">Email</label>
              <input
                type="email"
                required
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
                placeholder="you@company.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-slate-400 text-sm mb-1.5">Password</label>
              <input
                type="password"
                required
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <div className="flex items-center justify-between mt-1">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition"
              >
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
            </div>
            <p className="text-center mt-1">
              <Link to="/forgot-password" className="text-slate-500 hover:text-slate-300 text-sm transition">
                Forgot your password?
              </Link>
            </p>
          </form>
          <p className="text-slate-500 text-sm text-center mt-6">
            No account?{' '}
            <Link to="/register" className="text-indigo-400 hover:text-indigo-300">
              Sign up free
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
