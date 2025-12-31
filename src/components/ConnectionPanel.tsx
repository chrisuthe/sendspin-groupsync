import { useState } from 'react';
import { useConnectionStore } from '../store';

export function ConnectionPanel() {
  const { serverUrl, setServerUrl, connecting, error, recentServers } = useConnectionStore();
  const [inputUrl, setInputUrl] = useState(serverUrl || '');

  const handleConnect = () => {
    // TODO: Implement actual connection logic
    setServerUrl(inputUrl);
    console.log('Connecting to:', inputUrl);
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
            placeholder="192.168.1.100:8095"
            className="w-full px-4 py-3 bg-surface border border-gray-600 rounded-lg
                       focus:ring-2 focus:ring-primary focus:border-transparent
                       placeholder-gray-500"
          />
        </div>

        {error && (
          <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleConnect}
          disabled={connecting || !inputUrl}
          className="w-full py-3 px-4 bg-primary hover:bg-primary-dark disabled:opacity-50
                     rounded-lg font-medium transition-colors"
        >
          {connecting ? 'Connecting...' : 'Connect'}
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
                className="w-full text-left px-4 py-2 bg-surface hover:bg-gray-700
                           rounded-lg text-sm transition-colors"
              >
                {url}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
