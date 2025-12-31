/**
 * SyncOffsetPusher - Sends calculated offsets to Sendspin players
 *
 * Supports multiple push strategies:
 * 1. Direct Sendspin protocol: Send client/sync_offset message
 * 2. Music Assistant config API: Use config/players/save endpoint
 *
 * The pusher tries the direct protocol first, then falls back to MA config API.
 */

import { maClient } from '../ma-client';
import type { CalibrationResult } from '../types';

export interface PushResult {
  playerId: string;
  playerName: string;
  success: boolean;
  method: 'protocol' | 'config' | 'none';
  appliedOffsetMs: number;
  error?: string;
}

export interface PushOptions {
  /** Use Music Assistant config API as fallback if protocol fails */
  useConfigApiFallback?: boolean;
  /** Timeout for each push operation in ms */
  timeoutMs?: number;
}

const DEFAULT_OPTIONS: PushOptions = {
  useConfigApiFallback: true,
  timeoutMs: 5000,
};

/**
 * Push sync offsets to multiple players
 */
export async function pushSyncOffsets(
  results: Record<string, CalibrationResult>,
  options: PushOptions = {}
): Promise<PushResult[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const pushResults: PushResult[] = [];

  for (const [playerId, result] of Object.entries(results)) {
    const pushResult = await pushSingleOffset(playerId, result, opts);
    pushResults.push(pushResult);
  }

  return pushResults;
}

/**
 * Push sync offset to a single player
 */
async function pushSingleOffset(
  playerId: string,
  result: CalibrationResult,
  options: PushOptions
): Promise<PushResult> {
  const baseResult: PushResult = {
    playerId,
    playerName: result.playerName,
    success: false,
    method: 'none',
    appliedOffsetMs: result.offsetMs,
  };

  // Check connection
  if (!maClient.isConnected) {
    return {
      ...baseResult,
      error: 'Not connected to Music Assistant',
    };
  }

  // Try direct Sendspin protocol first
  try {
    const protocolResult = await pushViaProtocol(playerId, result.offsetMs, options.timeoutMs!);
    if (protocolResult.success) {
      return {
        ...baseResult,
        success: true,
        method: 'protocol',
      };
    }
  } catch (error) {
    console.log('[SyncPush] Protocol push failed, trying config API:', error);
  }

  // Fall back to Music Assistant config API
  if (options.useConfigApiFallback) {
    try {
      const configResult = await pushViaConfigApi(playerId, result.offsetMs, options.timeoutMs!);
      if (configResult.success) {
        return {
          ...baseResult,
          success: true,
          method: 'config',
        };
      }
      return {
        ...baseResult,
        error: configResult.error || 'Config API push failed',
      };
    } catch (error) {
      return {
        ...baseResult,
        error: error instanceof Error ? error.message : 'Config API push failed',
      };
    }
  }

  return {
    ...baseResult,
    error: 'All push methods failed',
  };
}

/**
 * Push offset via Sendspin protocol message
 * This sends the client/sync_offset message directly to the player
 */
async function pushViaProtocol(
  playerId: string,
  offsetMs: number,
  timeoutMs: number
): Promise<{ success: boolean; error?: string }> {
  // Message format (for reference):
  // { type: 'client/sync_offset', payload: { player_id, offset_ms, source, timestamp } }

  try {
    // Send via Music Assistant's player command mechanism
    // This routes the message to the specific player
    await maClient.sendCommand(
      'players/cmd/sync_offset',
      {
        player_id: playerId,
        offset_ms: offsetMs,
        source: 'groupsync',
      },
      timeoutMs
    );

    console.log(`[SyncPush] Protocol push succeeded for ${playerId}: ${offsetMs}ms`);
    return { success: true };
  } catch (error) {
    // Protocol push not supported yet - this is expected until players implement the handler
    console.log(`[SyncPush] Protocol push not supported for ${playerId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Protocol push failed',
    };
  }
}

/**
 * Push offset via Music Assistant config API
 * This saves the offset to player configuration
 */
async function pushViaConfigApi(
  playerId: string,
  offsetMs: number,
  timeoutMs: number
): Promise<{ success: boolean; error?: string }> {
  try {
    // Music Assistant config/players/save endpoint
    await maClient.sendCommand(
      'config/players/save',
      {
        player_id: playerId,
        values: {
          sync_offset_ms: offsetMs,
          sync_offset_source: 'groupsync',
          sync_offset_timestamp: Date.now(),
        },
      },
      timeoutMs
    );

    console.log(`[SyncPush] Config API push succeeded for ${playerId}: ${offsetMs}ms`);
    return { success: true };
  } catch (error) {
    console.error(`[SyncPush] Config API push failed for ${playerId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Config save failed',
    };
  }
}

/**
 * Create the sync offset pusher instance
 */
export function createSyncOffsetPusher() {
  return {
    pushOffsets: pushSyncOffsets,
    pushSingleOffset: async (playerId: string, result: CalibrationResult) => {
      return pushSingleOffset(playerId, result, DEFAULT_OPTIONS);
    },
  };
}

export const syncOffsetPusher = createSyncOffsetPusher();
