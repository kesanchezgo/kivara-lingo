/**
 * Bing Images — VIP image source.
 *
 * Bing's image search async endpoint ships compact image-card JSON
 * embedded in the response HTML, no JS execution required. We hit:
 *
 *   GET https://www.bing.com/images/async
 *       ?q=<word>&first=0&count=10&relp=10&scenario=ImageBasicHover
 *       &datsrc=N_I&layout=RowBased&mmasync=1
 *
 * Each image card has an `m="..."` attribute containing JSON with:
 *   - `murl`: medium image URL (the full original on the publisher CDN)
 *   - `turl`: Bing-hosted thumbnail URL
 *   - `purl`: source page URL
 *   - `t`:    image title / caption
 *
 * We surface `t`/`purl` as candidate metadata so the orchestrator's
 * image ranking can run its bad-subject filter (logo/news/SEO) over
 * Bing hits. Bing is a weak-signal FALLBACK source: it only publishes
 * when no free-license, metadata-rich source (Wikimedia/Openverse) had a
 * qualifying image, and even then only when the token anchors lexically.
 *
 * Verified live 2026-05: ~25 cards per request, 200 OK without any
 * cookie or token. Browser-friendly because Bing doesn't put the
 * results behind Cloudflare.
 *
 * Trade-off: Bing returns mixed-license images (some copyright-
 * protected). For free-license-only results, prefer Openverse or
 * Wikimedia Commons. We use Bing as a "best photo" fallback when
 * personal-use captions don't need licensing.
 */

import { fetchHtml } from '../fetcher';
import { decodeEntities } from '../html-utils';
import type { EnrichmentSource, ImageCandidate, SourcePartial } from '../types';

interface BingCard {
  murl?: string;
  turl?: string;
  purl?: string;
  t?: string;
}

export const bingImagesSource: EnrichmentSource = {
  id: 'bingImages',
  label: 'Bing',
  async enrich(token, ctx): Promise<SourcePartial> {
    const q = encodeURIComponent(token.trim());
    const url =
      `https://www.bing.com/images/async` +
      `?q=${q}&first=0&count=10&relp=10` +
      `&scenario=ImageBasicHover&datsrc=N_I&layout=RowBased&mmasync=1`;
    const html = await fetchHtml(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
      headers: {
        Referer: 'https://www.bing.com/',
        Accept: 'text/html,*/*;q=0.8',
      },
    });
    if (!html) return {};

    // Each image card has m="<JSON>" with murl/turl/purl/t.
    const re = /\bm\s*=\s*"({[^"]+})"/g;
    let match: RegExpExecArray | null;
    const imageCandidates: ImageCandidate[] = [];
    const seen = new Set<string>();
    while ((match = re.exec(html)) && imageCandidates.length < 8) {
      try {
        const parsed = JSON.parse(decodeEntities(match[1])) as BingCard;
        const imageUrl = parsed.murl || parsed.turl;
        if (!imageUrl || !/^https?:\/\//.test(imageUrl) || seen.has(imageUrl)) continue;
        seen.add(imageUrl);
        const title = parsed.t ? decodeEntities(parsed.t).trim() : '';
        imageCandidates.push({
          url: imageUrl,
          ...(title ? { title } : {}),
          ...(parsed.purl ? { sourcePageUrl: parsed.purl } : {}),
        });
      } catch {
        // Skip malformed cards.
      }
    }
    if (!imageCandidates.length) return {};
    return { imageUrl: imageCandidates[0].url, imageCandidates };
  },
};
