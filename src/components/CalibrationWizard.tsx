import { useCalibrationStore, usePlayersStore } from '../store';

export function CalibrationWizard() {
  const { phase, setPhase, setCurrentPlayer, detectedClicks, results, updateOffset } = useCalibrationStore();
  const { players, selectedPlayerIds } = usePlayersStore();

  // Mock players for development
  const mockPlayers = players.length > 0 ? players : [
    { player_id: 'player1', name: 'Living Room Speaker', available: true, type: 'sendspin' },
    { player_id: 'player2', name: 'Kitchen Sendspin', available: true, type: 'sendspin' },
    { player_id: 'player3', name: 'Bedroom SpinDroid', available: false, type: 'sendspin' },
  ];

  const selectedPlayers = mockPlayers.filter((p) =>
    selectedPlayerIds.includes(p.player_id)
  );

  const handleSelectSpeaker = (playerId: string) => {
    setCurrentPlayer(playerId);
    setPhase('listening');
    // TODO: Start audio detection
  };

  const handleBack = () => {
    if (phase === 'instructions') {
      setPhase('selecting');
    } else if (phase === 'listening') {
      setPhase('instructions');
      setCurrentPlayer(null);
    } else if (phase === 'results') {
      setPhase('idle');
    }
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Instructions Phase */}
      {phase === 'instructions' && (
        <>
          <div className="text-center">
            <div className="text-6xl mb-4">📱</div>
            <h2 className="text-2xl font-bold mb-2">Calibration Instructions</h2>
            <p className="text-text-muted">
              Hold your phone near each speaker, one at a time. A click track will play
              through all speakers while we measure the audio delay.
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="font-medium">Select the speaker you're standing near:</h3>
            {selectedPlayers.map((player) => (
              <button
                key={player.player_id}
                onClick={() => handleSelectSpeaker(player.player_id)}
                className="w-full flex items-center gap-3 p-4 bg-surface hover:bg-gray-700
                           rounded-lg border border-gray-600 transition-colors"
              >
                <div className="text-2xl">🔊</div>
                <div className="flex-1 text-left">
                  <div className="font-medium">{player.name}</div>
                  {results[player.player_id] && (
                    <div className="text-sm text-secondary">
                      Calibrated: {results[player.player_id].offsetMs.toFixed(1)}ms
                    </div>
                  )}
                </div>
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))}
          </div>

          <button
            onClick={handleBack}
            className="w-full py-3 px-4 bg-surface hover:bg-gray-700
                       rounded-lg font-medium transition-colors"
          >
            Back to Player Selection
          </button>
        </>
      )}

      {/* Listening Phase */}
      {phase === 'listening' && (
        <>
          <div className="text-center">
            <div className="text-6xl mb-4 animate-pulse">🎤</div>
            <h2 className="text-2xl font-bold mb-2">Listening...</h2>
            <p className="text-text-muted">
              Hold your phone steady near the speaker.
            </p>
          </div>

          {/* Waveform placeholder */}
          <div className="h-32 bg-surface rounded-lg flex items-center justify-center">
            <div className="flex gap-1 items-end h-16">
              {[...Array(20)].map((_, i) => (
                <div
                  key={i}
                  className="w-2 bg-primary rounded-full animate-pulse"
                  style={{
                    height: `${Math.random() * 100}%`,
                    animationDelay: `${i * 50}ms`,
                  }}
                />
              ))}
            </div>
          </div>

          {/* Click detection indicators */}
          <div className="flex flex-wrap gap-2 justify-center">
            {[...Array(20)].map((_, i) => (
              <div
                key={i}
                className={`w-4 h-4 rounded-full ${
                  i < detectedClicks.length ? 'bg-secondary' : 'bg-gray-600'
                }`}
              />
            ))}
          </div>

          <p className="text-center text-text-muted">
            Detected {detectedClicks.length} of 20 clicks
          </p>

          <button
            onClick={handleBack}
            className="w-full py-3 px-4 bg-surface hover:bg-gray-700
                       rounded-lg font-medium transition-colors"
          >
            Cancel
          </button>
        </>
      )}

      {/* Results Phase */}
      {phase === 'results' && (
        <>
          <div className="text-center">
            <div className="text-6xl mb-4">✅</div>
            <h2 className="text-2xl font-bold mb-2">Calibration Complete</h2>
            <p className="text-text-muted">
              Review and adjust the offsets below, then apply them to your players.
            </p>
          </div>

          <div className="space-y-4">
            {Object.entries(results).map(([playerId, result]) => (
              <div key={playerId} className="p-4 bg-surface rounded-lg">
                <div className="flex justify-between mb-2">
                  <span className="font-medium">{result.playerName}</span>
                  <span className="text-secondary">{result.offsetMs.toFixed(1)} ms</span>
                </div>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  step="0.5"
                  value={result.offsetMs}
                  onChange={(e) => {
                    updateOffset(playerId, parseFloat(e.target.value));
                  }}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-text-muted">
                  <span>-100ms</span>
                  <span>0</span>
                  <span>+100ms</span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setPhase('instructions')}
              className="flex-1 py-3 px-4 bg-surface hover:bg-gray-700
                         rounded-lg font-medium transition-colors"
            >
              Re-test
            </button>
            <button
              onClick={() => {
                // TODO: Apply offsets
                setPhase('idle');
              }}
              className="flex-1 py-3 px-4 bg-primary hover:bg-primary-dark
                         rounded-lg font-medium transition-colors"
            >
              Apply Offsets
            </button>
          </div>
        </>
      )}
    </div>
  );
}
