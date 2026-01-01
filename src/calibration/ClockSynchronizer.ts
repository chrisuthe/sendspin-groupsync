/**
 * Clock Synchronizer
 *
 * Implements NTP-style clock synchronization with a Kalman filter.
 * Used to synchronize GroupSync's clock with the Sendspin server
 * for accurate calibration measurements.
 *
 * Based on KalmanClockSynchronizer from windowsSpin and SendspinTimeFilter from SpinDroid.
 */

export interface ClockSyncStatus {
  offsetMicroseconds: number;
  driftMicrosecondsPerSecond: number;
  offsetUncertaintyMicroseconds: number;
  measurementCount: number;
  isConverged: boolean;
}

export interface TimeSyncMeasurement {
  t1: number;  // Client transmit time (microseconds)
  t2: number;  // Server receive time (microseconds)
  t3: number;  // Server transmit time (microseconds)
  t4: number;  // Client receive time (microseconds)
}

/**
 * High-precision clock synchronizer using a 2D Kalman filter.
 * Tracks both clock offset and drift rate for accurate audio synchronization.
 *
 * The Kalman filter state vector is [offset, drift]:
 * - offset: difference between server and client clocks (server_time = client_time + offset)
 * - drift: rate of change of offset (microseconds per second)
 */
export class ClockSynchronizer {
  // Kalman filter state
  private offset = 0;           // Estimated offset in microseconds
  private drift = 0;            // Estimated drift in microseconds per second
  private offsetVariance: number;   // Uncertainty in offset estimate
  private driftVariance: number;    // Uncertainty in drift estimate
  private covariance = 0;       // Cross-covariance between offset and drift

  // Timing
  private lastUpdateTime = 0;   // Last measurement time in microseconds
  private measurementCount = 0;

  // Configuration
  private readonly processNoiseOffset: number;  // How much offset can change per second
  private readonly processNoiseDrift: number;   // How much drift rate can change per second
  private readonly measurementNoise: number;    // Expected measurement noise (RTT variance)

  // Convergence thresholds
  private static readonly MIN_MEASUREMENTS = 3;
  private static readonly MAX_OFFSET_UNCERTAINTY = 2000; // 2ms uncertainty threshold

  // Performance timer offset (to convert performance.now() to microseconds)
  private readonly perfTimeOrigin: number;

  constructor(
    processNoiseOffset = 100.0,
    processNoiseDrift = 1.0,
    measurementNoise = 10000.0
  ) {
    this.processNoiseOffset = processNoiseOffset;
    this.processNoiseDrift = processNoiseDrift;
    this.measurementNoise = measurementNoise;

    // Initialize with high uncertainty
    this.offsetVariance = 1e12;  // Start with very high uncertainty (1 second)
    this.driftVariance = 1e6;    // 1000 μs/s uncertainty

    // Calculate performance timer origin in microseconds
    // This allows us to convert performance.now() to absolute microseconds
    this.perfTimeOrigin = Date.now() * 1000 - performance.now() * 1000;
  }

  /**
   * Get current client time in microseconds (high precision).
   * Uses performance.now() for sub-millisecond accuracy.
   */
  getCurrentTimeMicroseconds(): number {
    return Math.round(this.perfTimeOrigin + performance.now() * 1000);
  }

  /**
   * Get current clock offset in microseconds.
   * server_time = client_time + offset
   */
  get offsetMicros(): number {
    return this.offset;
  }

  /**
   * Get current clock offset in milliseconds.
   */
  get offsetMs(): number {
    return this.offset / 1000;
  }

  /**
   * Get offset uncertainty (standard deviation) in microseconds.
   */
  get offsetUncertainty(): number {
    return Math.sqrt(this.offsetVariance);
  }

  /**
   * Number of measurements processed.
   */
  get measurements(): number {
    return this.measurementCount;
  }

  /**
   * Whether the synchronizer has converged to a stable estimate.
   */
  get isConverged(): boolean {
    return (
      this.measurementCount >= ClockSynchronizer.MIN_MEASUREMENTS &&
      this.offsetUncertainty < ClockSynchronizer.MAX_OFFSET_UNCERTAINTY
    );
  }

  /**
   * Reset the synchronizer to initial state.
   */
  reset(): void {
    this.offset = 0;
    this.drift = 0;
    this.offsetVariance = 1e12;
    this.driftVariance = 1e6;
    this.covariance = 0;
    this.lastUpdateTime = 0;
    this.measurementCount = 0;

    console.log('[ClockSync] Reset');
  }

  /**
   * Process a complete time exchange measurement.
   *
   * @param t1 Client transmit time (T1) in microseconds
   * @param t2 Server receive time (T2) in microseconds
   * @param t3 Server transmit time (T3) in microseconds
   * @param t4 Client receive time (T4) in microseconds
   */
  processMeasurement(t1: number, t2: number, t3: number, t4: number): void {
    // Calculate offset using NTP formula
    // offset = ((T2 - T1) + (T3 - T4)) / 2
    const measuredOffset = ((t2 - t1) + (t3 - t4)) / 2;

    // Round-trip time for quality assessment
    // RTT = (T4 - T1) - (T3 - T2)
    const rtt = (t4 - t1) - (t3 - t2);

    // First measurement: initialize state
    if (this.measurementCount === 0) {
      this.offset = measuredOffset;
      this.lastUpdateTime = t4;
      this.measurementCount = 1;

      console.log(
        `[ClockSync] Initial sync: offset=${measuredOffset.toFixed(0)}μs, RTT=${rtt.toFixed(0)}μs`
      );
      return;
    }

    // Calculate time delta since last update (in seconds)
    const dt = (t4 - this.lastUpdateTime) / 1_000_000;
    if (dt <= 0) {
      console.warn('[ClockSync] Non-positive time delta, skipping measurement');
      return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // KALMAN FILTER PREDICT STEP
    // ═══════════════════════════════════════════════════════════════════
    const predictedOffset = this.offset + this.drift * dt;
    const predictedDrift = this.drift;

    // Predict covariance: P = F * P * F' + Q
    const p00 = this.offsetVariance + 2 * this.covariance * dt +
                this.driftVariance * dt * dt + this.processNoiseOffset * dt;
    const p01 = this.covariance + this.driftVariance * dt;
    const p11 = this.driftVariance + this.processNoiseDrift * dt;

    // ═══════════════════════════════════════════════════════════════════
    // KALMAN FILTER UPDATE STEP
    // ═══════════════════════════════════════════════════════════════════

    // Adaptive measurement noise based on RTT
    const adaptiveMeasurementNoise = this.measurementNoise + (rtt * rtt) / 4;

    // Innovation (measurement residual)
    const innovation = measuredOffset - predictedOffset;

    // Innovation covariance
    const innovationVariance = p00 + adaptiveMeasurementNoise;

    // Kalman gain
    const k0 = p00 / innovationVariance;  // Gain for offset
    const k1 = p01 / innovationVariance;  // Gain for drift

    // Update state estimate
    this.offset = predictedOffset + k0 * innovation;
    this.drift = predictedDrift + k1 * innovation;

    // Update covariance
    this.offsetVariance = (1 - k0) * p00;
    this.covariance = (1 - k0) * p01;
    this.driftVariance = p11 - k1 * p01;

    // Ensure covariance stays positive
    if (this.offsetVariance < 0) this.offsetVariance = 1;
    if (this.driftVariance < 0) this.driftVariance = 0.01;

    this.lastUpdateTime = t4;
    this.measurementCount++;

    // Log progress
    if (this.measurementCount <= 10 || this.measurementCount % 10 === 0) {
      console.log(
        `[ClockSync] #${this.measurementCount}: offset=${this.offset.toFixed(0)}μs ` +
        `(±${this.offsetUncertainty.toFixed(0)}), drift=${this.drift.toFixed(2)}μs/s, ` +
        `RTT=${rtt.toFixed(0)}μs`
      );
    }
  }

  /**
   * Convert client timestamp to server time.
   */
  clientToServerTime(clientTimeMicros: number): number {
    if (this.lastUpdateTime > 0) {
      const elapsedSeconds = (clientTimeMicros - this.lastUpdateTime) / 1_000_000;
      const currentOffset = this.offset + this.drift * elapsedSeconds;
      return clientTimeMicros + currentOffset;
    }
    return clientTimeMicros + this.offset;
  }

  /**
   * Convert server timestamp to client time.
   */
  serverToClientTime(serverTimeMicros: number): number {
    if (this.lastUpdateTime > 0) {
      const approxClientTime = serverTimeMicros - this.offset;
      const elapsedSeconds = (approxClientTime - this.lastUpdateTime) / 1_000_000;
      const currentOffset = this.offset + this.drift * elapsedSeconds;
      return serverTimeMicros - currentOffset;
    }
    return serverTimeMicros - this.offset;
  }

  /**
   * Get synchronization status for diagnostics.
   */
  getStatus(): ClockSyncStatus {
    return {
      offsetMicroseconds: this.offset,
      driftMicrosecondsPerSecond: this.drift,
      offsetUncertaintyMicroseconds: this.offsetUncertainty,
      measurementCount: this.measurementCount,
      isConverged: this.isConverged,
    };
  }
}

// Singleton instance
export const clockSynchronizer = new ClockSynchronizer();
