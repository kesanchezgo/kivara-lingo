/// <reference types="chrome" />

/**
 * Which optional host each provider needs, keyed by the id the UI stores in
 * settings/`VipSettings`. Derived from `manifest.json → optional_host_permissions`
 * so a manifest change cannot drift from what the code asks for: those 82
 * entries are exactly the provider origins below.
 *
 * The request itself MUST happen inside a user gesture, so every call site is
 * a panel/onboarding interaction (see `requestHosts`).
 */

/** Optional origins, grouped by provider id. */
export const PROVIDER_HOSTS: Record<string, string[]> = {
  // ── Traducción ──────────────────────────────────────────────────────────
  'translate:deepl': ['https://api.deepl.com/*', 'https://api-free.deepl.com/*'],
  'translate:google': ['https://translation.googleapis.com/*'],
  'translate:mymemory': ['https://api.mymemory.translated.net/*'],
  'translate:lingva': [
    'https://lingva.ml/*',
    'https://*.lingva.ml/*',
    'https://lingva.thedaviddelta.com/*',
    'https://lingva.pussthecat.org/*',
    'https://lingva.lunar.icu/*',
    'https://translate.plausibility.cloud/*',
  ],
  'translate:libretranslate': ['https://libretranslate.com/*', 'https://*.libretranslate.com/*'],

  // ── IA (BYOK) ───────────────────────────────────────────────────────────
  'ai:openai': ['https://api.openai.com/*'],
  'ai:anthropic': ['https://api.anthropic.com/*'],
  'ai:google-ai': ['https://generativelanguage.googleapis.com/*'],
  'ai:elevenlabs': ['https://api.elevenlabs.io/*'],

  // ── TTS ─────────────────────────────────────────────────────────────────
  'tts:google': ['https://translate.google.com/*', 'https://www.google.com/*'],
  'tts:elevenlabs': ['https://api.elevenlabs.io/*'],

  // ── Imagen / audio VIP ──────────────────────────────────────────────────
  'vip:unsplash': [
    'https://*.unsplash.com/*',
    'https://unsplash.com/*',
    'https://images.unsplash.com/*',
    'https://api.unsplash.com/*',
  ],
  'vip:pixabay': ['https://*.pixabay.com/*', 'https://pixabay.com/*', 'https://cdn.pixabay.com/*'],
  'vip:openverse': ['https://api.openverse.org/*', 'https://api.openverse.engineering/*'],
  'vip:bing': ['https://www.bing.com/*', 'https://*.bing.net/*'],
  'vip:ddg': ['https://duckduckgo.com/*'],
  'vip:wikimedia': [
    'https://commons.wikimedia.org/*',
    'https://www.wikidata.org/*',
    'https://upload.wikimedia.org/*',
  ],
  'vip:forvo': ['https://forvo.com/*', 'https://*.forvo.com/*'],
  'vip:lingualibre': ['https://lingualibre.org/*', 'https://commons.lingualibre.org/*'],

  // ── Voz humana / YouGlish ───────────────────────────────────────────────
  'audio:forvo': ['https://forvo.com/*', 'https://*.forvo.com/*'],
  'video:youglish': ['https://youglish.com/*'],

  // ── Diccionarios / tesauros / scrapers ──────────────────────────────────
  'dict:wiktionary': [
    'https://en.wiktionary.org/*',
    'https://*.wiktionary.org/*',
    'https://api.wiktapi.dev/*',
  ],
  'dict:datamuse': ['https://api.datamuse.com/*'],
  'dict:dictionaryapi': ['https://api.dictionaryapi.dev/*', 'https://freedictionaryapi.com/*'],
  'dict:moby': ['https://moby-thesaurus.org/*'],
  'dict:thesauruscom': ['https://www.thesaurus.com/*', 'https://thesaurus.com/*'],
  'dict:dictionarycom': [
    'https://www.dictionary.com/*',
    'https://dictionary.com/*',
    'https://audio.dictionary.com/*',
  ],
  'dict:wordhippo': ['https://www.wordhippo.com/*', 'https://wordhippo.com/*'],
  'dict:theidioms': ['https://www.theidioms.com/*', 'https://theidioms.com/*'],
  'dict:cambridge': ['https://*.dictionary.cambridge.org/*', 'https://dictionary.cambridge.org/*'],
  'dict:oxford': ['https://www.oxfordlearnersdictionaries.com/*', 'https://www.ldoceonline.com/*'],
  'dict:merriam': ['https://www.merriam-webster.com/*', 'https://media.merriam-webster.com/*'],
  'dict:britannica': ['https://www.britannica.com/*'],
  'dict:ozdic': ['https://ozdic.com/*', 'https://*.ozdic.com/*'],
  'dict:reverso': ['https://context.reverso.net/*'],
  'dict:pons': ['https://en.pons.com/*'],
  'dict:babla': ['https://en.bab.la/*'],
  'dict:dictcc': ['https://enes.dict.cc/*'],
  'dict:linguee': ['https://www.linguee.com/*', 'https://*.linguee.com/*'],
  'dict:promt': ['https://www.online-translator.com/*'],
  'dict:wordreference': ['https://www.wordreference.com/*'],
  'dict:spanishdict': ['https://www.spanishdict.com/*'],
  'dict:tatoeba': ['https://*.tatoeba.org/*', 'https://api.tatoeba.org/*'],
  'dict:etymonline': ['https://www.etymonline.com/*'],

  // ── Paquetes de diccionario (catálogo + build) ──────────────────────────
  'packs:cdn': [
    'https://*.r2.dev/*',
    'https://*.github.io/*',
    'https://raw.githubusercontent.com/*',
    'https://github.com/*',
    'https://codeload.github.com/*',
  ],

  // ── ASR (retirado salvo KIVARA_WHISPER=1) ───────────────────────────────
  'asr:huggingface': ['https://huggingface.co/*', 'https://cdn-lfs.huggingface.co/*'],
};

import type { useSyncExternalStore } from 'react';

export type ProviderHostModule = typeof PROVIDER_HOSTS & {
  useSyncExternalStore: typeof useSyncExternalStore;
};

export function providerHosts(providerId: string): string[] {
  return PROVIDER_HOSTS[providerId] ?? [];
}

/** Union of hosts for a set of provider ids. */
export function hostsForProviders(ids: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) for (const host of PROVIDER_HOSTS[id] ?? []) out.add(host);
  return [...out];
}

/** All known provider origins — the manifest's optional list, in practice. */
export function allProviderHosts(): string[] {
  return hostsForProviders(Object.keys(PROVIDER_HOSTS));
}
