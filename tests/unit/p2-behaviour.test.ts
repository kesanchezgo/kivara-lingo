/**
 * Behaviour tests for the P2 pass: things the audit found broken in the
 * running extension, asserted the way a user would notice them.
 *
 *  1. The generic HTML5 adapter must emit a STABLE cue identity (hover state
 *     and translation should survive an unchanged line) and must join EVERY
 *     active VTT cue (a player that splits one line across two cues used to
 *     show only the first half).
 *  2. A shortcut capture without a real modifier must be rejected: binding
 *     `K` ran save-word while the user typed a capital letter.
 *  3. A conflict check has to compare NORMALIZED combos, or the same chord
 *     binds twice ("command+s" vs "Meta+S").
 *  4. A response body has its own deadline — a fetch timeout covers only the
 *     headers, so a stalled body used to hang the source forever.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { attachGenericHtml5 } from '../../src/content/platform-adapters/generic-html5';
import {
  comboHasRequiredModifier,
  normalizeCombo,
  readManifestCombos,
} from '../../src/shared/shortcuts';
import { readBodyBounded } from '../../src/shared/net-guard';

afterEach(() => {
  document.querySelectorAll('video').forEach((v) => v.remove());
});

type Emitted = Array<{ id: string; start: number; end: number; text: string }>;

function fakeTrack(cues: Array<{ text: string; startTime: number; endTime: number; id?: string; align?: string }>) {
  const handlers: Array<() => void> = [];
  const track = {
    mode: 'disabled' as string,
    kind: 'subtitles' as const,
    language: 'en',
    activeCues: cues,
    addEventListener: (_t: string, cb: () => void) => handlers.push(cb),
    removeEventListener: (_t: string, cb: () => void) => {
      const i = handlers.indexOf(cb);
      if (i >= 0) handlers.splice(i, 1);
    },
    fire: () => handlers.forEach((h) => h()),
  };
  return track;
}

function withVideo(track: ReturnType<typeof fakeTrack>) {
  const video = document.createElement('video');
  const list = Object.create(Array.prototype);
  Object.defineProperty(list, '0', { value: track, enumerable: true });
  Object.defineProperty(list, 'length', { value: 1, enumerable: true });
  list.addEventListener = () => {};
  list.removeEventListener = () => {};
  Object.defineProperty(video, 'textTracks', { value: list, configurable: true });
  document.body.appendChild(video);
  return video;
}

describe('generic HTML5 adapter cue identity and merging', () => {
  it('keeps the same id while the cue window is unchanged (hover survives)', () => {
    const cue = { text: 'run away', startTime: 1, endTime: 3 };
    const track = fakeTrack([cue]);
    const adapter = attachGenericHtml5(withVideo(track));
    const seen: Emitted = [];
    adapter.onCueChange((cs) => cs.forEach((c) => seen.push(c as never)));
    track.fire();
    track.fire(); // same window, another cuechange
    expect(seen.length).toBe(2);
    expect(seen[1].id).toBe(seen[0].id);
  });

  it('joins every active cue instead of only the first', () => {
    const track = fakeTrack([
      { text: 'first half', startTime: 4, endTime: 6 },
      { text: 'second half', startTime: 4, endTime: 6 },
    ]);
    const adapter = attachGenericHtml5(withVideo(track));
    const seen: Emitted = [];
    adapter.onCueChange((cs) => cs.forEach((c) => seen.push(c as never)));
    track.fire();
    expect(seen[0].text).toContain('first half');
    expect(seen[0].text).toContain('second half');
  });
});

describe('shortcut capture guardrails', () => {
  const combo = (e: Partial<KeyboardEvent>): KeyboardEvent =>
    ({
      ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
      key: 'k', code: 'KeyK', preventDefault() {}, stopPropagation() {},
      ...e,
    }) as unknown as KeyboardEvent;

  it('rejects a bare keypress (a capital letter must never fire a shortcut)', () => {
    expect(comboHasRequiredModifier(combo({}))).toBe(false);
    expect(comboHasRequiredModifier(combo({ shiftKey: true }))).toBe(false);
    expect(comboHasRequiredModifier(combo({ ctrlKey: true }))).toBe(true);
    expect(comboHasRequiredModifier(combo({ altKey: true }))).toBe(true);
    expect(comboHasRequiredModifier(combo({ metaKey: true }))).toBe(true);
  });

  it('normalizes so "command+s" and "Meta+S" compare equal', () => {
    expect(normalizeCombo('command+s')).toBe(normalizeCombo('Meta+S'));
    expect(normalizeCombo('ctrl+ shift+k')).toBe(normalizeCombo('Ctrl+Shift+K'));
  });

  it('names the manifest chords so the editor can refuse them', () => {
    const owned = readManifestCombos();
    // Canonical spelling in this codebase puts Shift before Meta
    // (see MOD_ORDER). The manifest's save_word ships
    // `default: Ctrl+Shift+S` and `mac: Command+Shift+S`; from a manifest
    // read that is Ctrl+Shift+S, and the fallback set (no chrome API, as in
    // tests) normalizes 'Command+Shift+S' to the same Meta spelling.
    expect(owned).toContain('Ctrl+Shift+S');
    expect(owned).toContain('Shift+Meta+S');
    expect(owned.some((c) => c === 'Alt+R' || c === 'Alt+K')).toBe(true);
    // Editorial spelling 'Command+Shift+S' must not appear unnormalized.
    expect(owned).not.toContain('Command+Shift+S');
  });
});

describe('body read deadline', () => {
  it('rejects a body that never arrives', async () => {
    const res = new Response(
      new ReadableStream<Uint8Array>({ pull() { /* never */ } }),
    );
    let rejected = false;
    void readBodyBounded(res, 200, 'test body').catch(() => {
      rejected = true;
    });
    await new Promise((r) => setTimeout(r, 600));
    expect(rejected).toBe(true);
  });

  it('returns the text when the body arrives in time', async () => {
    const res = new Response('hello body');
    await expect(readBodyBounded(res, 1_000, 'test body')).resolves.toBe('hello body');
  });
});
