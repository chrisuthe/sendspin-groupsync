# GroupSync Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           User's Home Network                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌──────────────┐       ┌──────────────────────────────────────────┐  │
│   │   Mobile     │       │         Music Assistant Server           │  │
│   │   Phone      │       │                                          │  │
│   │              │       │  ┌──────────────────────────────────┐   │  │
│   │ ┌──────────┐ │       │  │     Sendspin Player Provider     │   │  │
│   │ │GroupSync │◄──WS────┼──►                                  │   │  │
│   │ │ Web App  │ │       │  │  - Player registry               │   │  │
│   │ └──────────┘ │       │  │  - Audio streaming               │   │  │
│   │      ▲       │       │  │  - Clock synchronization         │   │  │
│   │      │ mic   │       │  └──────────────────────────────────┘   │  │
│   └──────┼───────┘       │              │                          │  │
│          │               └──────────────┼──────────────────────────┘  │
│          │                              │                              │
│   ┌──────▼───────┐                      │ WebSocket                   │
│   │   Speaker    │                      │                              │
│   │   (audio)    │                      ▼                              │
│   └──────────────┘       ┌─────────────────────────────────────┐      │
│                          │        Sendspin Players              │      │
│                          │                                      │      │
│                          │  ┌─────────┐ ┌─────────┐ ┌────────┐ │      │
│                          │  │Windows  │ │SpinDroid│ │  JS    │ │      │
│                          │  │ Spin    │ │(Android)│ │ Player │ │      │
│                          │  └─────────┘ └─────────┘ └────────┘ │      │
│                          └─────────────────────────────────────┘      │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Connection Phase

```
GroupSync ──[WebSocket]──► Music Assistant
           client/hello {
             client_id: "groupsync-xxx",
             name: "GroupSync",
             supported_roles: ["controller@v1"]
           }

Music Assistant ──[WebSocket]──► GroupSync
                server/hello { version: 1 }

GroupSync ──[WebSocket]──► Music Assistant
           players/all {}

Music Assistant ──[WebSocket]──► GroupSync
                { players: [...] }
```

### 2. Calibration Phase

```
┌────────────┐    ┌─────────────┐    ┌────────────┐    ┌────────────┐
│  GroupSync │    │     MA      │    │  Speaker   │    │ Microphone │
└─────┬──────┘    └──────┬──────┘    └─────┬──────┘    └─────┬──────┘
      │                  │                 │                 │
      │ queue track      │                 │                 │
      ├─────────────────►│                 │                 │
      │                  │                 │                 │
      │                  │ stream audio    │                 │
      │                  ├────────────────►│                 │
      │                  │                 │                 │
      │                  │                 │ sound waves     │
      │                  │                 ├────────────────►│
      │                  │                 │                 │
      │                  │                 │                 │ capture
      │◄───────────────────────────────────────────────────┤
      │                  │                 │                 │
      │ detect offset    │                 │                 │
      ├──────────────────┤                 │                 │
      │                  │                 │                 │
```

### 3. Offset Push Phase

```
┌────────────┐    ┌─────────────┐    ┌────────────┐
│  GroupSync │    │     MA      │    │   Player   │
└─────┬──────┘    └──────┬──────┘    └─────┬──────┘
      │                  │                 │
      │ client/sync_offset                 │
      ├─────────────────────────────────►│
      │ { player_id, offset_ms }          │
      │                  │                 │
      │                  │                 │ apply offset
      │                  │                 ├──────────────►
      │                  │                 │
```

## Component Architecture

### React Component Tree

```
<App>
  ├── <ConnectionPanel>              # Server URL input, connect button
  │     └── <ServerHistory>          # Previously connected servers
  │
  ├── <PlayerList>                   # List of discovered players
  │     └── <PlayerCard>             # Individual player with checkbox
  │
  ├── <CalibrationWizard>            # Step-by-step calibration flow
  │     ├── <InstructionsStep>       # "Hold phone near speaker"
  │     ├── <SpeakerSelector>        # Which speaker are you calibrating?
  │     ├── <CalibrationProgress>    # Real-time detection feedback
  │     │     ├── <Waveform>         # Audio waveform visualization
  │     │     └── <ClickIndicators>  # 20 dots for click detection
  │     └── <ResultsStep>            # Show calculated offset
  │
  └── <ResultsSummary>               # All players with offsets
        └── <OffsetSlider>           # Manual offset adjustment
```

### State Management

```typescript
// Connection State
interface ConnectionState {
  serverUrl: string;
  connected: boolean;
  connecting: boolean;
  error: string | null;
  players: Player[];
}

// Calibration State
interface CalibrationState {
  selectedPlayers: string[];
  currentPlayer: string | null;
  phase: 'idle' | 'instructions' | 'listening' | 'calculating' | 'done';
  detectedClicks: ClickDetection[];
  offsets: Map<string, number>;
}

// Store Slices (Zustand)
const useConnectionStore = create<ConnectionState>(...);
const useCalibrationStore = create<CalibrationState>(...);
```

## Audio Processing Pipeline

### Microphone Capture

```
getUserMedia()
    │
    ▼
MediaStreamSource
    │
    ▼
AnalyserNode ──► FFT (for frequency detection)
    │
    ▼
ScriptProcessor / AudioWorklet ──► Raw samples
    │
    ▼
RingBuffer (last N seconds)
    │
    ▼
Onset Detector ──► Click timestamps
    │
    ▼
Cross-Correlation ──► Precise offset
```

### Detection Algorithm

```typescript
// Stage 1: Energy Onset Detection
function detectOnsets(samples: Float32Array): number[] {
  // Sliding window RMS
  // Detect sudden energy increases
  // Return sample indices
}

// Stage 2: Frequency Verification
function verifyClick(samples: Float32Array, onset: number): boolean {
  // FFT of short window
  // Check for expected frequency peak (1k, 2k, 4k, or 8k Hz)
  // Reject noise spikes
}

// Stage 3: Cross-Correlation
function calculateOffset(
  expected: Float32Array,
  recorded: Float32Array
): number {
  // FFT-based convolution
  // Find correlation peak
  // Return sample offset
}
```

### Offset Calculation Flow

```
Click Track                 Recorded Audio
  │                              │
  ▼                              ▼
[click at 0ms]              [click at ?ms]
[click at 1000ms]           [click at ?ms]
[click at 2000ms]           [click at ?ms]
  ...                           ...
  │                              │
  └──────────┬───────────────────┘
             │
             ▼
    Cross-Correlate Each Pair
             │
             ▼
    Average Offsets (reject outliers)
             │
             ▼
    Final Offset (ms)
```

## Click Track Specification

### Audio Properties

| Property | Value |
|----------|-------|
| Sample Rate | 48000 Hz |
| Channels | 2 (stereo) |
| Bit Depth | 16-bit PCM |
| Duration | 20 seconds |
| File Size | ~3.8 MB (WAV) |

### Click Pattern

```
Time (s)  | Frequency | Purpose
----------|-----------|------------------
0         | 1000 Hz   | Reference click
1         | 2000 Hz   | Octave 2
2         | 4000 Hz   | Octave 3
3         | 8000 Hz   | Octave 4
4         | 1000 Hz   | Repeat pattern
...       | ...       | ...
19        | 8000 Hz   | Final click
```

### Click Waveform

```
Amplitude
    │
  1 ├──────╮      ╭──────
    │       ╲    ╱
  0 ├────────────────────────────
    │         ╲╱
 -1 ├──────────────────────────
    └─────────────────────────► Time
         5ms click duration
         (Hann window envelope)
```

## Protocol Extension

### New Message: `client/sync_offset`

**Direction**: GroupSync → Player (via direct WebSocket or via MA relay)

**Purpose**: Push calculated sync offset to a player

**Format**:
```typescript
{
  type: 'client/sync_offset',
  payload: {
    player_id: string,      // Target player ID
    offset_ms: number,      // Offset in milliseconds
    source: 'groupsync',    // Source identifier
    timestamp: number,      // When calculated (optional)
  }
}
```

**Player Implementation**:

| Player | Existing API | Implementation |
|--------|--------------|----------------|
| windowsSpin | `StaticDelayMs` | Add handler in `SendSpinClient.cs` |
| SpinDroid | None | Add `staticOffsetMicros` to `SendspinTimeFilter.kt` |
| sendspin-js | `setSyncDelay(ms)` | Add handler in `protocol-handler.ts` |
| sendspin-cli | `--static-delay-ms` | Add handler in `app.py` |

## Error Handling

### Connection Errors

```typescript
enum ConnectionError {
  TIMEOUT = 'Connection timed out',
  REFUSED = 'Connection refused',
  INVALID_URL = 'Invalid server URL',
  WEBSOCKET_ERROR = 'WebSocket error',
}
```

### Calibration Errors

```typescript
enum CalibrationError {
  NO_MICROPHONE = 'Microphone access denied',
  NO_AUDIO = 'No audio detected',
  NOISE_TOO_HIGH = 'Background noise too high',
  CLICKS_NOT_DETECTED = 'Could not detect calibration clicks',
  INCONSISTENT_OFFSET = 'Offset measurements too inconsistent',
}
```

### Recovery Strategies

| Error | Recovery |
|-------|----------|
| Microphone denied | Show instructions to grant permission |
| No audio detected | Check speaker is playing, phone is close |
| Noise too high | Reduce ambient noise, try again |
| Inconsistent offset | Retry calibration, try different position |

## Performance Considerations

### Memory Usage

- Ring buffer: ~1MB (5 seconds at 48kHz stereo float)
- FFT buffers: ~64KB per operation
- React components: Minimal (functional components)

### CPU Usage

- Microphone capture: Low (native)
- Onset detection: Medium (every 100ms)
- Cross-correlation: High but brief (after detection)
- FFT: Medium (every detection)

### Battery Impact

- Microphone active: Significant during calibration
- Screen on: Required for UI
- WebSocket: Minimal (mostly idle)

**Recommendation**: Complete calibration quickly, then close app.

## Security Considerations

### Network

- WebSocket to MA server (typically local network)
- No external API calls
- No sensitive data transmitted

### Permissions

- Microphone: Required for calibration
- No other permissions needed

### Data Storage

- Server URL saved to localStorage
- Calculated offsets saved to localStorage
- No personal data collected
