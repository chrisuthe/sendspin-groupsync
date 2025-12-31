# GroupSync

A mobile web application for synchronizing multiple Sendspin players in multi-room audio setups.

## Overview

GroupSync solves the challenge of achieving sample-accurate audio synchronization across multiple Sendspin speakers. Users walk around their listening space holding their phone near each speaker, and the app uses the device microphone to detect audio offset. The calculated offset is then pushed to each player to achieve perfect synchronization.

## Features

- **Music Assistant Integration** - Connects via WebSocket to discover and control Sendspin players
- **Automatic Offset Detection** - Uses microphone to measure audio delay at each speaker
- **Cross-Correlation Algorithm** - Sub-millisecond accuracy offset calculation
- **Protocol Extension** - Pushes offset to players via new `client/sync_offset` message
- **Mobile-First Design** - Optimized for walking around with phone in hand

## How It Works

1. **Connect** - Enter your Music Assistant server URL
2. **Select Players** - Choose which Sendspin players to synchronize
3. **Calibrate** - Walk to each speaker, hold phone nearby while calibration track plays
4. **Apply** - Push calculated offsets to all players

### Calibration Process

GroupSync plays a specially designed click track through all selected speakers simultaneously:
- 20 seconds duration
- Clicks at 1-second intervals
- Rotating frequencies (1kHz, 2kHz, 4kHz, 8kHz) for reliable detection
- Cross-correlation algorithm calculates precise offset

## Technology Stack

| Component | Technology |
|-----------|------------|
| Framework | React 18 + TypeScript 5 |
| Build | Vite |
| Audio | Web Audio API |
| State | Zustand |
| UI | Tailwind CSS |

## Requirements

- Music Assistant server (v2.7+) with Sendspin player provider
- One or more Sendspin-compatible players
- Mobile device with microphone (iOS Safari or Android Chrome)
- HTTPS connection (required for microphone access)

## Supported Players

### Direct Support (protocol extension)
- **windowsSpin** - Windows desktop player
- **SpinDroid** - Android player

### Via PR (pending)
- **sendspin-js** - Web/Cast player
- **sendspin-cli** - Python CLI player

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/groupsync.git
cd groupsync

# Install dependencies
npm install

# Start development server (HTTPS required for microphone)
npm run dev

# Build for production
npm run build
```

## Usage

### Development

```bash
npm run dev
```

Opens at `https://localhost:5173` (HTTPS required for microphone access).

### Production

```bash
npm run build
npm run preview
```

Deploy the `dist/` folder to any static hosting service (GitHub Pages, Vercel, Netlify).

## Configuration

### Environment Variables

None required. Server URL is entered at runtime.

### Vite Config

HTTPS is enabled by default for development to allow microphone access:

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    https: true,
    host: true, // Allow mobile access
  },
});
```

## Protocol Extension

GroupSync extends the Sendspin protocol with a new message type:

```typescript
interface SyncOffsetMessage {
  type: 'client/sync_offset';
  payload: {
    player_id: string;
    offset_ms: number;      // Positive = delay, negative = advance
    source: 'groupsync';
  };
}
```

Players receive this message and adjust their internal sync delay accordingly.

## Project Structure

```
groupsync/
├── src/
│   ├── main.tsx              # Entry point
│   ├── App.tsx               # Main component
│   ├── calibration/          # Audio detection & offset calculation
│   ├── ma-client/            # Music Assistant WebSocket client
│   ├── sync-push/            # Offset push mechanism
│   ├── store/                # Zustand state management
│   ├── components/           # React UI components
│   └── types/                # TypeScript type definitions
├── public/
│   └── calibration-track.wav # Pre-generated click track
└── docs/
    ├── ARCHITECTURE.md       # Technical architecture
    └── PROTOCOL.md           # Protocol extension details
```

## Related Projects

- [Music Assistant](https://github.com/music-assistant) - Home music server
- [Sendspin Protocol](https://www.sendspin-audio.com/spec/) - Synchronized audio streaming
- [windowsSpin](https://github.com/yourusername/windowsSpin) - Windows Sendspin player
- [SpinDroid](https://github.com/yourusername/SpinDroid) - Android Sendspin player

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Acknowledgments

- Music Assistant team for the excellent home audio server
- Sendspin protocol designers for the synchronized audio specification
