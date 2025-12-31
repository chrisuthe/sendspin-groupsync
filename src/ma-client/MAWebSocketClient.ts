/**
 * Music Assistant WebSocket Client
 * Connects to Music Assistant server to discover and control Sendspin players
 */

import type { MAMessage, Player } from '../types';

type MessageHandler = (message: MAMessage) => void;
type ConnectionHandler = () => void;
type ErrorHandler = (error: Event | Error) => void;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class MAWebSocketClient {
  private ws: WebSocket | null = null;
  private messageId = 0;
  private pendingRequests = new Map<number, PendingRequest>();
  private eventHandlers = new Map<string, Set<MessageHandler>>();
  private connectionHandlers: Set<ConnectionHandler> = new Set();
  private disconnectionHandlers: Set<ConnectionHandler> = new Set();
  private errorHandlers: Set<ErrorHandler> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private shouldReconnect = true;
  private serverUrl = '';

  /**
   * Connect to Music Assistant server
   */
  async connect(serverUrl: string): Promise<void> {
    this.serverUrl = serverUrl;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;

    return new Promise((resolve, reject) => {
      try {
        // Build WebSocket URL
        const wsUrl = this.buildWebSocketUrl(serverUrl);
        console.log('[MA] Connecting to:', wsUrl);

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('[MA] Connected');
          this.reconnectAttempts = 0;
          this.connectionHandlers.forEach((handler) => handler());
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = (error) => {
          console.error('[MA] WebSocket error:', error);
          this.errorHandlers.forEach((handler) => handler(error));
          reject(new Error('WebSocket connection failed'));
        };

        this.ws.onclose = () => {
          console.log('[MA] Disconnected');
          this.disconnectionHandlers.forEach((handler) => handler());
          this.attemptReconnect();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from server
   */
  disconnect(): void {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    // Reject all pending requests
    this.pendingRequests.forEach((request) => {
      clearTimeout(request.timeout);
      request.reject(new Error('Connection closed'));
    });
    this.pendingRequests.clear();
  }

  /**
   * Check if connected
   */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Send a command and wait for response
   */
  async sendCommand<T = unknown>(
    command: string,
    args: Record<string, unknown> = {},
    timeoutMs = 10000
  ): Promise<T> {
    if (!this.isConnected) {
      throw new Error('Not connected to server');
    }

    const messageId = ++this.messageId;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(messageId);
        reject(new Error(`Request timeout: ${command}`));
      }, timeoutMs);

      this.pendingRequests.set(messageId, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout,
      });

      const message: MAMessage = {
        message_id: messageId,
        command,
        args,
      };

      console.log('[MA] Sending:', command, args);
      this.ws!.send(JSON.stringify(message));
    });
  }

  /**
   * Subscribe to events
   */
  onEvent(eventType: string, handler: MessageHandler): () => void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    this.eventHandlers.get(eventType)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.eventHandlers.get(eventType)?.delete(handler);
    };
  }

  /**
   * Subscribe to connection events
   */
  onConnect(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    return () => this.connectionHandlers.delete(handler);
  }

  /**
   * Subscribe to disconnection events
   */
  onDisconnect(handler: ConnectionHandler): () => void {
    this.disconnectionHandlers.add(handler);
    return () => this.disconnectionHandlers.delete(handler);
  }

  /**
   * Subscribe to error events
   */
  onError(handler: ErrorHandler): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  // ==================== Player API ====================

  /**
   * Get all players
   */
  async getAllPlayers(): Promise<Player[]> {
    const result = await this.sendCommand<Player[]>('players/all');
    return result;
  }

  /**
   * Get a specific player
   */
  async getPlayer(playerId: string): Promise<Player> {
    const result = await this.sendCommand<Player>('players/get', {
      player_id: playerId,
    });
    return result;
  }

  /**
   * Send player command
   */
  async playerCommand(
    playerId: string,
    command: string,
    args: Record<string, unknown> = {}
  ): Promise<void> {
    await this.sendCommand(`players/cmd/${command}`, {
      player_id: playerId,
      ...args,
    });
  }

  /**
   * Play media on a player
   */
  async playMedia(
    playerId: string,
    mediaUri: string,
    mediaType = 'track'
  ): Promise<void> {
    await this.sendCommand('player_queues/play_media', {
      queue_id: playerId,
      media: {
        uri: mediaUri,
        media_type: mediaType,
        name: 'GroupSync Calibration',
      },
    });
  }

  /**
   * Save player configuration
   */
  async savePlayerConfig(
    playerId: string,
    values: Record<string, unknown>
  ): Promise<void> {
    await this.sendCommand('config/players/save', {
      player_id: playerId,
      values,
    });
  }

  // ==================== Private Methods ====================

  private buildWebSocketUrl(serverUrl: string): string {
    // Remove trailing slash
    let url = serverUrl.replace(/\/$/, '');

    // Add protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `http://${url}`;
    }

    // Parse URL
    const parsed = new URL(url);

    // Build WebSocket URL
    const wsProtocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${parsed.host}/ws`;
  }

  private handleMessage(data: string): void {
    try {
      const message: MAMessage = JSON.parse(data);

      // Handle response to pending request
      if (message.message_id && this.pendingRequests.has(message.message_id)) {
        const request = this.pendingRequests.get(message.message_id)!;
        clearTimeout(request.timeout);
        this.pendingRequests.delete(message.message_id);

        if (message.error) {
          request.reject(new Error(message.error.message));
        } else {
          request.resolve(message.result);
        }
        return;
      }

      // Handle event
      if (message.event) {
        console.log('[MA] Event:', message.event, message.data);
        const handlers = this.eventHandlers.get(message.event);
        if (handlers) {
          handlers.forEach((handler) => handler(message));
        }
        // Also notify wildcard handlers
        const wildcardHandlers = this.eventHandlers.get('*');
        if (wildcardHandlers) {
          wildcardHandlers.forEach((handler) => handler(message));
        }
      }
    } catch (error) {
      console.error('[MA] Failed to parse message:', error);
    }
  }

  private attemptReconnect(): void {
    if (!this.shouldReconnect) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[MA] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`[MA] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      if (this.shouldReconnect && this.serverUrl) {
        this.connect(this.serverUrl).catch((error) => {
          console.error('[MA] Reconnect failed:', error);
        });
      }
    }, delay);
  }
}

// Singleton instance
export const maClient = new MAWebSocketClient();
