/**
 * The fullscreen overlay move, driven through its real orchestrator.
 *
 * This is the test a review asked for twice: happy-dom has no fullscreen
 * implementations, so the state a real browser would create (a sandboxed
 * document, a focus trail, a placeholder host) is built here and handed to the
 * SAME function the content script delegates to. The load-bearing case is the
 * one that silently failed for three revisions: with the state nulled before it
 * is read, the focus hand-back is dead code and nothing observable breaks.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  updateOverlayParent,
  type RestoreState,
} from '../../src/content/fullscreen-overlay-core';

describe('the fullscreen overlay move', () => {
  let doc: Document;
  let stage: HTMLElement;
  let video: HTMLElement;
  let button: HTMLElement;
  let host: HTMLElement;
  let state: { restore: RestoreState | null };
  let focusTrail: HTMLElement | null;

  // `computedPosition` stands for what `getComputedStyle(el).position` would
  // say for the entry target — 'static' is the only value the core overrides.
  const run = (fullscreenElement: HTMLElement | null, computedPosition = 'static'): void =>
    updateOverlayParent(
      {
        mount: { hostElement: host },
        getFullscreenElement: () => fullscreenElement,
        getPosition: () => computedPosition,
        getFallbackParent: () => doc.body,
        getPreviousFocus: () => focusTrail,
      },
      state,
    );

  /** The fake surroundings: the REAL global document, since happy-dom's
   *  `activeElement` only tracks that one — a separate `createHTMLDocument`
   *  document would make the focus assertions pass for the wrong reason. */
  beforeEach(() => {
    doc = document;
    doc.body.textContent = '';
    stage = doc.createElement('div');
    video = doc.createElement('video');
    button = doc.createElement('button');
    host = doc.createElement('div');
    doc.body.appendChild(stage);
    stage.appendChild(video);
    stage.appendChild(button);
    doc.body.appendChild(host);
    state = { restore: null };
    focusTrail = button;
  });

  afterEach(() => {
    state.restore = null;
    doc.body.textContent = '';
  });

  it('restores the position it wrote on exit', () => {
    run(video, 'static');
    expect(stage.style.position).toBe('');
    expect(video.style.position).toBe('relative');
    expect(host.parentElement).toBe(video);

    run(null);
    expect(video.style.position).toBe('');
    expect(host.parentElement).toBe(doc.body);
  });

  it('does not touch an element that was already positioned', () => {
    // `static` is the only computed value worth overriding; a player that is
    // already `absolute` must be left exactly as the site had it, so a restore
    // cannot write "" over its own layout.
    video.style.position = 'absolute';
    run(video, 'absolute');
    expect(video.style.position).toBe('absolute');
    run(null);
    expect(video.style.position).toBe('absolute');
  });

  it('hands focus back to the element the user was on', () => {
    video.focus();
    run(video, 'static');
    expect(doc.activeElement).not.toBe(button);
    run(null);
    expect(doc.activeElement).toBe(button);
  });

  it('does not move focus on an A to B switch', () => {
    const other = doc.createElement('div');
    doc.body.appendChild(other);
    video.focus();
    run(video, 'static');
    other.focus();
    // Mid-fullscreen on B: yanking focus back to the page would break the
    // click the user just made.
    run(other, 'static');
    expect(doc.activeElement).toBe(other);
    // …and the real exit still gives the original focus back.
    run(null);
    expect(doc.activeElement).toBe(button);
  });

  it('keeps the original value across a second toggle in the same session', () => {
    video.style.position = 'absolute';
    run(video);
    expect(video.style.position).toBe('relative');
    // A no-op re-entry inside the session must not overwrite the saved value.
    run(video);
    run(null);
    expect(video.style.position).toBe('absolute');
  });

  it('moves A to B without losing either (leave and entry in one event)', () => {
    const other = doc.createElement('div');
    doc.body.appendChild(other as unknown as Node);
    run(video);
    expect(video.style.position).toBe('relative');
    run(other);
    expect(video.style.position).toBe(''); // A restored
    expect(other.style.position).toBe('relative'); // B overridden
    expect(host.parentElement).toBe(other);
    run(null);
    expect(other.style.position).toBe('');
    expect(host.parentElement).toBe(doc.body);
  });

  it('does not focus a target that vanished while fullscreen', () => {
    run(video);
    button.remove();
    expect(() => run(null)).not.toThrow();
  });
});
