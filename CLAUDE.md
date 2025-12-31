# CLAUDE.md - Developer Guidance for GroupSync

This file provides context for AI assistants (Claude, Copilot, etc.) working on this codebase.

## Project Purpose

GroupSync is a mobile web app for synchronizing multiple Sendspin audio players. It measures speaker offset by playing a calibration track and listening via the device microphone, then pushes calculated offsets to each player.

## Key Concepts

### Sendspin Protocol
- WebSocket-based synchronized audio streaming protocol
- Players connect to Music Assistant server at `ws://host:port/sendspin`
- Clock synchronization via NTP-style `client/time` / `server/time` messages
- Audio chunks include server timestamps (microseconds)
- Players apply sync delay to compensate for hardware latency

### Sync Offset
- **Static delay**: User-configurable offset in milliseconds
- **Positive value**: Delays playback (plays later)
- **Negative value**: Advances playback (plays earlier)
- Used to compensate for speaker distance, hardware latency, network jitter

### Cross-Correlation
- Algorithm to find time offset between two signals
- Compare expected click waveform to recorded audio
- Peak in correlation indicates sample offset
- Convert samples to milliseconds: `offsetMs = (samples * 1000) / sampleRate`

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    GroupSync Web App                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Connection  │  │ Calibration │  │ Offset Push         │ │
│  │ Panel       │  │ Wizard      │  │                     │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         │                │                     │            │
│  ┌──────▼──────┐  ┌──────▼──────┐  ┌──────────▼──────────┐ │
│  │ MA Client   │  │ Audio       │  │ Sync Offset         │ │
│  │ (WebSocket) │  │ Detector    │  │ Pusher              │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
└─────────┼────────────────┼────────────────────┼────────────┘
          │                │                    │
          ▼                ▼                    ▼
   Music Assistant    Microphone         Sendspin Players
      Server          (Web Audio)        (via protocol msg)
```

## File Organization

### Core Modules

| Directory | Purpose | Key Files |
|-----------|---------|-----------|
| `src/ma-client/` | Music Assistant WebSocket connection | `MAWebSocketClient.ts` |
| `src/calibration/` | Audio detection and offset calculation | `AudioDetector.ts`, `OffsetCalculator.ts` |
| `src/sync-push/` | Push offset to players | `SyncOffsetPusher.ts` |
| `src/store/` | Zustand state management | `useConnectionStore.ts`, `useCalibrationStore.ts` |
| `src/components/` | React UI components | `CalibrationWizard.tsx`, `PlayerList.tsx` |

### Key Patterns

**WebSocket Messages** (Music Assistant API):
```typescript
// Send command
ws.send(JSON.stringify({
  message_id: Date.now(),
  command: 'players/all',
  args: {},
}));

// Receive response
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.message_id === sentId) {
    // Handle response
  }
};
```

**Audio Processing** (Web Audio API):
```typescript
// Microphone capture
const stream = await navigator.mediaDevices.getUserMedia({
  audio: { echoCancellation: false, sampleRate: 48000 }
});
const audioContext = new AudioContext({ sampleRate: 48000 });
const source = audioContext.createMediaStreamSource(stream);
```

**State Management** (Zustand):
```typescript
const useConnectionStore = create<ConnectionState>((set) => ({
  serverUrl: '',
  connected: false,
  players: [],
  connect: async (url) => { /* ... */ },
}));
```

## Common Tasks

### Adding a New Player Command

1. Add message type to `src/types/protocol.ts`
2. Implement in `src/ma-client/MAWebSocketClient.ts`
3. Call from component or store

### Modifying Audio Detection

1. Edit `src/calibration/AudioDetector.ts` for capture logic
2. Edit `src/calibration/OffsetCalculator.ts` for algorithm
3. Constants at top of files control thresholds

### Adding UI Components

1. Create in `src/components/`
2. Use Tailwind classes for styling
3. Mobile-first: design for small screens

## Testing

### Manual Testing Checklist

- [ ] Connect to Music Assistant server
- [ ] List available players
- [ ] Play calibration track
- [ ] Microphone capture works
- [ ] Clicks detected visually
- [ ] Offset calculated and displayed
- [ ] Offset pushed to player

### Debug Mode

Open browser console for logs. Key events:
- `[MA] Connected to server`
- `[MA] Players discovered: N`
- `[Audio] Microphone stream started`
- `[Calibration] Click detected at sample N`
- `[Offset] Calculated: +X.Xms`

## Dependencies

### Runtime
- `react` / `react-dom` - UI framework
- `zustand` - State management

### Development
- `vite` - Build tool
- `typescript` - Type checking
- `tailwindcss` - Styling

### Browser APIs Used
- `WebSocket` - Server communication
- `AudioContext` - Audio processing
- `MediaDevices.getUserMedia()` - Microphone access
- `AnalyserNode` - FFT for frequency detection

## Related Repositories

### Owned (direct changes)
- `Z:\CodeProjects\windowsSpin` - Windows Sendspin player
- `Z:\CodeProjects\SpinDroid` - Android Sendspin player

### External (PRs needed)
- `github.com/Sendspin/sendspin-js` - JS player library
- `github.com/Sendspin/sendspin-cli` - Python CLI player

## Protocol Extension

New message type for pushing sync offset:

```typescript
// Client sends to player
{
  type: 'client/sync_offset',
  payload: {
    player_id: string,
    offset_ms: number,  // +delay, -advance
    source: 'groupsync',
  }
}

// Player responds (optional)
{
  type: 'client/sync_offset_ack',
  payload: {
    player_id: string,
    applied_offset_ms: number,
  }
}
```

## Gotchas

1. **HTTPS Required** - Microphone access requires secure context
2. **48kHz Sample Rate** - Match Sendspin's audio format
3. **Echo Cancellation OFF** - We need the raw audio signal
4. **Mobile Browsers** - May need user gesture to start AudioContext
5. **Cross-Origin** - MA server needs CORS headers for WebSocket
