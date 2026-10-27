/**
 * Конвертация записи MediaRecorder в WAV 16 кГц моно.
 *
 * MediaRecorder в Chrome/Firefox отдаёт webm/opus, который Gemini не принимает
 * как аудио. Декодируем через Web Audio API и пересобираем в PCM WAV —
 * его понимают и распознавание речи, и любые браузеры.
 */

type AudioContextCtor = typeof AudioContext;

function getAudioContext(): AudioContext {
  const ctor: AudioContextCtor =
    window.AudioContext || (window as unknown as { webkitAudioContext: AudioContextCtor }).webkitAudioContext;
  return new ctor();
}

function resample(channel: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return channel;

  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.round(channel.length / ratio));
  const output = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, channel.length - 1);
    const fraction = position - left;
    output[i] = channel[left] * (1 - fraction) + channel[right] * fraction;
  }

  return output;
}

function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunkSize)));
  }

  return btoa(binary);
}

/** Декодирует запись и возвращает base64 WAV 16 кГц моно. */
export async function blobToWavBase64(blob: Blob, targetRate = 16000): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const context = getAudioContext();

  try {
    const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0));

    // Микшируем все каналы в моно
    const mono = new Float32Array(audioBuffer.length);
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const data = audioBuffer.getChannelData(channel);
      for (let i = 0; i < data.length; i++) {
        mono[i] += data[i] / audioBuffer.numberOfChannels;
      }
    }

    const resampled = resample(mono, audioBuffer.sampleRate, targetRate);
    return bytesToBase64(encodeWav(resampled, targetRate));
  } finally {
    void context.close();
  }
}
