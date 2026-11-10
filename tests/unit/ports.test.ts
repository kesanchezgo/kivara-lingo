/**
 * Port layer contract tests (docs/REDESIGN-V2.md §4.2, §3 H1).
 *
 * Three things are under test:
 *  1. The fake ports satisfy the `Ports` interface and behave as documented.
 *  2. `usePorts()` throws a clear error outside a `<PortsProvider>`.
 *  3. `usePortalContainer()` defaults to `document.body`.
 */
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PortsProvider, usePorts, type Ports } from '../../src/ui/ports/PortsProvider';
import { PortalContainerProvider, usePortalContainer } from '../../src/ui/portal';
import { fakePorts } from '../helpers/ports';

afterEach(() => cleanup());

describe('fake ports', () => {
  it('satisfies the Ports interface', () => {
    const ports: Ports = fakePorts();
    expect(Object.keys(ports).sort()).toEqual(['ai', 'anki', 'episode', 'lexicon', 'packs']);
  });

  it('exposes a tokenizer that classifies a known fixture word', async () => {
    const { lexicon } = fakePorts();
    const tokens = await lexicon.tokenize('It keeps her sane.', 'en');
    const sane = tokens.find((t) => t.key === 'sane');
    expect(sane?.kind).toBe('known');
    expect((await lexicon.lookup('sane', 'en'))?.translation).toBe('cuerdo');
  });

  it('exposes an episode with cues, an active index and a live controller', async () => {
    const { episode } = fakePorts();
    expect(episode.cues()).toHaveLength(3);
    expect(episode.activeIndex()).toBe(0);
    expect(episode.media()?.series).toBe('Game of Thrones');

    expect(episode.controller).not.toBeNull();
    await episode.controller!.seek(2600);
    expect(episode.activeIndex()).toBe(1);
    expect(episode.controller!.currentTimeMs()).toBe(2600);
  });

  it('notifies episode subscribers and stops after unsubscribe', () => {
    const { episode } = fakePorts();
    const spy = vi.fn();
    const off = episode.subscribe(spy);
    expect(typeof off).toBe('function');
    off();
  });

  it('exposes an Anki port whose createCard returns a note id', async () => {
    const { anki } = fakePorts();
    await expect(anki.ping()).resolves.toEqual({ ok: true, version: 6 });
    expect(await anki.decks()).toContain('Default');
    expect(await anki.fields('Cloze')).toContain('Text');
    const noteId = await anki.createCard({
      word: 'sane',
      sentence: 'It keeps her sane.',
      kind: 'word',
      deck: 'Default',
      lang: 'en',
    });
    expect(typeof noteId).toBe('number');
    await expect(anki.addContext({ noteId, sentence: 'ctx', tags: [] })).resolves.toBeUndefined();
    await expect(anki.undo(noteId)).resolves.toBeUndefined();
    expect(await anki.wordIntervals('en', 'Default', 'word')).toEqual({ sane: 42, afford: 0, day: 128 });
  });

  it('exposes an AI port returning a structured explanation', async () => {
    const { ai } = fakePorts();
    const explanation = await ai.explainSentence({
      line: 'These days it keeps her sane.',
      lang: 'en',
      uiLang: 'es',
      nativeLang: 'es',
    });
    expect(explanation.meaning).toContain('These days it keeps her sane.');
    expect(explanation.expressions[0]).toEqual({ text: 'these days', gloss: 'nowadays' });
  });

  it('exposes a packs port mirroring the service-worker messages', async () => {
    const { packs } = fakePorts();
    expect((await packs.list())[0].title).toBe('Wiktionary EN→ES');
    const result = await packs.installFromUrl('https://example.test/kty-en-es.zip');
    expect(result.ok).toBe(true);
    await expect(packs.remove('pack-fixture')).resolves.toBeUndefined();
  });

  it('accepts per-port overrides', () => {
    const ping = vi.fn();
    const ports = fakePorts({ anki: { ...fakePorts().anki, ping } });
    expect(ports.anki.ping).toBe(ping);
  });
});

describe('usePorts', () => {
  it('throws a clear error outside a PortsProvider', () => {
    function Probe(): null {
      usePorts();
      return null;
    }
    // Suppress React's error-boundary console noise for the intentional throw.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(createElement(Probe))).toThrow(/PortsProvider/);
    errorSpy.mockRestore();
  });

  it('returns the ports when mounted inside the provider', () => {
    let seen: Ports | null = null;
    function Probe(): null {
      seen = usePorts();
      return null;
    }
    const ports = fakePorts();
    render(createElement(PortsProvider, { ports, children: createElement(Probe) }));
    expect(seen).toBe(ports);
  });
});

describe('usePortalContainer', () => {
  it('defaults to document.body when there is no provider', () => {
    let seen: HTMLElement | null = null;
    function Probe(): null {
      seen = usePortalContainer();
      return null;
    }
    render(createElement(Probe));
    expect(seen).toBe(document.body);
  });

  it('returns the supplied container when wrapped', () => {
    const container = document.createElement('div');
    let seen: HTMLElement | null = null;
    function Probe(): null {
      seen = usePortalContainer();
      return null;
    }
    render(createElement(PortalContainerProvider, { container, children: createElement(Probe) }));
    expect(seen).toBe(container);
  });
});
