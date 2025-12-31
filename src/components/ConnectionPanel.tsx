import { useState } from 'react';
import { useConnectionStore, usePlayersStore } from '../store';
import { maClient } from '../ma-client';

export function ConnectionPanel() {
  const {
    serverUrl,
    setServerUrl,
    connecting,
    setConnecting,
    setConnected,
    setError,
    error,
    recentServers,
    addRecentServer,
  } = useConnectionStore();
  const { setPlayers, setLoading } = usePlayersStore();
  const [inputUrl, setInputUrl] = useState(serverUrl || '');
  const [needsAuth, setNeedsAuth] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authenticating, setAuthenticating] = useState(false);

  const fetchPlayers = async (): Promise<boolean> => {
    setLoading(true);
    try {
      const players = await maClient.getAllPlayers();
      console.log('[MA] Found players:', players.length, players);
      // Show all available players - user can select which ones to calibrate
      setPlayers(players);
      return true;
    } catch (playerError) {
      console.error('[MA] Failed to fetch players:', playerError);
      // Check if this is an auth error
      const errorMsg = playerError instanceof Error ? playerError.message : '';
      if (errorMsg.toLowerCase().includes('auth')) {
        setNeedsAuth(true);
        return false;
      }
      setError(errorMsg || 'Failed to fetch players');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    if (!inputUrl.trim()) return;

    setConnecting(true);
    setError(null);
    setNeedsAuth(false);

    try {
      // Connect to Music Assistant
      await maClient.connect(inputUrl.trim());

      // Save URL
      setServerUrl(inputUrl.trim());
      addRecentServer(inputUrl.trim());

      // Try to authenticate with stored token (proactively, some servers require it)
      const hasStoredToken = localStorage.getItem('ma_access_token');
      if (maClient.needsAuth || hasStoredToken) {
        const tokenAuthSuccess = await maClient.authenticateWithToken();
        if (!tokenAuthSuccess && maClient.needsAuth) {
          // Server explicitly requires auth and token failed
          setNeedsAuth(true);
          setConnecting(false);
          return;
        }
      }

      // Try to fetch players - this will detect if auth is actually required
      const success = await fetchPlayers();
      if (success) {
        setConnected(true);
      }
      // If fetchPlayers failed due to auth, needsAuth is already set
    } catch (err) {
      let message = err instanceof Error ? err.message : 'Connection failed';

      // Check for mixed content / WSS error
      if (message.includes('insecure WebSocket') || message.includes('SecurityError')) {
        message = 'Cannot connect: This page uses HTTPS but Music Assistant uses plain WebSocket. ' +
          'Either access MA via HTTPS/WSS, or run GroupSync on HTTP (but mic won\'t work on mobile).';
      }

      setError(message);
      console.error('[MA] Connection error:', err);
    } finally {
      setConnecting(false);
    }
  };

  const handleLogin = async () => {
    if (!username.trim()) return;

    setAuthenticating(true);
    setError(null);

    try {
      await maClient.login(username, password);
      setConnected(true);
      setNeedsAuth(false);
      await fetchPlayers();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
      console.error('[MA] Login error:', err);
    } finally {
      setAuthenticating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (needsAuth) {
        if (username.trim() && !authenticating) {
          handleLogin();
        }
      } else if (inputUrl.trim() && !connecting) {
        handleConnect();
      }
    }
  };

  // Show login form if authentication is required
  if (needsAuth) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Login to Music Assistant</h2>
          <p className="text-text-muted">
            Authentication is required. Enter your credentials.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium mb-2">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="admin"
              disabled={authenticating}
              autoComplete="username"
              className="w-full px-4 py-3 bg-surface border border-gray-600 rounded-lg
                         focus:ring-2 focus:ring-primary focus:border-transparent
                         placeholder-gray-500 disabled:opacity-50"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-2">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Password"
              disabled={authenticating}
              autoComplete="current-password"
              className="w-full px-4 py-3 bg-surface border border-gray-600 rounded-lg
                         focus:ring-2 focus:ring-primary focus:border-transparent
                         placeholder-gray-500 disabled:opacity-50"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => {
                setNeedsAuth(false);
                maClient.disconnect();
              }}
              disabled={authenticating}
              className="flex-1 py-3 px-4 bg-surface hover:bg-gray-700 disabled:opacity-50
                         rounded-lg font-medium transition-colors"
            >
              Back
            </button>
            <button
              onClick={handleLogin}
              disabled={authenticating || !username.trim()}
              className="flex-1 py-3 px-4 bg-primary hover:bg-primary-dark disabled:opacity-50
                         rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              {authenticating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Logging in...
                </>
              ) : (
                'Login'
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2">Connect to Music Assistant</h2>
        <p className="text-text-muted">
          Enter your Music Assistant server URL to discover Sendspin players.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="server-url" className="block text-sm font-medium mb-2">
            Server URL
          </label>
          <input
            id="server-url"
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="192.168.1.100:8095"
            disabled={connecting}
            className="w-full px-4 py-3 bg-surface border border-gray-600 rounded-lg
                       focus:ring-2 focus:ring-primary focus:border-transparent
                       placeholder-gray-500 disabled:opacity-50"
          />
        </div>

        {error && (
          <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleConnect}
          disabled={connecting || !inputUrl.trim()}
          className="w-full py-3 px-4 bg-primary hover:bg-primary-dark disabled:opacity-50
                     rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
        >
          {connecting ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Connecting...
            </>
          ) : (
            'Connect'
          )}
        </button>
      </div>

      {recentServers.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-text-muted mb-2">Recent Servers</h3>
          <div className="space-y-2">
            {recentServers.map((url) => (
              <button
                key={url}
                onClick={() => setInputUrl(url)}
                disabled={connecting}
                className="w-full text-left px-4 py-2 bg-surface hover:bg-gray-700
                           rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                {url}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="text-center text-xs text-text-muted">
        <p>
          Make sure Music Assistant is running and accessible on your network.
        </p>
      </div>
    </div>
  );
}
