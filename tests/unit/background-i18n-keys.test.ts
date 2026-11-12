/**
 * The background/shared copy routed through the dictionaries in the
 * `fix/background-i18n-literals` round is an EXPLICIT key list, checked the
 * same way enrich-fix-keys checks its maps: every key the modules name must
 * exist in BOTH locales, respect the bundle contract (background/content keys
 * in `sw`, shared-module keys in `core`), keep their placeholders, and stay
 * compatible with the classifiers that pattern-match the raw messages.
 */
import { describe, expect, it } from 'vitest';
import { ALL_MESSAGES } from '../../src/shared/i18n';
import { sw } from '../../src/shared/i18n/sw';
import { core } from '../../src/shared/i18n/core';
import { GROUP_LABELS } from '../../src/shared/dict-pack-catalog';

/** Keys the background/content modules call — the worker bundle must carry them. */
const SW_KEYS = [
  'capture.aiNoResponse',
  'capture.sentenceTranslationUnavailable',
  'capture.enrichmentPartial',
  'capture.dalleFailed',
  'capture.aiImageFailed',
  'capture.phoneticUnavailable',
  'capture.frameStoreFailed',
  'capture.audioStoreFailed',
  'capture.carriedAudioStoreFailed',
  'capture.ttsNoResponse',
  'capture.vipImageFailed',
  'capture.inactiveTab',
  'capture.offscreenNoResponse',
  'capture.offscreenNoRpc',
  'cards.noteForeign',
  'cards.noteOwnershipUnreadable',
  'dictpack.termsNotArray',
  'dictpack.tooManyTerms',
  'dictpack.noRowsWritten',
  'enrich.hostPermissionGate',
  'sw.noActiveTab',
  'sw.openUrlHttpOnly',
  'translate.originMismatch',
  'translate.providerOffline',
  'translate.chainEmpty',
  'translate.offlineNoNetwork',
  'translate.noProviderSucceeded',
  'translate.noProviderInRace',
  'tts.elevenlabsKeyRequired',
  'tts.elevenlabsBodyReadFailed',
  'tts.openaiKeyRequired',
  'tts.openaiBodyReadFailed',
  'tts.noText',
  'yomitan.parseFailed',
  'yomitan.packDownloadFailed',
  'yomitan.unzipFailed',
  'yomitan.csvParseFailed',
] as const;

/** Keys the shared modules resolve through core's `t`. */
const CORE_KEYS = [
  'fetch.stalledBody',
  'fetch.stalledDownload',
  'fetch.headerTimeout',
  'fetch.exhaustedRetries',
  'net.urlInvalid',
  'net.httpsOnly',
  'net.urlNotAllowed',
  'net.senderNotAllowed',
  'net.tooLarge',
  'secret.encryptionUnavailable',
  'secret.slotWriteFailed',
  'telem.badVersion',
  'freq.frequent',
  'freq.topSpoken1000',
  'freq.topSpoken2000',
  'freq.topSpoken3000',
  'freq.topWritten1000',
  'freq.topWritten2000',
  'freq.topWritten3000',
] as const;

function problems(keys: readonly string[]): string[] {
  return keys
    .map((key) => {
      const es = ALL_MESSAGES.es[key];
      const en = ALL_MESSAGES.en[key];
      if (es && en) return null;
      if (!es && !en) return `missing in BOTH locales: ${key}`;
      return `locale mismatch for ${key}: es=${JSON.stringify(es)} en=${JSON.stringify(en)}`;
    })
    .filter((p): p is string => p !== null);
}

describe('background i18n keys', () => {
  it('exists in es and en for every key the round routed through t()', () => {
    expect(problems(SW_KEYS)).toEqual([]);
    expect(problems(CORE_KEYS)).toEqual([]);
  });

  it('background keys live in the worker subset (sw area)', () => {
    const missing = SW_KEYS.filter((k) => !(k in sw.es && k in sw.en));
    expect(missing, 'background keys missing from sw.es/sw.en').toEqual([]);
  });

  it('shared-module keys live in the core subset', () => {
    const missing = CORE_KEYS.filter((k) => !(k in core.es && k in core.en));
    expect(missing, 'shared keys missing from core.es/core.en').toEqual([]);
  });

  it('keeps the placeholders the call sites fill', () => {
    const expectVars: Array<[string, string[]]> = [
      ['capture.aiNoResponse', ['{reason}']],
      ['capture.sentenceTranslationUnavailable', ['{reason}']],
      ['capture.enrichmentPartial', ['{reason}']],
      ['capture.dalleFailed', ['{reason}']],
      ['capture.frameStoreFailed', ['{reason}']],
      ['dictpack.tooManyTerms', ['{count}', '{max}']],
      ['translate.originMismatch', ['{origin}']],
      ['fetch.stalledBody', ['{seconds}']],
      ['fetch.headerTimeout', ['{seconds}']],
      ['net.tooLarge', ['{limit}']],
      ['telem.badVersion', ['{version}', '{expected}']],
      ['yomitan.parseFailed', ['{name}', '{reason}']],
      ['yomitan.packDownloadFailed', ['{reason}']],
    ];
    for (const [key, vars] of expectVars) {
      for (const v of vars) {
        expect(ALL_MESSAGES.es[key].includes(v), `es ${key} lacks ${v}`).toBe(true);
        expect(ALL_MESSAGES.en[key].includes(v), `en ${key} lacks ${v}`).toBe(true);
      }
    }
  });

  it('stays compatible with the classifiers that match the raw text', () => {
    // enrich-health routes a stalled body to the timeout family and the host
    // gate to the permission family; the es copy must keep those signals.
    expect(ALL_MESSAGES.es['fetch.headerTimeout']).toMatch(/no respond/i);
    expect(ALL_MESSAGES.es['fetch.stalledBody']).toMatch(/dejó de enviar/);
    expect(ALL_MESSAGES.es['enrich.hostPermissionGate']).toMatch(/permiso/);
    expect(ALL_MESSAGES.en['enrich.hostPermissionGate']).toMatch(/host permission/);
  });

  it('resolves every GROUP_LABELS entry through a key in both locales', () => {
    for (const key of Object.values(GROUP_LABELS)) {
      expect(problems([key]), key).toEqual([]);
    }
    // phonetic owns its label — it no longer borrows another group's copy.
    expect(GROUP_LABELS.phonetic).toBe('dictpack.groupPhonetic');
    expect(GROUP_LABELS.phonetic).not.toBe('onb.fieldPhonetic');
    expect(ALL_MESSAGES.es['dictpack.groupPhonetic']).toContain('Fonética');
    expect(ALL_MESSAGES.en['dictpack.groupPhonetic']).toContain('Phonetics');
    expect(ALL_MESSAGES.es['dictpack.groupFrequency']).toContain('Frecuencia');
    expect(ALL_MESSAGES.en['dictpack.groupFrequency']).toContain('Frequency');
  });
});
