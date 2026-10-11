import React, { useState } from 'react';
import { t } from '../../shared/i18n';
import { CheckCircle2, AlertTriangle, Loader2, Play, ArrowLeftRight, LayoutGrid, ListChecks, Wand2 } from 'lucide-react';
import type { AnkiMapping, FieldSource } from '../../shared/types';
import { SOURCE_BADGE } from './badges';
import { detectFieldSource } from '../../shared/anki-field-detect';
import { StepSection } from './StepSection';


export interface MappingStepProps {
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
  mapping, setMapping, decks, models, fields, busy,
  deckCreateMode, setDeckCreateMode, modelCreateMode, setModelCreateMode,
  onLoadDecks, onLoadFields,
}: MappingStepProps) {
  return (
    <StepSection
      title="Mazo, modelo y campos"
      subtitle={t('onb.deckStepDesc')}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

        {/* Mazo card */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/60 flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-indigo-500/10 ring-1 ring-indigo-500/20 text-indigo-600 dark:text-indigo-300 flex items-center justify-center">
              <LayoutGrid size={12} />
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">{t('onb.destDeck')}</span>
            {mapping.deckName && !deckCreateMode && (
              <CheckCircle2 size={12} className="ml-auto text-emerald-500" />
            )}
          </div>
          <div className="p-3 space-y-2">
            <div className="flex gap-2">
              {deckCreateMode ? (
                <input
                  type="text"
                  autoFocus
                  value={mapping.deckName}
                  onChange={(e) => setMapping({ ...mapping, deckName: e.target.value })}
                  placeholder={t('onb.newDeckPlaceholder')}
                  className="sl-input sl-lg flex-1"
                />
              ) : (
                <select
                  value={decks?.includes(mapping.deckName) ? mapping.deckName : ''}
                  onChange={(e) => setMapping({ ...mapping, deckName: e.target.value })}
                  disabled={!decks || decks.length === 0}
                  className="sl-select sl-lg flex-1"
                >
                  <option value="">{decks?.length ? '— Selecciona un mazo —' : 'Cargando…'}</option>
                  {(decks ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              )}
              <button
                onClick={onLoadDecks}
                disabled={busy}
                className="h-10 px-3.5 text-[12px] font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors shrink-0"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : 'Refrescar'}
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                if (deckCreateMode) {
                  setDeckCreateMode(false);
                  if (decks && !decks.includes(mapping.deckName)) setMapping({ ...mapping, deckName: '' });
                } else {
                  setDeckCreateMode(true);
                }
              }}
              className="text-[11.5px] text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              {deckCreateMode ? '← Elegir mazo existente' : t('onb.createDeck')}
            </button>
          </div>
        </div>

        {/* Modelo card */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/60 flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-emerald-500/10 ring-1 ring-emerald-500/20 text-emerald-600 dark:text-emerald-300 flex items-center justify-center">
              <ListChecks size={12} />
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">{t('onb.noteModelTitle')}</span>
            {mapping.modelName && !modelCreateMode && (
              <CheckCircle2 size={12} className="ml-auto text-emerald-500" />
            )}
          </div>
          <div className="p-3 space-y-2">
            {modelCreateMode ? (
              <input
                type="text"
                autoFocus
                value={mapping.modelName}
                onChange={(e) => setMapping({ ...mapping, modelName: e.target.value })}
                placeholder={t('onb.newModelPlaceholder')}
                className="sl-input sl-lg w-full"
              />
            ) : (
              <select
                value={mapping.modelName}
                onChange={(e) => {
                  const m = e.target.value;
                  setMapping({ ...mapping, modelName: m });
                  if (m) onLoadFields(m);
                }}
                disabled={!models || models.length === 0}
                className="sl-select sl-lg w-full"
              >
                <option value="">{models?.length ? '— Selecciona un modelo —' : 'Cargando…'}</option>
                {(models ?? (mapping.modelName ? [mapping.modelName] : [])).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
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
                className="text-[11.5px] text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                {modelCreateMode ? '← Elegir existente' : t('onb.createModel')}
              </button>
              {busy && (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
                  <Loader2 size={11} className="animate-spin" /> {t('onb.loading')}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Field mapping */}
      {fields && fields.length > 0 && (() => {
        const totalMapped = fields.filter((f) => (mapping.fieldSources[f] ?? 'manual') !== 'manual').length;
        const autoCount = fields.filter((f) => (mapping.fieldSources[f] ?? 'manual') === detectFieldSource(f)).length;
        return (
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/60 flex items-center gap-2 flex-wrap">
              <div className="w-6 h-6 rounded-md bg-violet-500/10 ring-1 ring-violet-500/20 text-violet-600 dark:text-violet-300 flex items-center justify-center">
                <Wand2 size={12} />
              </div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">{t('onb.fieldMapTitle')}</span>
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500">·</span>
              <span className="text-[10.5px] text-zinc-500 dark:text-zinc-400">
                {t('onb.mappedFmt', { done: totalMapped, total: fields.length })}
              </span>
              <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/10 px-2 py-0.5 rounded-full ring-1 ring-indigo-500/15">
                <Wand2 size={9} /> {t('onb.autoDetectedFmt', { n: autoCount })}
              </span>
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {fields.map((field) => {
                const current: FieldSource = mapping.fieldSources[field] ?? 'manual';
                const isAuto = current === detectFieldSource(field);
                const badge = SOURCE_BADGE[current] ?? SOURCE_BADGE['manual']!;
                const isManual = current === 'manual';
                return (
                  <div key={field} className="flex items-center gap-3 px-4 py-2.5">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isManual ? 'bg-zinc-300 dark:bg-zinc-700' : 'bg-emerald-500'}`} />
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <span className="text-[13px] font-medium text-zinc-800 dark:text-zinc-200 truncate font-mono">{field}</span>
                      {isAuto && !isManual && (
                        <span className="text-[9px] font-semibold text-indigo-500 dark:text-indigo-400 shrink-0 inline-flex items-center gap-0.5">
                          <Wand2 size={8} /> auto
                        </span>
                      )}
                    </div>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0 ${badge.color}`}>
                      {badge.label}
                    </span>
                    <select
                      value={current}
                      onChange={(e) => {
                        const src = e.target.value as FieldSource;
                        const next = { ...mapping.fieldSources };
                        if (src === 'manual') delete next[field];
                        else next[field] = src;
                        setMapping({ ...mapping, fieldSources: next });
                      }}
                      className="sl-select shrink-0"
                      style={{ width: 160 }}
                    >
                      <option value="manual">— No mapear —</option>
                      <option value="selection">Palabra</option>
                      <option value="cue">Frase completa</option>
                      <option value="phonetic">{t('onb.fieldPhonetic')}</option>
                      <option value="translation">{t('cards.translation')}</option>
                      <option value="bilingual">{t('onb.bilingualOpt')}</option>
                      <option value="monolingual">{t('onb.monolingualOpt')}</option>
                      <option value="examples">Ejemplos</option>
                      <option value="frame">Picture (frame)</option>
                      <option value="sentence-audio">Sentence audio</option>
                      <option value="word-audio">Word audio</option>
                      <option value="synonyms">{t('cards.synonyms')}</option>
                      <option value="antonyms">{t('cards.antonyms')}</option>
                      <option value="collocations">Combinaciones</option>
                      <option value="etymology">{t('cards.etymology')}</option>
                      <option value="mnemonic">{t('cards.mnemonic')}</option>
                      <option value="image">Imagen enriquecida</option>
                      <option value="video-link">Video link</option>
                      <option value="ai-definition">{t('cards.aiDefinitionLabel')}</option>
                      <option value="ai-synonyms">{t('cards.aiSynonymsLabel')}</option>
                      <option value="ai-collocations">IA · Colocaciones</option>
                      <option value="ai-nuance">IA · Matiz</option>
                      <option value="ai-register">IA · Registro</option>
                    </select>
                  </div>
                );
              })}
            </div>
            <div className="px-4 py-2.5 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-900/40">
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                {t('onb.autoDetectedNote')}</p>
            </div>
          </div>
        );
      })()}
    </StepSection>
  );
}
