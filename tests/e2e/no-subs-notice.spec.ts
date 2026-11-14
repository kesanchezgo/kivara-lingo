/**
 * Point 2 — the "no subtitles" notice (RED first: against the previous build
 * nothing ever appeared — the transcript and the overlay sat blank forever).
 *
 * The fixture is the seekable clip WITHOUT a <track>: nothing ever produces a
 * cue, so the notice is the only honest thing the UI can show.
 *
 * Channel: the overlay's notice renders with `aria-live` — the e2e state
 * publishes `[aria-live]` text as `live` on the video host. The RAIL's notice
 * is pinned by a unit test (`rail-notice.test.tsx`): the rail's own text
 * channel only publishes tab panels, and the rail's view can be either one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures';
import { openPlayer, readFixture, waitForState, VIDEO_HOST } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFixture('player-nosubs.html');

test('no-subtitles notice appears after ~5 s of playback with zero cues', async ({ context }) => {
  const page = await openPlayer(context, { fixture: FIXTURE });
  try {
    await waitForState(
      page,
      VIDEO_HOST,
      (state) => state.live.some((t) => /no hay subtítulos activos/i.test(t)),
      'the overlay announces that no subtitles are active',
      12_000,
    );
  } finally {
    await page.close();
  }
});

test('the notice names the platform when Kivara knows it', async ({ context }) => {
  const page = await openPlayer(context, { fixture: FIXTURE });
  try {
    await waitForState(
      page,
      VIDEO_HOST,
      (state) => state.live.some((t) => /reproductor de youtube/i.test(t)),
      'the YouTube fixture names the YouTube player',
      12_000,
    );
  } finally {
    await page.close();
  }
});

// Guard so the fixture cannot silently grow a track again.
test('the no-subs fixture really has no cue source', () => {
  const html = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fixtures/player-nosubs.html'), 'utf8');
  expect(html).not.toContain('<track');
  expect(html).toContain('WITHOUT subtitles');
});

