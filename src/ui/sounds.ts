/**
 * Micro-sounds synthesized with Web Audio — no assets, ~0 KB. Quiet and short
 * on purpose: they confirm an action without competing with the video audio.
 * Preference lives in localStorage ('kvl:sounds', default on).
 *
 * Every sound plays only after a user gesture: without prior page activation
 * the browser refuses to start an AudioContext and logs a warning (e.g. a
 * queued card auto-sending when Anki returns), so this returns early instead.
 */
type SoundName = 'shutter' | 'saved' | 'error';

let ctx: AudioContext | null = null;
const audio = () => {
  if (typeof window === 'undefined') return null;
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (activation && !activation.hasBeenActive) return null;
  try {
    // Older Safari only has the prefixed constructor.
    const AC = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
};

export const soundsEnabled = () => {
  try { return JSON.parse(localStorage.getItem('kvl:sounds') ?? 'true') !== false; } catch { return true; }
};

/** Filtered noise burst — the mechanical part of a camera shutter. */
function click(c: AudioContext, at: number, gain: number, freq: number) {
  const len = Math.floor(c.sampleRate * 0.035);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = c.createBufferSource(); src.buffer = buf;
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 0.9;
  const g = c.createGain(); g.gain.value = gain;
  src.connect(bp).connect(g).connect(c.destination);
  src.start(at);
}

function tone(c: AudioContext, at: number, freq: number, dur: number, gain: number, type: OscillatorType = 'sine') {
  const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(c.destination);
  o.start(at); o.stop(at + dur + 0.02);
}

export function playSound(name: SoundName) {
  if (!soundsEnabled()) return;
  const c = audio();
  if (!c) return;
  const t = c.currentTime + 0.01;
  if (name === 'shutter') {
    click(c, t, 0.5, 3200);         // curtain open
    click(c, t + 0.07, 0.35, 2200); // curtain close
  } else if (name === 'saved') {
    tone(c, t, 880, 0.18, 0.06);           // A5
    tone(c, t + 0.09, 1318.5, 0.32, 0.05); // E6 — soft rising "pling"
  } else {
    tone(c, t, 330, 0.16, 0.05, 'triangle');
    tone(c, t + 0.11, 247, 0.24, 0.05, 'triangle');
  }
}
