import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import api from '../lib/api';
import toast from 'react-hot-toast';

export default function RegisterPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [form, setForm] = useState({ name: '', email: '', password: '', organizationName: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password.length < 8) return toast.error('Password must be at least 8 characters.');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', form);
      setAuth(data.user, data.accessToken, data.refreshToken);
      toast.success('Account created! Welcome to ProspectMind.');
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">P</span>
            </div>
            <span className="text-white font-bold text-xl">ProspectMind</span>
          </div>
          <p className="text-slate-400 text-sm">Start with 50 free prospects per month</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8">
          <h1 className="text-white text-2xl font-semibold mb-6">Create your account</h1>
          <form onSubmit={handleSubmit} className="space-y-4">
            {[
              { key: 'name', label: 'Your name', placeholder: 'John Doe', type: 'text' },
              { key: 'organizationName', label: 'Organization / Team name', placeholder: 'Acme Inc.', type: 'text' },
              { key: 'email', label: 'Work email', placeholder: 'you@company.com', type: 'email' },
              { key: 'password', label: 'Password', placeholder: '8+ characters', type: 'password' },
            ].map(({ key, label, placeholder, type }) => (
              <div key={key}>
                <label className="block text-slate-400 text-sm mb-1.5">{label}</label>
                <input
                  type={type}
                  required
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
                  placeholder={placeholder}
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </div>
            ))}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition mt-2"
            >
              {loading ? 'Creating account...' : 'Create account →'}
            </button>
          </form>
          <p className="text-slate-500 text-sm text-center mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-indigo-400 hover:text-indigo-300">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
