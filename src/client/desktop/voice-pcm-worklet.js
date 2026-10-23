/* AudioWorklet: mono 16 kHz PCM16, 20 ms frames. Never monitors the microphone to speakers. */
class OrbitVoicePCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Int16Array(320); this.offset = 0;
    this.ratio = sampleRate / 16000; this.weight = 0; this.sum = 0;
    this.energy = 0; this.voiced = 0; this.quiet = 0; this.speaking = false; this.paused = false;
    this.meterEnergy = 0; this.meterSamples = 0; this.meterElapsed = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length || !channels[0]?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += Number.isFinite(channel[i]) ? channel[i] / channels.length : 0;
      let remaining = 1;
      while (remaining > 1e-8) {
        const part = Math.min(remaining, this.ratio - this.weight);
        this.sum += value * part; this.weight += part; remaining -= part;
        if (this.weight >= this.ratio - 1e-8) {
          const sample = Math.max(-1, Math.min(1, this.sum / this.ratio));
          this.frame[this.offset++] = Math.round(sample * (sample < 0 ? 32768 : 32767));
          this.energy += sample * sample;
          this.sum = 0; this.weight = 0;
          if (this.offset === 320) {
            this.meterEnergy += this.energy; this.meterSamples += 320; this.meterElapsed += 20;
            if (this.meterElapsed >= 50) {
              this.port.postMessage({ type: "level", rms: Math.sqrt(this.meterEnergy / this.meterSamples) });
              this.meterEnergy = 0; this.meterSamples = 0; this.meterElapsed -= 50;
            }
            // Local VAD is presentation-only; provider ASR remains the sole source of submitted text.
            if (Math.sqrt(this.energy / 320) >= 0.015) { this.voiced++; this.quiet = 0; }
            else { this.voiced = 0; this.quiet++; }
            if (!this.speaking && this.voiced >= 3) { this.speaking = true; this.paused = false; this.port.postMessage({ type: "speech_start" }); }
            else if (this.speaking && this.paused && this.voiced >= 3) { this.paused = false; this.port.postMessage({ type: "speech_resume" }); }
            if (this.speaking && !this.paused && this.quiet >= 20) { this.paused = true; this.port.postMessage({ type: "speech_pause" }); }
            if (this.speaking && this.quiet >= 40) { this.speaking = false; this.port.postMessage({ type: "speech_end" }); }
            this.energy = 0;
            this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
            this.frame = new Int16Array(320); this.offset = 0;
          }
        }
      }
    }
    return true;
  }
}
registerProcessor("orbit-voice-pcm", OrbitVoicePCM);
