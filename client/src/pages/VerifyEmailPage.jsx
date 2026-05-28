import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

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

export default function VerifyEmailPage() {
  const { token } = useParams();
  const [status, setStatus] = useState('loading'); // loading | success | error
  const [message, setMessage] = useState('');

  useEffect(() => {
    const verify = async () => {
      try {
        await api.get(`/auth/verify-email/${token}`);
        setStatus('success');
      } catch (err) {
        setStatus('error');
        setMessage(err.response?.data?.message || 'Verification failed. The link may have expired.');
      }
    };
    verify();
  }, [token]);

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Logo />
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center">
          {status === 'loading' && (
            <>
              <Loader2 size={40} className="text-indigo-400 animate-spin mx-auto mb-4" />
              <h1 className="text-white text-xl font-semibold mb-2">Verifying your email…</h1>
              <p className="text-slate-400 text-sm">Just a moment.</p>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="w-16 h-16 rounded-full bg-green-900/40 border border-green-800 flex items-center justify-center mx-auto mb-5">
                <CheckCircle2 size={30} className="text-green-400" />
              </div>
              <h1 className="text-white text-xl font-semibold mb-2">Email verified!</h1>
              <p className="text-slate-400 text-sm mb-6">
                Your account is now fully activated. Head to your dashboard to get started.
              </p>
              <Link
                to="/dashboard"
                className="inline-block px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium text-sm transition"
              >
                Go to dashboard →
              </Link>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="w-16 h-16 rounded-full bg-red-900/40 border border-red-800 flex items-center justify-center mx-auto mb-5">
                <AlertTriangle size={28} className="text-red-400" />
              </div>
              <h1 className="text-white text-xl font-semibold mb-2">Verification failed</h1>
              <p className="text-slate-400 text-sm mb-6">{message}</p>
              <div className="flex flex-col gap-2">
                <Link
                  to="/dashboard"
                  className="inline-block px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium text-sm transition"
                >
                  Go to dashboard
                </Link>
                <p className="text-slate-500 text-xs mt-1">
                  Need a new link?{' '}
                  <Link to="/login" className="text-indigo-400 hover:text-indigo-300">
                    Sign in
                  </Link>{' '}
                  and we'll send another.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
