import { t } from './i18n';
/**
 * Whisper.cpp ggml model presets.
 *
 * Lives in `shared/` so both the offscreen runtime (`whisper-asr.ts`) and
 * the React UI (`SettingsTab.tsx`, popup, etc.) can import without
 * pulling DOM- / Cache-Storage-specific code into the wrong context.
 *
 * URLs point at Hugging Face's official mirror of `ggerganov/whisper.cpp`,
 * which is CORS-enabled and doesn't require auth. Sizes are approximate
 * (the exact byte length depends on the quantisation revision); they are
 * used only to estimate the progress bar when a server doesn't return a
 * `Content-Length` header.
 *
 *  | model     | size   | speed (3 s clip) | WER on clean speech |
 *  |-----------|--------|------------------|---------------------|
 *  | tiny.en   | ~75 MB | ~0.5 s           | ~5 %                |
 *  | base.en   | ~150 MB| ~1 s             | ~3.5 %              |
 *  | small.en  | ~466 MB| ~3 s             | ~2.5 %              |
 *  | medium.en | ~1.5 GB| ~10 s            | ~2 %                |
 */
export const WHISPER_MODEL_PRESETS = {
  tiny: {
    label: t('whisper.tinyLabel'),
    sizeBytes: 78_000_000,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
  },
  base: {
    label: 'Base (150 MB · equilibrado)',
    sizeBytes: 148_000_000,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
  },
  small: {
    label: 'Small (466 MB · alta calidad)',
    sizeBytes: 466_000_000,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
  },
  medium: {
    label: 'Medium (1.5 GB · estudio / desktop)',
    sizeBytes: 1_500_000_000,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin',
  },
} as const;

export type WhisperModelKey = keyof typeof WHISPER_MODEL_PRESETS;

export function modelKeyForUrl(url: string): WhisperModelKey | null {
  for (const [key, preset] of Object.entries(WHISPER_MODEL_PRESETS) as Array<
    [WhisperModelKey, (typeof WHISPER_MODEL_PRESETS)[WhisperModelKey]]
  >) {
    if (preset.url === url) return key;
  }
  return null;
}
