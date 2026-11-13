/**
 * Where Prime Video lives.
 *
 * Extracted from `detectPlatform` so the rule can be exercised without
 * booting the adapters: the predicate is the only part of the detection that
 * is easy to get subtly wrong.
 */
const AMAZON_PRIME_HOST =
  /(^|\.)amazon\.(?:com|co\.uk|de|es|fr|it|co\.jp|ca|com\.mx|com\.br|in)$/;

/**
 * `primevideo.com` is Prime everywhere; on the Amazon domains it is Prime only
 * under `/gp/video/` — the rest of the store must fall through to the generic
 * player (and the manifest does not inject there anyway).
 */
export function isPrimeRoute(host: string, pathname: string): boolean {
  if (host.includes('primevideo.com')) return true;
  return AMAZON_PRIME_HOST.test(host) && pathname.startsWith('/gp/video/');
}
