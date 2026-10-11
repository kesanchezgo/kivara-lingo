/**
 * MOVED IMPLEMENTATION — kivara-lingo#27.
 *
 * The port protocol used to live here, next to the service worker entry that
 * wires it. It now lives in enrichment/stream.ts together with the other
 * enrichments modules, for the same reason merge.ts does: the enrichment
 * chain owns the stream's payload shape, so its transport belongs beside it.
 * This file re-exports the whole surface so existing imports keep working.
 */
export { installResolveWordPort } from './enrichment/stream';
export type { ResolveWordStreamFn } from './enrichment/stream';
