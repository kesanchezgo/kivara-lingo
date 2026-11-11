/**
 * Fake port implementations for component tests (docs/REDESIGN-V2.md §4.2).
 *
 * The shapes are modelled on the prototype's mock data (segments, transcript,
 * anki, sentenceExplain, dictPacks, playback) but the fixtures below are
 * hand-written and small — nothing is imported from `.mock/` at runtime and no
 * mock corpus is shipped into `src/`.
 *
 * The fakes are built through the real `createXxxPort` factories, so the tests
 * also exercise the stub delegation.
 */
import type { DictionaryEntry } from '../../src/shared/types';
import type { Ports } from '../../src/ui/ports/PortsProvider';
import { createAiPort } from '../../src/ui/ports/ai';
import { createAnkiPort } from '../../src/ui/ports/anki';
import { createEpisodePort } from '../../src/ui/ports/episode';
import { createLexiconPort } from '../../src/ui/ports/lexicon';
import { createPacksPort } from '../../src/ui/ports/packs';
import type { LexiconToken, MediaInfo, PlaybackController, SubtitleCue } from '../../src/ui/ports/types';

/* ── Lexicon fixtures ─────────────────────────────────────────────────────── */

const ENTRIES: Record<string, DictionaryEntry> = {
  sane: { token: 'sane', type: 'word', phonetic: '/seɪn/', translation: 'cuerdo', level: 'B1' },
  afford: { token: 'afford', type: 'word', phonetic: '/əˈfɔːrd/', translation: 'permitirse', level: 'B1' },
  'these days': {
    token: 'these days',
    type: 'phrase',
    phraseKind: 'idiom',
    translation: 'hoy en día',
    level: 'B1',
  },
  'look up': {
    token: 'look up',
    type: 'phrase',
    phraseKind: 'phrasal',
    translation: 'buscar (información)',
    level: 'B1',
  },
};

const RANKS: Record<string, number> = { sane: 3900, afford: 2100, day: 120, look: 340 };

const LEMMAS: Record<string, string> = { days: 'day', sanity: 'sane', affording: 'afford' };

/** Greedy enough for the fixture lines: split on whitespace, keep punctuation. */
function tokenizeLine(text: string): LexiconToken[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const key = word.replace(/[^\p{L}\p{N}']/gu, '').toLowerCase();
      return { text: word, key, kind: ENTRIES[key] ? 'known' : 'unknown' } satisfies LexiconToken;
    });
}

function makeLexicon() {
  return createLexiconPort({
    async tokenize(text) {
      return tokenizeLine(text);
    },
    async lookup(key) {
      return ENTRIES[key.toLowerCase()] ?? null;
    },
    async rankOf(lemma) {
      return RANKS[lemma.toLowerCase()] ?? null;
    },
    async levelOf(key) {
      return ENTRIES[key.toLowerCase()]?.level ?? null;
    },
    async lemmaOf(key) {
      return LEMMAS[key.toLowerCase()] ?? null;
    },
  });
}

/* ── Episode + playback fixtures ──────────────────────────────────────────── */

const CUES: SubtitleCue[] = [
  { id: 'c1', start: 1000, end: 2500, text: 'These days it keeps her sane.', language: 'en' },
  { id: 'c2', start: 2500, end: 4000, text: 'Maybe we should look up flights.', language: 'en' },
  { id: 'c3', start: 4000, end: 5200, text: "I can't afford it.", language: 'en' },
];

const MEDIA: MediaInfo = {
  platform: 'hbo',
  title: 'Winter is Coming',
  series: 'Game of Thrones',
  season: 1,
  episode: 1,
  url: 'https://play.hbomax.com/video/watch/fixture',
};

interface PlaybackState {
  timeMs: number;
  paused: boolean;
  rate: number;
}

function makePlaybackController(state: PlaybackState): PlaybackController {
  return {
    async seek(t) {
      state.timeMs = t;
    },
    async play() {
      state.paused = false;
    },
    pause() {
      state.paused = true;
    },
    getRate: () => state.rate,
    setRate: (r) => {
      state.rate = r;
    },
    isPaused: () => state.paused,
    currentTimeMs: () => state.timeMs,
  };
}

function makeEpisode() {
  const state: PlaybackState = { timeMs: CUES[0].start, paused: false, rate: 1 };
  const listeners = new Set<() => void>();
  const controller = makePlaybackController(state);
  return createEpisodePort({
    cues: () => CUES,
    activeIndex: () => {
      let idx = -1;
      for (let i = 0; i < CUES.length; i += 1) if (CUES[i].start <= state.timeMs) idx = i;
      return idx;
    },
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    media: () => MEDIA,
    controller,
  });
}

/* ── Anki fixture state ───────────────────────────────────────────────────── */

const DECKS = ['Vocabulario Inglés', 'Netflix & HBO', 'Default'];
const MODELS = ['KivaraLingo', 'Basic', 'Cloze'];
const FIELDS: Record<string, string[]> = {
  KivaraLingo: ['word', 'phonetic', 'sentence', 'translation', 'source'],
  Basic: ['Front', 'Back'],
  Cloze: ['Text', 'Extra'],
};
const INTERVALS: Record<string, number> = { sane: 42, afford: 0, day: 128 };

function makeAnki() {
  let nextNoteId = 9000;
  const notes = new Set<number>();
  const queue = new Set<string>();
  return createAnkiPort({
    async ping() {
      return { ok: true, version: 6 };
    },
    async decks() {
      return DECKS;
    },
    async models() {
      return MODELS;
    },
    async fields(modelName) {
      return FIELDS[modelName] ?? ['Front', 'Back'];
    },
    async createCard() {
      const noteId = nextNoteId += 1;
      notes.add(noteId);
      return noteId;
    },
    async undo(noteId) {
      notes.delete(noteId);
    },
    async addContext(input) {
      if (!notes.has(input.noteId)) throw new Error(`unknown note ${input.noteId}`);
    },
    async browse() {
      /* no-op in the fake */
    },
    async wordIntervals() {
      return { ...INTERVALS };
    },
    async retry(id) {
      queue.delete(id);
    },
    async retryAll() {
      queue.clear();
    },
    async dismiss(id) {
      queue.delete(id);
    },
  });
}

/* ── AI + packs fixtures ──────────────────────────────────────────────────── */

function makeAi() {
  return createAiPort({
    async explainSentence(input) {
      return {
        meaning: `How the line “${input.line}” reads in context.`,
        grammar: 'Present simple with a fronted time phrase.',
        expressions: [
          { text: 'these days', gloss: 'nowadays' },
          { text: 'keep someone sane', gloss: 'help someone stay well' },
        ],
        sound: [{ phrase: 'these days', sounds: '/ðiːz deɪz/', note: 'run together' }],
      };
    },
  });
}

function makePacks() {
  return createPacksPort({
    async list() {
      return [
        {
          id: 'pack-fixture',
          title: 'Wiktionary EN→ES',
          revision: '2026-01',
          format: 3,
          sourceLang: 'en',
          targetLang: 'es',
          termCount: 61_000,
          enabled: true,
          createdAt: 1,
        },
      ];
    },
    async installFromUrl(url) {
      return {
        ok: true,
        pack: {
          id: 'pack-installed',
          title: url,
          revision: '2026-01',
          format: 3,
          sourceLang: 'en',
          targetLang: 'es',
          termCount: 1,
          enabled: true,
          createdAt: 2,
        },
        termsImported: 1,
      };
    },
    async remove() {
      /* no-op in the fake */
    },
  });
}

/**
 * Build a full `Ports` object. Pass `overrides` to swap any single port (e.g. a
 * spy-wrapped AnkiPort) without rebuilding the rest.
 */
export function fakePorts(overrides: Partial<Ports> = {}): Ports {
  return {
    lexicon: makeLexicon(),
    episode: makeEpisode(),
    anki: makeAnki(),
    ai: makeAi(),
    packs: makePacks(),
    ...overrides,
  };
}
