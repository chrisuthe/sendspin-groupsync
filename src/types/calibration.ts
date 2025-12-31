/**
 * Calibration types for audio offset detection
 */

export type CalibrationPhase =
  | 'idle'
  | 'connecting'
  | 'selecting'
  | 'instructions'
  | 'listening'
  | 'calculating'
  | 'results';

export interface ClickDetection {
  timestamp: number;      // When click was detected (ms)
  frequency: number;      // Detected frequency (Hz)
  confidence: number;     // Detection confidence (0-1)
  sampleOffset: number;   // Sample offset from expected
}

export interface CalibrationResult {
  playerId: string;
  playerName: string;
  offsetMs: number;
  confidence: number;
  detectedClicks: number;
  totalClicks: number;
}

export interface CalibrationState {
  phase: CalibrationPhase;
  currentPlayer: string | null;
  detectedClicks: ClickDetection[];
  results: Map<string, CalibrationResult>;
  error: string | null;
}

export interface CalibrationConfig {
  clickIntervalMs: number;    // Time between clicks (default: 1000ms)
  totalClicks: number;        // Number of clicks in track (default: 20)
  frequencies: number[];      // Click frequencies (default: [1000, 2000, 4000, 8000])
  sampleRate: number;         // Audio sample rate (default: 48000)
}

export const DEFAULT_CALIBRATION_CONFIG: CalibrationConfig = {
  clickIntervalMs: 1000,
  totalClicks: 20,
  // Frequencies optimized for smartphone mic sensitivity (sweet spots: 500, 1k, 2k, 3k Hz)
  frequencies: [500, 1000, 2000, 3000],
  sampleRate: 48000,
};
