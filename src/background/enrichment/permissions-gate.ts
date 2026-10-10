/**
 * The optional-host-permission gate.
 *
 * The extension ships ~80 host permissions as `optional_host_permissions`, so
 * the manifest reads as "collects nothing" at review time. The cost is on the
 * service-worker side: a source whose origins were never granted would fire a
 * request the page cannot answer, and the user would see an empty popover with
 * no idea why — which is worse than a slow failure. Instead the fan-out checks
 * first, skips what it cannot reach, and reports WHAT is missing so the card can
 * show a grant CTA. Failing closed is deliberate: a dictionary the user cannot
 * reach is not a source, and "error: CORS" in the UI is a lie.
 *
 * Two invariants live here on purpose, because they are one mechanism seen from
 * two ends:
 *
 *  - the LISTING is done once per lookup, not once per source: a fresh install
 *    with ~40 enabled sources used to make ~40 `chrome.permissions.getAll()`
 *    calls in series before the first request left;
 *  - a request made without a grant is reported as `needsAccess`, never thrown.
 *
 * When the user does grant, `chrome.permissions.onAdded` must purge both cache
 * layers immediately (see `installGrantListener`) — an answer taken while
 * sources were held back would otherwise keep reporting them missing.
 */
import { grantedOriginList, originCovered } from '../../shared/host-permissions';
import { providerHosts } from '../../shared/provider-hosts';

/** A source that is held back because its optional origins are not granted. */
export interface NeedsAccess {
  source: string;
  group: string;
}

/** How the gate's result is reported; `reachable` is the fan-out list. */
export interface PermissionGateResult {
  /** The sources that may be called, in their original order. */
  reachable: import('./types').EnrichmentSource[];
  /** What is missing and why, in the same order. */
  needsAccess: NeedsAccess[];
}

/**
 * Source id → the permission group its requests need.
 *
 * Sources with no network reach (bundled dictionaries, Yomitan packs, the
 * phonetics/audio built-ins) are absent on purpose: they must run even with
 * every optional origin revoked.
 */
export const SOURCE_PERMISSION_GROUP: Record<string, string> = {
  freeDictionary: 'dict:dictionaryapi',
  datamuse: 'dict:datamuse',
  wiktionary: 'dict:wiktionary',
  wiktionaryHtml: 'dict:wiktionary',
  wiktionaryApi: 'dict:wiktionary',
  wiktApi: 'dict:wiktionary',
  mobyThesaurus: 'dict:moby',
  thesaurusCom: 'dict:thesauruscom',
  wordHippo: 'dict:wordhippo',
  theIdioms: 'dict:theidioms',
  britannicaDictionary: 'dict:britannica',
  cambridge: 'dict:cambridge',
  oxfordLearners: 'dict:oxford',
  longman: 'dict:oxford',
  collins: 'dict:dictionarycom',
  merriamWebster: 'dict:merriam',
  merriamWebsterThesaurus: 'dict:merriam',
  ozdic: 'dict:ozdic',
  pons: 'dict:pons',
  babla: 'dict:babla',
  dictCc: 'dict:dictcc',
  reverso: 'dict:reverso',
  linguee: 'dict:linguee',
  promtContext: 'dict:promt',
  wordReference: 'dict:wordreference',
  spanishDict: 'dict:spanishdict',
  tatoeba: 'dict:tatoeba',
  etymonline: 'dict:etymonline',
  forvo: 'audio:forvo',
  linguaLibre: 'vip:lingualibre',
  googleTtsFallback: 'tts:google',
  unsplash: 'vip:unsplash',
  pixabay: 'vip:pixabay',
  bingImages: 'vip:bing',
  duckduckgoImages: 'vip:ddg',
  openverse: 'vip:openverse',
  wikimediaCommons: 'vip:wikimedia',
  youglish: 'video:youglish',
};

/** The origins a single source needs, or none when it does no networking. */
export function originsForSource(sourceId: string): string[] {
  const group = SOURCE_PERMISSION_GROUP[sourceId];
  return group ? providerHosts(group) : [];
}

/**
 * Split `sources` into what may run and what is waiting for a grant.
 *
 * `granted` is read ONCE by the caller (`gateSources` does it) so a lookup with
 * forty enabled sources costs one `getAll()` instead of forty.
 */
export function splitByPermission(
  sources: import('./types').EnrichmentSource[],
  granted: string[],
): PermissionGateResult {
  const reachable: import('./types').EnrichmentSource[] = [];
  const needsAccess: NeedsAccess[] = [];
  for (const source of sources) {
    const group = SOURCE_PERMISSION_GROUP[source.id];
    const origins = group ? providerHosts(group) : [];
    // Every pattern of a group must be granted, not one of them: matching is
    // origin-by-origin, so a partially granted group is an unreachable group.
    const missing = origins.filter((o) => !originCovered(o, granted));
    if (missing.length > 0) {
      needsAccess.push({ source: source.id, group: group ?? 'dict' });
      continue;
    }
    reachable.push(source);
  }
  return { reachable, needsAccess };
}

/**
 * Ask the browser what is granted and apply it. The OUTER async boundary of the
 * gate: everything below it is pure, and this is the single place the listing is
 * issued from a lookup.
 */
export async function gateSources(
  sources: import('./types').EnrichmentSource[],
): Promise<PermissionGateResult> {
  // Not an extension context (unit tests, the options page outside chrome):
  // there is nothing that could be granted, so nothing is gated. Treating
  // "cannot list permissions" as "nothing is granted" would hold every network
  // source back outside a real service worker.
  if (typeof chrome === 'undefined' || !chrome.permissions?.getAll) {
    return { reachable: sources, needsAccess: [] };
  }
  return splitByPermission(sources, await grantedOriginList());
}

export { grantedOriginList };
import { permissionsApiAvailable } from '../../shared/host-permissions';
export { permissionsApiAvailable };
