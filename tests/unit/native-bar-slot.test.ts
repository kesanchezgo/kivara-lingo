/**
 * RED TESTS — native player bar integration (base main@b74ec17).
 */
import { describe, expect, it } from 'vitest';
import { findNativeBarAnchor, NativeAnchorWatcher } from '../../src/content/ui/native-bar-slot';

function el(tag: string, cls = '', uia = ''): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (uia) e.setAttribute('data-uia', uia);
  return e;
}

describe('findNativeBarAnchor', () => {
  it('netflix: climbs single-child wrappers to the multi-child control row', () => {
    const row = el('div', 'PlayerControlsNeo__bottom-controls');
    const wrap1 = el('div');
    const wrap2 = el('div');
    const next = el('button', '', 'control-next');
    row.append(el('button', '', 'control-play'), wrap1);
    wrap1.append(wrap2);
    wrap2.append(next);
    row.append(el('button', '', 'control-fullscreen-enter'));
    document.body.append(row);
    const anchor = findNativeBarAnchor('netflix', row);
    expect(anchor).not.toBeNull();
    expect(anchor!.parent).toBe(row);
    expect(anchor!.before).toBe(wrap1);
    row.remove();
  });

  it('netflix: a movie without control-next uses control-audio-subtitle', () => {
    const row = el('div', 'PlayerControlsNeo__bottom-controls');
    const wrap = el('div');
    const audio = el('button', '', 'control-audio-subtitle');
    wrap.append(audio);
    row.append(el('button', '', 'control-play'), wrap);
    document.body.append(row);
    const anchor = findNativeBarAnchor('netflix', row);
    expect(anchor?.before).toBe(wrap);
    row.remove();
  });

  it('youtube: right controls, before firstChild', () => {
    const player = el('div', 'html5-video-player');
    const right = el('div', 'ytp-right-controls');
    const first = el('button', 'ytp-button');
    right.append(first);
    const left = el('div', 'ytp-left-controls');
    player.append(left, right);
    document.body.append(player);
    const anchor = findNativeBarAnchor('youtube', player);
    expect(anchor?.parent).toBe(right);
    expect(anchor?.before).toBe(first);
    player.remove();
  });

  it('generic has no native anchor', () => {
    expect(findNativeBarAnchor('generic', document.body)).toBeNull();
  });
});

describe('native anchor lifecycle', () => {
  it('after a native anchor is seen, the resting site teardown does NOT enable the floating fallback', () => {
    const watcher: NativeAnchorWatcher = new NativeAnchorWatcher();
    const row = el('div', 'PlayerControlsNeo__bottom-controls');
    const wrap = el('div');
    wrap.append(el('button', '', 'control-next'));
    row.append(el('button', '', 'control-play'), wrap);
    document.body.append(row);
    watcher.observe(row, () => {}, 'netflix');
    expect(watcher.hasSeenNativeAnchor()).toBe(true);
    row.remove(); // the site parks its bar on inactivity
    expect(watcher.shouldUseFloating()).toBe(false);
    // A pointer-moving user makes the site re-mount the row.
    document.body.append(row);
    watcher.flush();
    expect(watcher.shouldUseFloating()).toBe(false);
    expect(watcher.currentAnchor()).not.toBeNull();
    watcher.disconnect();
    row.remove();
  });
});
