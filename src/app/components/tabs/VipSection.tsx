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

const STANDARD_SOURCES: SourceMeta[] = [
  { key: 'freeDictionary', label: 'Free Dictionary API', hint: 'IPA + audio MP3 de Wikimedia + sinónimos. Gratis sin token (api.dictionaryapi.dev).' },
  { key: 'datamuse', label: 'Datamuse', hint: 'Collocations corpus-based + relaciones. Gratis sin token (api.datamuse.com).' },
];

const DICT_SOURCES: SourceMeta[] = [
  { key: 'cambridge', label: 'Cambridge', hint: 'Definiciones, collocations, IPA y audio UK/US.' },
  { key: 'oxfordLearners', label: 'Oxford Learner\u2019s', hint: 'Definiciones learner-grade y ejemplos curados.' },
  { key: 'longman', label: 'Longman LDOCE', hint: 'Definiciones simples (Defining Vocabulary 2 000).' },
  { key: 'collins', label: 'Collins COBUILD', hint: 'Estilo "If something is X…" + ejemplos del corpus.' },
  { key: 'merriamWebster', label: 'Merriam-Webster', hint: 'American English authority, etimología detallada.' },
  { key: 'ozdic', label: 'Oxford Collocations', hint: 'Mirror de OCD (ozdic.com): 250 000 collocations curadas Oxford con patrones gramaticales (ADJ, VERB, PREP).' },
  { key: 'oxfordCollocations', label: 'Oxford Coll. pack', hint: 'Reservado para un pack importable offline (placeholder).' },
];

const BILINGUAL_SOURCES: SourceMeta[] = [
  { key: 'reverso', label: 'Reverso Context', hint: 'Frases EN-ES de subtítulos / libros / prensa.' },
  { key: 'linguee', label: 'Linguee', hint: 'Traducciones y ejemplos curados de la web.' },
  { key: 'wordReference', label: 'WordReference', hint: 'Equivalencias EN-ES naturales.' },
  { key: 'spanishDict', label: 'SpanishDict', hint: 'Conjugación + ejemplos paralelos.' },
  { key: 'tatoeba', label: 'Tatoeba', hint: 'Corpus comunitario CC-BY de oraciones paralelas (api.tatoeba.org).' },
];

const AUDIO_SOURCES: SourceMeta[] = [
  { key: 'cambridgeAudio', label: 'Cambridge audio', hint: 'MP3 oficial UK + US.' },
  { key: 'oxfordAudio', label: 'Oxford audio', hint: 'MP3 oficial UK + US.' },
  { key: 'forvo', label: 'Forvo', hint: 'Pronunciación humana de hablantes nativos.' },
  { key: 'linguaLibre', label: 'Lingua Libre', hint: 'Wikimedia: CC-BY hablantes nativos.' },
  { key: 'googleTtsFallback', label: 'Google TTS fallback', hint: 'Síntesis cuando ninguna grabación humana respondió.' },
];

const IMAGE_SOURCES: SourceMeta[] = [
  { key: 'unsplash', label: 'Unsplash', hint: 'Fotos profesionales con licencia abierta.' },
  { key: 'pixabay', label: 'Pixabay', hint: 'Stock variado CC0.' },
  { key: 'wikimediaCommons', label: 'Wikimedia Commons', hint: 'Imágenes CC con metadata, ideal para términos nicho.' },
  { key: 'duckduckgoImages', label: 'DuckDuckGo Images', hint: 'Búsqueda última-milla cuando todo lo anterior falla.' },
];

const VIDEO_SOURCES: SourceMeta[] = [
  { key: 'youglish', label: 'YouGlish', hint: 'Enlaces a videos de YouTube con la palabra pronunciada.' },
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
      <SubGroup
        title="Estándar (gratis, siempre activo)"
        hint="APIs gratuitas sin token: corpus de Datamuse y diccionario Wikimedia. Si las desactivas, sólo quedan los datos locales y los packs Yomitan."
        sources={STANDARD_SOURCES}
        vip={vip}
        setKey={setKey}
      />

      {/* VIP master switch */}
      <div className="rounded-md bg-zinc-50/70 dark:bg-zinc-800/30 border border-zinc-200/60 dark:border-zinc-800/70 px-2.5 py-2">
        <label className="flex items-center justify-between gap-2 cursor-pointer">
          <span className="flex flex-col">
            <span className="text-[11.5px] font-semibold text-zinc-800 dark:text-zinc-200">
              Activar VIP
            </span>
            <span className="text-[10px] text-zinc-500 dark:text-zinc-500 leading-snug mt-0.5">
              Consulta hasta 20 fuentes en paralelo (diccionarios, scrapes y audio nativo).
              Cada palabra tarda 1-3&nbsp;s la primera vez; las siguientes son instantáneas (caché).
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
          VIP está desactivado. Solo se usan los datos locales + las fuentes Standard arriba.
        </div>
      )}

      {vip.enabled && (
        <>
          <SubGroup title="Diccionarios premium" hint="Definiciones, IPA, ejemplos y collocations." sources={DICT_SOURCES} vip={vip} setKey={setKey} />
          <SubGroup title="Bilingüe" hint="Traducción + frases paralelas EN-ES." sources={BILINGUAL_SOURCES} vip={vip} setKey={setKey} />
          <SubGroup title="Audio" hint="Pronunciación a nivel de palabra. Para audio de la frase completa se usa la captura del video." sources={AUDIO_SOURCES} vip={vip} setKey={setKey} />
          <SubGroup title="Imágenes" hint="Imagen para el frente de la tarjeta cuando no hay frame del video. Si tienes OpenAI configurado en IA premium con enrichOnSave, DALL-E 3 genera una ilustración mnemónica como último fallback (~$0.04 por tarjeta)." sources={IMAGE_SOURCES} vip={vip} setKey={setKey} />
          <SubGroup title="Video" hint="Enlaces a pronunciación en contexto real." sources={VIDEO_SOURCES} vip={vip} setKey={setKey} />

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
              checked={Boolean(vip[s.key])}
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
