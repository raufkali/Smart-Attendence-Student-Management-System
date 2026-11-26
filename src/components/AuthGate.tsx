import React, { useEffect, useState } from 'react';
import { ShieldCheck, Lock, ArrowRight } from 'lucide-react';
import { apiGet, apiPost, setAuthToken } from '../api/client';

export interface AuthUser {
  username: string;
  fullName: string;
  role: string;
  avatarUrl: string;
}

interface AuthStatus {
  adminClaimed: boolean;
  envOverrideActive: boolean;
  institutionName: string;
  institutionLogo: string;
}

interface AuthGateProps {
  onAuthenticated: (user: AuthUser) => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({ onAuthenticated }) => {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [fullName, setFullName] = useState('Dr. Evelyn Vance');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiGet<AuthStatus>('/api/auth/status')
      .then(setStatus)
      .catch(() => setError('Unable to reach local administration server.'));
  }, []);

  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('Administrator password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const res = await apiPost<{ token: string; user: AuthUser }>('/api/auth/claim', {
        fullName,
        username,
        password,
      });
      setAuthToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to claim administrator account.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiPost<{ token: string; user: AuthUser }>('/api/auth/login', {
        username,
        password,
      });
      setAuthToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-8 shadow-sm">
        <div className="flex items-center gap-4 mb-6 pb-6 border-b border-slate-200">
          <div className="w-14 h-14 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden shrink-0 flex items-center justify-center">
            <img
              src={status?.institutionLogo || '/src/assets/images/institution_crest_1795676738629.jpg'}
              alt="Institution crest"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-tight">
              {status?.institutionName || 'ScholarGrid Administration'}
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Local Network Institution Server · Offline-First SQLite
            </p>
          </div>
        </div>

        {!status ? (
          <p className="text-sm text-slate-600">Connecting to local SQLite server...</p>
        ) : !status.adminClaimed ? (
          <form onSubmit={handleClaim} className="space-y-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ShieldCheck className="w-4 h-4 text-blue-700" />
                <span>First-Run Administrator Setup</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Create the primary administrator credentials stored securely on this administration computer.
              </p>
            </div>

            <div>
              <label htmlFor="claim-fullname" className="block text-xs font-medium text-slate-700 mb-1">
                Administrator Full Name
              </label>
              <input
                id="claim-fullname"
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label htmlFor="claim-username" className="block text-xs font-medium text-slate-700 mb-1">
                Username
              </label>
              <input
                id="claim-username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label htmlFor="claim-password" className="block text-xs font-medium text-slate-700 mb-1">
                Password (min. 6 characters)
              </label>
              <input
                id="claim-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label htmlFor="claim-confirm" className="block text-xs font-medium text-slate-700 mb-1">
                Confirm Password
              </label>
              <input
                id="claim-confirm"
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {error && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-800 hover:bg-blue-900 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
            >
              <span>{loading ? 'Provisioning...' : 'Complete Administrator Setup'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Lock className="w-4 h-4 text-blue-700" />
              <span>Administrator Sign In</span>
            </div>

            <div>
              <label htmlFor="login-username" className="block text-xs font-medium text-slate-700 mb-1">
                Username
              </label>
              <input
                id="login-username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-xs font-medium text-slate-700 mb-1">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {error && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-800 hover:bg-blue-900 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
            >
              <span>{loading ? 'Signing In...' : 'Sign In to Console'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
