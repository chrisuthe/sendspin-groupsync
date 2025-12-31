# GroupSync Protocol Extension

This document describes the protocol extension for pushing sync offset to Sendspin players.

## Background

The Sendspin protocol currently supports clock synchronization via NTP-style `client/time` / `server/time` message exchanges. However, there is no standardized way for an external tool to push sync offset adjustments to players.

Players implement static delay differently:
- **JS Player**: `syncDelay` config + `setSyncDelay(ms)` runtime API
- **Windows Player**: `StaticDelayMs` property in `KalmanClockSynchronizer`
- **CLI Player**: `--static-delay-ms` CLI argument
- **Android Player**: Currently no user-configurable offset

GroupSync introduces a new protocol message to standardize remote offset adjustment.

## New Message Type: `client/sync_offset`

### Purpose

Allow external tools (like GroupSync) to push sync offset adjustments to players over WebSocket.

### Message Format

```typescript
interface SyncOffsetMessage {
  type: 'client/sync_offset';
  payload: {
    player_id: string;        // Target player's unique ID
    offset_ms: number;        // Offset in milliseconds (float)
    source: string;           // Source identifier (e.g., 'groupsync')
    timestamp?: number;       // When offset was calculated (optional, microseconds)
  };
}
```

### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `'client/sync_offset'` |
| `payload.player_id` | string | Yes | Unique identifier of target player |
| `payload.offset_ms` | number | Yes | Offset in milliseconds. Positive = delay playback, negative = advance playback |
| `payload.source` | string | Yes | Identifies the sender (e.g., `'groupsync'`, `'manual'`) |
| `payload.timestamp` | number | No | Timestamp when offset was calculated (server time, microseconds) |

### Example Messages

**Delay playback by 25ms:**
```json
{
  "type": "client/sync_offset",
  "payload": {
    "player_id": "sendspin_livingroom",
    "offset_ms": 25.0,
    "source": "groupsync"
  }
}
```

**Advance playback by 10ms:**
```json
{
  "type": "client/sync_offset",
  "payload": {
    "player_id": "sendspin_kitchen",
    "offset_ms": -10.0,
    "source": "groupsync"
  }
}
```

**With timestamp:**
```json
{
  "type": "client/sync_offset",
  "payload": {
    "player_id": "spindroid_bedroom",
    "offset_ms": 42.5,
    "source": "groupsync",
    "timestamp": 1735678900000000
  }
}
```

## Player Implementation

### Expected Behavior

When a player receives `client/sync_offset`:

1. **Validate** the message format
2. **Verify** the `player_id` matches this player (or accept if broadcast)
3. **Apply** the offset to internal sync delay
4. **Clear audio buffer** (optional, for immediate effect)
5. **Persist** the offset if the player supports settings storage
6. **Acknowledge** the message (optional)

### Implementation Guidelines

#### Offset Application

The offset should be applied in the time conversion function where server timestamps are converted to local playback time:

```
playback_time = server_to_client_time(server_timestamp) + sync_offset
```

#### Range Limits

Players should clamp the offset to a reasonable range:
- Recommended: -5000ms to +5000ms
- Minimum useful: -1000ms to +1000ms

#### Immediate vs Gradual Application

- **Immediate**: Clear buffer and reschedule playback (brief interruption)
- **Gradual**: Apply offset over several seconds using playback rate adjustment (smooth but slower)

Immediate is recommended for calibration scenarios.

### Player-Specific Implementation

#### windowsSpin (C#)

```csharp
// In SendSpinClient.cs or protocol handler
case "client/sync_offset":
    var payload = message.Payload;
    var offsetMs = payload.GetProperty("offset_ms").GetDouble();
    var playerId = payload.GetProperty("player_id").GetString();

    if (playerId == _playerId)
    {
        _clockSynchronizer.StaticDelayMs = offsetMs;
        _audioBuffer.Clear();  // Optional: immediate effect
        _logger.LogInformation("Sync offset set to {Offset}ms", offsetMs);
    }
    break;
```

#### SpinDroid (Kotlin)

```kotlin
// In SendSpinClient.kt
"client/sync_offset" -> {
    val payload = jsonObject.getJSONObject("payload")
    val offsetMs = payload.getDouble("offset_ms")
    val playerId = payload.getString("player_id")

    if (playerId == this.playerId) {
        timeFilter.setStaticOffset(offsetMs)
        audioPlayer.clearBuffer()  // Optional
        Log.i(TAG, "Sync offset set to ${offsetMs}ms")
    }
}

// In SendspinTimeFilter.kt
private var staticOffsetMicros: Long = 0

fun setStaticOffset(offsetMs: Double) {
    staticOffsetMicros = (offsetMs * 1000).toLong()
}

fun serverToClient(serverTimeMicros: Long): Long {
    // ... existing calculation ...
    return result.toLong() + staticOffsetMicros
}
```

#### sendspin-js (TypeScript)

```typescript
// In protocol-handler.ts
case 'client/sync_offset':
    const { player_id, offset_ms } = message.payload;
    if (player_id === this.playerId) {
        this.audioProcessor.setSyncDelay(offset_ms);
        console.log(`Sync offset set to ${offset_ms}ms`);
    }
    break;
```

#### sendspin-cli (Python)

```python
# In app.py or protocol handler
async def handle_sync_offset(self, message: dict):
    payload = message.get("payload", {})
    offset_ms = payload.get("offset_ms", 0.0)
    player_id = payload.get("player_id")

    if player_id == self._player_id:
        self._client.set_static_delay_ms(offset_ms)
        self._audio_player.clear()  # Optional
        logger.info(f"Sync offset set to {offset_ms}ms")
```

## Optional: Acknowledgment Message

Players may optionally acknowledge the offset application:

### Message Format

```typescript
interface SyncOffsetAckMessage {
  type: 'client/sync_offset_ack';
  payload: {
    player_id: string;
    applied_offset_ms: number;
    success: boolean;
    error?: string;
  };
}
```

### Example

```json
{
  "type": "client/sync_offset_ack",
  "payload": {
    "player_id": "sendspin_livingroom",
    "applied_offset_ms": 25.0,
    "success": true
  }
}
```

## Delivery Mechanisms

### Direct WebSocket

GroupSync can connect directly to each player's Sendspin WebSocket endpoint:

```
ws://player-ip:port/sendspin
```

1. Connect with `client/hello` as controller
2. Send `client/sync_offset`
3. Disconnect

### Via Music Assistant Relay (Future)

If Music Assistant adds support, the message could be relayed through the server:

```
GroupSync → MA Server → Target Player
```

This would require:
- New MA API endpoint
- Message routing logic
- Player identification

## Backwards Compatibility

Players that don't support `client/sync_offset`:
- Will ignore the message (standard protocol behavior)
- GroupSync should detect this and show manual instructions
- Fallback: Display offset value for user to manually enter in player UI

## Security Considerations

### Authentication

Currently, the Sendspin protocol doesn't require authentication. Any client on the network can send messages.

**Recommendations:**
- Only accept on local network
- Consider adding source verification
- Future: Add authentication token support

### Rate Limiting

Players should rate-limit offset changes to prevent abuse:
- Maximum 1 change per second
- Maximum 10 changes per minute

### Validation

Players must validate:
- `offset_ms` is a valid number
- `offset_ms` is within acceptable range
- `player_id` matches (if applicable)

## Future Extensions

### Broadcast Offset

Apply same offset to all players in a group:

```json
{
  "type": "client/sync_offset",
  "payload": {
    "group_id": "group_livingroom",
    "offset_ms": 25.0,
    "source": "groupsync"
  }
}
```

### Relative Offset

Adjust existing offset rather than replacing:

```json
{
  "type": "client/sync_offset",
  "payload": {
    "player_id": "sendspin_kitchen",
    "offset_delta_ms": -5.0,
    "source": "groupsync"
  }
}
```

### Query Current Offset

Request current offset from player:

```json
{
  "type": "client/sync_offset_query",
  "payload": {
    "player_id": "sendspin_livingroom"
  }
}
```

Response:
```json
{
  "type": "client/sync_offset_response",
  "payload": {
    "player_id": "sendspin_livingroom",
    "current_offset_ms": 25.0
  }
}
```
