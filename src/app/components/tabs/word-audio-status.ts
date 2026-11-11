/**
 * Pronunciation source of the previewed word — the indicator the Cards tab
 * shows under the preview.
 *
 * The prototype's view (human recording / synthetic voice / no source, plus
 * "held back" when access is missing) over the repo's settings: the enabled
 * VIP audio sources, the premium TTS provider and the granted host origins.
 * Pure apart from `hasOrigin`, which reads the granted-origins store.
 */
import type { AiSettings, TtsSettings, VipSettings } from '../../../shared/types';
import { hasOrigin } from '../../../shared/host-permissions-store';
import { PROVIDER_HOSTS } from '../../../shared/provider-hosts';

export interface WordAudioStatus {
  /** Human recording → native voice, `tts` → synthetic, `null` → nothing. */
  kind: 'human' | 'tts' | null;
  /** Provider name when `kind === 'human'` (Cambridge, Forvo...). */
  source?: string;
  /**
   * A better source would have been used if the user granted the site access
   * it needs — the UI shows the "allow access" hint on the badge.
   */
  heldBack: boolean;
}

type HumanAudioKey = 'cambridgeAudio' | 'oxfordAudio' | 'forvo' | 'linguaLibre';

interface HumanAudioSource {
  key: HumanAudioKey;
  label: string;
  /** Origins the source needs; at least one must be granted. */
  hosts: string[];
  /** VIP-only sources are skipped when the master switch is off. */
  vip: boolean;
}

/** Order mirrors the prototype: dictionary audio first, community recordings
 * last, and the free source (Lingua Libre) even with VIP off. */
const HUMAN_AUDIO: HumanAudioSource[] = [
  { key: 'cambridgeAudio', label: 'Cambridge', hosts: PROVIDER_HOSTS['dict:cambridge'], vip: true },
  { key: 'oxfordAudio', label: 'Oxford', hosts: PROVIDER_HOSTS['dict:oxford'], vip: true },
  { key: 'forvo', label: 'Forvo', hosts: PROVIDER_HOSTS['audio:forvo'], vip: true },
  { key: 'linguaLibre', label: 'Lingua Libre', hosts: PROVIDER_HOSTS['vip:lingualibre'], vip: false },
];

/** Premium TTS is configured when its provider has the credentials it needs. */
function premiumTts(tts: TtsSettings, ai: AiSettings): boolean {
  if (tts.provider === 'disabled') return false;
  const openAiKey = ai.provider === 'openai' && ai.apiKey.trim() !== '';
  const elevenKey = tts.elevenLabsApiKey.trim() !== '';
  if (tts.provider === 'elevenlabs') return elevenKey;
  if (tts.provider === 'openai') return openAiKey;
  return openAiKey || elevenKey;
}

/** Any of the source's origins granted → the source can be fetched. */
function granted(hosts: string[]): boolean {
  return hosts.some((host) => hasOrigin(host));
}

/**
 * Resolve the pronunciation of `text` with the current settings. Human
 * recordings only apply to a single word; a multi-word expression goes
 * straight to TTS (there is nothing recorded to fetch).
 */
export function resolveWordAudio(
  text: string,
  settings: { vip: VipSettings; tts: TtsSettings; ai: AiSettings },
): WordAudioStatus {
  const word = text.trim();
  const singleWord = word !== '' && !/\s/.test(word);
  let heldBack = false;

  if (singleWord) {
    for (const source of HUMAN_AUDIO) {
      if (source.vip && !settings.vip.enabled) continue;
      if (settings.vip[source.key] === false) continue;
      if (!granted(source.hosts)) {
        heldBack = true;
        continue;
      }
      return { kind: 'human', source: source.label, heldBack };
    }
  }

  if (premiumTts(settings.tts, settings.ai)) return { kind: 'tts', heldBack };

  const googleOn = settings.vip.googleTtsFallback !== false;
  if (googleOn) {
    if (granted(PROVIDER_HOSTS['tts:google'])) return { kind: 'tts', heldBack };
    heldBack = true;
  }
  return { kind: null, heldBack };
}
