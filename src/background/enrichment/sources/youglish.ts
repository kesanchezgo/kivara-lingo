/**
 * YouGlish — VIP video pronunciation source.
 *
 * YouGlish links straight to YouTube videos where the queried word is
 * pronounced in real context. There's no public JSON API, but the
 * deeplink format is stable and we don't actually need to parse the
 * page — we just emit the search URL so the popover can render an
 * iframe / external link.
 */

import type { EnrichmentSource, SourcePartial } from '../types';

const LANG_MAP: Record<string, string> = {
  en: 'english',
  es: 'spanish',
  fr: 'french',
  de: 'german',
  it: 'italian',
  pt: 'portuguese',
  ja: 'japanese',
  ko: 'korean',
  zh: 'chinese',
  ru: 'russian',
};

export const youglishSource: EnrichmentSource = {
  id: 'youglish',
  label: 'YouGlish',
  async enrich(token, ctx): Promise<SourcePartial> {
    const lang = LANG_MAP[(ctx.sourceLang || 'en').slice(0, 2)];
    if (!lang) return {};
    const slug = encodeURIComponent(token.trim());
    return {
      videoLinks: [
        { url: `https://youglish.com/pronounce/${slug}/${lang}` },
      ],
    };
  },
};
