/** PCM16 mono WAV, accepted by the server ASR adapter without codec guessing. */
export function pcm16Wav(samples: Float32Array, sampleRate = 16000): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer);
  const write = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  write(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); write(8, "WAVE");
  write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Number.isFinite(samples[i]) ? Math.max(-1, Math.min(1, samples[i]!)) : 0;
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return buffer;
}

export async function recordingToWav(blob: Blob): Promise<Blob> {
  const context = new AudioContext({ sampleRate: 16000 });
  try {
    // decodeAudioData resamples to this context's sample rate.
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (!decoded.length || decoded.duration > 62) throw new Error("录音长度无效，请重新录制。");
    const mono = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const data = decoded.getChannelData(channel);
      for (let i = 0; i < mono.length; i++) mono[i] += data[i]! / decoded.numberOfChannels;
    }
    return new Blob([pcm16Wav(mono, decoded.sampleRate)], { type: "audio/wav" });
  } finally { await context.close(); }
}

export function spokenText(markdown: string, brief = false): string {
  const clean = markdown.replace(/```[\s\S]*?```/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s*[|].*[|]\s*$/gm, " ").replace(/^\s*(?:#{1,6}\s*|[-*>]\s*|\d+[.)]\s*)/gm, "")
    .replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
  // Keep synthesis bounded: one short acknowledgement, or at most a short paragraph.
  const limit = brief ? 110 : 480;
  let text = clean;
  if (brief) text = (clean.match(/[^。！？!?]+[。！？!?]?/g) || [clean]).slice(0, 2).join("");
  return text.length > limit ? `${text.slice(0, limit).replace(/[,，、;；：:]?\s*$/, "")}。其余内容可以查看文字。` : text;
}

/** Invalidating a task also invalidates late network, media and permission callbacks. */
export class VoiceEpoch {
  private value = 0;
  next() { return ++this.value; }
  current(token: number) { return token === this.value; }
}
