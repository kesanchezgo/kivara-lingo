/**
 * Mapping step — deck, note type and field mapping (F8; prototype view, repo
 * field rules).
 *
 * The deck is the one of the language chosen in the Lang/Level steps
 * (`mapping.decks[lang]`), never a single global deck: level, marks and the
 * check belong to the language, and changing the deck must not move them.
 * The gate in `steps.ts` reads that same per-language entry.
 */
import { t } from '../../shared/i18n';
import { CheckCircle2, Loader2, ChevronRight, LayoutGrid, Wand2, ListChecks, ArrowLeft } from '../../ui/icons';
import type { AnkiMapping, FieldSource } from '../../shared/types';
import { detectFieldSource } from '../../shared/anki-field-detect';
import { deckFor, withDeck } from '../../shared/study/decks';
import { Button } from '../../ui/primitives/settings-primitives';
import { Select, inputLgCls } from '../../ui/primitives/controls';
import { StepSection } from './StepSection';

export interface MappingStepProps {
  /** Language being learned: the deck chosen here is ITS deck. */
  lang: string;
  mapping: AnkiMapping;
  setMapping: (m: AnkiMapping) => void;
  decks: string[] | null;
  models: string[] | null;
  fields: string[] | null;
  busy: boolean;
  deckCreateMode: boolean;
  setDeckCreateMode: (v: boolean) => void;
  modelCreateMode: boolean;
  setModelCreateMode: (v: boolean) => void;
  onLoadDecks: () => void;
  onLoadFields: (m: string) => void;
}

export function MappingStep({
  lang, mapping, setMapping, decks, models, fields, busy,
  deckCreateMode, setDeckCreateMode, modelCreateMode, setModelCreateMode,
  onLoadDecks, onLoadFields,
}: MappingStepProps) {
  const deck = deckFor(mapping, lang);
  const setDeck = (d: string) => setMapping(withDeck(mapping, lang, d));
  const deckChosen = Boolean(mapping.decks?.[lang]);

  return (
    <StepSection
      icon={<LayoutGrid size={20} />}
      title={t('onb.deckModelFields')}
      subtitle={t('onb.deckStepDesc')}
    >
      <div
        data-deck-for={lang}
        className="rounded-2xl bg-white dark:bg-white/[0.03] ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.06] shadow-[0_12px_32px_-18px_rgba(16,24,40,.25)] dark:shadow-none divide-y divide-zinc-900/[0.06] dark:divide-white/[0.06]"
      >
        {/* Deck */}
        <div className="flex items-start gap-3 px-4 py-4">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/[0.08] dark:bg-indigo-400/[0.12] text-indigo-600 dark:text-indigo-300 flex items-center justify-center shrink-0 mt-1">
            <LayoutGrid size={16} />
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100">
                {t('onb.destDeck', { lang: t(`lang.${lang}`) })}
              </span>
              {deckChosen && !deckCreateMode && <CheckCircle2 size={13} className="text-emerald-500" />}
            </div>
            <div className="flex gap-2">
              {deckCreateMode ? (
                <input
                  type="text"
                  autoFocus
                  value={deck}
                  onChange={(e) => setDeck(e.target.value)}
                  placeholder={t('onb.newDeckPlaceholder')}
                  className={`${inputLgCls} flex-1`}
                />
              ) : (
                <Select
                  data-testid="onboarding-deck-select"
                  aria-label={t('onb.destDeck', { lang: t(`lang.${lang}`) })}
                  value={decks?.includes(deck) ? deck : ''}
                  onChange={(e) => setDeck(e.target.value)}
                  disabled={!decks || decks.length === 0}
                  size="lg"
                  className="flex-1"
                >
                  <option value="">{decks?.length ? t('onb.selectDeck') : t('common.loading')}</option>
                  {(decks ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
                </Select>
              )}
              {/* Same loading convention as the rest: the text stays (accessible
                  name and stable width) and the icon spins beside it. */}
              <Button
                variant="secondary"
                onClick={onLoadDecks}
                disabled={busy}
                aria-busy={busy}
                icon={busy ? <Loader2 size={13} className="animate-spin" /> : undefined}
              >
                {t('onb.refresh')}
              </Button>
            </div>
            <button
              type="button"
              onClick={() => {
                if (deckCreateMode) {
                  setDeckCreateMode(false);
                  if (decks && !decks.includes(deck)) setDeck('');
                } else {
                  setDeckCreateMode(true);
                }
              }}
              className="text-[12px] text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              {deckCreateMode
                ? <span className="inline-flex items-center gap-1"><ArrowLeft size={12} />{t('onb.chooseExistingDeck')}</span>
                : t('onb.createDeck')}
            </button>
            <p className="text-[12px] leading-[17px] text-zinc-500 dark:text-zinc-400" data-deck-hint>{t('cards.deckLangHint')}</p>
          </div>
        </div>

        {/* Note type */}
        <div className="flex items-start gap-3 px-4 py-4">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/[0.08] dark:bg-indigo-400/[0.12] text-indigo-600 dark:text-indigo-300 flex items-center justify-center shrink-0 mt-1">
            <ListChecks size={16} />
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{t('onb.noteModelTitle')}</span>
              {mapping.modelName && !modelCreateMode && <CheckCircle2 size={13} className="text-emerald-500" />}
            </div>
            {modelCreateMode ? (
              <input
                type="text"
                autoFocus
                value={mapping.modelName}
                onChange={(e) => setMapping({ ...mapping, modelName: e.target.value })}
                placeholder={t('onb.newModelPlaceholder')}
                className={`${inputLgCls} w-full`}
              />
            ) : (
              <Select
                data-testid="onboarding-model-select"
                aria-label={t('onb.noteModelTitle')}
                value={mapping.modelName}
                onChange={(e) => {
                  const m = e.target.value;
                  setMapping({ ...mapping, modelName: m });
                  if (m) onLoadFields(m);
                }}
                disabled={!models || models.length === 0}
                size="lg"
                className="w-full"
              >
                <option value="">{models?.length ? t('ai.selectModel') : t('common.loading')}</option>
                {(models ?? (mapping.modelName ? [mapping.modelName] : [])).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </Select>
            )}
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  if (modelCreateMode) {
                    setModelCreateMode(false);
                    if (models && !models.includes(mapping.modelName)) setMapping({ ...mapping, modelName: '' });
                  } else {
                    setModelCreateMode(true);
                  }
                }}
                className="text-[12px] text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                {modelCreateMode
                  ? <span className="inline-flex items-center gap-1"><ArrowLeft size={12} />{t('onb.chooseExistingModel')}</span>
                  : t('onb.createModel')}
              </button>
              {busy && (
                <span className="inline-flex items-center gap-1.5 text-[12px] text-zinc-500">
                  <Loader2 size={12} className="animate-spin" /> {t('onb.loading')}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Field mapping */}
      {fields && fields.length > 0 && (() => {
        const totalMapped = fields.filter((f) => (mapping.fieldSources[f] ?? 'manual') !== 'manual').length;
        const autoCount = fields.filter((f) => (mapping.fieldSources[f] ?? 'manual') !== 'manual' && mapping.fieldSources[f] === detectFieldSource(f)).length;
        return (
          <>
            <div className="flex items-end justify-between gap-3 px-1 pt-4">
              <div>
                <p className="text-[15px] font-semibold tracking-[-0.01em] text-zinc-900 dark:text-white">{t('onb.fieldMapTitle')}</p>
                <p className="text-[12px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {t('onb.mappedFmt', { done: totalMapped, total: fields.length })}
                </p>
              </div>
              <span className="inline-flex items-center gap-1 h-6 text-[11px] font-medium text-indigo-600 dark:text-indigo-300 bg-indigo-500/[0.08] dark:bg-indigo-400/[0.12] px-2 rounded-full">
                <Wand2 size={12} /> {t('onb.autoDetectedFmt', { n: autoCount })}
              </span>
            </div>
            <div className="rounded-xl bg-white dark:bg-white/[0.03] ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.06] shadow-[0_1px_2px_rgba(16,24,40,.04)] dark:shadow-none overflow-hidden">
              <div className="divide-y divide-zinc-900/[0.06] dark:divide-white/[0.06]">
                {fields.map((field) => {
                  const current: FieldSource = mapping.fieldSources[field] ?? 'manual';
                  const isAuto = current !== 'manual' && current === detectFieldSource(field);
                  const isManual = current === 'manual';
                  return (
                    <div key={field} className="flex items-center gap-3 px-4 h-[52px]">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isManual ? 'bg-zinc-300 dark:bg-zinc-700' : 'bg-emerald-500'}`} />
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <span className="text-[13px] font-medium text-zinc-800 dark:text-zinc-200 truncate font-mono">{field}</span>
                        {isAuto && (
                          <span className="text-[12px] font-medium text-indigo-500 dark:text-indigo-400 shrink-0 inline-flex items-center gap-1">
                            <Wand2 size={12} /> auto
                          </span>
                        )}
                      </div>
                      <ChevronRight size={14} className="text-zinc-300 dark:text-zinc-600 shrink-0" />
                      <div className="w-[160px] shrink-0">
                        <Select
                          value={current}
                          onChange={(e) => {
                            // The repo's rule: 'manual' deletes the key so the Cards
                            // tab's auto-detection keeps the semantics it had.
                            const src = e.target.value as FieldSource;
                            const next = { ...mapping.fieldSources };
                            if (src === 'manual') delete next[field];
                            else next[field] = src;
                            setMapping({ ...mapping, fieldSources: next });
                          }}
                        >
                        <option value="manual">{t('cards.noMapping')}</option>
                        <option value="selection">{t('cards.wordSelection')}</option>
                        <option value="cue">{t('cards.sentence')}</option>
                        <option value="phonetic">{t('onb.fieldPhonetic')}</option>
                        <option value="translation">{t('cards.translation')}</option>
                        <option value="bilingual">{t('onb.bilingualOpt')}</option>
                        <option value="monolingual">{t('onb.monolingualOpt')}</option>
                        <option value="examples">{t('cards.examples')}</option>
                        <option value="frame">{t('cards.pictureFrame')}</option>
                        <option value="sentence-audio">{t('cards.sentenceAudio')}</option>
                        <option value="word-audio">{t('cards.wordAudio')}</option>
                        <option value="synonyms">{t('cards.synonyms')}</option>
                        <option value="antonyms">{t('cards.antonyms')}</option>
                        <option value="collocations">{t('cards.collocations')}</option>
                        <option value="etymology">{t('cards.etymology')}</option>
                        <option value="mnemonic">{t('cards.mnemonic')}</option>
                        <option value="image">{t('cards.enrichedImage')}</option>
                        <option value="video-link">{t('cards.videoLink')}</option>
                        <option value="ai-definition">{t('cards.aiDefinitionLabel')}</option>
                        <option value="ai-synonyms">{t('cards.aiSynonymsLabel')}</option>
                        <option value="ai-collocations">{t('cards.aiCollocationsLabel')}</option>
                        <option value="ai-nuance">{t('cards.aiNuanceLabel')}</option>
                        <option value="ai-register">{t('cards.aiRegisterLabel')}</option>
                        </Select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="text-center text-[12px] leading-[18px] text-zinc-500 dark:text-zinc-400 px-6 pt-1">
              {t('onb.autoDetectedNote')}
            </p>
          </>
        );
      })()}
    </StepSection>
  );
}