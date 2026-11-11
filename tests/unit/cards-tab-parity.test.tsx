/**
 * Cards tab parity with the prototype (docs/REDESIGN-V2.md §7 F4).
 *
 * The view is the prototype's; the wiring is the repo's. Every case renders
 * the tab over the real AnkiConnect client (via `createAnkiMessagesFake`,
 * which validates the calls against the add-on fixture) and covers one
 * behaviour: the connection states, the per-language deck row with its badge
 * and "(new)" option, the grouped source picker, the two preview faces and
 * the three pronunciation indicators.
 */
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Full CardsTab renders with real timers are the heaviest DOM tests in the
// suite; under parallel runs they were observed crossing the default 5 s
// ceiling with zero failures in isolation. The ceiling moves, not the logic.
vi.setConfig({ testTimeout: 20_000 });
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { sendMessage } from 'webext-bridge/content-script';
import { CardsTab } from '../../src/app/components/tabs/CardsTab';
import type { AnkiMapping } from '../../src/shared/types';
import { buildPreviewData, type PreviewData } from '../../src/shared/preview-data';
import { useKivaraStore } from '../../src/shared/use-kivara-store';
import { refreshHostPermissions } from '../../src/shared/host-permissions-store';
import {
  DEFAULT_AI, DEFAULT_CAPTURE, DEFAULT_TTS, DEFAULT_TRANSLATE, DEFAULT_VIP,
} from '../../src/shared/store';
import { createAnkiMessagesFake, type AnkiMessagesFake } from '../helpers/anki-messages';

vi.mock('webext-bridge/content-script', () => ({ sendMessage: vi.fn(), onMessage: vi.fn() }));

const send = vi.mocked(sendMessage);

const MODEL_FIELDS = [
  'word', 'phonetic', 'sentence', 'translation', 'bilingual', 'monolingual', 'picture', 'sentence audio', 'word audio',
];

function baseMapping(overrides: Partial<AnkiMapping> = {}): AnkiMapping {
  return {
    ankiUrl: 'http://127.0.0.1:8765',
    apiKey: '',
    deckName: 'Default',
    modelName: 'KivaraLingo',
    fieldSources: {},
    decks: { en: 'Default' },
    ...overrides,
  };
}

interface HarnessProps {
  initial?: AnkiMapping;
  episodeLang?: string;
  mockData?: PreviewData;
  onOpenVocab?: () => void;
}

/** Keeps the mapping in state, exactly like the SidePanel host does. */
function Harness({ initial, episodeLang, mockData, onOpenVocab }: HarnessProps) {
  const [mapping, setMapping] = useState<AnkiMapping>(initial ?? baseMapping());
  return (
    <CardsTab
      mapping={mapping}
      setMapping={setMapping}
      mockData={mockData ?? buildPreviewData()}
      episodeLang={episodeLang}
      onOpenVocab={onOpenVocab}
    />
  );
}

/** The happy-path reply: a real Anki with one deck and the Kivara model. */
function connectedFake(overrides: Record<string, unknown> = {}): AnkiMessagesFake {
  const fake = createAnkiMessagesFake({
    resolve: {
      version: 6,
      deckNames: ['Default'],
      modelNames: ['KivaraLingo'],
      modelFieldNames: MODEL_FIELDS,
      ...overrides,
    },
  });
  send.mockImplementation((type: string, data?: unknown) => fake.send(type, data) as Promise<never>);
  return fake;
}

/** Open the docked preview so the faces and the quality badges render. */
function openPreview() {
  fireEvent.click(screen.getByRole('button', { name: /Vista previa/ }));
}

/** Expand the connection group: its status detail lives inside the collapse. */
function openConnection() {
  fireEvent.click(screen.getAllByRole('button', { name: /Conexión/ })[0]);
}

let ankiFake: AnkiMessagesFake | null = null;

beforeEach(async () => {
  cleanup();
  const state = useKivaraStore.getState();
  useKivaraStore.setState({
    ...state,
    ai: { ...DEFAULT_AI },
    vip: { ...DEFAULT_VIP },
    tts: { ...DEFAULT_TTS },
    capture: { ...DEFAULT_CAPTURE },
    translate: { ...DEFAULT_TRANSLATE },
  }, true);
  // Reset the granted-origins store: it is a module singleton that outlives a
  // test, so a grant from the previous case would leak into the next one.
  (globalThis as unknown as { chrome: { permissions?: unknown } }).chrome.permissions = {
    getAll: vi.fn(async () => ({ origins: [] as string[] })),
  };
  await act(async () => { await refreshHostPermissions(); });
});

afterEach(() => {
  ankiFake?.restore();
  ankiFake = null;
  cleanup();
  vi.unstubAllGlobals();
});

describe('CardsTab · connection states', () => {
  it('shows the connecting state while the probe is in flight', async () => {
    send.mockReturnValue(new Promise(() => {}) as Promise<never>);
    render(<Harness />);
    openConnection();
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Comprobando'));
  });

  it('shows the offline pill and the coded error when Anki does not answer', async () => {
    send.mockResolvedValue({ ok: false, code: 'NETWORK' } as never);
    const { container } = render(<Harness />);
    openConnection();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Anki no responde'));
    expect(container.textContent).toContain('sin conexión');
    expect(screen.getByRole('button', { name: /Probar/ })).toBeTruthy();
  });

  it('renders the connected pill, the reconnect action and the note fields', async () => {
    ankiFake = connectedFake();
    render(<Harness />);
    await waitFor(() => expect(screen.getByText('activo')).toBeTruthy());
    expect(screen.getByRole('button', { name: /Reconectar/ })).toBeTruthy();
    // The model's fields are listed with their detected source.
    expect(await screen.findByText('word')).toBeTruthy();
    expect(screen.getByText('sentence audio')).toBeTruthy();
  });
});

describe('CardsTab · one deck per language', () => {
  it('renders a deck row per language, badges the episode deck and offers the new deck', async () => {
    ankiFake = connectedFake();
    render(<Harness episodeLang="es" />);
    await waitFor(() => expect(screen.getByText('activo')).toBeTruthy());

    // Active language (en) keeps the saved deck; the episode language (es) is
    // not in the list yet, so it is offered as new.
    const esDeck = await screen.findByLabelText('Mazo · Español') as HTMLSelectElement;
    expect(esDeck.value).toBe('Vocabulario Español');
    const newOption = Array.from(esDeck.options).find((o) => o.text.includes('Vocabulario Español (nuevo)'));
    expect(newOption).toBeTruthy();
    expect(screen.getByText('Este episodio')).toBeTruthy();
  });

  it('writes the chosen deck for that language through the mapping', async () => {
    ankiFake = connectedFake({ deckNames: ['Default', 'Otro'] });
    render(<Harness episodeLang="es" />);
    await waitFor(() => expect(screen.getByText('activo')).toBeTruthy());
    const esDeck = await screen.findByLabelText('Mazo · Español') as HTMLSelectElement;
    fireEvent.change(esDeck, { target: { value: 'Otro' } });
    await waitFor(() => {
      const current = screen.getByLabelText('Mazo · Español') as HTMLSelectElement;
      expect(current.value).toBe('Otro');
    });
  });
});

describe('CardsTab · grouped source picker', () => {
  it('shows the translated group labels and source labels', async () => {
    ankiFake = connectedFake();
    render(<Harness />);
    await waitFor(() => expect(screen.getByText('word')).toBeTruthy());

    // Groups come from cards.group* — no literal in the view.
    expect(screen.getAllByText('Nativas').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Multi-fuente').length).toBeGreaterThan(0);
    expect(screen.getAllByText('IA').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Otros').length).toBeGreaterThan(0);
    // And the options are translated too.
    expect(screen.getAllByText('Frase con hueco').length).toBeGreaterThan(0);
  });

  it('assigns the picked source to the field', async () => {
    ankiFake = connectedFake();
    render(<Harness />);
    await waitFor(() => expect(screen.getByText('word')).toBeTruthy());

    // The "word" field expands to its picker; pick "Manual".
    const wordRow = screen.getAllByRole('button', { name: /word/ }).find(
      (button) => (button.textContent ?? '').startsWith('word') && !(button.textContent ?? '').startsWith('word audio'),
    );
    expect(wordRow).toBeTruthy();
    fireEvent.click(wordRow!);
    fireEvent.click(screen.getAllByRole('button', { name: 'Manual' })[0]);
    await waitFor(() => {
      const updated = screen.getAllByRole('button', { name: /word/ }).find(
        (button) => (button.textContent ?? '').startsWith('word') && !(button.textContent ?? '').startsWith('word audio'),
      );
      expect(updated?.textContent).toContain('Manual');
    });
  });
});

describe('CardsTab · preview faces', () => {
  it('renders the front face and flips to the back', async () => {
    ankiFake = connectedFake();
    const { container } = render(<Harness />);
    await waitFor(() => expect(screen.getByText('activo')).toBeTruthy());
    openPreview();

    const flip = container.querySelector('div[role="button"][aria-label="Voltear"]');
    expect(flip).toBeTruthy();
    const visibleFace = () => Array.from(flip!.querySelectorAll('[aria-hidden="false"]')).map((el) => el.textContent).join(' ');
    expect(visibleFace()).toContain('these days');

    fireEvent.click(screen.getByRole('radio', { name: 'Reverso' }));
    await waitFor(() => expect(visibleFace()).toContain('Significado'));
    expect(visibleFace()).toContain('these days');
  });
});

describe('CardsTab · pronunciation indicators', () => {
  it('shows the synthetic-voice indicator when premium TTS is configured', async () => {
    ankiFake = connectedFake();
    useKivaraStore.setState({ tts: { ...DEFAULT_TTS, provider: 'elevenlabs', elevenLabsApiKey: 'sk-test' } });
    render(<Harness />);
    await waitFor(() => expect(screen.getByText('activo')).toBeTruthy());
    openPreview();
    expect(screen.getByText('voz sintética')).toBeTruthy();
  });

  it('shows the no-source indicator and the held-back hint without access', async () => {
    ankiFake = connectedFake();
    render(<Harness />);
    await waitFor(() => expect(screen.getByText('activo')).toBeTruthy());
    openPreview();
    expect(screen.getByText('sin fuente')).toBeTruthy();
    const heldBackBadge = screen.getAllByText('Palabra').find(
      (label) => label.parentElement?.getAttribute('title')?.includes('Acceso a sitios'),
    );
    expect(heldBackBadge).toBeTruthy();
  });

  it('shows the named human source when its host is granted', async () => {
    ankiFake = connectedFake();
    useKivaraStore.setState({ vip: { ...DEFAULT_VIP, enabled: true } });
    (globalThis as unknown as { chrome: { permissions: { getAll: unknown } } }).chrome.permissions = {
      getAll: vi.fn(async () => ({ origins: ['https://dictionary.cambridge.org/*'] })),
    };
    await act(async () => { await refreshHostPermissions(); });

    const single = { ...buildPreviewData(), word: 'sane' };
    render(<Harness mockData={single} />);
    await waitFor(() => expect(screen.getByText('activo')).toBeTruthy());
    openPreview();
    await waitFor(() => expect(screen.getByText('Cambridge')).toBeTruthy());
    expect(screen.queryByText('sin fuente')).toBeNull();
  });
});
