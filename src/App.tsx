import { useConnectionStore, useCalibrationStore } from './store';
import { ConnectionPanel } from './components/ConnectionPanel';
import { PlayerList } from './components/PlayerList';
import { CalibrationWizard } from './components/CalibrationWizard';

function App() {
  const { connected } = useConnectionStore();
  const { phase } = useCalibrationStore();

  return (
    <div className="min-h-screen bg-background text-text">
      {/* Header */}
      <header className="bg-surface border-b border-gray-700 px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-primary">GroupSync</h1>
          {connected && (
            <span className="text-xs text-secondary flex items-center gap-1">
              <span className="w-2 h-2 bg-secondary rounded-full animate-pulse" />
              Connected
            </span>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-lg mx-auto p-4">
        {!connected ? (
          <ConnectionPanel />
        ) : phase === 'idle' || phase === 'selecting' ? (
          <PlayerList />
        ) : (
          <CalibrationWizard />
        )}
      </main>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-surface border-t border-gray-700 p-2">
        <p className="text-center text-xs text-text-muted">
          GroupSync - Sendspin Audio Synchronization
        </p>
      </footer>
    </div>
  );
}

export default App;
