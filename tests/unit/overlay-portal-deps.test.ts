/**
 * QA finding (real Netflix) — the no-cue notice appeared in the transcript
 * rail but NEVER over the player.
 *
 * `overlayPortal` is a `useMemo` that returns `createPortal(...)`. A memoized
 * element is the SAME element object while its deps hold, so React skips
 * re-rendering the whole subtree: a prop the memo passes down but does not
 * depend on is frozen at its first value. `noCuesNotice` was in that list —
 * the rail (rendered outside the memo) showed the notice, the overlay kept
 * `noCuesNotice=false` forever. Live evidence: video root 0 notice nodes
 * while the fixture root had 1, with `All 0` cues and the video playing.
 *
 * The deps array is hand-maintained, so this test reads it: every prop the
 * memoized subtree is given must be a dependency.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync(resolve(__dirname, '../../src/content/ui/App.tsx'), 'utf8');

/** The `const overlayPortal = useMemo(() => { … }, [ … ])` block. */
function overlayPortalBlock(): { body: string; deps: string[] } {
  const start = SRC.indexOf('const overlayPortal = useMemo(');
  expect(start, 'overlayPortal useMemo not found').toBeGreaterThan(-1);
  // The deps array is the last `],` before the closing `);` of the useMemo.
  const depsStart = SRC.indexOf('\n  }, [\n', start);
  expect(depsStart, 'overlayPortal deps array not found').toBeGreaterThan(start);
  const depsEnd = SRC.indexOf('\n  ]);', depsStart);
  expect(depsEnd).toBeGreaterThan(depsStart);
  const body = SRC.slice(start, depsStart);
  const deps = SRC.slice(depsStart, depsEnd)
    .split('\n')
    .map((line) => line.trim().replace(/,$/, ''))
    .filter((line) => line && !line.startsWith('//') && !line.startsWith('[') && !line.startsWith(']') && !line.startsWith('/*') && !line.startsWith('*'));
  return { body, deps };
}

describe('overlayPortal memo dependencies', () => {
  const { body, deps } = overlayPortalBlock();

  it('keeps the no-cue notice live (QA regression)', () => {
    expect(body).toContain('noCuesNotice={noCuesNotice}');
    expect(deps).toContain('noCuesNotice');
  });

  it('lists every state flag the memoized subtree reads', () => {
    // Props the portal passes down that change over a session. A missing one
    // freezes the overlay at its first value with no error anywhere.
    const mustBeDeps = ['noCuesNotice', 'playing', 'enabled', 'subtitlesVisible', 'activeCue', 'altCue', 'subtitleStyles', 'isDarkMode', 'mode'];
    for (const dep of mustBeDeps) {
      if (new RegExp(`\\b${dep}=`).test(body) || new RegExp(`\\b${dep}\\b`).test(body)) {
        expect(deps, `${dep} is read inside the overlay portal but missing from its deps`).toContain(dep);
      }
    }
  });
});
