/**
 * PR #172 — the episode catalog, read from the page's own Falcor graph.
 *
 * `window.netflix.falcorCache` lives in the MAIN world, so this runs there (the
 * interceptor calls it) and must be as forgiving as the page is undocumented:
 * atoms, refs, several generations of field names and a structure that changes
 * between builds. The rules are simple and absolute:
 *
 *   • never throw (a getter that throws is a normal case, not an exception);
 *   • never hang (a hard node budget and a depth cap, so a cyclic or gigantic
 *     graph cannot block the main thread);
 *   • never guess (a film, an unknown shape or an empty graph answers `null`).
 */

export interface NetflixEpisodeItem {
  id: string;
  number: number;
  title: string;
  durationSec?: number;
  synopsis?: string;
  current: boolean;
}

export interface NetflixSeasonItem {
  id: string;
  number: number;
  title: string;
  episodes: NetflixEpisodeItem[];
}

export interface NetflixEpisodesCatalog {
  currentVideoId?: string;
  seasons: NetflixSeasonItem[];
}

/** Hard caps: a graph walk on the page's main thread owes the user these. */
const MAX_NODES = 2_500;
const MAX_DEPTH = 8;

interface WalkState {
  budget: number;
}

/** Reads a property without letting a hostile getter escape. */
function safeRead(node: unknown, key: string): unknown {
  if (!node || typeof node !== 'object') return undefined;
  try {
    return (node as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/**
 * Unwraps Falcor's wrappers: `{ $type: 'atom', value }` is a value, and
 * `{ $type: 'ref', value: ['videos', id, 'summary'] }` is a path into the cache.
 * Plain objects are returned as they are.
 */
function resolve(cache: unknown, node: unknown, state: WalkState, depth = 0): unknown {
  if (state.budget <= 0 || depth > MAX_DEPTH) return undefined;
  state.budget -= 1;
  if (!node || typeof node !== 'object') return node;
  const type = safeRead(node, '$type');
  if (type === 'atom') return safeRead(node, 'value');
  if (type === 'ref') {
    const path = safeRead(node, 'value');
    if (!Array.isArray(path)) return undefined;
    let cursor: unknown = cache;
    for (const segment of path) {
      cursor = safeRead(cursor, String(segment));
      if (cursor === undefined) return undefined;
    }
    return resolve(cache, cursor, state, depth + 1);
  }
  return node;
}

/** A maybe-wrapped `{ id, type: 'episode', seasonId, episodeNumber, title }`. */
interface EpisodeFacts {
  id: string;
  seasonId?: string;
  seriesId?: string;
  number: number;
  title: string;
  durationSec?: number;
  synopsis?: string;
}

function numberFrom(...values: unknown[]): number | undefined {
  for (const value of values) {
    const numeric = typeof value === 'string' ? Number(value) : value;
    if (typeof numeric === 'number' && Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

function stringFrom(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

/** `{ summary: { ... } }` (or the bare object) reduced to the facts we need. */
function readEpisodeFacts(cache: unknown, node: unknown, state: WalkState): EpisodeFacts | null {
  const unwrapped = resolve(cache, node, state);
  if (!unwrapped || typeof unwrapped !== 'object') return null;
  const summary = resolve(cache, safeRead(unwrapped, 'summary') ?? unwrapped, state);
  if (!summary || typeof summary !== 'object') return null;

  const id = stringFrom(safeRead(summary, 'id'), safeRead(summary, 'videoId'), safeRead(summary, 'episodeId'));
  if (!id) return null;
  const type = stringFrom(safeRead(summary, 'type'), safeRead(summary, 'videoType'));
  const episodeNumber = numberFrom(
    safeRead(summary, 'episodeNumber'),
    safeRead(summary, 'episodeSeq'),
    safeRead(summary, 'number'),
    safeRead(summary, 'seq'),
  );
  const seasonId = stringFrom(safeRead(summary, 'seasonId'), safeRead(summary, 'season'));
  // An episode is a node that HAS an episode number inside a season. A film
  // answers `type: 'movie'` and has neither, and guessing would show nonsense.
  if (type && type !== 'episode') return null;
  if (episodeNumber === undefined || seasonId === undefined) return null;

  const runtime = numberFrom(safeRead(summary, 'runtime'), safeRead(summary, 'duration'), safeRead(summary, 'durationSec'));
  return {
    id,
    seasonId,
    seriesId: stringFrom(safeRead(summary, 'seriesId'), safeRead(summary, 'series')),
    number: episodeNumber,
    title: stringFrom(safeRead(summary, 'title'), safeRead(summary, 'name')) ?? `E${episodeNumber}`,
    // Netflix stores the runtime in seconds; some builds in milliseconds.
    durationSec: runtime === undefined ? undefined : (runtime > 36_000 ? Math.round(runtime / 1_000) : Math.round(runtime)),
    synopsis: stringFrom(safeRead(summary, 'synopsis'), safeRead(summary, 'shortSynopsis')),
  };
}

/** The season's own label, when the graph carries one. */
function readSeasonLabel(cache: unknown, node: unknown, state: WalkState): { title?: string; number?: number } {
  const unwrapped = resolve(cache, node, state);
  if (!unwrapped || typeof unwrapped !== 'object') return {};
  const summary = resolve(cache, safeRead(unwrapped, 'summary') ?? unwrapped, state);
  if (!summary || typeof summary !== 'object') return {};
  return {
    title: stringFrom(safeRead(summary, 'title'), safeRead(summary, 'name')),
    number: numberFrom(safeRead(summary, 'seq'), safeRead(summary, 'number'), safeRead(summary, 'seasonNumber')),
  };
}

/** Every node directly under `videos`, bounded by the walk budget. */
function videoNodes(cache: unknown, videos: unknown, state: WalkState): unknown[] {
  if (!videos || typeof videos !== 'object') return [];
  const out: unknown[] = [];
  let keys: string[] = [];
  try {
    keys = Object.keys(videos as Record<string, unknown>);
  } catch {
    return [];
  }
  for (const key of keys) {
    if (state.budget <= 0) break;
    const node = safeRead(videos, key);
    if (node !== undefined) out.push(node);
    void cache;
  }
  return out;
}

/**
 * The catalog of the series the CURRENT video belongs to, or `null`.
 *
 * The graph lists episodes as siblings under `videos`; the series link is what
 * separates them, and the season labels come from `seasons` when they exist.
 */
export function extractNetflixEpisodesCatalog(
  win: unknown,
  currentVideoId?: string,
): NetflixEpisodesCatalog | null {
  try {
    const cache = safeRead(safeRead(win, 'netflix'), 'falcorCache');
    if (!cache || typeof cache !== 'object') return null;
    const state: WalkState = { budget: MAX_NODES };

    const videos = safeRead(cache, 'videos');
    const facts: EpisodeFacts[] = [];
    for (const node of videoNodes(cache, videos, state)) {
      if (state.budget <= 0) break;
      const episode = readEpisodeFacts(cache, node, state);
      if (episode) facts.push(episode);
    }
    if (facts.length === 0) return null;

    // The current video decides WHICH series: if we know it and it is an
    // episode, its series is the catalog; without it we take the largest group.
    const current = currentVideoId ? facts.find((episode) => episode.id === currentVideoId) : undefined;
    // The page TELLS us it is a film when its own node is in the graph with a
    // non-episode shape: offering "Episodes" over a film would be a lie, and a
    // sibling series' episodes would be a worse one.
    if (currentVideoId !== undefined && safeRead(videos, currentVideoId) !== undefined && !current) return null;
    let seriesId = current?.seriesId;
    if (!seriesId) {
      const counts = new Map<string, number>();
      for (const episode of facts) {
        if (!episode.seriesId) continue;
        counts.set(episode.seriesId, (counts.get(episode.seriesId) ?? 0) + 1);
      }
      seriesId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    }
    const selected = seriesId
      ? facts.filter((episode) => episode.seriesId === seriesId)
      : current
        ? [current]
        : facts;
    if (selected.length === 0) return null;
    // A single episode with no season data is not a catalog: it is a film-like
    // page, and offering "Episodes" there would be a lie.
    if (selected.length === 1 && selected[0].seasonId === undefined) return null;

    const seasonsNode = safeRead(cache, 'seasons');
    const bySeason = new Map<string, NetflixEpisodeItem[]>();
    for (const episode of selected) {
      const seasonKey = episode.seasonId ?? '1';
      const list = bySeason.get(seasonKey) ?? [];
      list.push({
        id: episode.id,
        number: episode.number,
        title: episode.title,
        durationSec: episode.durationSec,
        synopsis: episode.synopsis,
        current: episode.id === currentVideoId,
      });
      bySeason.set(seasonKey, list);
    }

    const seasons: NetflixSeasonItem[] = [];
    for (const [seasonKey, episodes] of bySeason) {
      const label = seasonsNode ? readSeasonLabel(cache, safeRead(seasonsNode, seasonKey), state) : {};
      const fallbackNumber = episodes.reduce((min, episode) => Math.min(min, episode.number), Number.POSITIVE_INFINITY);
      const number = label.number ?? (Number.isFinite(Number(seasonKey)) ? Number(seasonKey) : fallbackNumber);
      seasons.push({
        id: seasonKey,
        number: Number.isFinite(number) ? number : seasons.length + 1,
        // No label in the graph: the UI localises "Temporada {n}" itself.
        title: label.title ?? '',
        episodes: episodes.sort((a, b) => a.number - b.number),
      });
    }
    if (seasons.length === 0) return null;
    seasons.sort((a, b) => a.number - b.number);
    return currentVideoId ? { currentVideoId, seasons } : { seasons };
  } catch {
    // A hostile graph is not an error worth printing: the caller falls back to
    // the site's own menu, which is exactly what the user would have used.
    return null;
  }
}
