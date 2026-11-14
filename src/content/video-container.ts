/**
 * The gated container finder (point 1). Pure over a Document so the rules are
 * unit-testable; `index.tsx` keeps the window-bound wrapper.
 *
 * Known platforms mount ONLY on their playback route and container: on other
 * paths of the same host there are trailers and storefront previews playing,
 * and the old "any <video>" fallback put the overlay over those. The fallback
 * stays for hosts without an adapter.
 */
import { mountDenied, mountGateFor } from './mount-gate';
import { devLog } from '../shared/logger';

export function findVideoContainerIn(
  doc: Document,
  host: string,
  pathname: string,
): { video: HTMLVideoElement | null; container: HTMLElement | null } {
  const gate = mountGateFor(host);
  if (gate) {
    const playerIn = (): { video: HTMLVideoElement; container: HTMLElement } | null => {
      for (const selector of gate.selectors) {
        const el = doc.querySelector<HTMLElement>(selector);
        const video = el?.querySelector<HTMLVideoElement>('video');
        if (el && video) return { video, container: el };
      }
      return null;
    };

    // A known platform owns this host: outside its playback route there is
    // nothing to mount on (storefront trailers, home-feed previews) — unless
    // the gate opted into the container override and the platform's OWN player
    // container is right there with a video in it. That is the case where the
    // route table is simply behind the platform (Max/Disney+ ship paths
    // without notice), and staying idle would leave the user without Kivara.
    if (mountDenied(host, pathname)) {
      if (!gate.containerOverride) return { video: null, container: null };
      const player = playerIn();
      if (!player) return { video: null, container: null };
      devLog('[Kivara Lingo] unrecognised route, mounting on the player container', gate.platform, pathname);
      return player;
    }
    // Play route: prefer the platform's own player container, but fall back
    // to the video's parent when the container is missing or renamed — the
    // route is the hard gate (storefront trailers live on other paths), and
    // platforms do rename their player DOM (Netflix did exactly that once).
    // Before the player exists there is no <video> at all, so this branch
    // never picks up a stray video from a previous view.
    const player = playerIn();
    if (player) return player;
    const video = doc.querySelector<HTMLVideoElement>('video');
    return {
      video,
      container: (video?.parentElement as HTMLElement | null) ?? null,
    };
  }

  // Hosts without an adapter keep the generic fallback.
  const video = doc.querySelector<HTMLVideoElement>('video');
  return {
    video,
    container: (video?.parentElement as HTMLElement | null) ?? null,
  };
}
