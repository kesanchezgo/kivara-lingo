/**
 * Mount serialization + generation guard for the content script.
 *
 * Extracted from `content/index.tsx` so the invariant can be unit-tested
 * without importing the whole content entry (which kicks off `init()` and
 * a 15 s <video> poll as a module side effect).
 *
 * Invariant: every mount/unmount runs ONE AT A TIME through a promise
 * chain (no interleaved createRoot/unmount → no orphaned React roots), and
 * every task carries the generation it was scheduled under. A task whose
 * generation is stale — a navigation happened while it waited its turn —
 * is dropped instead of mounting an old video.
 */

let queue: Promise<void> = Promise.resolve();
let gen = 0;

/** Current generation (read-only, for scheduling). */
export function readMountGen(): number {
  return gen;
}

/** Invalidate every queued-but-not-yet-run task. Call when a NEW mount
 * intent appears (navigation). Returns the generation for the caller to
 * schedule its own task under. */
export function bumpMountGen(): number {
  gen += 1;
  return gen;
}

/** Run `task` strictly after everything already queued, skipping it when a
 * newer generation superseded it. */
export function enqueueMount(genAtSchedule: number, task: () => Promise<void>): Promise<void> {
  const run = async () => {
    if (genAtSchedule !== gen) return; // superseded by a newer intent
    await task();
  };
  queue = queue.then(run, run);
  return queue;
}

/** Test-only: reset module state between cases. */
export function __resetMountQueueForTests(): void {
  queue = Promise.resolve();
  gen = 0;
}
