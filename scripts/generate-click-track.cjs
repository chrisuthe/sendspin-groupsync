/**
 * Generate click track WAV file for calibration
 * Run with: node scripts/generate-click-track.js
 */

const fs = require('fs');
const path = require('path');

const config = {
  sampleRate: 48000,
  totalDuration: 20,
  clickDuration: 50, // ms - longer for reliable detection (was 5ms)
  clickInterval: 1000, // ms
  // Frequencies optimized for smartphone mic sensitivity
  frequencies: [500, 1000, 2000, 3000],
  amplitude: 0.8,
};

function generateClickTrack() {
  const { sampleRate, totalDuration, clickDuration, clickInterval, frequencies, amplitude } = config;

  const totalSamples = sampleRate * totalDuration;
  const leftChannel = new Float32Array(totalSamples);
  const rightChannel = new Float32Array(totalSamples);

  const clickSamples = Math.floor((clickDuration / 1000) * sampleRate);
  const intervalSamples = Math.floor((clickInterval / 1000) * sampleRate);
  const numClicks = Math.floor(totalDuration * 1000 / clickInterval);

  console.log(`Generating ${numClicks} clicks, ${clickSamples} samples each`);

  for (let clickIndex = 0; clickIndex < numClicks; clickIndex++) {
    const startSample = clickIndex * intervalSamples;
    const frequency = frequencies[clickIndex % frequencies.length];

    for (let i = 0; i < clickSamples; i++) {
      const sampleIndex = startSample + i;
      if (sampleIndex >= totalSamples) break;

      // Hann window envelope
      const envelope = 0.5 * (1 - Math.cos((2 * Math.PI * i) / clickSamples));
      const sample = amplitude * envelope * Math.sin((2 * Math.PI * frequency * i) / sampleRate);

      leftChannel[sampleIndex] = sample;
      rightChannel[sampleIndex] = sample;
    }
  }

  return { leftChannel, rightChannel, sampleRate };
}

function createWavBuffer(leftChannel, rightChannel, sampleRate) {
  const numChannels = 2;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = leftChannel.length * blockAlign;
  const headerSize = 44;
  const fileSize = headerSize + dataSize;

  const buffer = Buffer.alloc(fileSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(fileSize - 8, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(1, 20); // audio format (PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Audio data (interleaved stereo)
  let offset = 44;
  for (let i = 0; i < leftChannel.length; i++) {
    const leftSample = Math.max(-1, Math.min(1, leftChannel[i]));
    const rightSample = Math.max(-1, Math.min(1, rightChannel[i]));

    buffer.writeInt16LE(Math.round(leftSample * 0x7fff), offset);
    offset += 2;
    buffer.writeInt16LE(Math.round(rightSample * 0x7fff), offset);
    offset += 2;
  }

  return buffer;
}

// Generate and save
const { leftChannel, rightChannel, sampleRate } = generateClickTrack();
const wavBuffer = createWavBuffer(leftChannel, rightChannel, sampleRate);

const outputPath = path.join(__dirname, '..', 'public', 'calibration-clicks.wav');
fs.writeFileSync(outputPath, wavBuffer);

console.log(`Generated: ${outputPath}`);
console.log(`Size: ${(wavBuffer.length / 1024 / 1024).toFixed(2)} MB`);
