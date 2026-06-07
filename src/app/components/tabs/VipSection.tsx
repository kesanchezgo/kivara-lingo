/**
 * VIP enrichment settings section for the side-panel.
 *
 * Exposes:
 *   - Master "VIP" toggle. When off, the chain only runs the free-tier
 *     standard sources (Free Dictionary API + Datamuse) — no scraping.
 *   - Per-source granular toggles, grouped into:
 *     · Diccionarios (definitions, IPA, examples, collocations)
 *     · Bilingüe (translations + sentence pairs)
 *     · Audio (word-level pronunciation)
 *     · Imágenes (hero image for the card)
 *     · Video (YouGlish links to real videos)
 *
 * Visual contract: matches the existing SettingsTab cards (rounded-md
 * container, 11px label, indigo accent). No marketing copy — just the
 * source name and a one-line description so the user can decide what
 * to keep on.
 */

import React from 'react';
import { useKivaraStore } from '../../../shared/store';
import { InfoHint } from '../InfoHint';
import type { VipSettings } from '../../../shared/types';
type VipKey = keyof VipSettings;

interface SourceMeta {
  key: VipKey;
  label: string;
  hint: string;
}

/* ── Standard tier: free APIs, no token, run regardless of VIP master switch ── */

const STD_DICT_SOURCES: SourceMeta[] = [
  { key: 'bundled', label: 'Bundled (offline)', hint: 'Diccionario curado + extensiones + CEFR + thesaurus + collocations académicas. ~10 893 entradas, ~250 KB. Funciona offline.' },
  { key: 'yomitanPacks', label: 'Yomitan packs', hint: 'Packs Wiktionary instalados (kty-en-es: 67k entradas, kty-en-en: 500k, kty-en-ipa: 200k). Cubren phrasals, idioms, MWE y slang.' },
  { key: 'wiktionary', label: 'Wiktionary REST', hint: 'API oficial Wikimedia (en.wiktionary.org/api/rest_v1). Cubre phrasal verbs, idioms y MWE multi-palabra que otros diccionarios no indexan. Sin token.' },
  { key: 'wiktionaryHtml', label: 'Wiktionary HTML', hint: 'Parser de la página HTML completa de Wiktionary: etimología + sinónimos + antónimos + términos relacionados que el endpoint JSON no expone. Crucial para frases multi-palabra (kick the bucket, piece of cake, turn off). Sin token.' },
  { key: 'wiktionaryApi', label: 'WiktionaryAPI', hint: 'freedictionaryapi.com — mirror Wiktionary con datos completos para frases multi-palabra (kick the bucket → 18+ sinónimos, big deal → 2 senses). Sin token.' },
  { key: 'wiktApi', label: 'WiktApi / Kaikki', hint: 'wiktapi.dev — JSON estructurado de Wiktionary/Kaikki: traducciones ES, sentidos, ejemplos, formas, IPA y audio para palabras simples. Sin token.' },
  { key: 'britannicaDictionary', label: 'Britannica Dictionary', hint: 'Diccionario learner gratuito: definiciones simples y muchos ejemplos. Mejora Standard cuando FreeDictionary elige un sentido incorrecto. Sin token.' },
  { key: 'mobyThesaurus', label: 'Moby Thesaurus', hint: 'Tesauro público de Grady Ward (1996). 30k entradas con hasta 100+ sinónimos por palabra común. Sin token, sin antónimos.' },
  { key: 'thesaurusCom', label: 'Thesaurus.com', hint: 'Antónimos profesionales para sustantivos abstractos / técnicos (algorithm → deviation, idleness; apple → 66 antónimos; house → 157). Solo palabra simple. Sin token.' },
  { key: 'wordHippo', label: 'WordHippo', hint: 'Antónimos de phrasals, idioms, MWE y sustantivos concretos (kick the bucket → bring back to life, big deal → small potatoes, apple → country) que ningún otro tesauro free cubre. Sin token.' },
  { key: 'theIdioms', label: 'TheIdioms', hint: 'theidioms.com — origen e historia de idioms en inglés. Mejor fuente gratuita para etimología de frases (kick the bucket, piece of cake, big deal). Solo aplica a frases multi-palabra.' },
  { key: 'freeDictionary', label: 'Free Dictionary API', hint: 'IPA + audio MP3 de Wikimedia + sinónimos. Gratis sin token (api.dictionaryapi.dev).' },
  { key: 'datamuse', label: 'Datamuse', hint: 'Collocations corpus-based + relaciones. Gratis sin token (api.datamuse.com).' },
];

const STD_BILINGUAL_SOURCES: SourceMeta[] = [
  { key: 'tatoeba', label: 'Tatoeba', hint: 'Corpus comunitario CC-BY de oraciones paralelas EN-ES (api.tatoeba.org). Sin token.' },
];

const STD_AUDIO_SOURCES: SourceMeta[] = [
  { key: 'linguaLibre', label: 'Lingua Libre', hint: 'Wikimedia: pronunciaciones CC-BY de hablantes nativos. Sin token.' },
  { key: 'googleTtsFallback', label: 'Google TTS fallback', hint: 'Síntesis sintética cuando ninguna grabación humana respondió. Sin token.' },
];

const STD_IMAGE_SOURCES: SourceMeta[] = [
  { key: 'bingImages', label: 'Bing Images', hint: 'Búsqueda web sin token. ~25 fotos por consulta, licencia mixta — ideal cuando importa la pertinencia más que la licencia.' },
  { key: 'openverse', label: 'Openverse', hint: 'Imágenes CC-BY / CC0 (Flickr + Wikimedia + museos) vía API pública sin token.' },
  { key: 'wikimediaCommons', label: 'Wikimedia Commons', hint: 'Imágenes CC con metadata, ideal para términos nicho.' },
  { key: 'duckduckgoImages', label: 'DuckDuckGo Images', hint: 'Búsqueda última-milla cuando todo lo anterior falla.' },
];

const STD_ETY_VIDEO: SourceMeta[] = [
  { key: 'etymonline', label: 'Etymonline', hint: 'Etimología profesional (etymonline.com): origen + evolución histórica. Sin token.' },
  { key: 'youglish', label: 'YouGlish', hint: 'Enlaces a videos de YouTube con la palabra pronunciada. URL only, sin fetch.' },
];

/* ── VIP tier: scrapes of commercial dictionaries + BYOK image APIs ── */

const VIP_DICT_SOURCES: SourceMeta[] = [
  { key: 'cambridge', label: 'Cambridge', hint: 'Definiciones, collocations, IPA y audio UK/US.' },
  { key: 'oxfordLearners', label: 'Oxford Learner\u2019s', hint: 'Definiciones learner-grade y ejemplos curados.' },
  { key: 'longman', label: 'Longman LDOCE', hint: 'Definiciones simples (Defining Vocabulary 2 000).' },
  { key: 'collins', label: 'Collins COBUILD', hint: 'Estilo "If something is X…" + ejemplos del corpus.' },
  { key: 'merriamWebster', label: 'Merriam-Webster', hint: 'American English authority, etimología detallada.' },
  { key: 'ozdic', label: 'Oxford Collocations', hint: 'Mirror de OCD (ozdic.com): 250 000 collocations curadas Oxford con patrones gramaticales (ADJ, VERB, PREP).' },
  { key: 'oxfordCollocations', label: 'Oxford Coll. pack', hint: 'Reservado para un pack importable offline (placeholder).' },
];

const VIP_BILINGUAL_SOURCES: SourceMeta[] = [
  { key: 'reverso', label: 'Reverso Context', hint: 'Frases EN-ES de subtítulos / libros / prensa.' },
  { key: 'linguee', label: 'Linguee', hint: 'Traducciones y ejemplos curados de la web.' },
  { key: 'wordReference', label: 'WordReference', hint: 'Equivalencias EN-ES naturales.' },
  { key: 'spanishDict', label: 'SpanishDict', hint: 'Conjugación + ejemplos paralelos.' },
];

const VIP_AUDIO_SOURCES: SourceMeta[] = [
  { key: 'cambridgeAudio', label: 'Cambridge audio', hint: 'MP3 oficial UK + US (extraído por la fuente Cambridge).' },
  { key: 'oxfordAudio', label: 'Oxford audio', hint: 'MP3 oficial UK + US (extraído por la fuente Oxford).' },
  { key: 'forvo', label: 'Forvo', hint: 'Pronunciación humana de hablantes nativos.' },
];

const VIP_IMAGE_SOURCES: SourceMeta[] = [
  { key: 'unsplash', label: 'Unsplash (BYOK)', hint: 'Fotos profesionales con licencia Unsplash. Necesita clave gratuita (input abajo). Sin clave queda inactivo.' },
  { key: 'pixabay', label: 'Pixabay', hint: 'Stock variado, licencia libre. Funciona sin clave por scraping; con clave (input abajo) usa la API oficial (más estable).' },
];

export function VipSection() {
  const vip = useKivaraStore((s) => s.vip);
  const setVip = useKivaraStore((s) => s.setVip);

  const setKey = <K extends VipKey>(k: K, v: VipSettings[K]) => {
    setVip((prev) => ({ ...prev, [k]: v }));
  };

  return (
    <div className="p-2.5 space-y-3">
      {/* Bundled overlays — read-only info panel. These ship inside the
          extension; the user doesn't choose them, but they should know
          they're active so the popover's data feels less magical. */}
      <div className="rounded-md bg-zinc-50/70 dark:bg-zinc-800/30 border border-zinc-200/60 dark:border-zinc-800/70 px-2.5 py-2 space-y-1.5">
        <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          <span>Datos locales (siempre activos)</span>
          <InfoHint message="Bundled con la extensión. Suman ~250 KB y se cargan a memoria al instante. No requieren internet." />
        </div>
        <ul className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-snug space-y-0.5 ml-1">
          <li>• Dict. curado (4 151 entradas) + extensiones</li>
          <li>• Oxford 3000/5000 CEFR (4 950 niveles A2/B2)</li>
          <li>• Phrasal Academic Lexicon (672 frases)</li>
          <li>• Academic Collocation List (2 469 chunks)</li>
          <li>• Fernald Thesaurus 1896 (610 sin/ant)</li>
        </ul>
      </div>

      {/* Standard tier — runs regardless of master switch, free APIs. */}
      <div className="rounded-md bg-emerald-50/40 dark:bg-emerald-950/20 border border-emerald-200/40 dark:border-emerald-900/40 px-2.5 py-2">
        <div className="text-[11.5px] font-semibold text-emerald-800 dark:text-emerald-300 mb-1">
          Estándar (gratis, sin tokens, siempre activo)
        </div>
        <div className="text-[10px] text-emerald-700/80 dark:text-emerald-400/80 leading-snug">
          20 fuentes públicas que no requieren clave ni scraping de diccionarios comerciales.
          Funcionan independiente del switch VIP. Cada una se puede silenciar abajo.
        </div>
      </div>

      <SubGroup title="Standard · diccionario y relaciones" hint="APIs JSON públicas." sources={STD_DICT_SOURCES} vip={vip} setKey={setKey} />
      <SubGroup title="Standard · ejemplos bilingües" hint="Corpus paralelo CC-BY de Tatoeba." sources={STD_BILINGUAL_SOURCES} vip={vip} setKey={setKey} />
      <SubGroup title="Standard · audio" hint="Pronunciación nativa (Lingua Libre Wikimedia) + síntesis de fallback." sources={STD_AUDIO_SOURCES} vip={vip} setKey={setKey} />
      <SubGroup title="Standard · imágenes" hint="Búsquedas web sin token." sources={STD_IMAGE_SOURCES} vip={vip} setKey={setKey} />
      <SubGroup title="Standard · etimología y video" hint="Etymonline (origen) + YouGlish (videos con la palabra hablada)." sources={STD_ETY_VIDEO} vip={vip} setKey={setKey} />

      {/* VIP master switch */}
      <div className="rounded-md bg-amber-50/40 dark:bg-amber-950/20 border border-amber-200/40 dark:border-amber-900/40 px-2.5 py-2">
        <label className="flex items-center justify-between gap-2 cursor-pointer">
          <span className="flex flex-col">
            <span className="text-[11.5px] font-semibold text-amber-900 dark:text-amber-300">
              Activar VIP (scrapes de diccionarios comerciales)
            </span>
            <span className="text-[10px] text-amber-800/70 dark:text-amber-400/70 leading-snug mt-0.5">
              Cambridge · Oxford · Longman · Collins · Merriam-Webster · Reverso · Linguee · WordReference · SpanishDict · Forvo · Ozdic
              + claves opcionales Unsplash/Pixabay. Cada palabra tarda 1-3&nbsp;s la primera vez; las siguientes son instantáneas (caché).
            </span>
          </span>
          <input
            type="checkbox"
            checked={vip.enabled}
            onChange={(e) => setKey('enabled', e.target.checked)}
            className="sl-checkbox shrink-0"
          />
        </label>
      </div>

      {!vip.enabled && (
        <div className="text-[10.5px] text-zinc-500 italic px-1 leading-snug">
          VIP está desactivado. La tarjeta usa solo datos locales + las 20 fuentes Standard arriba.
        </div>
      )}

      {vip.enabled && (
        <>
          <SubGroup title="VIP · diccionarios comerciales" hint="Scrapes de los grandes learner's dictionaries." sources={VIP_DICT_SOURCES} vip={vip} setKey={setKey} />
          <SubGroup title="VIP · bilingüe (premium)" hint="Reverso/Linguee/WordRef/SpanishDict — pares EN-ES de mejor calidad." sources={VIP_BILINGUAL_SOURCES} vip={vip} setKey={setKey} />
          <SubGroup title="VIP · audio (premium)" hint="MP3 oficiales de Cambridge/Oxford + Forvo (hablantes nativos)." sources={VIP_AUDIO_SOURCES} vip={vip} setKey={setKey} />
          <SubGroup title="VIP · imágenes (BYOK opcional)" hint="Unsplash y Pixabay con clave gratis. Sin VIP, las imágenes Standard cubren bien." sources={VIP_IMAGE_SOURCES} vip={vip} setKey={setKey} />

          {/* Optional API keys for Unsplash + Pixabay — both are free
              with no credit card required, but require a one-time
              developer signup. Without keys, Unsplash is inactive
              (Anubis JS-challenge gate) and Pixabay falls back to
              HTML scraping. */}
          <div className="rounded-md bg-zinc-50/70 dark:bg-zinc-800/30 border border-zinc-200/60 dark:border-zinc-800/70 px-2.5 py-2 space-y-2">
            <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              <span>Claves API opcionales (gratis sin tarjeta)</span>
              <InfoHint message="Ambas plataformas regalan tier gratuito generoso (Unsplash 50/h, Pixabay 100/min). Sin clave: Unsplash queda inactivo, Pixabay usa scraping." />
            </div>
            <label className="flex flex-col gap-1 text-[11px] text-zinc-700 dark:text-zinc-300">
              <span className="flex items-center justify-between gap-1">
                <span>Unsplash Access Key</span>
                <a href="https://unsplash.com/developers" target="_blank" rel="noopener noreferrer" className="text-[10px] text-indigo-500 hover:underline">obtener</a>
              </span>
              <input
                type="password"
                value={vip.unsplashAccessKey || ''}
                onChange={(e) => setKey('unsplashAccessKey', e.target.value)}
                placeholder="(opcional)"
                className="sl-input"
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-zinc-700 dark:text-zinc-300">
              <span className="flex items-center justify-between gap-1">
                <span>Pixabay API Key</span>
                <a href="https://pixabay.com/api/docs/" target="_blank" rel="noopener noreferrer" className="text-[10px] text-indigo-500 hover:underline">obtener</a>
              </span>
              <input
                type="password"
                value={vip.pixabayApiKey || ''}
                onChange={(e) => setKey('pixabayApiKey', e.target.value)}
                placeholder="(opcional, scrape activo sin clave)"
                className="sl-input"
                spellCheck={false}
                autoComplete="off"
              />
            </label>
          </div>

          {/* Fine tuning */}
          <div className="rounded-md bg-zinc-50/70 dark:bg-zinc-800/30 border border-zinc-200/60 dark:border-zinc-800/70 px-2.5 py-2 space-y-2">
            <label className="flex items-center justify-between gap-2 text-[11px] text-zinc-700 dark:text-zinc-300">
              <span className="flex items-center gap-1">
                Timeout por fuente
                <InfoHint message="Si una fuente tarda más de este tiempo, se cancela y el resto continúa." />
              </span>
              <span className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={500}
                  max={20000}
                  step={500}
                  value={vip.perSourceTimeoutMs}
                  onChange={(e) => setKey('perSourceTimeoutMs', Number(e.target.value) || 4000)}
                  className="sl-input text-right tabular-nums"
                  style={{ width: 70 }}
                />
                <span className="text-[10px] text-zinc-500">ms</span>
              </span>
            </label>
            <label className="flex items-center justify-between gap-2 text-[11px] text-zinc-700 dark:text-zinc-300">
              <span className="flex items-center gap-1">
                Caché
                <InfoHint message="Tiempo que se conserva el resultado en IndexedDB antes de re-consultar." />
              </span>
              <span className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={vip.cacheTtlDays}
                  onChange={(e) => setKey('cacheTtlDays', Number(e.target.value) || 14)}
                  className="sl-input text-right tabular-nums"
                  style={{ width: 50 }}
                />
                <span className="text-[10px] text-zinc-500">días</span>
              </span>
            </label>
          </div>
        </>
      )}

      {/* Cache management — always visible (Standard mode also caches). */}
      <CacheManager />
    </div>
  );
}

function SubGroup({
  title,
  hint,
  sources,
  vip,
  setKey,
}: {
  title: string;
  hint: string;
  sources: SourceMeta[];
  vip: VipSettings;
  setKey: <K extends VipKey>(k: K, v: VipSettings[K]) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 px-1">
        <span className="text-[9px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          {title}
        </span>
        <InfoHint message={hint} />
      </div>
      <div className="space-y-1">
        {sources.map((s) => (
          <label
            key={s.key}
            className="rounded-md bg-zinc-50/70 dark:bg-zinc-800/30 border border-zinc-200/60 dark:border-zinc-800/70 px-2 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-zinc-100/70 dark:hover:bg-zinc-800/50 transition-colors"
          >
            <input
              type="checkbox"
              checked={vip[s.key] === true}
              onChange={(e) => setKey(s.key, e.target.checked as VipSettings[typeof s.key])}
              className="sl-checkbox shrink-0"
            />
            <div className="flex-1 min-w-0">
              <div className="text-[11.5px] font-medium text-zinc-800 dark:text-zinc-200 leading-tight">
                {s.label}
              </div>
              <div className="text-[10px] text-zinc-500 dark:text-zinc-500 leading-tight mt-0.5">
                {s.hint}
              </div>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}


interface CacheBucket {
  id: 'enrichment' | 'translation' | 'ai' | 'media';
  label: string;
  count: number;
  bytes: number;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Cache management panel. Shows per-bucket row counts + approximate size
 * and lets the user wipe everything (with a confirm) or a single bucket.
 * Talks to the service worker via GET_CACHE_STATS / CLEAR_CACHE.
 */
function CacheManager() {
  const [buckets, setBuckets] = React.useState<CacheBucket[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  const refresh = React.useCallback(() => {
    try {
      chrome.runtime.sendMessage({ type: 'GET_CACHE_STATS' }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res?.ok && res.stats?.buckets) setBuckets(res.stats.buckets);
      });
    } catch {
      // chrome.runtime not available (e.g. storybook) — leave null.
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const clearAll = () => {
    setBusy(true);
    try {
      chrome.runtime.sendMessage({ type: 'CLEAR_CACHE', which: 'all' }, (res) => {
        setBusy(false);
        setConfirming(false);
        if (chrome.runtime.lastError) return;
        if (res?.ok) refresh();
      });
    } catch {
      setBusy(false);
      setConfirming(false);
    }
  };

  const total = buckets?.reduce((a, b) => a + b.count, 0) ?? 0;
  const totalBytes = buckets?.reduce((a, b) => a + b.bytes, 0) ?? 0;

  return (
    <div className="rounded-md bg-zinc-50/70 dark:bg-zinc-800/30 border border-zinc-200/60 dark:border-zinc-800/70 px-2.5 py-2 space-y-2">
      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        <span>Caché almacenada</span>
        <InfoHint message="Resultados guardados localmente (IndexedDB) para que re-consultar la misma palabra/subtítulo sea instantáneo. No incluye tus diccionarios instalados ni tus tarjetas guardadas." />
      </div>

      {buckets === null ? (
        <div className="text-[10.5px] text-zinc-500 italic">Cargando…</div>
      ) : total === 0 ? (
        <div className="text-[10.5px] text-zinc-500 italic">La caché está vacía.</div>
      ) : (
        <ul className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-snug space-y-0.5">
          {buckets.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{b.label}</span>
              <span className="tabular-nums text-zinc-500 shrink-0">
                {b.count} · {formatBytes(b.bytes)}
              </span>
            </li>
          ))}
          <li className="flex items-center justify-between gap-2 pt-0.5 mt-0.5 border-t border-zinc-200/60 dark:border-zinc-800/70 font-medium text-zinc-700 dark:text-zinc-300">
            <span>Total</span>
            <span className="tabular-nums">{total} · {formatBytes(totalBytes)}</span>
          </li>
        </ul>
      )}

      {!confirming ? (
        <button
          type="button"
          disabled={busy || total === 0}
          onClick={() => setConfirming(true)}
          className="w-full text-[11px] rounded-md border border-red-300/60 dark:border-red-900/50 text-red-600 dark:text-red-400 px-2 py-1.5 hover:bg-red-50/60 dark:hover:bg-red-950/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Limpiar caché
        </button>
      ) : (
        <div className="space-y-1.5">
          <div className="text-[10.5px] text-amber-700 dark:text-amber-400 leading-snug">
            Esto borra todos los resultados guardados (palabras, traducciones, IA, dedup multimedia).
            La próxima consulta de cada palabra volverá a tardar 1-3&nbsp;s mientras se rellena de nuevo.
            <strong className="font-medium"> No</strong> afecta tus diccionarios instalados ni tus tarjetas Anki.
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={clearAll}
              className="flex-1 text-[11px] rounded-md bg-red-600 text-white px-2 py-1.5 hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {busy ? 'Limpiando…' : 'Sí, limpiar todo'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="flex-1 text-[11px] rounded-md border border-zinc-300/60 dark:border-zinc-700/60 text-zinc-600 dark:text-zinc-300 px-2 py-1.5 hover:bg-zinc-100/60 dark:hover:bg-zinc-800/40 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
