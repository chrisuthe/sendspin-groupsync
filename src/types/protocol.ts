/**
 * Protocol message types for Music Assistant and Sendspin
 */

// Music Assistant WebSocket message structure
export interface MAMessage {
  message_id: number;
  command?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: MAError;
  event?: string;
  data?: unknown;
}

export interface MAError {
  code: string;
  message: string;
}

// Sendspin protocol messages
export interface SendspinMessage {
  type: string;
  payload?: Record<string, unknown>;
}

// New sync offset message type
export interface SyncOffsetMessage {
  type: 'client/sync_offset';
  payload: {
    player_id: string;
    offset_ms: number;
    source: 'groupsync' | 'manual';
    timestamp?: number;
  };
}

export interface SyncOffsetAckMessage {
  type: 'client/sync_offset_ack';
  payload: {
    player_id: string;
    applied_offset_ms: number;
    success: boolean;
    error?: string;
  };
}

// Connection state
export interface ConnectionState {
  serverUrl: string;
  connected: boolean;
  connecting: boolean;
  error: string | null;
}

// Music Assistant API commands
export const MA_COMMANDS = {
  PLAYERS_ALL: 'players/all',
  PLAYERS_GET: 'players/get',
  PLAYER_CMD: 'players/cmd',
  QUEUE_PLAY_MEDIA: 'player_queues/play_media',
  CONFIG_PLAYERS_SAVE: 'config/players/save',
} as const;
