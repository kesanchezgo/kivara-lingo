/**
 * Netflix media metadata (#35).
 *
 * Netflix only puts the title in the DOM while the player controls are
 * visible; once they hide, both the heading and `document.title` fall back to
 * "Netflix". The adapter caches the last real title per <video> so a card
 * saved with the controls hidden still gets the right series tag — and never
 * `kivara::netflix`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNetflixAdapter } from '../../src/content/platform-adapters/netflix';
import { cardSourceFromMedia } from '../../src/shared/cards';
import { cardTags } from '../../src/shared/study/cardTags';

function mountWatchPage(): void {
  document.body.innerHTML = [
    '<div class="watch-video">',
    '<video></video>',
    '<div class="video-title" data-uia="video-title"><h4>Dark</h4><span>S01 E01</span></div>',
    '</div>',
  ].join('');
}

beforeEach(() => {
  document.title = 'Watch Dark | Netflix';
  mountWatchPage();
});

afterEach(() => {
  document.body.innerHTML = '';
  document.title = '';
});

describe('Netflix media metadata', () => {
  it('caches the title and reuses it once the controls disappear', () => {
    const adapter = createNetflixAdapter();
    try {
      expect(adapter.getMediaInfo?.()).toMatchObject({
        title: 'Dark',
        series: 'Dark',
        season: 1,
        episode: 1,
      });

      // Controls auto-hide: heading gone, document title degrades.
      document.querySelector('[data-uia="video-title"]')?.remove();
      document.title = 'Netflix';

      expect(adapter.getMediaInfo?.()).toMatchObject({
        title: 'Dark',
        series: 'Dark',
        season: 1,
        episode: 1,
      });
    } finally {
      adapter.destroy?.();
    }
  });

  it('drops the cached title when Netflix swaps the video element', () => {
    const adapter = createNetflixAdapter();
    try {
      expect(adapter.getMediaInfo?.()?.title).toBe('Dark');

      const watch = document.querySelector('.watch-video')!;
      watch.querySelector('video')?.remove();
      watch.appendChild(document.createElement('video'));
      document.querySelector('[data-uia="video-title"]')?.remove();
      document.title = 'Netflix';

      expect(adapter.getMediaInfo?.()?.title).toBe('');
    } finally {
      adapter.destroy?.();
    }
  });

  it('never emits a series tag built from the platform name', () => {
    const adapter = createNetflixAdapter();
    try {
      document.querySelector('[data-uia="video-title"]')?.remove();
      document.title = 'Netflix';

      const media = adapter.getMediaInfo?.();
      expect(media?.title).toBe('');
      const tags = cardTags('word', cardSourceFromMedia(media));
      expect(tags).not.toContain('kivara::netflix');
      expect(tags).toEqual(['kivara::platform::netflix', 'kivara::word']);
    } finally {
      adapter.destroy?.();
    }
  });
});
