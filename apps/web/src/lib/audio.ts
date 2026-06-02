// Tiny browser audio notification service.
//
// Plays a short, gentle two-tone beep using the Web Audio API. The AudioContext
// is lazily created on first use because browsers block contexts created
// before a user gesture. A `localStorage` flag lets the user mute notifications
// without round-tripping to the server.

const STORAGE_KEY = "csb_audio_enabled";

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

export function isAudioEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true;
    return raw === "true";
  } catch {
    return true;
  }
}

export function setAudioEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    /* private mode / storage full — ignore */
  }
}

export function playNotification(): void {
  if (!isAudioEnabled()) return;
  const audio = getCtx();
  if (!audio) return;

  // Some browsers leave the context suspended until a user gesture; resume best-effort.
  if (audio.state === "suspended") {
    void audio.resume().catch(() => undefined);
  }

  const now = audio.currentTime;
  beep(audio, 880, now, 0.08);
  beep(audio, 1320, now + 0.09, 0.08);
}

function beep(audio: AudioContext, freq: number, startAt: number, durationSec: number): void {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, startAt);

  // Quick attack + fade so the tone is gentle and short.
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(0.05, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSec);

  osc.connect(gain).connect(audio.destination);
  osc.start(startAt);
  osc.stop(startAt + durationSec + 0.02);
}
