/* SOURCE_BADGE — moved verbatim from the wizard root. */
import { t } from '../../shared/i18n';
import type { FieldSource } from '../../shared/types';

export const SOURCE_BADGE: Partial<Record<FieldSource, { label: string; color: string }>> = {
  selection:        { label: 'Palabra',        color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300' },
  cue:              { label: 'Frase',          color: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300' },
  phonetic:         { label: t('cards.phonetic'),       color: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300' },
  translation:      { label: t('cards.translation'),     color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' },
  bilingual:        { label: t('onb.modeBilingual'),       color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  monolingual:      { label: t('onb.modeMonolingual'),     color: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300' },
  examples:         { label: 'Ejemplos',       color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300' },
  frame:            { label: 'Picture',        color: 'bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300' },
  'sentence-audio': { label: 'Sentence audio', color: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' },
  'word-audio':     { label: 'Word audio',     color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300' },
  synonyms:         { label: t('cards.synonyms'),      color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' },
  antonyms:         { label: t('cards.antonyms'),      color: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300' },
  collocations:     { label: 'Combinaciones',  color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300' },
  etymology:        { label: t('cards.etymology'),     color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  mnemonic:         { label: t('cards.mnemonic'),   color: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300' },
  image:            { label: 'Imagen',         color: 'bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300' },
  'video-link':     { label: 'Video link',     color: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300' },
  'ai-definition':  { label: 'IA def.',        color: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300' },
  'ai-synonyms':    { label: t('onb.aiOffShort'),        color: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300' },
  'ai-collocations':{ label: 'IA coloc.',      color: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300' },
  'ai-nuance':      { label: 'IA matiz',       color: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300' },
  'ai-register':    { label: 'IA registro',    color: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300' },
  manual:           { label: 'Manual',         color: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' },
};
