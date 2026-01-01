import { useEffect, useRef, useState } from 'react';
import { useCalibrationStore, usePlayersStore, useConnectionStore } from '../store';
import { createCalibrationSession, CalibrationSession } from '../calibration';
import { pushSyncOffsets } from '../sync-push';
import type { PushResult } from '../sync-push';
import type { CalibrationResult } from '../types';

export function CalibrationWizard() {
  const {
    phase,
    setPhase,
    setCurrentPlayer,
    detectedClicks,
    addClickDetection,
    clearDetections,
    results,
    setResult,
    updateOffset,
    setError,
  } = useCalibrationStore();
  const { players, selectedPlayerIds } = usePlayersStore();
  const { serverUrl, sendspinUrl } = useConnectionStore();

  const [audioLevel, setAudioLevel] = useState(0);
  const [calibrationProgress, setCalibrationProgress] = useState({ detected: 0, total: 20 });
  const [playbackMethod, setPlaybackMethod] = useState<'music_assistant' | 'local' | null>(null);
  const [clockSyncStatus, setClockSyncStatus] = useState<{
    attempted: boolean;
    syncing: boolean;
    synced: boolean;
    error?: string;
    offsetMs?: number;
    uncertaintyMs?: number;
    measurements?: number;
  }>({
    attempted: false,
    syncing: false,
    synced: false,
  });
  const [isPushing, setIsPushing] = useState(false);
  const [pushResults, setPushResults] = useState<PushResult[] | null>(null);
  const sessionRef = useRef<CalibrationSession | null>(null);
  const animationRef = useRef<number>(0);

  const selectedPlayers = players.filter((p) =>
    selectedPlayerIds.includes(p.player_id)
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      sessionRef.current?.stop();
      cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // Audio level visualization loop
  useEffect(() => {
    if (phase !== 'listening') return;

    const updateLevel = () => {
      if (sessionRef.current) {
        setAudioLevel(sessionRef.current.getCurrentLevel());
      }
      animationRef.current = requestAnimationFrame(updateLevel);
    };

    animationRef.current = requestAnimationFrame(updateLevel);

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [phase]);

  const handleSelectSpeaker = async (playerId: string) => {
    const player = players.find((p) => p.player_id === playerId);
    if (!player) return;

    setCurrentPlayer(playerId);
    clearDetections();
    setPlaybackMethod(null);
    setClockSyncStatus({ attempted: false, syncing: false, synced: false });
    setPhase('listening');

    // Create and start calibration session
    // Use sendspinUrl for clock sync if provided, otherwise use serverUrl
    const clockSyncUrl = sendspinUrl || serverUrl;
    const session = createCalibrationSession(playerId, player.name, clockSyncUrl);
    sessionRef.current = session;

    try {
      await session.start((event) => {
        switch (event.type) {
          case 'clock_syncing':
            setClockSyncStatus({ attempted: true, syncing: true, synced: false });
            break;

          case 'clock_synced': {
            const data = event.data as {
              success: boolean;
              error?: string;
              offsetMs: number | null;
              uncertaintyMs: number | null;
              measurements: number;
            };
            setClockSyncStatus({
              attempted: true,
              syncing: false,
              synced: data.success,
              error: data.error,
              offsetMs: data.offsetMs ?? undefined,
              uncertaintyMs: data.uncertaintyMs ?? undefined,
              measurements: data.measurements,
            });
            break;
          }

          case 'playback_started': {
            const data = event.data as { method: 'music_assistant' | 'local'; url: string };
            setPlaybackMethod(data.method);
            break;
          }

          case 'click_detected':
            addClickDetection(event.data as Parameters<typeof addClickDetection>[0]);
            break;

          case 'progress':
            setCalibrationProgress(event.data as { detected: number; total: number });
            break;

          case 'completed': {
            const result = event.data as CalibrationResult;
            setResult(playerId, result);
            setPhase('results');
            break;
          }

          case 'error':
            setError(event.data as string);
            setPhase('instructions');
            break;
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Calibration failed');
      setPhase('instructions');
    }
  };

  const handleCancelCalibration = () => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    clearDetections();
    setPhase('instructions');
    setCurrentPlayer(null);
  };

  const handleBack = () => {
    if (phase === 'instructions') {
      setPhase('selecting');
    } else if (phase === 'listening') {
      handleCancelCalibration();
    } else if (phase === 'results') {
      setPhase('idle');
    }
  };

  const handleApplyOffsets = async () => {
    if (Object.keys(results).length === 0) return;

    setIsPushing(true);
    setPushResults(null);
    setError(null);

    try {
      console.log('[CalibrationWizard] Applying offsets:', results);
      const pushResultsArray = await pushSyncOffsets(results);
      setPushResults(pushResultsArray);

      // Check if all succeeded
      const allSuccess = pushResultsArray.every((r) => r.success);
      if (allSuccess) {
        console.log('[CalibrationWizard] All offsets applied successfully');
      } else {
        const failed = pushResultsArray.filter((r) => !r.success);
        console.warn('[CalibrationWizard] Some offsets failed:', failed);
      }
    } catch (err) {
      console.error('[CalibrationWizard] Failed to apply offsets:', err);
      setError(err instanceof Error ? err.message : 'Failed to apply offsets');
    } finally {
      setIsPushing(false);
    }
  };

  // Generate waveform bars based on audio level
  const waveformBars = Array.from({ length: 32 }, (_, i) => {
    const baseHeight = 20 + Math.sin(i * 0.3 + Date.now() / 100) * 15;
    const levelBoost = audioLevel * 100;
    return Math.min(100, baseHeight + levelBoost);
  });

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

          <div className="p-4 bg-blue-900/20 border border-blue-700/50 rounded-lg text-blue-300 text-sm">
            <p className="font-medium mb-1">Important</p>
            <ul className="list-disc list-inside text-blue-300/70 space-y-1">
              <li>Hold your phone 1-2 feet from the speaker</li>
              <li>Keep the room quiet during calibration</li>
              <li>The process takes about 20 seconds per speaker</li>
            </ul>
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

          {Object.keys(results).length > 0 && (
            <button
              onClick={() => setPhase('results')}
              className="w-full py-3 px-4 bg-secondary hover:bg-secondary/80
                         rounded-lg font-medium transition-colors"
            >
              View Results ({Object.keys(results).length} calibrated)
            </button>
          )}

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
            <h2 className="text-2xl font-bold mb-2">
              {clockSyncStatus.syncing ? 'Syncing Clock...' : 'Listening...'}
            </h2>
            <p className="text-text-muted">
              {clockSyncStatus.syncing
                ? 'Synchronizing with server for accurate timing'
                : 'Hold your phone steady near the speaker.'}
            </p>
          </div>

          {/* Clock sync status */}
          {clockSyncStatus.attempted && (
            <div className={`p-3 rounded-lg text-sm text-center ${
              clockSyncStatus.syncing
                ? 'bg-blue-900/20 border border-blue-700/50 text-blue-300'
                : clockSyncStatus.synced
                ? 'bg-green-900/20 border border-green-700/50 text-green-300'
                : 'bg-yellow-900/20 border border-yellow-700/50 text-yellow-300'
            }`}>
              {clockSyncStatus.syncing ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-blue-300 border-t-transparent rounded-full animate-spin" />
                  Synchronizing clock with server...
                </span>
              ) : clockSyncStatus.synced ? (
                <div className="space-y-1">
                  <div>Clock synced: {clockSyncStatus.offsetMs?.toFixed(1)}ms offset</div>
                  <div className="text-xs opacity-75">
                    {clockSyncStatus.measurements} measurements, ±{clockSyncStatus.uncertaintyMs?.toFixed(2)}ms uncertainty
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <div>Using fallback timing (clock sync failed)</div>
                  {clockSyncStatus.error && (
                    <div className="text-xs opacity-75">{clockSyncStatus.error}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Playback status indicator */}
          {playbackMethod && (
            <div className={`p-3 rounded-lg text-sm text-center ${
              playbackMethod === 'music_assistant'
                ? 'bg-green-900/20 border border-green-700/50 text-green-300'
                : 'bg-yellow-900/20 border border-yellow-700/50 text-yellow-300'
            }`}>
              {playbackMethod === 'music_assistant' ? (
                <>Playing click track through Music Assistant</>
              ) : (
                <>Playing through phone speaker (MA playback failed)</>
              )}
            </div>
          )}

          {/* Waveform visualization */}
          <div className="h-32 bg-surface rounded-lg flex items-center justify-center overflow-hidden">
            <div className="flex gap-1 items-center h-full px-4">
              {waveformBars.map((height, i) => (
                <div
                  key={i}
                  className="w-2 bg-primary rounded-full transition-all duration-75"
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>
          </div>

          {/* Click detection indicators */}
          <div className="flex flex-wrap gap-2 justify-center">
            {Array.from({ length: 20 }).map((_, i) => (
              <div
                key={i}
                className={`w-4 h-4 rounded-full transition-colors ${
                  i < detectedClicks.length ? 'bg-secondary' : 'bg-gray-600'
                }`}
              />
            ))}
          </div>

          <div className="text-center">
            <p className="text-lg font-medium">
              {calibrationProgress.detected} of {calibrationProgress.total} clicks detected
            </p>
            <p className="text-text-muted text-sm mt-1">
              {calibrationProgress.detected === 0
                ? 'Waiting for audio...'
                : calibrationProgress.detected < 10
                ? 'Keep holding steady...'
                : 'Almost done!'}
            </p>
          </div>

          {/* Progress bar */}
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${(calibrationProgress.detected / calibrationProgress.total) * 100}%` }}
            />
          </div>

          <button
            onClick={handleCancelCalibration}
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

          {Object.keys(results).length === 0 ? (
            <div className="p-4 bg-yellow-900/20 border border-yellow-700/50 rounded-lg text-yellow-300 text-sm text-center">
              No calibration results yet. Go back and calibrate some speakers.
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(results).map(([playerId, result]) => (
                <div key={playerId} className="p-4 bg-surface rounded-lg">
                  <div className="flex justify-between mb-2">
                    <span className="font-medium">{result.playerName}</span>
                    <span className={`font-mono ${
                      result.offsetMs > 0 ? 'text-blue-400' : result.offsetMs < 0 ? 'text-orange-400' : 'text-secondary'
                    }`}>
                      {result.offsetMs > 0 ? '+' : ''}{result.offsetMs.toFixed(1)} ms
                    </span>
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
                    className="w-full accent-primary"
                  />
                  <div className="flex justify-between text-xs text-text-muted mt-1">
                    <span>-100ms (earlier)</span>
                    <span>0</span>
                    <span>+100ms (later)</span>
                  </div>
                  <div className="flex justify-between text-xs text-text-muted mt-2">
                    <span>Confidence: {Math.round(result.confidence * 100)}%</span>
                    <span>{result.detectedClicks}/{result.totalClicks} clicks</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Push Results */}
          {pushResults && (
            <div className="space-y-2">
              <h3 className="font-medium text-sm text-text-muted">Push Results</h3>
              {pushResults.map((result) => (
                <div
                  key={result.playerId}
                  className={`p-3 rounded-lg text-sm flex items-center gap-2 ${
                    result.success
                      ? 'bg-green-900/20 border border-green-700/50 text-green-300'
                      : 'bg-red-900/20 border border-red-700/50 text-red-300'
                  }`}
                >
                  <span>{result.success ? '✓' : '✗'}</span>
                  <span className="flex-1">{result.playerName}</span>
                  {result.success ? (
                    <span className="text-xs opacity-75">via {result.method}</span>
                  ) : (
                    <span className="text-xs opacity-75">{result.error}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => {
                setPhase('instructions');
                setPushResults(null);
              }}
              disabled={isPushing}
              className="flex-1 py-3 px-4 bg-surface hover:bg-gray-700 disabled:opacity-50
                         rounded-lg font-medium transition-colors"
            >
              Calibrate More
            </button>
            <button
              onClick={handleApplyOffsets}
              disabled={Object.keys(results).length === 0 || isPushing}
              className="flex-1 py-3 px-4 bg-primary hover:bg-primary-dark disabled:opacity-50
                         rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              {isPushing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Applying...
                </>
              ) : pushResults?.every((r) => r.success) ? (
                'Done!'
              ) : (
                'Apply Offsets'
              )}
            </button>
          </div>

          {pushResults?.every((r) => r.success) && (
            <button
              onClick={() => {
                setPhase('idle');
                setPushResults(null);
              }}
              className="w-full py-3 px-4 bg-secondary hover:bg-secondary/80
                         rounded-lg font-medium transition-colors"
            >
              Finish
            </button>
          )}
        </>
      )}
    </div>
  );
}
