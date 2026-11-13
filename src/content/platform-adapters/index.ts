import { SubtitleSource } from './types';
import { attachGenericHtml5 } from './generic-html5';
import { attachYouTube } from './youtube';
import { createNetflixAdapter } from './netflix';
import { createDisneyPlusAdapter } from './disney-plus';
import { createHboMaxAdapter } from './hbo-max';
import { createPrimeVideoAdapter } from './prime-video';
// Side-effect import: registers the postMessage listener that receives
// subtitle tracks from the MAIN-world interceptor.
import './intercepted-bus';

export async function detectPlatform(): Promise<SubtitleSource | null> {
  const host = window.location.hostname;

  if (host.includes('youtube.com')) {
    const video = document.querySelector('video');
    if (video) return attachYouTube();
  }

  if (host.includes('netflix.com')) {
    return createNetflixAdapter();
  }

  if (host.includes('disneyplus.com')) {
    return createDisneyPlusAdapter();
  }

  if (host.includes('hbomax.com') || host.includes('max.com')) {
    return createHboMaxAdapter();
  }

  // amazon.* is only Prime under /gp/video: the rest of the store must not
  // mount the adapter (and the manifest only injects there, so in practice
  // this branch is unreachable off-route — the guard keeps it honest).
  if (
    (host.includes('primevideo.com'))
    || (/\.amazon\.(?:com|co\.uk|de|es|fr|it|co\.jp|ca|com\.mx|com\.br|in)$/.test(host) && window.location.pathname.startsWith('/gp/video/'))
  ) {
    return createPrimeVideoAdapter();
  }

  // Fallback to generic HTML5 video if available
  const video = document.querySelector('video');
  if (video) {
    return attachGenericHtml5(video);
  }

  return null;
}
