/**
 * Where a file used by the extension is allowed to come from.
 *
 * Two different jobs under one module, because they fail the same way and
 * review as one question: "may the extension fetch this URL at all?"
 *
 *  1. `assertFetchableWhisperUrl` — DATA (the ~75 MB ggml weights). Fetched
 *     from the offscreen document, which is the most privileged page the
 *     extension owns: its own storage, Dexie, the media graph. The value
 *     arrives as free text in `AsrSettings.modelUrl`, so a private target sent
 *     there is a port scanner aimed at the user's own machine and network —
 *     run from inside the extension, where the request is not subject to the
 *     page CORS that would normally contain it.
 *
 *  2. `assertExtensionScriptUrl` — CODE. The whisper.cpp glue used to be a
 *    `script.src` from whatever URL the user typed, and modelUrl's neighbour
 *     (`AsrSettings.glueUrl`) was the same shape before this landed: an input
 *     box able to execute arbitrary JavaScript in the offscreen document.
 *
 * Both are called at the point of use, not only at save time. A value stored
 * by an older build, hand-edited in devtools, or imported through a settings
 * dump never passes through the settings UI at all, so validating on save
 * alone leaves the hole open exactly where an attacker aims.
 */

import { UrlNotAllowedError, assertPublicHttpUrl } from './net-guard';

/**
 * Largest model we will pull. 200 MB is a long way past the biggest
 * quantisation we document, and binding it here means a malicious mirror
 * cannot use the extension's own storage quota as a staging area.
 */
export const WHISPER_MODEL_MAX_BYTES = 200 * 1024 * 1024;

/**
 * Validate a model URL the offscreen is about to fetch.
 *
 * HTTPS and public only — the same rule as the enrichment fetchers, and the
 * reason is the same: the service worker's host permissions reach far more
 * than any page, and `AsrSettings` is user-writable.
 *
 * `http:` is refused outright, unlike the media path's `allowHttp` start.
 * There are no public Whisper mirrors over cleartext; the flag exists so a
 * http→https upgrade can be attempted, and granting it here would only open a
 * downgrade.
 */
export function assertFetchableWhisperUrl(raw: string): URL {
  const url = assertPublicHttpUrl(raw);
  if (url.protocol !== 'https:') {
    throw new UrlNotAllowedError('Solo se permiten URLs https://');
  }
  return url;
}

/**
 * True when the URL may be executed as a script inside the extension.
 *
 * Only `chrome-extension://<id>/…`: an extension page cannot load remote code
 * under MV3's `script-src 'self'` anyway, so this is the rule stated in code
 * and enforced before the request, instead of being discovered as an opaque
 * CSP violation afterwards. `runtimeId` is passed rather than read because
 * this runs in the offscreen document, where `chrome.runtime.id` is available:
 * letting the caller supply it keeps the check pure and testable without a
 * chrome stub.
 */
export function assertExtensionScriptUrl(raw: string, runtimeId: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlNotAllowedError('URL inválida');
  }
  if (url.protocol !== 'chrome-extension:') {
    throw new UrlNotAllowedError('El glue de Whisper debe vivir dentro de la extensión');
  }
  if (url.hostname !== runtimeId) {
    throw new UrlNotAllowedError('El glue de Whisper debe pertenecer a esta extensión');
  }
  // No credentials, no fragment, no query: a path inside our own bundle.
  if (url.username || url.password || url.search || url.hash) {
    throw new UrlNotAllowedError('URL no permitida');
  }
  return url;
}
