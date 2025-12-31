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
  partialResults?: unknown[];
}

interface ServerInfo {
  server_id: string;
  server_version: string;
  schema_version: number;
  min_supported_schema_version: number;
  needs_auth?: boolean;
}

interface AuthResult {
  access_token: string;
  user: {
    user_id: string;
    username: string;
  };
}

export class MAWebSocketClient {
  private ws: WebSocket | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private eventHandlers = new Map<string, Set<MessageHandler>>();
  private connectionHandlers: Set<ConnectionHandler> = new Set();
  private disconnectionHandlers: Set<ConnectionHandler> = new Set();
  private errorHandlers: Set<ErrorHandler> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private shouldReconnect = true;
  private serverUrl = '';
  private serverInfo: ServerInfo | null = null;
  private initialized = false;
  private authenticated = false;
  private accessToken: string | null = null;

  /**
   * Connect to Music Assistant server
   */
  async connect(serverUrl: string): Promise<void> {
    this.serverUrl = serverUrl;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    this.initialized = false;

    return new Promise((resolve, reject) => {
      try {
        // Build WebSocket URL
        const wsUrl = this.buildWebSocketUrl(serverUrl);
        console.log('[MA] Connecting to:', wsUrl);

        this.ws = new WebSocket(wsUrl);

        const connectionTimeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
          this.ws?.close();
        }, 10000);

        this.ws.onopen = () => {
          console.log('[MA] WebSocket connected, waiting for server info...');
        };

        this.ws.onmessage = (event) => {
          const data = event.data;

          // Check for server info (first message)
          if (!this.initialized) {
            try {
              const msg = JSON.parse(data);
              if (msg.server_id && msg.server_version) {
                this.serverInfo = msg as ServerInfo;
                this.initialized = true;
                console.log('[MA] Server info:', this.serverInfo);
                clearTimeout(connectionTimeout);
                this.reconnectAttempts = 0;
                this.connectionHandlers.forEach((handler) => handler());
                resolve();
                return;
              }
            } catch {
              // Not JSON or not server info, continue
            }
          }

          this.handleMessage(data);
        };

        this.ws.onerror = (error) => {
          console.error('[MA] WebSocket error:', error);
          this.errorHandlers.forEach((handler) => handler(error));
          if (!this.initialized) {
            clearTimeout(connectionTimeout);
            reject(new Error('WebSocket connection failed'));
          }
        };

        this.ws.onclose = () => {
          console.log('[MA] Disconnected');
          this.initialized = false;
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
    this.initialized = false;
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
    return this.ws?.readyState === WebSocket.OPEN && this.initialized;
  }

  /**
   * Check if authenticated
   */
  get isAuthenticated(): boolean {
    return this.authenticated;
  }

  /**
   * Check if authentication is required
   */
  get needsAuth(): boolean {
    return this.serverInfo?.needs_auth === true && !this.authenticated;
  }

  /**
   * Authenticate with username and password
   */
  async login(username: string, password: string): Promise<void> {
    const result = await this.sendCommand<AuthResult>('auth/login', {
      username,
      password,
      device_name: 'GroupSync',
    });

    this.accessToken = result.access_token;
    console.log('[MA] Got access token, authenticating session...');

    // Now authenticate the session with the token
    await this.sendCommand('auth', {
      token: this.accessToken,
      device_name: 'GroupSync',
    });

    this.authenticated = true;
    console.log('[MA] Authenticated as:', result.user.username);

    // Store token for reconnection
    try {
      localStorage.setItem('ma_access_token', this.accessToken);
    } catch {
      // localStorage not available
    }
  }

  /**
   * Authenticate with existing token
   */
  async authenticateWithToken(token?: string): Promise<boolean> {
    const tokenToUse = token || this.accessToken || this.getStoredToken();
    if (!tokenToUse) {
      return false;
    }

    try {
      await this.sendCommand('auth', {
        token: tokenToUse,
        device_name: 'GroupSync',
      });

      this.accessToken = tokenToUse;
      this.authenticated = true;
      console.log('[MA] Authenticated with token');
      return true;
    } catch (error) {
      console.log('[MA] Token authentication failed:', error);
      this.clearStoredToken();
      return false;
    }
  }

  /**
   * Get stored access token
   */
  private getStoredToken(): string | null {
    try {
      return localStorage.getItem('ma_access_token');
    } catch {
      return null;
    }
  }

  /**
   * Clear stored token
   */
  private clearStoredToken(): void {
    try {
      localStorage.removeItem('ma_access_token');
    } catch {
      // localStorage not available
    }
  }

  /**
   * Generate a UUID for message ID
   */
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
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

    const messageId = this.generateUUID();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(messageId);
        reject(new Error(`Request timeout: ${command}`));
      }, timeoutMs);

      this.pendingRequests.set(messageId, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout,
        partialResults: [],
      });

      const message = {
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
   * @param playerId - The player/queue ID to play on
   * @param mediaUri - The URI to play (URL or MA media reference)
   * @param option - Queue option: 'play' (default), 'replace', 'next', 'add', etc.
   */
  async playMedia(
    playerId: string,
    mediaUri: string,
    option: 'play' | 'replace' | 'next' | 'replace_next' | 'add' = 'play'
  ): Promise<void> {
    // Media can be a string URI or array of URIs
    // For external URLs, just pass the URL string directly
    await this.sendCommand('player_queues/play_media', {
      queue_id: playerId,
      media: mediaUri,
      option,
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
    // If current page is HTTPS, we MUST use WSS (browser security requirement)
    // Otherwise, use the protocol based on the server URL
    const isPageSecure = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const wsProtocol = isPageSecure || parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${parsed.host}/ws`;
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);
      console.log('[MA] Received:', message);

      // Handle response to pending request
      if (message.message_id && this.pendingRequests.has(message.message_id)) {
        const request = this.pendingRequests.get(message.message_id)!;

        // Check for error
        if (message.error_code !== undefined) {
          clearTimeout(request.timeout);
          this.pendingRequests.delete(message.message_id);
          request.reject(new Error(message.details || `Error: ${message.error_code}`));
          return;
        }

        // Handle partial results
        if (message.partial === true && message.result !== undefined) {
          request.partialResults = request.partialResults || [];
          if (Array.isArray(message.result)) {
            request.partialResults.push(...message.result);
          } else {
            request.partialResults.push(message.result);
          }
          return;
        }

        // Final result
        clearTimeout(request.timeout);
        this.pendingRequests.delete(message.message_id);

        // Combine partial results if any
        if (request.partialResults && request.partialResults.length > 0) {
          if (Array.isArray(message.result)) {
            request.resolve([...request.partialResults, ...message.result]);
          } else if (message.result !== undefined) {
            request.resolve([...request.partialResults, message.result]);
          } else {
            request.resolve(request.partialResults);
          }
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
