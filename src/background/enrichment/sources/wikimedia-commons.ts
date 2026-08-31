/**
 * Wikimedia Commons image search — VIP image source (and a great
 * fallback when Unsplash / Pixabay don't have the niche term).
 *
 * Uses the public Commons API (`commons.wikimedia.org/w/api.php`).
 * No key. Returns CC-BY-SA / CC0 / public-domain images.
 *
 * Two-stage concept-anchored search (verified live 2026-08-30):
 *   1. Resolve the token to a Wikidata item via `wbsearchentities`,
 *      requiring an exact label match and rejecting descriptions that
 *      mark disambiguation-style entities (songs, films, companies,
 *      surnames…). This is what keeps `apple` anchored on Q89 (edible
 *      fruit) instead of Q312 (Apple Inc.), and keeps abstract verbs
 *      (`run`, `know`) imageless rather than grabbing a random stream.
 *   2. Search Commons with `haswbstatement:P180=<qid>` so every result
 *      *depicts* the concept — the structured-relevance signal the old
 *      plain-text search lacked (logos, news and SEO images never carry
 *      the P180 statement for the fruit).
 *
 * When stage 1 finds no safe item, the source returns `{}` — an empty
 * image beats a wrong image.
 */

import { fetchJson } from '../fetcher';
import type { EnrichmentContext, EnrichmentSource, SourcePartial } from '../types';

interface SearchResp {
  query?: { search?: Array<{ title?: string }> };
}

interface EntitySearchHit {
  id?: string;
  label?: string;
  description?: string;
}

interface EntitySearchResp {
  search?: EntitySearchHit[];
}

interface ExtMetadataValue {
  value?: string;
}

interface WikimediaExtMetadata {
  ImageDescription?: ExtMetadataValue;
  Categories?: ExtMetadataValue;
  LicenseShortName?: ExtMetadataValue;
}

interface InfoResp {
  query?: {
    pages?: Record<string, {
      title?: string;
      imageinfo?: Array<{
        url?: string;
        thumburl?: string;
        descriptionurl?: string;
        width?: number;
        height?: number;
        thumbwidth?: number;
        thumbheight?: number;
        extmetadata?: WikimediaExtMetadata;
      }>;
    }>;
  };
}

/** Disambiguation-style descriptions that make an item unusable as the
 * visual concept for a vocabulary token. An item whose description
 * matches this can never be what a learner is looking up. */
const NON_CONCEPT_DESCRIPTION =
  /\b(?:song|single|film|movie|album|series|episode|company|corporation|video game|given name|family name|surname|record label|band|musical|character|software|website|newspaper|magazine|novel|book|place|town|city|village|island|river|stream in|station|vocal track|studio recording|unit of time|musical group|television|radio|painting|photograph of)\b/i;

/**
 * Resolve a token to a depictable Wikidata concept.
 * Exact label match + a real concept description; otherwise `undefined`.
 */
async function resolveConceptQid(token: string, ctx: EnrichmentContext): Promise<string | undefined> {
  const url =
    `https://www.wikidata.org/w/api.php` +
    `?action=wbsearchentities&format=json&origin=*` +
    `&language=en&uselang=en&type=item&limit=7` +
    `&search=${encodeURIComponent(token)}`;
  const data = await fetchJson<EntitySearchResp>(url, {
    timeoutMs: ctx.timeoutMs,
    signal: ctx.signal,
  });
  const hits = data?.search ?? [];
  const lowered = token.toLowerCase();
  const exact = hits.find((hit) =>
    (hit.label ?? '').toLowerCase() === lowered &&
    hit.description &&
    !NON_CONCEPT_DESCRIPTION.test(hit.description));
  return exact?.id;
}

function cleanMetadataText(value?: string): string {
  return (value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function metadataTags(metadata?: WikimediaExtMetadata): string[] {
  if (!metadata) return [];
  const description = cleanMetadataText(metadata.ImageDescription?.value);
  const categories = (metadata.Categories?.value ?? '')
    .split('|')
    .map(cleanMetadataText)
    .filter(Boolean);
  const license = cleanMetadataText(metadata.LicenseShortName?.value);
  return [...new Set([description, ...categories, license].filter(Boolean))];
}

export const wikimediaCommonsSource: EnrichmentSource = {
  id: 'wikimediaCommons',
  label: 'Wikimedia',
  async enrich(token, ctx): Promise<SourcePartial> {
    const t = token.trim();
    if (!t) return {};

    // Stage 1 — anchor the token to a depictable concept. Without a safe
    // Q-id there is nothing worth searching for: no image beats a wrong
    // image for abstract tokens.
    const qid = await resolveConceptQid(t, ctx);
    if (!qid) return {};

    // Stage 2 — Commons files that *depict* (P180) the concept.
    const searchUrl =
      `https://commons.wikimedia.org/w/api.php` +
      `?action=query&list=search&format=json&origin=*` +
      `&srnamespace=6` +
      `&srsearch=${encodeURIComponent(`haswbstatement:P180=${qid} filetype:bitmap`)}` +
      `&srlimit=6`;
    const search = await fetchJson<SearchResp>(searchUrl, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    const titles = (search?.query?.search ?? [])
      .map((r) => r.title ?? '')
      .filter((x) => /\.(jpg|jpeg|png|webp)$/i.test(x))
      .slice(0, 4);
    if (titles.length === 0) return {};

    const infoUrl =
      `https://commons.wikimedia.org/w/api.php` +
      `?action=query&prop=imageinfo&iiprop=url|size|extmetadata` +
      `&iiextmetadatafilter=ImageDescription|Categories|LicenseShortName` +
      `&iiurlwidth=600&format=json&origin=*` +
      `&titles=${encodeURIComponent(titles.join('|'))}`;
    const info = await fetchJson<InfoResp>(infoUrl, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    const pages = info?.query?.pages ?? {};
    const imageCandidates = Object.values(pages).flatMap((page) => {
      const imageInfo = page?.imageinfo?.[0];
      const candidateUrl = imageInfo?.thumburl || imageInfo?.url;
      if (!candidateUrl) return [];

      const tags = metadataTags(imageInfo.extmetadata);
      const width = imageInfo.thumburl ? imageInfo.thumbwidth : imageInfo.width;
      const height = imageInfo.thumburl ? imageInfo.thumbheight : imageInfo.height;
      return [{
        url: candidateUrl,
        ...(page.title?.trim() ? { title: page.title.trim() } : {}),
        ...(imageInfo.descriptionurl ? { sourcePageUrl: imageInfo.descriptionurl } : {}),
        ...(typeof width === 'number' ? { width } : {}),
        ...(typeof height === 'number' ? { height } : {}),
        ...(tags.length ? { tags } : {}),
      }];
    }).slice(0, 4);

    if (!imageCandidates.length) return {};
    return { imageUrl: imageCandidates[0].url, imageCandidates };
  },
};
