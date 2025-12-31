/**
 * Click Track Generator
 * Generates a calibration click track with rotating frequencies for accurate detection
 */

export interface ClickTrackConfig {
  sampleRate: number;       // Audio sample rate (default: 48000)
  totalDuration: number;    // Total duration in seconds (default: 20)
  clickDuration: number;    // Duration of each click in ms (default: 5)
  clickInterval: number;    // Time between clicks in ms (default: 1000)
  frequencies: number[];    // Click frequencies to rotate through
  amplitude: number;        // Click amplitude 0-1 (default: 0.8)
}

export const DEFAULT_CLICK_TRACK_CONFIG: ClickTrackConfig = {
  sampleRate: 48000,
  totalDuration: 20,
  clickDuration: 5,
  clickInterval: 1000,
  frequencies: [1000, 2000, 4000, 8000], // Rotating octaves
  amplitude: 0.8,
};

export class ClickTrackGenerator {
  private config: ClickTrackConfig;

  constructor(config: Partial<ClickTrackConfig> = {}) {
    this.config = { ...DEFAULT_CLICK_TRACK_CONFIG, ...config };
  }

  /**
   * Generate an AudioBuffer containing the click track
   */
  generateAudioBuffer(audioContext: AudioContext): AudioBuffer {
    const { sampleRate, totalDuration, clickDuration, clickInterval, frequencies, amplitude } = this.config;

    const totalSamples = sampleRate * totalDuration;
    const buffer = audioContext.createBuffer(2, totalSamples, sampleRate);

    const leftChannel = buffer.getChannelData(0);
    const rightChannel = buffer.getChannelData(1);

    const clickSamples = Math.floor((clickDuration / 1000) * sampleRate);
    const intervalSamples = Math.floor((clickInterval / 1000) * sampleRate);
    const numClicks = Math.floor(totalDuration * 1000 / clickInterval);

    console.log(`[ClickTrack] Generating ${numClicks} clicks, ${clickSamples} samples each`);

    for (let clickIndex = 0; clickIndex < numClicks; clickIndex++) {
      const startSample = clickIndex * intervalSamples;
      const frequency = frequencies[clickIndex % frequencies.length];

      this.generateClick(leftChannel, rightChannel, startSample, clickSamples, frequency, amplitude, sampleRate);
    }

    return buffer;
  }

  /**
   * Generate a single click with Hann window envelope
   */
  private generateClick(
    leftChannel: Float32Array,
    rightChannel: Float32Array,
    startSample: number,
    numSamples: number,
    frequency: number,
    amplitude: number,
    sampleRate: number
  ): void {
    for (let i = 0; i < numSamples; i++) {
      const sampleIndex = startSample + i;
      if (sampleIndex >= leftChannel.length) break;

      // Hann window envelope for clean onset/offset
      const envelope = 0.5 * (1 - Math.cos((2 * Math.PI * i) / numSamples));

      // Sine wave at the specified frequency
      const sample = amplitude * envelope * Math.sin((2 * Math.PI * frequency * i) / sampleRate);

      leftChannel[sampleIndex] = sample;
      rightChannel[sampleIndex] = sample;
    }
  }

  /**
   * Generate a reference click for cross-correlation
   */
  generateReferenceClick(frequency: number): Float32Array {
    const { sampleRate, clickDuration, amplitude } = this.config;
    const clickSamples = Math.floor((clickDuration / 1000) * sampleRate);
    const samples = new Float32Array(clickSamples);

    for (let i = 0; i < clickSamples; i++) {
      const envelope = 0.5 * (1 - Math.cos((2 * Math.PI * i) / clickSamples));
      samples[i] = amplitude * envelope * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
    }

    return samples;
  }

  /**
   * Get expected click timestamps in milliseconds
   */
  getClickTimestamps(): { time: number; frequency: number }[] {
    const { totalDuration, clickInterval, frequencies } = this.config;
    const numClicks = Math.floor(totalDuration * 1000 / clickInterval);
    const timestamps: { time: number; frequency: number }[] = [];

    for (let i = 0; i < numClicks; i++) {
      timestamps.push({
        time: i * clickInterval,
        frequency: frequencies[i % frequencies.length],
      });
    }

    return timestamps;
  }

  /**
   * Play the click track through the given AudioContext
   */
  async play(audioContext: AudioContext): Promise<AudioBufferSourceNode> {
    const buffer = this.generateAudioBuffer(audioContext);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start();
    return source;
  }

  /**
   * Generate WAV file as Blob
   */
  generateWavBlob(): Blob {
    const { sampleRate, totalDuration, clickDuration, clickInterval, frequencies, amplitude } = this.config;

    const totalSamples = sampleRate * totalDuration;
    const leftChannel = new Float32Array(totalSamples);
    const rightChannel = new Float32Array(totalSamples);

    const clickSamples = Math.floor((clickDuration / 1000) * sampleRate);
    const intervalSamples = Math.floor((clickInterval / 1000) * sampleRate);
    const numClicks = Math.floor(totalDuration * 1000 / clickInterval);

    for (let clickIndex = 0; clickIndex < numClicks; clickIndex++) {
      const startSample = clickIndex * intervalSamples;
      const frequency = frequencies[clickIndex % frequencies.length];
      this.generateClick(leftChannel, rightChannel, startSample, clickSamples, frequency, amplitude, sampleRate);
    }

    // Create WAV file
    const wavData = this.createWavFile(leftChannel, rightChannel, sampleRate);
    return new Blob([wavData], { type: 'audio/wav' });
  }

  /**
   * Create WAV file from audio data
   */
  private createWavFile(leftChannel: Float32Array, rightChannel: Float32Array, sampleRate: number): ArrayBuffer {
    const numChannels = 2;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = leftChannel.length * blockAlign;
    const headerSize = 44;
    const fileSize = headerSize + dataSize;

    const buffer = new ArrayBuffer(fileSize);
    const view = new DataView(buffer);

    // RIFF header
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, fileSize - 8, true);
    this.writeString(view, 8, 'WAVE');

    // fmt chunk
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, 1, true); // audio format (PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    // data chunk
    this.writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Audio data (interleaved stereo)
    let offset = 44;
    for (let i = 0; i < leftChannel.length; i++) {
      // Clamp and convert to 16-bit integer
      const leftSample = Math.max(-1, Math.min(1, leftChannel[i]));
      const rightSample = Math.max(-1, Math.min(1, rightChannel[i]));

      view.setInt16(offset, leftSample * 0x7fff, true);
      offset += 2;
      view.setInt16(offset, rightSample * 0x7fff, true);
      offset += 2;
    }

    return buffer;
  }

  private writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  /**
   * Get configuration
   */
  getConfig(): ClickTrackConfig {
    return { ...this.config };
  }
}

// Singleton instance with default config
export const clickTrackGenerator = new ClickTrackGenerator();
