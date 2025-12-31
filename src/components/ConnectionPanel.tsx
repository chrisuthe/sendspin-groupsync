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

  const handleConnect = async () => {
    if (!inputUrl.trim()) return;

    setConnecting(true);
    setError(null);

    try {
      // Connect to Music Assistant
      await maClient.connect(inputUrl.trim());

      // Save URL and mark connected
      setServerUrl(inputUrl.trim());
      addRecentServer(inputUrl.trim());
      setConnected(true);

      // Fetch players
      setLoading(true);
      try {
        const players = await maClient.getAllPlayers();
        // Filter to only Sendspin-capable players
        const sendspinPlayers = players.filter(
          (p) => p.type?.includes('sendspin') || p.can_sync_with?.length
        );
        setPlayers(sendspinPlayers.length > 0 ? sendspinPlayers : players);
        console.log('[MA] Found players:', players.length);
      } catch (playerError) {
        console.error('[MA] Failed to fetch players:', playerError);
        // Still connected, just couldn't get players yet
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      setError(message);
      console.error('[MA] Connection error:', err);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && inputUrl.trim() && !connecting) {
      handleConnect();
    }
  };

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
            onKeyPress={handleKeyPress}
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
