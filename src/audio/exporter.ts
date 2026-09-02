const CHANNELS = 2;
const SAMPLE_RATE = 44_100;
const BYTES_PER_SAMPLE = 2;
const WAV_HEADER_BYTES = 44;

const writeAscii = (view: DataView, offset: number, value: string): void => {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
};

const pcm16 = (sample: number): number => {
  const clamped = Math.max(-1, Math.min(1, sample));
  return Math.round(clamped * (clamped < 0 ? 32_768 : 32_767));
};

export function encodeWav(buffer: AudioBuffer): Blob {
  if (buffer.numberOfChannels !== CHANNELS || buffer.sampleRate !== SAMPLE_RATE) {
    throw new RangeError("WAV export requires a 44.1 kHz stereo audio buffer");
  }
  const dataBytes = buffer.length * CHANNELS * BYTES_PER_SAMPLE;
  const output = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(output);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, output.byteLength - 8, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE, true);
  view.setUint16(32, CHANNELS * BYTES_PER_SAMPLE, true);
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
  let offset = WAV_HEADER_BYTES;
  for (let frame = 0; frame < buffer.length; frame += 1) {
    for (const channel of channels) {
      view.setInt16(offset, pcm16(channel[frame] ?? 0), true);
      offset += BYTES_PER_SAMPLE;
    }
  }
  return new Blob([output], { type: "audio/wav" });
}

export function wavFileName(projectName: string): string {
  const safeName = projectName
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .replace(/^[-. ]+$/g, "");
  return `${safeName || "agentdaw"}.wav`;
}
