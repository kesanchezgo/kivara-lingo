import { beforeEach, describe, expect, it, vi } from 'vitest';
import { britannicaDictionarySource } from '../../src/background/enrichment/sources/britannica-dictionary';
import { dictionaryComSource } from '../../src/background/enrichment/sources/dictionary-com';
import { linguaLibreSource } from '../../src/background/enrichment/sources/lingua-libre';
import { lingueeSource } from '../../src/background/enrichment/sources/linguee';
import { merriamWebsterSource } from '../../src/background/enrichment/sources/merriam-webster';
import { promtContextSource } from '../../src/background/enrichment/sources/promt-context';
import { pixabaySource } from '../../src/background/enrichment/sources/pixabay';
import { tatoebaSource } from '../../src/background/enrichment/sources/tatoeba';
import { wordReferenceSource } from '../../src/background/enrichment/sources/wordreference';

const ctx = {
  sourceLang: 'en',
  targetLang: 'es',
  timeoutMs: 8000,
};

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('browser-session protected scrapers', () => {
  it('seeds the WordReference gate cookie and includes browser credentials', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<table class="WRD"><td class="ToWrd">dar vt</td></table>', { status: 200 }),
    );

    const result = await wordReferenceSource.enrich('give', ctx);

    expect(chrome.cookies.set).toHaveBeenCalledWith(expect.objectContaining({
      name: 'nginx_wr_human',
      value: '1',
      domain: '.wordreference.com',
      sameSite: 'no_restriction',
    }));
    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.wordreference.com/enes/give',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(result.translations).toEqual(['dar']);
  });

  it('never sends the browser session to a third-party dictionary', async () => {
    // Policy change (audit): `credentials: 'include'` inside the service
    // worker ships the user's REAL cookies to every dictionary we scrape.
    // Knowing which word a session looked up on britannica.com /
    // merriam-webster.com / linguee.com is user data that belongs to those
    // sites and their logged-in user — not to us. A 403 costs a lookup; a
    // cookie leak costs an account trail. WordReference is the exception
    // and keeps 'include' because it sets its own gate cookie.
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<span class="def_text">to hand something to someone</span>', { status: 200 }),
    );

    await britannicaDictionarySource.enrich('give', ctx);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.britannica.com/dictionary/give',
      expect.objectContaining({ credentials: 'omit' }),
    );
  });

  it('WordReference keeps its own credentials (it sets the gate cookie)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<table class="WRD"><td class="ToWrd">dar vt</td></table>', { status: 200 }),
    );

    await wordReferenceSource.enrich('give', ctx);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.wordreference.com/enes/give',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('opens a persistent Britannica circuit after a Cloudflare challenge', async () => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', {
      status: 403,
      headers: { 'cf-mitigated': 'challenge' },
    }));

    await britannicaDictionarySource.enrich('give', ctx);

    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      'enrichment:britannica:circuit:v1': {
        blockedUntil: now + 10 * 60 * 1000,
        reason: 'cloudflare-challenge',
      },
    });
  });

  it('does not retry Britannica while its persistent circuit is open', async () => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      'enrichment:britannica:circuit:v1': {
        blockedUntil: now + 60_000,
        reason: 'cloudflare-challenge',
      },
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await britannicaDictionarySource.enrich('give', ctx);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });

  it('keeps WordReference examples paired within their original rows', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(`
      <table class="WRD">
        <tr><td class="FrEx">Don't forget to turn off the light.</td><td class="ToEx">No olvides apagar la luz.</td></tr>
        <tr><td class="FrEx">I forgot to do the laundry.</td></tr>
        <tr><td class="FrEx">Forget about it!</td><td class="ToEx">¡Olvídalo!</td></tr>
      </table>
    `, { status: 200 }));

    const result = await wordReferenceSource.enrich('forget', ctx);

    expect(result.examples).toEqual([
      { text: "Don't forget to turn off the light.", translation: 'No olvides apagar la luz.' },
      { text: 'Forget about it!', translation: '¡Olvídalo!' },
    ]);
  });

  it('parses Dictionary.com editorial data without a browser session', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(`
      <span class="txt-ipa">/ ɡɪv /</span>
      <button class="common-btn-headword-audio" data-audiosrc="tts/g/give/give.mp3" data-audioorigin="https://audio.dictionary.com"></button>
      <li class="item-definition">
        <p class="txt-variant-label-short">to present voluntarily.</p>
        <blockquote class="box-examples"><p class="txt-example">She gave him a book.</p></blockquote>
      </li>
    `, { status: 200 }));

    const result = await dictionaryComSource.enrich('give', ctx);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.dictionary.com/browse/give',
      expect.objectContaining({ credentials: 'omit' }),
    );
    expect(result).toEqual({
      phonetic: '/ɡɪv/',
      audio: [{ url: 'https://audio.dictionary.com/tts/g/give/give.mp3', accent: 'US' }],
      definitions: ['to present voluntarily.'],
      examples: [{ text: 'She gave him a book.' }],
    });
  });

  it('rejects unrelated Dictionary.com fallback audio for phrases', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(`
      <button class="common-btn-headword-audio"
        data-audiosrc="tts/w/wisenheimer/wisenheimer.mp3"
        data-audioorigin="https://audio.dictionary.com"></button>
      <p class="txt-variant-label-short">something that is very easy.</p>
    `, { status: 200 }));

    const result = await dictionaryComSource.enrich('piece of cake', ctx);

    expect(result.audio).toBeUndefined();
    expect(result.definitions).toEqual(['something that is very easy.']);
  });
});

describe('Linguee request protection', () => {
  const rateLimitKey = 'enrichment:linguee:rate-limit:v1';

  it('omits the browser session and persists each permitted request', async () => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<a class="dictLink">dar</a>', { status: 200 }),
    );

    const result = await lingueeSource.enrich('give', ctx);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.linguee.com/english-spanish/search?source=auto&query=give',
      expect.objectContaining({ credentials: 'omit' }),
    );
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      [rateLimitKey]: {
        requestTimestamps: [now],
        lastRequestAt: now,
        cooldownUntil: 0,
      },
    });
    expect(result.translations).toEqual(['dar']);
  });

  it('does not contact Linguee after six requests in the current hour', async () => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      [rateLimitKey]: {
        requestTimestamps: Array.from({ length: 6 }, (_, index) => now - 60_000 - index),
        lastRequestAt: now - 60_000,
        cooldownUntil: 0,
      },
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await lingueeSource.enrich('give', ctx);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });

  it('activates a six-hour persistent cooldown after HTTP 429', async () => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 429 }));

    await lingueeSource.enrich('give', ctx);

    expect(chrome.storage.local.set).toHaveBeenLastCalledWith({
      [rateLimitKey]: {
        requestTimestamps: [now],
        lastRequestAt: now,
        cooldownUntil: now + 6 * 60 * 60 * 1000,
      },
    });
  });
});

describe('PROMT contextual fallback', () => {
  const rateLimitKey = 'enrichment:promt-context:rate-limit:v1';

  it('extracts aligned bilingual sentences and persists the request permit', async () => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(`
      <div class="samplesList">
        <span class="samSource">I will <span class="sourceSample">give</span> you the book.</span>
        <span class="samTranslation">Te <a class="backLink">daré</a> el libro.</span>
      </div>
      <div class="samplesList">
        <span class="samSource">Give it to me.</span>
        <span class="samTranslation">Dámelo.</span>
      </div>
    `, { status: 200 }));

    const result = await promtContextSource.enrich('give', ctx);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.online-translator.com/contexts/english-spanish/give',
      expect.objectContaining({ credentials: 'omit' }),
    );
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      [rateLimitKey]: {
        requestTimestamps: [now],
        lastRequestAt: now,
        cooldownUntil: 0,
      },
    });
    expect(result.examples).toEqual([
      { text: 'I will give you the book.', translation: 'Te daré el libro.' },
      { text: 'Give it to me.', translation: 'Dámelo.' },
    ]);
  });

  it('activates a two-hour cooldown after HTTP 429', async () => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 429 }));

    await promtContextSource.enrich('give', ctx);

    expect(chrome.storage.local.set).toHaveBeenLastCalledWith({
      [rateLimitKey]: {
        requestTimestamps: [now],
        lastRequestAt: now,
        cooldownUntil: now + 2 * 60 * 60 * 1000,
      },
    });
  });
});

describe('same-provider endpoint updates', () => {
  it('encodes Merriam-Webster multiword entries exactly once', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<span class="dtText">: to become publicly known</span>', { status: 200 }),
    );

    const result = await merriamWebsterSource.enrich('come out', ctx);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.merriam-webster.com/dictionary/come%20out',
      expect.objectContaining({ credentials: 'omit' }),
    );
    expect(result.definitions).toEqual(['to become publicly known']);
  });

  it('uses Tatoeba v1 and prefers a direct translation', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      data: [{
        text: 'Please give me the book.',
        translations: [
          { text: 'Entrégame el libro.', is_direct: false },
          { text: 'Dame el libro.', is_direct: true },
        ],
      }],
    }));

    const result = await tatoebaSource.enrich('give', ctx);

    expect(fetchMock.mock.calls[0]?.[0]).toContain('https://api.tatoeba.org/v1/sentences');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('trans%3Alang=spa');
    expect(result.examples).toEqual([
      { text: 'Please give me the book.', translation: 'Dame el libro.' },
    ]);
  });

  it('reads Pixabay public bootstrap results without an API key', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      page: {
        results: [{
          mediaType: 'photo',
          sources: {
            small: 'https://cdn.pixabay.com/photo/small.jpg',
            large: 'https://cdn.pixabay.com/photo/large.jpg',
          },
        }],
      },
    }));

    const result = await pixabaySource.enrich('give', ctx);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://pixabay.com/images/search/give/?pagi=1',
      expect.objectContaining({
        credentials: 'omit',
        headers: expect.objectContaining({
          Accept: 'application/json',
          'x-fetch-bootstrap': '1',
        }),
      }),
    );
    expect(result.imageUrl).toBe('https://cdn.pixabay.com/photo/large.jpg');
  });

  it('searches enough LinguaLibre candidates to find an exact recording', async () => {
    const phrasals = Array.from({ length: 5 }, (_, index) => ({
      title: `File:LL-Q1860 (eng)-Speaker-give ${index}.wav`,
    }));
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        query: { search: [...phrasals, { title: 'File:LL-Q1860 (eng)-Speaker-give.wav' }] },
      }))
      .mockResolvedValueOnce(jsonResponse({
        query: {
          pages: {
            '1': { imageinfo: [{ url: 'https://upload.wikimedia.org/give.wav' }] },
          },
        },
      }));

    const result = await linguaLibreSource.enrich('give', ctx);

    expect(fetchMock.mock.calls[0]?.[0]).toContain('srlimit=20');
    expect(decodeURIComponent(String(fetchMock.mock.calls[0]?.[0]))).toContain('intitle:"-give"');
    expect(result.audio).toEqual([{ url: 'https://upload.wikimedia.org/give.wav' }]);
  });
});
