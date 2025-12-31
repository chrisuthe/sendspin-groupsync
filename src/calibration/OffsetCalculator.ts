/**
 * Offset Calculator
 * Calculates precise time offset using cross-correlation
 */

export interface OffsetResult {
  offsetMs: number;
  confidence: number;
  correlationPeak: number;
}

export class OffsetCalculator {
  private sampleRate: number;

  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
  }

  /**
   * Calculate offset between expected and recorded click
   * Uses cross-correlation to find the precise time difference
   */
  calculateOffset(
    expectedClick: Float32Array,
    recordedAudio: Float32Array
  ): OffsetResult {
    // Perform cross-correlation
    const correlation = this.crossCorrelate(expectedClick, recordedAudio);

    // Find peak in correlation
    const { peakIndex, peakValue } = this.findPeak(correlation);

    // Calculate offset in samples (relative to center)
    const center = expectedClick.length;
    const offsetSamples = peakIndex - center;

    // Convert to milliseconds
    const offsetMs = (offsetSamples * 1000) / this.sampleRate;

    // Calculate confidence based on peak prominence
    const meanCorrelation = this.mean(correlation);
    const stdCorrelation = this.standardDeviation(correlation, meanCorrelation);
    const prominence = (peakValue - meanCorrelation) / stdCorrelation;
    const confidence = Math.min(1, Math.max(0, prominence / 10));

    return {
      offsetMs,
      confidence,
      correlationPeak: peakValue,
    };
  }

  /**
   * Calculate average offset from multiple detections
   */
  calculateAverageOffset(
    detections: Array<{ expectedTime: number; detectedTime: number }>
  ): { offsetMs: number; confidence: number; stdDev: number } {
    if (detections.length === 0) {
      return { offsetMs: 0, confidence: 0, stdDev: 0 };
    }

    // Calculate individual offsets
    const offsets = detections.map((d) => d.detectedTime - d.expectedTime);

    // Remove outliers (outside 2 standard deviations)
    const mean = this.mean(new Float32Array(offsets));
    const stdDev = this.standardDeviation(new Float32Array(offsets), mean);

    const filteredOffsets = offsets.filter(
      (offset) => Math.abs(offset - mean) <= 2 * stdDev
    );

    if (filteredOffsets.length === 0) {
      return { offsetMs: mean, confidence: 0.5, stdDev };
    }

    // Calculate final average
    const avgOffset = this.mean(new Float32Array(filteredOffsets));
    const finalStdDev = this.standardDeviation(new Float32Array(filteredOffsets), avgOffset);

    // Confidence based on consistency of detections
    const confidence = Math.min(1, Math.max(0, 1 - finalStdDev / 50));

    return {
      offsetMs: avgOffset,
      confidence,
      stdDev: finalStdDev,
    };
  }

  /**
   * Cross-correlate two signals
   * Returns correlation array where index 0 corresponds to maximum negative lag
   */
  private crossCorrelate(template: Float32Array, signal: Float32Array): Float32Array {
    const outputLength = template.length + signal.length - 1;
    const correlation = new Float32Array(outputLength);

    // Normalize template
    const templateNorm = this.normalize(template);

    // For each lag position
    for (let lag = 0; lag < outputLength; lag++) {
      let sum = 0;
      let count = 0;

      for (let i = 0; i < template.length; i++) {
        const signalIndex = lag - template.length + 1 + i;
        if (signalIndex >= 0 && signalIndex < signal.length) {
          sum += templateNorm[i] * signal[signalIndex];
          count++;
        }
      }

      correlation[lag] = count > 0 ? sum / count : 0;
    }

    return correlation;
  }

  /**
   * Find the peak in the correlation array
   */
  private findPeak(correlation: Float32Array): { peakIndex: number; peakValue: number } {
    let peakValue = -Infinity;
    let peakIndex = 0;

    for (let i = 0; i < correlation.length; i++) {
      if (correlation[i] > peakValue) {
        peakValue = correlation[i];
        peakIndex = i;
      }
    }

    // Refine peak using quadratic interpolation
    if (peakIndex > 0 && peakIndex < correlation.length - 1) {
      const y0 = correlation[peakIndex - 1];
      const y1 = correlation[peakIndex];
      const y2 = correlation[peakIndex + 1];

      const offset = (y0 - y2) / (2 * (y0 - 2 * y1 + y2));
      if (Math.abs(offset) < 1) {
        return {
          peakIndex: peakIndex + offset,
          peakValue: y1 - 0.25 * (y0 - y2) * offset,
        };
      }
    }

    return { peakIndex, peakValue };
  }

  /**
   * Normalize an array to zero mean and unit variance
   */
  private normalize(arr: Float32Array): Float32Array {
    const mean = this.mean(arr);
    const std = this.standardDeviation(arr, mean);

    const normalized = new Float32Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      normalized[i] = std > 0 ? (arr[i] - mean) / std : 0;
    }

    return normalized;
  }

  /**
   * Calculate mean of an array
   */
  private mean(arr: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      sum += arr[i];
    }
    return sum / arr.length;
  }

  /**
   * Calculate standard deviation
   */
  private standardDeviation(arr: Float32Array, mean: number): number {
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      const diff = arr[i] - mean;
      sum += diff * diff;
    }
    return Math.sqrt(sum / arr.length);
  }
}

// Singleton instance
export const offsetCalculator = new OffsetCalculator();
