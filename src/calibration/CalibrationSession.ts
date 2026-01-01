/**
 * Calibration Session
 * Orchestrates the calibration process for a single speaker
 *
 * Uses NTP-style clock synchronization with the Sendspin server for
 * accurate timing measurements. This allows us to calculate speaker
 * offset with millisecond precision.
 */

import { AudioDetector, createAudioDetector } from './AudioDetector';
import { ClickTrackGenerator } from './ClickTrackGenerator';
import { OffsetCalculator } from './OffsetCalculator';
import { SendspinSyncClient, createSendspinSyncClient } from './SendspinSyncClient';
import type { ClickDetection, CalibrationResult, CalibrationConfig } from '../types';
import { DEFAULT_CALIBRATION_CONFIG } from '../types';
import { maClient } from '../ma-client';

export type CalibrationEventType =
  | 'started'
  | 'clock_syncing'
  | 'clock_synced'
  | 'playback_started'
  | 'click_detected'
  | 'progress'
  | 'completed'
  | 'error';

export interface CalibrationEvent {
  type: CalibrationEventType;
  data?: unknown;
}

type CalibrationEventCallback = (event: CalibrationEvent) => void;

export class CalibrationSession {
  private audioDetector: AudioDetector | null = null;
  private clickTrackGenerator: ClickTrackGenerator;
  private offsetCalculator: OffsetCalculator;
  private syncClient: SendspinSyncClient | null = null;
  private config: CalibrationConfig;

  private playerId: string;
  private playerName: string;
  private serverUrl: string;
  private detections: ClickDetection[] = [];
  private expectedClicks: { time: number; frequency: number }[] = [];
  private eventCallback: CalibrationEventCallback | null = null;
  private isRunning = false;

  // Audio playback
  private audioContext: AudioContext | null = null;
  private audioSource: AudioBufferSourceNode | null = null;

  // Clock sync - playback start time in server microseconds
  private playbackStartServerTime: number = 0;
  private useClockSync: boolean = true;

  constructor(
    playerId: string,
    playerName: string,
    serverUrl: string,
    config?: Partial<CalibrationConfig>
  ) {
    this.playerId = playerId;
    this.playerName = playerName;
    this.serverUrl = serverUrl;
    this.config = { ...DEFAULT_CALIBRATION_CONFIG, ...config };

    this.clickTrackGenerator = new ClickTrackGenerator({
      sampleRate: this.config.sampleRate,
      frequencies: this.config.frequencies,
      clickDuration: 50, // 50ms for reliable detection
      clickInterval: this.config.clickIntervalMs,
      totalDuration: this.config.totalClicks,
    });

    this.offsetCalculator = new OffsetCalculator(this.config.sampleRate);
    this.expectedClicks = this.clickTrackGenerator.getClickTimestamps();
  }

  /**
   * Start calibration session
   */
  async start(callback: CalibrationEventCallback): Promise<void> {
    if (this.isRunning) {
      throw new Error('Calibration already running');
    }

    this.eventCallback = callback;
    this.detections = [];
    this.isRunning = true;

    try {
      // Step 1: Connect to Sendspin for clock synchronization
      this.emit({ type: 'clock_syncing' });
      console.log('[CalibrationSession] Connecting to Sendspin for clock sync...');
      console.log('[CalibrationSession] Server URL:', this.serverUrl);

      this.syncClient = createSendspinSyncClient('GroupSync');

      try {
        await this.syncClient.connect(this.serverUrl);
        console.log('[CalibrationSession] Sendspin connection established');

        // Wait for clock sync to converge (up to 3 seconds)
        const synced = await this.syncClient.waitForSync(3000);

        if (synced) {
          const status = this.syncClient.clock.getStatus();
          console.log(
            `[CalibrationSession] Clock synced: offset=${status.offsetMicroseconds.toFixed(0)}μs ` +
            `(±${status.offsetUncertaintyMicroseconds.toFixed(0)}μs)`
          );
          this.useClockSync = true;
        } else {
          console.warn('[CalibrationSession] Clock sync did not converge, using fallback timing');
          this.useClockSync = false;

          // Emit non-converged status
          const clockStatus = this.syncClient.clock.getStatus();
          this.emit({
            type: 'clock_synced',
            data: {
              success: false,
              error: 'Clock sync did not converge in time',
              offsetMs: clockStatus.offsetMicroseconds / 1000,
              uncertaintyMs: clockStatus.offsetUncertaintyMicroseconds / 1000,
              measurements: clockStatus.measurementCount,
            },
          });
        }
      } catch (syncError) {
        const errorMsg = syncError instanceof Error ? syncError.message : String(syncError);
        console.warn('[CalibrationSession] Clock sync failed:', errorMsg);
        console.warn('[CalibrationSession] Using fallback timing (local clock only)');
        this.useClockSync = false;

        // Emit failure with error message
        this.emit({
          type: 'clock_synced',
          data: {
            success: false,
            error: errorMsg,
            offsetMs: null,
            uncertaintyMs: null,
            measurements: 0,
          },
        });
      }

      // Only emit success status here (failure is emitted in catch block)
      if (this.useClockSync) {
        const clockStatus = this.syncClient?.clock.getStatus();
        this.emit({
          type: 'clock_synced',
          data: {
            success: true,
            offsetMs: clockStatus ? clockStatus.offsetMicroseconds / 1000 : null,
            uncertaintyMs: clockStatus?.offsetUncertaintyMicroseconds
              ? clockStatus.offsetUncertaintyMicroseconds / 1000
              : null,
            measurements: clockStatus?.measurementCount ?? 0,
          },
        });
      }

      // Step 2: Initialize audio detector (microphone)
      this.audioDetector = createAudioDetector({
        sampleRate: this.config.sampleRate,
        expectedFrequencies: this.config.frequencies,
      });

      await this.audioDetector.initialize();

      // Create audio context for playback
      this.audioContext = new AudioContext({ sampleRate: this.config.sampleRate });

      this.emit({ type: 'started' });

      // Start listening for clicks via microphone
      this.audioDetector.startListening((detection) => {
        this.handleDetection(detection);
      });

      // Small delay to ensure mic is ready, then start playing click track
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Step 3: Play click track through Music Assistant
      console.log('[CalibrationSession] Starting click track playback via Music Assistant...');

      // Build the URL to the click track served by this app
      // NOTE: This URL must be accessible from the Music Assistant server!
      const clickTrackUrl = `${window.location.origin}/calibration-clicks.wav`;
      console.log('[CalibrationSession] Click track URL:', clickTrackUrl);

      let playbackMethod: 'music_assistant' | 'local' = 'music_assistant';

      // Record the server time when we start playback (for offset calculation)
      if (this.useClockSync && this.syncClient) {
        this.playbackStartServerTime = this.syncClient.clock.clientToServerTime(
          this.syncClient.clock.getCurrentTimeMicroseconds()
        );
        console.log(`[CalibrationSession] Playback start server time: ${this.playbackStartServerTime}μs`);
      }

      try {
        // Tell Music Assistant to play the click track on the selected player
        // 'replace' clears the queue and plays immediately
        await maClient.playMedia(this.playerId, clickTrackUrl, 'replace');
        console.log('[CalibrationSession] Click track command sent to', this.playerName);
      } catch (playError) {
        console.error('[CalibrationSession] Failed to play via MA, falling back to local playback:', playError);
        playbackMethod = 'local';

        // Fallback to local playback (phone speaker)
        const buffer = this.clickTrackGenerator.generateAudioBuffer(this.audioContext!);
        this.audioSource = this.audioContext!.createBufferSource();
        this.audioSource.buffer = buffer;
        this.audioSource.connect(this.audioContext!.destination);
        this.audioSource.start();

        console.log('[CalibrationSession] Fallback: Click track playing through phone speaker');
      }

      this.emit({
        type: 'playback_started',
        data: {
          method: playbackMethod,
          url: clickTrackUrl,
          clockSynced: this.useClockSync,
        },
      });

      // Auto-stop after calibration duration
      // Add extra buffer for MA playback startup latency
      const totalDurationMs = this.config.totalClicks * this.config.clickIntervalMs + 5000;
      setTimeout(() => {
        if (this.isRunning) {
          this.complete();
        }
      }, totalDurationMs);
    } catch (error) {
      this.emit({
        type: 'error',
        data: error instanceof Error ? error.message : 'Calibration failed',
      });
      this.cleanup();
      throw error;
    }
  }

  /**
   * Stop calibration early
   */
  stop(): void {
    if (this.isRunning) {
      this.cleanup();
    }
  }

  /**
   * Get current progress
   */
  getProgress(): { detected: number; total: number; percentage: number } {
    const total = this.config.totalClicks;
    const detected = this.detections.length;
    return {
      detected,
      total,
      percentage: Math.round((detected / total) * 100),
    };
  }

  /**
   * Get current audio level (for visualization)
   */
  getCurrentLevel(): number {
    return this.audioDetector?.getCurrentLevel() ?? 0;
  }

  /**
   * Get frequency data (for visualization)
   */
  getFrequencyData(): Uint8Array {
    return this.audioDetector?.getFrequencyData() ?? new Uint8Array(0);
  }

  // ==================== Private Methods ====================

  private handleDetection(detection: ClickDetection): void {
    this.detections.push(detection);

    this.emit({
      type: 'click_detected',
      data: detection,
    });

    this.emit({
      type: 'progress',
      data: this.getProgress(),
    });

    console.log(`[CalibrationSession] Detection ${this.detections.length}/${this.config.totalClicks}`);
  }

  private complete(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    this.audioDetector?.stopListening();

    // Match detections to expected clicks
    const matchedDetections = this.matchDetections();

    // Calculate average offset
    const { offsetMs, confidence, stdDev } = this.offsetCalculator.calculateAverageOffset(
      matchedDetections
    );

    const result: CalibrationResult = {
      playerId: this.playerId,
      playerName: this.playerName,
      offsetMs,
      confidence,
      detectedClicks: this.detections.length,
      totalClicks: this.config.totalClicks,
    };

    console.log('[CalibrationSession] Complete:', result, 'stdDev:', stdDev);

    this.emit({
      type: 'completed',
      data: result,
    });

    this.cleanup();
  }

  private matchDetections(): Array<{ expectedTime: number; detectedTime: number }> {
    const matched: Array<{ expectedTime: number; detectedTime: number }> = [];
    const usedExpected = new Set<number>();
    const frequencyTolerance = 150; // Hz tolerance for matching

    // First pass: estimate the overall offset from the first few detections
    // This handles the case where MA playback starts with some delay
    let estimatedOffset = 0;
    if (this.detections.length > 0) {
      // Find first detection that matches a frequency
      for (const detection of this.detections.slice(0, 5)) {
        for (const expected of this.expectedClicks) {
          if (Math.abs(detection.frequency - expected.frequency) <= frequencyTolerance) {
            // This detection likely corresponds to this expected click
            estimatedOffset = detection.timestamp - expected.time;
            console.log(`[CalibrationSession] Estimated playback offset: ${estimatedOffset.toFixed(0)}ms`);
            break;
          }
        }
        if (estimatedOffset !== 0) break;
      }
    }

    for (const detection of this.detections) {
      // Find the closest expected click that:
      // 1. Hasn't been matched yet
      // 2. Has matching frequency
      // 3. Is within reasonable time range (accounting for estimated offset)
      let bestMatch: { index: number; diff: number } | null = null;

      for (let i = 0; i < this.expectedClicks.length; i++) {
        if (usedExpected.has(i)) continue;

        const expected = this.expectedClicks[i];

        // Check frequency match first
        if (Math.abs(detection.frequency - expected.frequency) > frequencyTolerance) {
          continue;
        }

        // Calculate time difference, accounting for estimated playback offset
        const adjustedExpectedTime = expected.time + estimatedOffset;
        const diff = Math.abs(detection.timestamp - adjustedExpectedTime);

        // Only match if within reasonable range (±300ms after offset adjustment)
        if (diff < 300 && (!bestMatch || diff < bestMatch.diff)) {
          bestMatch = { index: i, diff };
        }
      }

      if (bestMatch) {
        usedExpected.add(bestMatch.index);
        matched.push({
          expectedTime: this.expectedClicks[bestMatch.index].time,
          detectedTime: detection.timestamp,
        });
        console.log(`[CalibrationSession] Matched detection at ${detection.timestamp.toFixed(0)}ms (${detection.frequency}Hz) to expected click #${bestMatch.index + 1} at ${this.expectedClicks[bestMatch.index].time}ms`);
      } else {
        console.log(`[CalibrationSession] No match for detection at ${detection.timestamp.toFixed(0)}ms (${detection.frequency}Hz)`);
      }
    }

    console.log(`[CalibrationSession] Matched ${matched.length} of ${this.detections.length} detections`);
    return matched;
  }

  private emit(event: CalibrationEvent): void {
    this.eventCallback?.(event);
  }

  private cleanup(): void {
    this.isRunning = false;

    // Stop audio playback
    try {
      this.audioSource?.stop();
    } catch {
      // Already stopped
    }
    this.audioSource = null;

    if (this.audioContext?.state !== 'closed') {
      this.audioContext?.close();
    }
    this.audioContext = null;

    // Stop microphone
    this.audioDetector?.dispose();
    this.audioDetector = null;

    // Disconnect clock sync client
    this.syncClient?.disconnect();
    this.syncClient = null;
  }
}

/**
 * Create a new calibration session
 */
export function createCalibrationSession(
  playerId: string,
  playerName: string,
  serverUrl: string,
  config?: Partial<CalibrationConfig>
): CalibrationSession {
  return new CalibrationSession(playerId, playerName, serverUrl, config);
}
