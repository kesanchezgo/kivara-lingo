/**
 * The two URLs the Whisper loader takes from settings, and where each may go.
 *
 * Read at the point of use, not on save: a value can reach the offscreen
 * document without ever passing the settings panel — a payload stored by an
 * older build, a hand-edited value, an imported dump. Validating while the user
 * types is a courtesy; validating where the value is spent is the control.
 *
 * The offscreen document is the most privileged page the extension owns (its
 * own storage, Dexie, the media graph), which is why a free-text URL there is
 * not the same as a free-text URL on a web page.
 */
import { describe, expect, it } from 'vitest';
import { assertExtensionScriptUrl, assertFetchableWhisperUrl, WHISPER_MODEL_MAX_BYTES } from '../../src/shared/whisper-url';

const OWN_ID = 'kivaraextensionid';

describe('the Whisper model URL', () => {
  it('accepts a public https mirror', () => {
    expect(assertFetchableWhisperUrl('https://huggingface.co/x/ggml-tiny.en.bin').hostname)
      .toBe('huggingface.co');
    expect(assertFetchableWhisperUrl('https://example.com/model.bin?sig=abc').search).toBe('?sig=abc');
  });

  it('refuses loopback, LAN and metadata targets', () => {
    for (const url of [
      'http://127.0.0.1/model.bin',
      'http://localhost:8765/model.bin',
      'http://192.168.1.50/model.bin',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/model.bin',
      'http://[::1]/model.bin',
      'http://my-nas.local/model.bin',
    ]) {
      expect(() => assertFetchableWhisperUrl(url), url).toThrow();
    }
  });

  it('refuses cleartext, unlike the media path that allows an http start', () => {
    // `allowHttp` exists so an http→https upgrade can be attempted. Whisper
    // mirrors are https-only, and the flag here would only be a downgrade.
    expect(() => assertFetchableWhisperUrl('http://example.com/model.bin')).toThrow(/https/);
  });

  it('refuses a malformed string and a non-http scheme', () => {
    expect(() => assertFetchableWhisperUrl('not a url')).toThrow();
    expect(() => assertFetchableWhisperUrl('file:///etc/passwd')).toThrow();
    expect(() => assertFetchableWhisperUrl('data:text/plain,x')).toThrow();
    expect(() => assertFetchableWhisperUrl('javascript:alert(1)')).toThrow();
  });

  it('bounds what may be staged into the cache', () => {
    // 200 MB: past the biggest quantisation we document, so a mirror cannot
    // use the extension's cache as a bucket.
    expect(WHISPER_MODEL_MAX_BYTES).toBe(200 * 1024 * 1024);
  });
});

describe('the Whisper glue URL', () => {
  const own = (path: string): string => `chrome-extension://${OWN_ID}/${path}`;

  it('accepts a script from this extension', () => {
    expect(assertExtensionScriptUrl(own('lib/whisper.js'), OWN_ID).pathname)
      .toBe('/lib/whisper.js');
  });

  it('refuses every remote origin', () => {
    for (const url of [
      'https://cdn.example.com/whisper.js',
      'http://cdn.example.com/whisper.js',
      'https://evil.test/whisper.js',
      '//evil.test/whisper.js',
    ]) {
      expect(() => assertExtensionScriptUrl(url, OWN_ID), url).toThrow();
    }
  });

  it('refuses another extension id and our own page nesting tricks', () => {
    expect(() => assertExtensionScriptUrl('chrome-extension://someoneelse/whisper.js', OWN_ID))
      .toThrow(/pertenecer/);
    // A query or fragment on our own path is how a same-origin URL smuggles a
    // different meaning; the loader serves a plain path, so neither is allowed.
    expect(() => assertExtensionScriptUrl(`${own('whisper.js')}?v=2`, OWN_ID)).toThrow();
    expect(() => assertExtensionScriptUrl(`${own('whisper.js')}#main`, OWN_ID)).toThrow();
  });

  it('refuses file: and javascript: regardless of the id', () => {
    expect(() => assertExtensionScriptUrl('file:///C:/evil.js', OWN_ID)).toThrow();
    expect(() => assertExtensionScriptUrl('javascript:alert(1)', OWN_ID)).toThrow();
  });

  it('refuses credentials in the URL', () => {
    expect(() => assertExtensionScriptUrl(`chrome-extension://u:p@${OWN_ID}/w.js`, OWN_ID)).toThrow();
  });
});
