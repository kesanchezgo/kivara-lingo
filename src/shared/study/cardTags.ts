/** Ported from the v2 prototype (docs/REDESIGN-V2.md §5.3); behaviour unchanged. */

import type { CardKind } from './types';

/**
 * One deck per language for every series; the organization lives in
 * hierarchical Anki tags («::»), not in subdecks:
 *
 *   kivara::lang::<language>        kivara::lang::en
 *   kivara::platform::<platform>    kivara::platform::hbo_max · netflix · disney_plus · prime_video · youtube · crunchyroll
 *   kivara::<series>::<episode>     kivara::game_of_thrones::s01e01
 *   kivara::<movie>                 kivara::inception
 *   kivara::youtube::<video>        kivara::youtube::<video_title>
 *   kivara::<kind>                  kivara::word | expression | sentence | selection
 *
 * That way there is a single daily review per language, no word is duplicated
 * across series (the new context is added to the same note) and a specific
 * series is studied with Anki's custom study filtered by its tag. The language
 * tag is what locates your cards when syncing the vocabulary even if you
 * change, move or rename the deck (see 12.6). The platform tag lets you study
 * «everything on Netflix» just like «everything Game of Thrones». A word that
 * comes up again in another series or platform adds its tags to the same note
 * (cardQueue · addContextToCard).
 */
export type Platform = 'netflix' | 'max' | 'disney' | 'prime' | 'youtube' | 'crunchyroll';

/** Visible name and tag of each platform (Max became HBO Max again in 2025). */
export const PLATFORMS: Record<Platform, { name: string; slug: string }> = {
  netflix: { name: 'Netflix', slug: 'netflix' },
  max: { name: 'HBO Max', slug: 'hbo_max' },
  disney: { name: 'Disney+', slug: 'disney_plus' },
  prime: { name: 'Prime Video', slug: 'prime_video' },
  youtube: { name: 'YouTube', slug: 'youtube' },
  crunchyroll: { name: 'Crunchyroll', slug: 'crunchyroll' },
};
const isPlatform = (v: unknown): v is Platform => typeof v === 'string' && v in PLATFORMS;

export interface CardSource {
  platform: Platform;
  /** Series. Without it: a movie (its title) or a YouTube video. */
  series?: string;
  season?: number;
  episode?: number;
  /** Title of the episode or of the video. */
  title?: string;
}

export const TAG_ROOT = 'kivara';
const MAX_SLUG = 60;

/**
 * Lowercase, spaces → «_», no punctuation. Accents are stripped only from
 * Latin letters (Élite → elite); letters from any other alphabet are kept
 * (進撃の巨人, 스위트홈, карточный_домик). It used to keep only a-z: a Japanese
 * or Korean title came out empty and all those series shared the platform tag
 * (kivara::crunchyroll::s01e01).
 */
export function slugTag(s: string): string {
  const slug = s
    .normalize('NFD').replace(/([A-Za-z])[\u0300-\u036f]+/g, '$1').normalize('NFC')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_]/gu, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  // By characters, not UTF-16 units: never split a character in two.
  return Array.from(slug).slice(0, MAX_SLUG).join('').replace(/_+$/, '');
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `s01e01` if there is both a season and an episode. */
export function episodeCode(src: CardSource): string | undefined {
  return src.season != null && src.episode != null ? `s${pad(src.season)}e${pad(src.episode)}` : undefined;
}

/** `kivara::<series>::<episode>`, `kivara::<movie>` or `kivara::youtube::<title>`. */
export function sourceTag(src: CardSource): string {
  const title = src.title ? slugTag(src.title) : '';
  if (src.series) {
    const item = episodeCode(src) ?? title;
    const group = slugTag(src.series) || PLATFORMS[src.platform].slug;
    return item ? `${TAG_ROOT}::${group}::${item}` : `${TAG_ROOT}::${group}`;
  }
  if (src.platform === 'youtube') return title ? `${TAG_ROOT}::youtube::${title}` : `${TAG_ROOT}::youtube`;
  return `${TAG_ROOT}::${title || PLATFORMS[src.platform].slug}`;
}

/** `kivara::platform::<platform>`. */
export function platformTag(platform: Platform): string {
  return `${TAG_ROOT}::platform::${PLATFORMS[platform].slug}`;
}

export function kindTag(kind: CardKind): string {
  return `${TAG_ROOT}::${kind}`;
}

export function langTag(lang: string): string {
  return `${TAG_ROOT}::lang::${slugTag(lang)}`;
}

export function cardTags(kind: CardKind, source?: CardSource, lang?: string): string[] {
  return [...(lang ? [langTag(lang)] : []), ...(source ? [platformTag(source.platform), sourceTag(source)] : []), kindTag(kind)];
}

/**
 * Tags of a card. Old cards without tags derive them from their metadata;
 * cards missing the language or platform tag get them added, in the same order
 * as new cards.
 */
export function tagsOf(card: { kind: CardKind; tags?: string[]; source?: CardSource; lang?: string }): string[] {
  if (!card.tags?.length) return cardTags(card.kind, card.source, card.lang);
  const head = [card.lang ? langTag(card.lang) : '', card.source ? platformTag(card.source.platform) : ''].filter(Boolean);
  if (head.every((tag) => card.tags!.includes(tag))) return card.tags;
  return [...head, ...card.tags.filter((tag) => !head.includes(tag))];
}

/** English render of the localized `recent.episodeCode` message: «S1 E1». */
const episodeLabel = (season: number, episode: number) => `S${season} E${episode}`;

/** «Game of Thrones · S1 E1» / the movie or video title. `undefined` if there is no source (old cards). */
export function sourceLabel(src?: CardSource): string | undefined {
  if (!src) return undefined;
  if (!src.series) return src.title;
  const ep = src.season != null && src.episode != null ? episodeLabel(src.season, src.episode) : src.title;
  return ep ? `${src.series} · ${ep}` : src.series;
}

/**
 * Readable origin of a card: «Game of Thrones · S1 E1 · HBO Max»,
 * «Inception · Netflix», «<video> · YouTube». It is what goes in the note's
 * «Origin» field (shown on the card) and in the toasts.
 */
export function originLabel(src?: CardSource): string | undefined {
  if (!src) return undefined;
  return [sourceLabel(src), PLATFORMS[src.platform].name].filter(Boolean).join(' · ');
}

/** Validation of what is read from disk: a malformed source is dropped (the card is still valid). */
export function reviveSource(raw: unknown): CardSource | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (!isPlatform(r.platform)) return undefined;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  return { platform: r.platform, series: str(r.series), season: num(r.season), episode: num(r.episode), title: str(r.title) };
}