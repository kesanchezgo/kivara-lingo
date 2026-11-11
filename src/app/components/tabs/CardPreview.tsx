import React from 'react';
import { Volume2, Info, Eye, AlertTriangle, FilmSlate } from '../../../ui/icons';
import { t } from '../../../shared/i18n';
import type { AnkiMapping, FieldSource } from '../../../shared/types';
import type { PreviewData } from '../../../shared/preview-data';
import { detectFieldSource } from '../../../shared/anki-field-detect';

/**
 * Anki card preview.
 *
 * Every field of the note type is rendered with the value its mapped source
 * would produce (the same mapping the Cards tab edits), plus the layout of the
 * note type. KivaraLingo — the model Kivara installs — is drawn here; any other
 * model uses its real Anki template (`{{Field}}`, `{{FrontSide}}`,
 * `{{cloze:Field}}`). A field on `manual` or without data renders empty, the
 * same as the note would.
 */

/** What a note field carries, for drawing purposes. */
export type FieldValue =
  | { kind: 'text'; text: string }
  | { kind: 'cloze' }
  | { kind: 'image' }
  | { kind: 'audio'; what: 'sentence' | 'word' }
  | { kind: 'empty' };

/** The preview payload plus the optional enrichment fields the card can use. */
export interface CardPreviewData extends PreviewData {
  source?: string;
  examples?: string[];
  synonyms?: string[];
  antonyms?: string[];
  collocations?: string[];
  etymology?: string;
  imageUrl?: string;
  ai?: {
    synonyms?: string[];
    collocations?: string[];
    nuance?: string;
    register?: string;
  };
}

const EMPTY: FieldValue = { kind: 'empty' };
const text = (s?: string | null): FieldValue => (s && s.trim() ? { kind: 'text', text: s } : EMPTY);
const list = (xs?: string[]): FieldValue => text(xs?.length ? xs.join(' · ') : '');

/** The value a source would put in the card. */
export function fieldValue(
  src: FieldSource,
  card: CardPreviewData,
  aiOn: boolean,
): FieldValue {
  switch (src) {
    case 'selection': return text(card.word);
    case 'cue': return text(card.targetSentence);
    case 'cloze': return { kind: 'cloze' };
    case 'source': return text(card.source);
    case 'phonetic': return text(card.phonetic);
    case 'translation':
    case 'translate': return text(card.nativeSentence);
    case 'bilingual': return text(card.bilingual ?? card.translation);
    case 'monolingual':
    case 'dictionary': return text(card.monolingual);
    case 'examples': return list(card.examples);
    case 'frame': return { kind: 'image' };
    case 'image': return card.imageUrl ? { kind: 'image' } : EMPTY;
    case 'sentence-audio':
    case 'tabCapture': return { kind: 'audio', what: 'sentence' };
    case 'word-audio':
    case 'tts': return { kind: 'audio', what: 'word' };
    case 'synonyms': return list(card.synonyms);
    case 'antonyms': return list(card.antonyms);
    case 'collocations': return list(card.collocations);
    // Frequency needs the bundled frequency list (F5); the field stays empty
    // until then instead of inventing a band.
    case 'frequency': return EMPTY;
    case 'etymology': return text(card.etymology);
    case 'video-link': return text(`YouGlish · ${card.word}`);
    // Only with AI configured (Preferences › AI premium).
    case 'mnemonic': return aiOn ? text(card.monolingual) : EMPTY;
    case 'ai-definition': return aiOn ? text(card.monolingual) : EMPTY;
    case 'ai-synonyms': return aiOn ? list(card.ai?.synonyms) : EMPTY;
    case 'ai-collocations': return aiOn ? list(card.ai?.collocations) : EMPTY;
    case 'ai-nuance': return aiOn ? text(card.ai?.nuance) : EMPTY;
    case 'ai-register': return aiOn ? text(card.ai?.register) : EMPTY;
    case 'manual': return EMPTY;
  }
}

const tplLabel = 'text-[11px] font-semibold uppercase tracking-[0.09em] text-slate-500 dark:text-slate-400';
const tplBlock = 'rounded-xl bg-slate-50 dark:bg-white/[0.035] ring-1 ring-slate-200 dark:ring-white/[0.07]';
// `blur-none`, not `blur-0`: in Tailwind v4 `blur-0` does not exist and the
// text stayed blurred on hover.
const peek = 'blur-[5px] opacity-30 select-none transition-[filter,opacity] duration-200 group-hover/peek:blur-none group-hover/peek:opacity-100';

function EyebrowTag({ children, dot }: { children: React.ReactNode; dot?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 dark:bg-blue-400/[0.12] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-blue-600 dark:text-blue-400 select-none">
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** Audio marker. The preview does not play it — it shows the field carries audio. */
function AudioDot({ what }: { what: 'sentence' | 'word' }) {
  const small = what === 'sentence';
  return (
    <span
      title={what === 'sentence' ? t('cards.tabAudioTitle') : t('cards.wordAudioTitle')}
      className={`${small ? 'w-7 h-7' : 'w-8 h-8'} shrink-0 rounded-full inline-flex items-center justify-center bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-white/10 text-blue-600 dark:text-blue-400 shadow-sm`}
    >
      <Volume2 size={small ? 13 : 15} />
    </span>
  );
}

function SceneImage() {
  return (
    <div className="relative rounded-xl overflow-hidden ring-1 ring-slate-200 dark:ring-white/[0.07] h-[84px] bg-gradient-to-br from-slate-200 to-slate-100 dark:from-zinc-800 dark:to-zinc-900">
      <img
        src="https://images.unsplash.com/photo-1574923930958-9b653a0e5148?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400&q=80"
        alt={t('cards.sceneImage')}
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
        className="absolute inset-0 w-full h-full object-cover"
      />
    </div>
  );
}

/** The sentence with the word hidden (front) or highlighted (back). */
function ClozeSentence({ card, reveal }: { card: CardPreviewData; reveal: boolean }) {
  const esc = card.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = card.targetSentence.split(new RegExp(`(${esc})`, 'i'));
  return (
    <>
      {parts.map((p, i) => (i % 2
        ? (
          <span
            key={i}
            className={`rounded-md px-1 py-px font-bold ${reveal
              ? 'bg-blue-500/10 dark:bg-blue-400/15 text-blue-600 dark:text-blue-300'
              : 'bg-blue-500/10 dark:bg-blue-400/15 tracking-[0.05em] text-blue-600 dark:text-blue-300'}`}
          >
            {reveal ? p : '[ ... ]'}
          </span>
        )
        : <React.Fragment key={i}>{p}</React.Fragment>))}
    </>
  );
}

function FieldNode({ value, card, side }: { value: FieldValue; card: CardPreviewData; side: 'front' | 'back' }) {
  switch (value.kind) {
    case 'text': return <>{value.text}</>;
    case 'cloze': return <ClozeSentence card={card} reveal={side === 'back'} />;
    case 'image': return <span className="block my-2"><SceneImage /></span>;
    case 'audio': return <span className="inline-flex align-middle mx-1"><AudioDot what={value.what} /></span>;
    case 'empty': return null;
  }
}

const isEmpty = (v: FieldValue) => v.kind === 'empty';
/** The field carries the target sentence: the template hides / highlights the word in it. */
const isTargetSentence = (v: FieldValue, card: CardPreviewData) =>
  v.kind === 'cloze' || (v.kind === 'text' && v.text === card.targetSentence);

/** In-face notice: Anki refuses to create a card with an empty front. */
function EmptyFront() {
  return (
    <p className="flex items-start justify-center gap-1.5 text-[12px] leading-4 text-amber-700 dark:text-amber-400/90 text-center">
      <AlertTriangle size={13} className="shrink-0 mt-px" /> {t('cards.emptyFront')}
    </p>
  );
}

type FieldOf = (field: string) => FieldValue;

/* ── KivaraLingo: the note type Kivara installs ─────────────────────────── */

function KivaraFront({ v, card }: { v: FieldOf; card: CardPreviewData }) {
  const word = v('word');
  const sentence = v('sentence');
  const wordAudio = v('word audio');
  return (
    <div className="font-sans flex-1 flex flex-col min-h-[230px]">
      <div className="flex items-center justify-between min-h-8">
        <EyebrowTag dot>{t('cards.tplTarget')}</EyebrowTag>
        {wordAudio.kind === 'audio' && <AudioDot what="word" />}
      </div>
      <div className="flex-1 flex flex-col items-center justify-center text-center py-4">
        {isEmpty(word) && isEmpty(sentence) ? <EmptyFront /> : (
          <div className="text-[30px] font-extrabold tracking-[-0.035em] leading-[1.1] text-slate-900 dark:text-slate-50 break-words max-w-full">
            <FieldNode value={word} card={card} side="front" />
          </div>
        )}
        {v('phonetic').kind === 'text' && (
          <span className="group/peek mt-1.5 cursor-help">
            <span className={`block text-[14px] italic text-teal-600 dark:text-teal-400 ${peek}`}>
              <FieldNode value={v('phonetic')} card={card} side="front" />
            </span>
          </span>
        )}
      </div>
      {!isEmpty(sentence) && (
        <div className={`${tplBlock} px-3.5 py-3`}>
          <div className={`${tplLabel} mb-1.5`}>{t('cards.tplCloze')}</div>
          <p className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-300">
            {isTargetSentence(sentence, card)
              ? <ClozeSentence card={card} reveal={false} />
              : <FieldNode value={sentence} card={card} side="front" />}
          </p>
        </div>
      )}
    </div>
  );
}

function KivaraBack({ v, card }: { v: FieldOf; card: CardPreviewData }) {
  const sentence = v('sentence');
  const sentenceAudio = v('sentence audio');
  const translation = v('translation');
  const source = v('source');
  return (
    <div className="font-sans space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <EyebrowTag>{t('cards.tplVocab')}</EyebrowTag>
          <div className="mt-2 text-[22px] font-bold tracking-[-0.025em] leading-[1.15] text-slate-900 dark:text-slate-50 truncate">
            <FieldNode value={v('word')} card={card} side="back" />
          </div>
          {v('phonetic').kind === 'text' && (
            <div className="text-[13px] italic text-teal-600 dark:text-teal-400 mt-0.5">
              <FieldNode value={v('phonetic')} card={card} side="back" />
            </div>
          )}
        </div>
        {v('word audio').kind === 'audio' && <AudioDot what="word" />}
      </div>

      <div className="h-px bg-slate-100 dark:bg-white/[0.06]" />

      {!isEmpty(v('bilingual')) && (
        <div>
          <div className={`${tplLabel} mb-1`}>{t('cards.tplMeaning')}</div>
          <div className="text-[15px] font-medium leading-snug text-slate-700 dark:text-slate-300">
            <FieldNode value={v('bilingual')} card={card} side="back" />
          </div>
        </div>
      )}

      {!isEmpty(v('monolingual')) && (
        <div className="group/peek rounded-xl bg-slate-50 dark:bg-white/[0.035] border border-dashed border-slate-200 dark:border-white/10 px-3 py-2.5 cursor-help">
          <div className={`${tplLabel} flex items-center gap-1.5 mb-1 transition-colors group-hover/peek:text-blue-600 dark:group-hover/peek:text-blue-400`}>
            <Info size={12} /> {t('cards.tplMono')}
          </div>
          <div className={`text-[13px] leading-snug text-slate-700 dark:text-slate-300 ${peek}`}>
            <FieldNode value={v('monolingual')} card={card} side="back" />
          </div>
        </div>
      )}

      {v('picture').kind === 'image' && <SceneImage />}

      {(!isEmpty(sentence) || !isEmpty(translation)) && (
        <div className={`${tplBlock} px-3.5 py-3`}>
          <div className="flex items-center justify-between mb-1.5 min-h-7">
            <span className={tplLabel}>{t('cards.tplContext')}</span>
            {sentenceAudio.kind === 'audio' && <AudioDot what="sentence" />}
          </div>
          {!isEmpty(sentence) && (
            <div className="text-[14px] italic leading-snug text-slate-900 dark:text-slate-100">
              “{isTargetSentence(sentence, card)
                ? <ClozeSentence card={card} reveal />
                : <FieldNode value={sentence} card={card} side="back" />}”
            </div>
          )}
          {!isEmpty(translation) && (
            <div className="group/peek mt-2.5 pt-2 border-t border-dashed border-slate-200 dark:border-white/10 cursor-help">
              <div className={`${tplLabel} flex items-center gap-1.5 mb-0.5 transition-colors group-hover/peek:text-blue-600 dark:group-hover/peek:text-blue-400`}>
                <Eye size={12} /> {t('cards.tplTranslation')}
              </div>
              <div className={`text-[13px] leading-snug text-slate-600 dark:text-slate-300 ${peek}`}>
                <FieldNode value={translation} card={card} side="back" />
              </div>
            </div>
          )}
        </div>
      )}

      {source.kind === 'text' && (
        <div className="flex items-start gap-1.5 text-[12px] leading-4 text-slate-500 dark:text-slate-400">
          <FilmSlate size={13} className="shrink-0 mt-px" />
          <span className="min-w-0 break-words">{source.text}</span>
        </div>
      )}
    </div>
  );
}

/* ── Other note types: their real Anki templates ────────────────────────── */

const TOKEN_RE = /(\{\{[^}]+\}\}|<hr id=answer>|<br\s*\/?>)/;

/** Fields a template uses (to know whether a side ends up empty). */
function templateFields(tpl: string): string[] {
  return [...tpl.matchAll(/\{\{([^}]+)\}\}/g)]
    .map((m) => m[1].trim())
    .filter((f) => f !== 'FrontSide')
    .map((f) => f.split(':').pop()!.trim());
}

function TemplateSide({
  tpl, frontTpl, side, v, card,
}: {
  tpl: string; frontTpl: string; side: 'front' | 'back'; v: FieldOf; card: CardPreviewData;
}) {
  return (
    <>
      {tpl.split(TOKEN_RE).map((piece, i) => {
        if (!piece) return null;
        if (piece.startsWith('<hr')) return <hr key={i} className="my-3 border-slate-200 dark:border-white/10" />;
        if (piece.startsWith('<br')) return <br key={i} />;
        const m = /^\{\{(.+)\}\}$/.exec(piece);
        if (!m) return <React.Fragment key={i}>{piece.replace(/<[^>]+>/g, '')}</React.Fragment>;
        const tag = m[1].trim();
        if (tag === 'FrontSide') return <TemplateSide key={i} tpl={frontTpl} frontTpl={frontTpl} side="front" v={v} card={card} />;
        // Filters: `cloze:` shows the gap; the rest (text:, tts...) is ignored
        // in the preview.
        const field = tag.split(':').pop()!.trim();
        return <FieldNode key={i} value={v(field)} card={card} side={side} />;
      })}
    </>
  );
}

function GenericSide({
  fields, side, v, card,
}: {
  fields: string[]; side: 'front' | 'back'; v: FieldOf; card: CardPreviewData;
}) {
  // No template bundled for this model: first field on the front, every field
  // on the back.
  const tpl = {
    front: fields[0] ? `{{${fields[0]}}}` : '',
    back: ['{{FrontSide}}<hr id=answer>', ...fields.slice(1).map((f) => `{{${f}}}`)].join('<br>'),
  };
  const frontEmpty = templateFields(tpl.front).every((f) => isEmpty(v(f)));
  return (
    <div className="font-sans min-h-[160px] flex flex-col items-center justify-center text-center text-[16px] leading-relaxed text-slate-800 dark:text-slate-100 break-words">
      {side === 'front' && frontEmpty
        ? <EmptyFront />
        : (
          <div className="w-full">
            <TemplateSide
              tpl={side === 'front' ? tpl.front : tpl.back}
              frontTpl={tpl.front}
              side={side}
              v={v}
              card={card}
            />
          </div>
        )}
    </div>
  );
}

/**
 * One side of the card. `fields` are the note type's fields; their source
 * comes from the mapping or, when there is none yet, from the field name —
 * the same thing the mapping list shows.
 */
export function CardFace({
  side, mapping, fields, card, aiOn = false,
}: {
  side: 'front' | 'back';
  mapping: AnkiMapping;
  fields: string[];
  card: CardPreviewData;
  aiOn?: boolean;
}) {
  const v: FieldOf = (field) => (fields.includes(field)
    ? fieldValue(mapping.fieldSources[field] ?? detectFieldSource(field), card, aiOn)
    : EMPTY);
  if (mapping.modelName === 'KivaraLingo') {
    return side === 'front' ? <KivaraFront v={v} card={card} /> : <KivaraBack v={v} card={card} />;
  }
  return <GenericSide fields={fields} side={side} v={v} card={card} />;
}
