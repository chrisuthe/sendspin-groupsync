/**
 * Audio Detector
 * Captures microphone audio and detects click onsets
 */

import type { ClickDetection } from '../types';

export interface AudioDetectorConfig {
  sampleRate: number;
  fftSize: number;
  onsetThreshold: number;       // RMS threshold for onset detection
  frequencyTolerance: number;   // Hz tolerance for frequency matching
  minClickGap: number;          // Minimum ms between valid clicks
  expectedFrequencies: number[]; // Frequencies to look for
}

export const DEFAULT_AUDIO_DETECTOR_CONFIG: AudioDetectorConfig = {
  sampleRate: 48000,
  fftSize: 2048,
  onsetThreshold: 0.01,         // Lowered for better sensitivity
  frequencyTolerance: 100,      // Wider tolerance for frequency matching
  minClickGap: 500,
  // Frequencies optimized for smartphone mic sensitivity
  // Sweet spots: 220, 500, 1000, 2500, 3500 Hz
  // Avoid 4k+ where mics and speakers both struggle
  expectedFrequencies: [500, 1000, 2000, 3000],
};

type DetectionCallback = (detection: ClickDetection) => void;

export class AudioDetector {
  private config: AudioDetectorConfig;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private isListening = false;
  private detectionCallback: DetectionCallback | null = null;
  private lastDetectionTime = 0;
  private noiseFloor = 0;
  private startTime = 0;

  // Ring buffer for recent audio samples
  private ringBuffer: Float32Array;
  private ringBufferIndex = 0;
  private readonly ringBufferSize = 48000 * 2; // 2 seconds of audio

  constructor(config: Partial<AudioDetectorConfig> = {}) {
    this.config = { ...DEFAULT_AUDIO_DETECTOR_CONFIG, ...config };
    this.ringBuffer = new Float32Array(this.ringBufferSize);
  }

  /**
   * Request microphone permission and initialize audio context
   */
  async initialize(): Promise<void> {
    try {
      // Request microphone access with optimal settings
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: this.config.sampleRate,
        },
      });

      this.audioContext = new AudioContext({ sampleRate: this.config.sampleRate });

      console.log('[AudioDetector] Initialized with sample rate:', this.audioContext.sampleRate);
    } catch (error) {
      console.error('[AudioDetector] Failed to initialize:', error);
      throw new Error('Microphone access denied');
    }
  }

  /**
   * Start listening for clicks
   */
  startListening(callback: DetectionCallback): void {
    if (!this.audioContext || !this.mediaStream) {
      throw new Error('AudioDetector not initialized');
    }

    this.detectionCallback = callback;
    this.isListening = true;
    this.startTime = performance.now();
    this.lastDetectionTime = 0;

    // Create audio nodes
    const source = this.audioContext.createMediaStreamSource(this.mediaStream);

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = this.config.fftSize;
    this.analyser.smoothingTimeConstant = 0;

    // Use ScriptProcessor for sample access (deprecated but widely supported)
    // Note: AudioWorklet would be better for production
    this.scriptProcessor = this.audioContext.createScriptProcessor(2048, 1, 1);

    source.connect(this.analyser);
    this.analyser.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.audioContext.destination);

    // Capture noise floor during first second
    this.captureNoiseFloor();

    this.scriptProcessor.onaudioprocess = (event) => {
      if (!this.isListening) return;

      const inputBuffer = event.inputBuffer.getChannelData(0);
      this.processAudioChunk(inputBuffer);
    };

    console.log('[AudioDetector] Started listening');
  }

  /**
   * Stop listening
   */
  stopListening(): void {
    this.isListening = false;

    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }

    console.log('[AudioDetector] Stopped listening');
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stopListening();

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  /**
   * Get current RMS level (for visualization)
   */
  getCurrentLevel(): number {
    if (!this.analyser) return 0;

    const dataArray = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(dataArray);

    return this.computeRMS(dataArray);
  }

  /**
   * Get frequency data (for visualization)
   */
  getFrequencyData(): Uint8Array {
    if (!this.analyser) return new Uint8Array(0);

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);
    return dataArray;
  }

  // ==================== Private Methods ====================

  private captureNoiseFloor(): void {
    // Capture noise floor after 500ms
    setTimeout(() => {
      if (this.analyser) {
        const dataArray = new Float32Array(this.analyser.fftSize);
        this.analyser.getFloatTimeDomainData(dataArray);
        this.noiseFloor = this.computeRMS(dataArray);
        console.log('[AudioDetector] Noise floor:', this.noiseFloor.toFixed(4));
      }
    }, 500);
  }

  private debugLogCounter = 0;

  private processAudioChunk(samples: Float32Array): void {
    // Add to ring buffer
    for (let i = 0; i < samples.length; i++) {
      this.ringBuffer[this.ringBufferIndex] = samples[i];
      this.ringBufferIndex = (this.ringBufferIndex + 1) % this.ringBufferSize;
    }

    // Compute RMS energy
    const rms = this.computeRMS(samples);

    // Check for onset (energy significantly above noise floor)
    const threshold = Math.max(this.config.onsetThreshold, this.noiseFloor * 3);

    // Debug logging every ~1 second (48000 samples / 2048 buffer = ~23 chunks/sec)
    this.debugLogCounter++;
    if (this.debugLogCounter % 23 === 0) {
      const frequency = this.detectDominantFrequency();
      console.log(`[AudioDetector] Level: ${rms.toFixed(4)}, threshold: ${threshold.toFixed(4)}, freq: ${frequency?.toFixed(0) ?? 'none'}Hz`);
    }

    if (rms > threshold) {
      const now = performance.now();
      const elapsed = now - this.startTime;

      // Enforce minimum gap between detections
      if (elapsed - this.lastDetectionTime < this.config.minClickGap) {
        return;
      }

      // Verify frequency
      const frequency = this.detectDominantFrequency();
      console.log(`[AudioDetector] Onset detected! RMS: ${rms.toFixed(4)}, freq: ${frequency?.toFixed(0)}Hz, expected: ${this.config.expectedFrequencies}`);

      if (frequency && this.isExpectedFrequency(frequency)) {
        this.lastDetectionTime = elapsed;

        const detection: ClickDetection = {
          timestamp: elapsed,
          frequency,
          confidence: Math.min(1, rms / threshold),
          sampleOffset: 0, // Will be calculated by OffsetCalculator
        };

        console.log('[AudioDetector] Click detected:', detection);
        this.detectionCallback?.(detection);
      } else {
        console.log(`[AudioDetector] Frequency ${frequency?.toFixed(0)}Hz not in expected list, ignoring`);
      }
    }
  }

  private computeRMS(samples: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
  }

  private detectDominantFrequency(): number | null {
    if (!this.analyser) return null;

    const frequencyData = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(frequencyData);

    // Find peak in frequency spectrum
    let maxValue = -Infinity;
    let maxIndex = 0;

    for (let i = 0; i < frequencyData.length; i++) {
      if (frequencyData[i] > maxValue) {
        maxValue = frequencyData[i];
        maxIndex = i;
      }
    }

    // Convert bin index to frequency
    const nyquist = this.config.sampleRate / 2;
    const binWidth = nyquist / this.analyser.frequencyBinCount;
    const frequency = maxIndex * binWidth;

    return frequency;
  }

  private isExpectedFrequency(frequency: number): boolean {
    const { expectedFrequencies, frequencyTolerance } = this.config;

    for (const expected of expectedFrequencies) {
      if (Math.abs(frequency - expected) <= frequencyTolerance) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get recent audio samples for cross-correlation
   */
  getRecentSamples(durationMs: number): Float32Array {
    const numSamples = Math.floor((durationMs / 1000) * this.config.sampleRate);
    const samples = new Float32Array(numSamples);

    let readIndex = (this.ringBufferIndex - numSamples + this.ringBufferSize) % this.ringBufferSize;

    for (let i = 0; i < numSamples; i++) {
      samples[i] = this.ringBuffer[readIndex];
      readIndex = (readIndex + 1) % this.ringBufferSize;
    }

    return samples;
  }
}

// Factory function
export function createAudioDetector(config?: Partial<AudioDetectorConfig>): AudioDetector {
  return new AudioDetector(config);
}
