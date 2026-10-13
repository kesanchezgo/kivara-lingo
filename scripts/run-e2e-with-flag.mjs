/**
 * Cross-platform E2E runner with a build flag.
 *
 * `KIVARA_E2E=1 vite build && playwright test …` does not survive Windows:
 * `KIVARA_E2E=1` is POSIX shorthand, so `cmd` treats the assignment as the
 * command name and the build never starts. Rather than pull in `cross-env`
 * for one flag, this tiny runner spawns the two commands itself with the
 * environment already set, which works on every shell npm can run on.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Run a command with the E2E flag already in its environment. */
function run(args) {
  const res = spawnSync(args[0], args.slice(1), {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, KIVARA_E2E: '1' },
  });
  return res.status ?? 1;
}

// Build with the flag, then run the specs that only exist in an E2E-
// flagged build: the AudioWorklet-default choice lives in
// `shipped-capabilities.spec.ts` and the smoke is in `audio-smoke.spec.ts`.
process.exit(run(['npx', 'vite', 'build'])
  || run([
    'npx', 'playwright', 'test',
    'tests/e2e/audio-smoke.spec.ts',
    'tests/e2e/shipped-capabilities.spec.ts',
  ]));
