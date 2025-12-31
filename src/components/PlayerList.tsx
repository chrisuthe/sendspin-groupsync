import { usePlayersStore, useCalibrationStore, useConnectionStore } from '../store';

export function PlayerList() {
  const { players, selectedPlayerIds, togglePlayerSelection, loading } = usePlayersStore();
  const { setPhase } = useCalibrationStore();
  const { setConnected } = useConnectionStore();

  const handleStartCalibration = () => {
    if (selectedPlayerIds.length > 0) {
      setPhase('instructions');
    }
  };

  const handleDisconnect = () => {
    setConnected(false);
  };

  // Mock players for development
  const mockPlayers = players.length > 0 ? players : [
    { player_id: 'player1', name: 'Living Room Speaker', available: true, type: 'sendspin' },
    { player_id: 'player2', name: 'Kitchen Sendspin', available: true, type: 'sendspin' },
    { player_id: 'player3', name: 'Bedroom SpinDroid', available: false, type: 'sendspin' },
  ];

  return (
    <div className="space-y-6 pb-20">
      <div>
        <h2 className="text-2xl font-bold mb-2">Select Players</h2>
        <p className="text-text-muted">
          Choose which Sendspin players to synchronize.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {mockPlayers.map((player) => (
            <button
              key={player.player_id}
              onClick={() => togglePlayerSelection(player.player_id)}
              disabled={!player.available}
              className={`w-full flex items-center gap-3 p-4 rounded-lg border transition-colors
                ${selectedPlayerIds.includes(player.player_id)
                  ? 'bg-primary/20 border-primary'
                  : 'bg-surface border-gray-600 hover:border-gray-500'
                }
                ${!player.available && 'opacity-50 cursor-not-allowed'}
              `}
            >
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center
                ${selectedPlayerIds.includes(player.player_id)
                  ? 'bg-primary border-primary'
                  : 'border-gray-500'
                }
              `}>
                {selectedPlayerIds.includes(player.player_id) && (
                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
              <div className="flex-1 text-left">
                <div className="font-medium">{player.name}</div>
                <div className="text-sm text-text-muted">
                  {player.available ? 'Available' : 'Offline'}
                </div>
              </div>
              <div className={`w-2 h-2 rounded-full ${player.available ? 'bg-secondary' : 'bg-gray-500'}`} />
            </button>
          ))}
        </div>
      )}

      <div className="fixed bottom-16 left-0 right-0 p-4 bg-background border-t border-gray-700">
        <div className="max-w-lg mx-auto flex gap-3">
          <button
            onClick={handleDisconnect}
            className="px-4 py-3 bg-surface hover:bg-gray-700 rounded-lg font-medium transition-colors"
          >
            Disconnect
          </button>
          <button
            onClick={handleStartCalibration}
            disabled={selectedPlayerIds.length === 0}
            className="flex-1 py-3 px-4 bg-primary hover:bg-primary-dark disabled:opacity-50
                       rounded-lg font-medium transition-colors"
          >
            Start Calibration ({selectedPlayerIds.length} selected)
          </button>
        </div>
      </div>
    </div>
  );
}
