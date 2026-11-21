/**
 * RED TESTS — round 10: pronunciation playback robustness.
 *
 * The URL chain only handled `play()` REJECTION. An audio element whose
 * download fails AFTER play() resolved (CSP media-src on Netflix, dead CDN)
 * fired onerror and left the chain hanging — no synthesized fallback, no
 * background TTS. And `speakSynthesized` returned early whenever
 * speechSynthesis existed, even with ZERO voices and no error observer, so
 * the background TTS fallback never ran exactly where it is needed most.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendMessage } from 'webext-bridge/content-script';
import { playPronunciation, speakSynthesized } from '../../src/content/ui/WordPopover';

vi.mock('webext-bridge/content-script', () => ({
  sendMessage: vi.fn(async () => ({ ok: true })),
}));

type AudioStub = {
  src: string;
  play: () => Promise<void>;
  pause: () => void;
  onerror: (() => void) | null;
};

let audioFactory: ((stub: AudioStub) => Partial<AudioStub>) | null = null;
let created: AudioStub[] = [];

beforeEach(() => {
  vi.mocked(sendMessage).mockClear();
  created = [];
  // jsdom has no Audio: install a stub the production code will drive.
  vi.stubGlobal('Audio', class {
    src = '';
    play: () => Promise<void> = async () => {};
    pause: () => void = () => {};
    onerror: (() => void) | null = null;
    constructor() {
      const stub = audioFactory?.(this) ?? this;
      Object.assign(this, stub);
      created.push(this);
    }
  } as unknown as typeof Audio);
});

afterEach(() => {
  vi.unstubAllGlobals();
  audioFactory = null;
});

describe('playPronunciation chain', () => {
  it('play() rejection advances to the next candidate, then onExhausted', async () => {
    audioFactory = (stub) => ({ ...stub, play: async () => { throw new Error('NotAllowedError'); } });
    const exhausted = vi.fn();
    playPronunciation(
      [{ url: 'https://a.example/1.mp3' }, { url: 'https://a.example/2.mp3' }],
      exhausted,
    );
    await vi.waitFor(() => expect(exhausted).toHaveBeenCalledTimes(1));
    expect(created).toHaveLength(2);
  });

  it('an onerror AFTER play() resolved advances the chain too (CSP media-src)', async () => {
    const exhausted = vi.fn();
    audioFactory = (stub) => ({
      ...stub,
      // play() resolves (the element accepted the src) — then the element
      // fails to load: the URL is blocked or dead.
      play: async () => {},
    });
    playPronunciation([{ url: 'https://netflix.example/blocked.mp3' }], exhausted);
    // The page never fires play's rejection: only onerror can save the chain.
    await Promise.resolve();
    expect(exhausted).not.toHaveBeenCalled();
    created[0]!.onerror?.();
    await vi.waitFor(() => expect(exhausted).toHaveBeenCalledTimes(1));
  });
});

describe('speakSynthesized fallbacks', () => {
  function stubSpeech(voices: string[], failSpeak = false): { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> } {
    const speak = vi.fn((utter: { onerror?: (() => void) | null }) => {
      if (failSpeak) setTimeout(() => utter.onerror?.(), 0);
    });
    const cancel = vi.fn();
    const speech = { cancel, speak, getVoices: () => voices.map((v) => ({ name: v })) };
    Object.defineProperty(window, 'speechSynthesis', { value: speech, configurable: true });
    // jsdom ships neither speechSynthesis nor SpeechSynthesisUtterance.
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      lang = '';
      rate = 1;
      onerror: (() => void) | null = null;
      constructor(public text: string) {}
    });
    return { speak, cancel };
  }

  it('zero voices falls back to background TTS_SPEAK', () => {
    const { speak } = stubSpeech([]);
    speakSynthesized('frames', 'en');
    expect(speak).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith('TTS_SPEAK', { text: 'frames', lang: 'en' }, 'background');
  });

  it('utter.onerror falls back to background TTS_SPEAK', async () => {
    const { speak } = stubSpeech(['en-US-1'], true);
    speakSynthesized('frames', 'en');
    expect(speak).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith('TTS_SPEAK', { text: 'frames', lang: 'en' }, 'background'),
    );
  });

  it('with voices and no error, the page synthesis plays and no TTS is sent', () => {
    const { speak } = stubSpeech(['en-US-1']);
    speakSynthesized('frames', 'en');
    expect(speak).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('without speechSynthesis at all, background TTS_SPEAK answers', () => {
    Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true });
    speakSynthesized('frames', 'en');
    expect(sendMessage).toHaveBeenCalledWith('TTS_SPEAK', { text: 'frames', lang: 'en' }, 'background');
  });
});
