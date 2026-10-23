export interface VoiceConfigurationState {
  streamingTts?: boolean;
  configured: boolean;
  /** Available to try; a configured credential does not by itself prove authorization. */
  tts: boolean;
  asr: boolean;
  verified: { tts: boolean; asr: boolean };
  provider: "doubao-realtime";
  voice: string;
}
export interface VoiceConfigurationInput { apiKey?: string; voice?: string; clear?: boolean }
export interface VoiceTranscription { text: string }
