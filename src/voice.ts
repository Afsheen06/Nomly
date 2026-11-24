/** Thin wrapper over the browser's Web Speech API (speech to text). */

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

const Ctor: SpeechRecognitionCtor | undefined =
  (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ||
  (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition;

export const voiceSupported = Boolean(Ctor);

export interface VoiceHandlers {
  onText: (text: string, isFinal: boolean) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}

export function startListening(lang: string, h: VoiceHandlers): () => void {
  if (!Ctor) {
    h.onError("Voice input isn't supported in this browser. You can type instead.");
    h.onEnd();
    return () => {};
  }
  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (e) => {
    let text = "";
    let final = false;
    for (let i = 0; i < e.results.length; i++) {
      text += e.results[i][0].transcript;
      final = e.results[i].isFinal;
    }
    h.onText(text.trim(), final);
  };
  rec.onerror = (e) => {
    const msg =
      e.error === "not-allowed"
        ? "Microphone permission was denied."
        : e.error === "no-speech"
          ? "I didn't hear anything. Try again."
          : e.error === "network"
            ? "Voice needs an internet connection on this device."
            : `Voice input error: ${e.error}`;
    h.onError(msg);
  };
  rec.onend = h.onEnd;
  rec.start();
  return () => rec.stop();
}
