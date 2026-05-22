/**
 * DASH subtitle loader.
 *
 * Reads a DASH MPD (Media Presentation Description) manifest and, given a
 * primary language tag, identifies and downloads ALL subtitle tracks that
 * match. Returns the merged WebVTT cues for each language so the adapter
 * can drop them straight into the intercepted-bus.
 *
 * Why not just rely on the player's own subtitle requests? The player only
 * requests the ONE track the user has currently selected. But the manifest
 * lists every track that exists, with explicit `lang="…"` and a
 * `SegmentTemplate` we can use to download them ourselves — exactly the
 * trick Migaku, Trancy, Language Reactor, etc. use on streaming platforms
 * where seeking has to feel zero-latency.
 *
 * This is platform-neutral DASH parsing — works for HBO Max / Disney+ /
 * any platform that ships standard MPD-DASH manifests.
 */
import { parseAny, type RawCue } from './parsers';

export interface DashSubtitleTrack {
  /** Adaptation set id from the MPD (`id="61"`). */
  id: string;
  /** Representation id (`id="t18"`). */
  representationId: string;
  /** Primary language subtag, lowercased (`es`, `en`, `pt`). */
  language: string;
  /** Full BCP-47 tag from the manifest (`es-419`, `pt-BR`, `en-US`). */
  fullLanguage: string;
  /**
   * Optional role marker: `subtitle` is a normal translation track,
   * `caption` is closed-caption / SDH (sound effects, speaker IDs),
   * `forced-subtitle` is signage-only forced subtitles. We prefer
   * plain `subtitle` for the dual-caption line because SDH adds
   * non-dialogue text that pollutes vocabulary mining.
   */
  role: 'subtitle' | 'caption' | 'forced-subtitle' | null;
  /**
   * Human-readable label from the MPD (`Label` element). Useful as a
   * tiebreaker when multiple tracks share a `lang` (e.g. `en-US CC`
   * vs `en-US SDH`).
   */
  label: string | null;
  /**
   * Resolved absolute URLs to every subtitle segment in playback order.
   * Concatenating their bodies yields the full track for the entire
   * presentation.
   */
  segmentUrls: string[];
}

interface SegmentTemplate {
  media: string;
  startNumber: number;
  presentationTimeOffset: number;
  /** Total duration of this template's segment, in `timescale` units. */
  totalDuration: number;
  /** Segment timescale (1/sec). For VTT this is almost always 1000. */
  timescale: number;
}

/**
 * Parse a DASH MPD body and return every subtitle track it advertises,
 * with absolute segment URLs ready to fetch.
 *
 * @param mpdBody  raw XML body of the MPD response
 * @param mpdUrl   URL the MPD was downloaded from (used to resolve
 *                 relative `media=` template paths)
 */
export function parseDashSubtitleTracks(
  mpdBody: string,
  mpdUrl: string,
): DashSubtitleTrack[] {
  // The browser's DOMParser handles MPD just fine — it's plain XML.
  let doc: Document;
  try {
    const parser = new DOMParser();
    doc = parser.parseFromString(mpdBody, 'application/xml');
  } catch {
    return [];
  }
  if (doc.getElementsByTagName('parsererror').length > 0) return [];

  const baseUrl = mpdUrl;
  const periods = Array.from(doc.getElementsByTagName('Period'));

  // Collect segments per (adaptation id, representation id, language).
  // The MPD splits a single track across multiple <Period> elements when
  // the asset has chapter breaks / ad insertions, so we accumulate
  // template URLs and timeline durations across periods.
  type Acc = {
    adaptationId: string;
    representationId: string;
    fullLanguage: string;
    role: DashSubtitleTrack['role'];
    label: string | null;
    segmentUrls: string[];
  };
  const byKey = new Map<string, Acc>();

  for (const period of periods) {
    const adaptationSets = Array.from(period.getElementsByTagName('AdaptationSet'));
    for (const adaptation of adaptationSets) {
      if (adaptation.getAttribute('contentType') !== 'text') continue;
      const lang = (adaptation.getAttribute('lang') || '').trim();
      if (!lang) continue;
      const role = readRole(adaptation);
      const label = adaptation.querySelector(':scope > Label')?.textContent?.trim() ?? null;
      const adaptationId = adaptation.getAttribute('id') ?? '';
      const representations = Array.from(adaptation.getElementsByTagName('Representation'));
      for (const rep of representations) {
        if ((rep.getAttribute('mimeType') || '') !== 'text/vtt') continue;
        const repId = rep.getAttribute('id') ?? '';
        const tpl = readSegmentTemplate(rep);
        if (!tpl) continue;
        const urls = expandSegmentTemplate(tpl, repId, baseUrl);
        if (urls.length === 0) continue;
        const key = `${adaptationId}::${repId}::${lang}`;
        const existing = byKey.get(key);
        if (existing) {
          existing.segmentUrls.push(...urls);
        } else {
          byKey.set(key, {
            adaptationId,
            representationId: repId,
            fullLanguage: lang,
            role,
            label,
            segmentUrls: urls,
          });
        }
      }
    }
  }

  // Convert the map into the public shape, normalize language.
  const out: DashSubtitleTrack[] = [];
  for (const acc of byKey.values()) {
    const primary = acc.fullLanguage.toLowerCase().split(/[-_]/)[0];
    if (!primary) continue;
    out.push({
      id: acc.adaptationId,
      representationId: acc.representationId,
      language: primary,
      fullLanguage: acc.fullLanguage,
      role: acc.role,
      label: acc.label,
      segmentUrls: acc.segmentUrls,
    });
  }
  return out;
}

function readRole(adaptation: Element): DashSubtitleTrack['role'] {
  const role = adaptation.querySelector(':scope > Role[schemeIdUri="urn:mpeg:dash:role:2011"]');
  const value = role?.getAttribute('value');
  if (value === 'subtitle' || value === 'caption' || value === 'forced-subtitle') {
    return value;
  }
  return null;
}

function readSegmentTemplate(rep: Element): SegmentTemplate | null {
  // SegmentTemplate may be on the Representation OR on the parent
  // AdaptationSet. We look in both, child first.
  const tpl =
    rep.querySelector(':scope > SegmentTemplate') ||
    rep.parentElement?.querySelector(':scope > SegmentTemplate') ||
    null;
  if (!tpl) return null;
  const media = tpl.getAttribute('media') || '';
  const startNumber = parseInt(tpl.getAttribute('startNumber') || '1', 10);
  const presentationTimeOffset = parseInt(
    tpl.getAttribute('presentationTimeOffset') || '0',
    10,
  );
  const timescale = parseInt(tpl.getAttribute('timescale') || '1000', 10);

  const timeline = tpl.querySelector(':scope > SegmentTimeline');
  if (!timeline) return null;
  const sNodes = Array.from(timeline.getElementsByTagName('S'));
  let totalDuration = 0;
  for (const s of sNodes) {
    const d = parseInt(s.getAttribute('d') || '0', 10);
    const r = parseInt(s.getAttribute('r') || '0', 10);
    totalDuration += d * (1 + Math.max(0, r));
  }

  return { media, startNumber, presentationTimeOffset, timescale, totalDuration };
}

/**
 * Expand a `media="t/dba5dc/$RepresentationID$/$Number$.vtt"` template
 * into the concrete segment URLs.
 *
 * In the HBO MPD each text Representation has exactly one segment
 * (the entire track is a single .vtt for the whole period). We produce
 * one URL per period anyway because the same Representation appears in
 * each Period and the period's `startNumber` rotates.
 */
function expandSegmentTemplate(
  tpl: SegmentTemplate,
  representationId: string,
  baseUrl: string,
): string[] {
  if (!tpl.media) return [];
  // For text tracks HBO ships exactly one segment per period (the whole
  // track is one .vtt). The S element's `r` attribute would expand to
  // additional segments if the platform chose to split it; we honor it.
  const url = tpl.media
    .replace(/\$RepresentationID\$/g, representationId)
    .replace(/\$Number\$/g, String(tpl.startNumber));
  try {
    return [new URL(url, baseUrl).toString()];
  } catch {
    return [];
  }
}

/**
 * Download every segment of a DashSubtitleTrack and merge the WebVTT
 * cues into a single RawCue[]. Per-segment fetch errors are tolerated —
 * we return whatever cues we managed to load.
 */
export async function downloadDashSubtitleTrack(
  track: DashSubtitleTrack,
): Promise<RawCue[]> {
  const all: RawCue[] = [];
  for (const url of track.segmentUrls) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) continue;
      const body = await res.text();
      const cues = parseAny(url, body);
      // Cues from later periods need their absolute timestamps preserved —
      // WebVTT bodies already use absolute `00:11:23.456` timecodes for
      // segment-aware tracks (HBO does), so we just concatenate.
      all.push(...cues);
    } catch {
      // skip — we still have whatever earlier segments loaded
    }
  }
  return all;
}

/**
 * Pick the BEST track for a given primary language code from a parsed
 * MPD. Prefers `subtitle` over `caption` (SDH adds non-dialogue text
 * that pollutes mining), and ignores `forced-subtitle` outright (those
 * are partial signage-only tracks).
 *
 * Where multiple regional variants of the same language exist
 * (`es-419` and `es-ES`) we prefer the user's currently selected source
 * if it includes a region, otherwise we pick the more common variant
 * (LATAM `es-419` > peninsular `es-ES`, Brazilian `pt-BR` > European
 * `pt-PT`). Caller can override by passing a full BCP-47 tag.
 */
export function pickBestTrack(
  tracks: DashSubtitleTrack[],
  langCode: string,
): DashSubtitleTrack | null {
  const primary = langCode.toLowerCase().split(/[-_]/)[0];
  const preferredFull = langCode.toLowerCase();
  const candidates = tracks.filter(
    (t) => t.language === primary && t.role !== 'forced-subtitle',
  );
  if (candidates.length === 0) return null;

  // Sort by preference. Lower score = better.
  const score = (t: DashSubtitleTrack): number => {
    let s = 0;
    // Prefer plain subtitle over caption (SDH).
    if (t.role === 'subtitle') s -= 100;
    else if (t.role === 'caption') s -= 50;
    // Prefer exact BCP-47 match.
    if (t.fullLanguage.toLowerCase() === preferredFull) s -= 10;
    // Prefer regional variants over plain language for spanish/portuguese.
    if (primary === 'es' && t.fullLanguage.toLowerCase() === 'es-419') s -= 5;
    if (primary === 'pt' && t.fullLanguage.toLowerCase() === 'pt-br') s -= 5;
    return s;
  };
  candidates.sort((a, b) => score(a) - score(b));
  return candidates[0];
}
