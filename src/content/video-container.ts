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

export function findVideoContainerIn(
  doc: Document,
  host: string,
  pathname: string,
): { video: HTMLVideoElement | null; container: HTMLElement | null } {
  const gate = mountGateFor(host);
  if (gate) {
    // A known platform owns this host: outside its playback route there is
    // nothing to mount on (storefront trailers, home-feed previews).
    if (mountDenied(host, pathname)) return { video: null, container: null };
    // Play route: prefer the platform's own player container, but fall back
    // to the video's parent when the container is missing or renamed — the
    // route is the hard gate (storefront trailers live on other paths), and
    // platforms do rename their player DOM (Netflix did exactly that once).
    // Before the player exists there is no <video> at all, so this branch
    // never picks up a stray video from a previous view.
    for (const selector of gate.selectors) {
      const el = doc.querySelector<HTMLElement>(selector);
      const video = el?.querySelector<HTMLVideoElement>('video');
      if (el && video) return { video, container: el };
    }
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
