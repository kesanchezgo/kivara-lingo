/**
 * Mount-queue invariant (cd498fe review, 🟡 #1).
 *
 * 1. Tasks run strictly one-at-a-time (no interleaved mount/unmount).
 * 2. A task scheduled under a STALE generation is dropped — this is what
 *    stops `init()` (which can wait 15 s for a <video>) from mounting the
 *    OLD video after a navigation already mounted the new one.
 * 3. A failing task doesn't poison the chain.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  enqueueMount,
  bumpMountGen,
  readMountGen,
  __resetMountQueueForTests,
} from '../../src/content/mount-queue';

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe('mount-queue', () => {
  beforeEach(() => {
    __resetMountQueueForTests();
  });

  it('runs queued tasks strictly in order', async () => {
    const order: number[] = [];
    const p1 = enqueueMount(readMountGen(), async () => {
      await tick();
      order.push(1);
    });
    const p2 = enqueueMount(readMountGen(), async () => {
      order.push(2);
    });
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it('drops a task whose generation was superseded while it waited', async () => {
    const ran: string[] = [];
    // init() captured gen 0 and is waiting for the video…
    const staleGen = readMountGen();
    // …a navigation fires meanwhile and bumps the generation.
    const freshGen = bumpMountGen();
    expect(freshGen).toBe(staleGen + 1);

    const stale = enqueueMount(staleGen, async () => {
      ran.push('stale-init');
    });
    const fresh = enqueueMount(freshGen, async () => {
      ran.push('nav-mount');
    });
    await Promise.all([stale, fresh]);

    // Only the navigation's mount happened — the stale init was dropped.
    expect(ran).toEqual(['nav-mount']);
  });

  it('a later navigation invalidates an earlier queued mount', async () => {
    const ran: string[] = [];
    const genA = bumpMountGen();
    const genB = bumpMountGen();
    const a = enqueueMount(genA, async () => ran.push('A'));
    const b = enqueueMount(genB, async () => ran.push('B'));
    await Promise.all([a, b]);
    expect(ran).toEqual(['B']);
  });

  it('a throwing task does not poison the chain', async () => {
    const ran: string[] = [];
    const boom = enqueueMount(readMountGen(), async () => {
      throw new Error('mount exploded');
    });
    const next = enqueueMount(readMountGen(), async () => {
      ran.push('after');
    });
    await expect(boom).rejects.toThrow('mount exploded');
    await next;
    expect(ran).toEqual(['after']);
  });
});
