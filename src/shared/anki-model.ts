/**
 * The KivaraLingo note model, in AnkiConnect's `createModel` shape.
 *
 * One canonical definition (fields, templates, CSS) shared by the SW's
 * ANKI_ENSURE_MODEL handler and the save-path rescue: the bespoke card
 * preview (CardPreview) only draws this layout when
 * `mapping.modelName === 'KivaraLingo'`, so the installed model MUST match
 * the fields CardsTab automaps and the preview reads.
 */

import type { AnkiMapping } from './types';
import { autoMapFields } from './anki-field-detect';

export const KIVARA_MODEL_NAME = 'KivaraLingo';

/** The 9 standard fields — same list as CardsTab's FALLBACK_FIELDS.
 * Exported so the save path can automap an EMPTY fieldSources against the
 * model it just installed. */
export const KIVARA_MODEL_FIELDS = [
  'word',
  'phonetic',
  'sentence',
  'translation',
  'bilingual',
  'monolingual',
  'picture',
  'sentence audio',
  'word audio',
] as const;

export interface AnkiCardTemplate {
  Name: string;
  Front: string;
  Back: string;
}

export interface AnkiModelDefinition {
  modelName: string;
  inOrderFields: string[];
  cardTemplates: AnkiCardTemplate[];
  css: string;
  isCloze: false;
}

/** The card CSS: dark-mode aware, readable over Anki's default white card.
 * (Not exported: it rides inside `buildKivaraModel()`.) */
const KIVARA_MODEL_CSS = `
.card {
  font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 18px;
  text-align: center;
  color: #1f2937;
  background-color: #ffffff;
}
.card.night_mode {
  color: #e5e7eb;
  background-color: #111827;
}
.phonetic {
  font-family: monospace;
  font-size: 14px;
  color: #6b7280;
}
.sentence {
  font-style: italic;
  color: #4b5563;
}
.kivara-picture {
  max-width: 80%;
  border-radius: 12px;
  margin-top: 12px;
}
`;

/** The AnkiModelDefinition AnkiConnect.createModel consumes. */
export function buildKivaraModel(): AnkiModelDefinition {
  return {
    modelName: KIVARA_MODEL_NAME,
    inOrderFields: [...KIVARA_MODEL_FIELDS],
    cardTemplates: [
      {
        Name: 'Card 1',
        Front: '{{word}}{{#phonetic}}<br><span class="phonetic">{{phonetic}}</span>{{/phonetic}}{{#sentence audio}}{{sentence audio}}{{/sentence audio}}',
        Back: '{{FrontSide}}<hr id="answer"><span class="sentence">{{sentence}}</span><br><br>{{translation}}{{#bilingual}}<br>{{bilingual}}{{/bilingual}}{{#monolingual}}<br>{{monolingual}}{{/monolingual}}{{#picture}}<br><img class="kivara-picture" src="{{picture}}">{{/picture}}{{#word audio}}{{word audio}}{{/word audio}}',
      },
    ],
    css: KIVARA_MODEL_CSS,
    isCloze: false,
  };
}

/**
 * ONE normalization for every consumer of a stored mapping: a fresh install
 * can select KivaraLingo before it has any fieldSources (the model did not
 * exist yet), and every path that resolves fields — CREATE_CARD, the frame
 * update, add-context, delete and the content script — must see the SAME
 * 9-field map instead of falling back to { Front, Back }.
 */
export function normalizeAnkiMapping(mapping: AnkiMapping): AnkiMapping {
  if (
    mapping.modelName === KIVARA_MODEL_NAME
    && Object.keys(mapping.fieldSources ?? {}).length === 0
  ) {
    return { ...mapping, fieldSources: autoMapFields([...KIVARA_MODEL_FIELDS]) };
  }
  return mapping;
}
