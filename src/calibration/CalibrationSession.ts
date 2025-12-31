/**
 * Calibration Session
 * Orchestrates the calibration process for a single speaker
 */

import { AudioDetector, createAudioDetector } from './AudioDetector';
import { ClickTrackGenerator, DEFAULT_CLICK_TRACK_CONFIG } from './ClickTrackGenerator';
import { OffsetCalculator } from './OffsetCalculator';
import type { ClickDetection, CalibrationResult, CalibrationConfig } from '../types';

export type CalibrationEventType =
  | 'started'
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
  private config: CalibrationConfig;

  private playerId: string;
  private playerName: string;
  private detections: ClickDetection[] = [];
  private expectedClicks: { time: number; frequency: number }[] = [];
  private eventCallback: CalibrationEventCallback | null = null;
  private isRunning = false;

  constructor(playerId: string, playerName: string, config?: Partial<CalibrationConfig>) {
    this.playerId = playerId;
    this.playerName = playerName;
    this.config = { ...DEFAULT_CLICK_TRACK_CONFIG, ...config } as CalibrationConfig;

    this.clickTrackGenerator = new ClickTrackGenerator({
      sampleRate: this.config.sampleRate,
      frequencies: this.config.frequencies,
      clickDuration: 5,
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
      // Initialize audio detector
      this.audioDetector = createAudioDetector({
        sampleRate: this.config.sampleRate,
        expectedFrequencies: this.config.frequencies,
      });

      await this.audioDetector.initialize();

      this.emit({ type: 'started' });

      // Start listening for clicks
      this.audioDetector.startListening((detection) => {
        this.handleDetection(detection);
      });

      // Auto-stop after calibration duration
      const totalDurationMs = this.config.totalClicks * this.config.clickIntervalMs + 2000;
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

    for (const detection of this.detections) {
      // Find the closest expected click that hasn't been matched
      let bestMatch: { index: number; diff: number } | null = null;

      for (let i = 0; i < this.expectedClicks.length; i++) {
        if (usedExpected.has(i)) continue;

        const expected = this.expectedClicks[i];
        const diff = Math.abs(detection.timestamp - expected.time);

        // Only match if within reasonable range (±500ms)
        if (diff < 500 && (!bestMatch || diff < bestMatch.diff)) {
          bestMatch = { index: i, diff };
        }
      }

      if (bestMatch) {
        usedExpected.add(bestMatch.index);
        matched.push({
          expectedTime: this.expectedClicks[bestMatch.index].time,
          detectedTime: detection.timestamp,
        });
      }
    }

    return matched;
  }

  private emit(event: CalibrationEvent): void {
    this.eventCallback?.(event);
  }

  private cleanup(): void {
    this.isRunning = false;
    this.audioDetector?.dispose();
    this.audioDetector = null;
  }
}

/**
 * Create a new calibration session
 */
export function createCalibrationSession(
  playerId: string,
  playerName: string,
  config?: Partial<CalibrationConfig>
): CalibrationSession {
  return new CalibrationSession(playerId, playerName, config);
}
