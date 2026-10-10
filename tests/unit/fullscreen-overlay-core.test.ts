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

  const run = (fullscreenElement: HTMLElement | null): void =>
    updateOverlayParent(
      {
        mount: { hostElement: host },
        getFullscreenElement: () => fullscreenElement,
        getPosition: () => 'static',
        getFallbackParent: () => doc.body,
        getPreviousFocus: () => focusTrail,
      },
      state,
    );

  beforeEach(() => {
    doc = document.implementation.createHTMLDocument('t');
    stage = doc.createElement('div');
    video = doc.createElement('video');
    button = doc.createElement('button');
    host = doc.createElement('div');
    doc.body.appendChild(stage as unknown as Node);
    stage.appendChild(video as unknown as Node);
    stage.appendChild(button as unknown as Node);
    doc.body.appendChild(host as unknown as Node);
    state = { restore: null };
    focusTrail = button;
  });

  it('restores the position it wrote on exit', () => {
    run(video);
    expect(stage.style.position).toBe('');
    expect(video.style.position).toBe('relative');
    expect(host.parentElement).toBe(video);

    run(null);
    expect(video.style.position).toBe('');
    expect(host.parentElement).toBe(doc.body);
  });

  it('hands focus back to the element the user was on', () => {
    run(video);
    expect(doc.activeElement).not.toBe(button);
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
