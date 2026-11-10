/**
 * 'Kivara Inter' registration (src/ui/fonts.ts).
 *
 * The guard must answer "is a face with this family already in the
 * document?", not `fonts.check()` — check() reports availability, and a host
 * page that ships its own face (or a not-yet-loaded face) makes it answer
 * the wrong question. These tests stub `document.fonts` and `FontFace`
 * because happy-dom does not implement the FontFace API.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface FakeFace {
  family: string;
  weight?: string;
  unicodeRange?: string;
  load: () => Promise<void>;
}

let added: FakeFace[];

function makeFace(family: string): FakeFace {
  return { family, load: async () => {} };
}

interface FakeFontFaceSet {
  check: () => boolean;
  add: (face: FakeFace) => void;
  [Symbol.iterator](): IterableIterator<FakeFace>;
}

/** `check: () => false` is the trap: the old guard consulted it, and it
 * cannot know whether the family is ours — so a document that already has
 * the faces (previous injection) got them registered again. */
function installFonts(existing: FakeFace[] = []): FakeFontFaceSet {
  const set = new Set(existing);
  added = [];
  const fonts = {
    check: () => false,
    add: (face: FakeFace) => {
      set.add(face);
      added.push(face);
    },
    [Symbol.iterator]: () => set[Symbol.iterator](),
  } as unknown as FakeFontFaceSet;
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
  return fonts;
}

beforeEach(() => {
  vi.stubGlobal(
    'FontFace',
    class {
      family: string;
      weight?: string;
      unicodeRange?: string;
      load = async () => {};
      constructor(family: string, _source: string, descriptors?: Record<string, string>) {
        this.family = family;
        this.weight = descriptors?.weight;
        this.unicodeRange = descriptors?.unicodeRange;
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  // Drop the stubbed FontFaceSet; happy-dom's own (missing) one comes back.
  delete (document as { fonts?: unknown }).fonts;
});

async function loadModule() {
  return import('../../src/ui/fonts');
}

describe('ensureKivaraInter', () => {
  it('registers both subsets and they are findable afterwards', async () => {
    installFonts();
    const { ensureKivaraInter, isKivaraInterRegistered } = await loadModule();
    await ensureKivaraInter();
    expect(added).toHaveLength(2);
    expect(added.every((f) => f.family === 'Kivara Inter')).toBe(true);
    expect(added.map((f) => f.weight)).toEqual(['100 900', '100 900']);
    expect(new Set(added.map((f) => f.unicodeRange)).size).toBe(2);
    expect(isKivaraInterRegistered()).toBe(true);
  });

  it('fails the old guard: an already-registered face means no second registration', async () => {
    // With check() forced false, the previous implementation re-registered
    // into a document that already carried the faces.
    installFonts([makeFace('Kivara Inter')]);
    const { ensureKivaraInter } = await loadModule();
    await ensureKivaraInter();
    expect(added).toHaveLength(0);
  });

  it('does not confuse the host page own Inter with ours', async () => {
    installFonts([makeFace('Inter'), makeFace('"Inter"')]);
    const { ensureKivaraInter, isKivaraInterRegistered } = await loadModule();
    await ensureKivaraInter();
    expect(added).toHaveLength(2);
    expect(isKivaraInterRegistered()).toBe(true);
  });

  it('is idempotent under concurrent calls', async () => {
    installFonts();
    const { ensureKivaraInter } = await loadModule();
    await Promise.all([ensureKivaraInter(), ensureKivaraInter(), ensureKivaraInter()]);
    expect(added).toHaveLength(2);
  });
});
