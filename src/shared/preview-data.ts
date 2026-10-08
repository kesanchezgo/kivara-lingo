/**
 * Card-preview data for the SidePanel / Cards templates.
 *
 * Single source for the FRENTE/REVERSO preview. Previously Options.tsx and
 * content/ui/App.tsx each carried their OWN copy of the same placeholder
 * literal (editing the sample meant editing two files, and they drifted).
 * Both now call `buildPreviewData`.
 *
 * The live cue, when present, drives `targetSentence` so the preview shows
 * the line the user is watching; the rest stays a deterministic sample.
 */
export interface PreviewData {
  targetSentence: string;
  nativeSentence: string;
  word: string;
  translation: string;
  phonetic?: string;
  bilingual?: string;
  monolingual?: string;
}

export const DEFAULT_PREVIEW_SENTENCE = "These days, Nicola doesn't travel much.";

const SAMPLE: Omit<PreviewData, 'targetSentence'> = {
  nativeSentence: 'Estos días, Nicola no viaja mucho.',
  word: 'these days',
  translation: 'estos días',
  phonetic: '/ðiːz deɪz/',
  bilingual: '(noun) estos días',
  monolingual: 'Used to refer to the present time period.',
};

/** Build the preview payload. Pass the current cue text (or null) — it
 * falls back to the deterministic sample when there's no live cue. */
export function buildPreviewData(targetSentence?: string | null): PreviewData {
  return {
    targetSentence: (targetSentence ?? '').trim() || DEFAULT_PREVIEW_SENTENCE,
    ...SAMPLE,
  };
}
