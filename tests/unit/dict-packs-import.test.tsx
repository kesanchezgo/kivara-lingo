/**
 * The dictionary-pack import path must not write into the page's IndexedDB.
 *
 * `DictPacksSection` is rendered by the content-script side panel, where
 * `IndexedDB` is the streaming SITE's database: a pack imported there used to
 * land under the site's origin, readable by it and invisible to the worker
 * (issue #32). The panel now parses the file and hands plain rows to the
 * service worker over `DICT_PACK_IMPORT_*`.
 *
 * These cases pin that route end to end with a fake worker: the panel's real
 * parser runs, the fake accepts or rejects the messages according to the
 * scenario, and the assertions read the fake's "database". If the panel went
 * back to Dexie, every one of these would pass while the real bug returned —
 * so the fake also records which messages arrived, and a malformed file must
 * send NONE.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { strToU8, zipSync } from 'fflate';
import type { DictPackRow, DictTermRow, PackStatsRow } from '../../src/shared/dict-types';
import { parseSnapshot } from '../../src/shared/telemetry';

interface FakeWorker {
  packs: Map<string, DictPackRow>;
  terms: Map<string, DictTermRow[]>;
  /** The extension-origin `pack_stats` table. */
  stats: Map<string, PackStatsRow>;
  messages: Record<string, unknown>[];
  /** Set when the fake should answer like a torn-down service worker. */
  unavailable: boolean;
}

function makeWorker(): FakeWorker {
  return {
    packs: new Map(),
    terms: new Map(),
    stats: new Map(),
    messages: [],
    unavailable: false,
  };
}

/** Answer a message exactly the way the worker does. */
function route(worker: FakeWorker, message: Record<string, unknown>): Record<string, unknown> {
  switch (message.type) {
    case 'LIST_DICT_PACKS':
      return { ok: true, packs: [...worker.packs.values()] };
    case 'DICT_PACK_IMPORT_BEGIN': {
      const pack = message.pack as DictPackRow;
      worker.terms.set(pack.id, []);
      return { ok: true };
    }
    case 'DICT_PACK_IMPORT_TERMS': {
      const packId = message.packId as string;
      const rows = message.terms as DictTermRow[];
      worker.terms.set(packId, [...(worker.terms.get(packId) ?? []), ...rows]);
      return { ok: true, added: rows.length };
    }
    case 'DICT_PACK_IMPORT_COMMIT': {
      const pack = message.pack as DictPackRow;
      worker.packs.set(pack.id, pack);
      return { ok: true, termsImported: worker.terms.get(pack.id)?.length ?? 0 };
    }
    case 'DICT_PACK_IMPORT_ABORT':
      worker.terms.delete(message.packId as string);
      return { ok: true };
    case 'GET_PACK_STATS':
      return { ok: true, rows: [...worker.stats.values()] };
    case 'RESET_PACK_STATS':
      worker.stats.clear();
      return { ok: true };
    case 'IMPORT_PACK_STATS': {
      // The real worker runs the same validator before touching the table.
      const snap = parseSnapshot(message.raw);
      let added = 0;
      let merged = 0;
      for (const row of snap.rows) {
        const existing = worker.stats.get(row.packId);
        if (existing) {
          worker.stats.set(row.packId, {
            packId: row.packId,
            hits: Math.max(existing.hits, row.hits),
            lastUsedAt: Math.max(existing.lastUsedAt, row.lastUsedAt),
            createdAt: Math.min(existing.createdAt, row.createdAt),
          });
          merged += 1;
        } else {
          worker.stats.set(row.packId, row);
          added += 1;
        }
      }
      return { ok: true, added, merged, replaced: 0 };
    }
    case 'EXPORT_PACK_STATS':
      return {
        ok: true,
        snapshot: {
          version: 1,
          exportedAt: new Date().toISOString(),
          source: message.source,
          rows: [...worker.stats.values()],
        },
      };
    default:
      return { ok: true };
  }
}

function installChrome(worker: FakeWorker) {
  const runtime: {
    id: string;
    lastError: { message: string } | undefined;
    sendMessage: (message: Record<string, unknown>, cb?: (reply?: unknown) => void) => void;
    onMessage: { addListener: () => void; removeListener: () => void };
  } = {
    id: 'test-extension-id',
    lastError: undefined,
    sendMessage: (message, cb) => {
      worker.messages.push(message);
      // The real API is asynchronous and reports a dead receiver through
      // `lastError` INSIDE the callback, clearing it right after.
      setTimeout(() => {
        if (worker.unavailable) {
          runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
          try {
            cb?.(undefined);
          } finally {
            runtime.lastError = undefined;
          }
          return;
        }
        // A handler that throws (invalid payload) replies with the error, the
        // same way the worker's try/catch does.
        try {
          cb?.(route(worker, message));
        } catch (err) {
          cb?.({ ok: false, error: (err as Error).message });
        }
      }, 0);
    },
    onMessage: { addListener: () => {}, removeListener: () => {} },
  };
  vi.stubGlobal('chrome', {
    runtime,
    storage: {
      sync: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) },
      local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) },
      onChanged: { addListener: () => {} },
    },
    i18n: { getUILanguage: () => 'es' },
  });
  return worker;
}

async function mountPanel() {
  const { DictPacksSection } = await import('../../src/app/components/tabs/DictPacksSection');
  return render(<DictPacksSection />);
}

/** The hidden `.zip,.csv,.tsv,.txt` picker behind the "Archivo local" button. */
function localFileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"][accept*="application/zip"]');
  if (!input) throw new Error('local file picker not found');
  return input as HTMLInputElement;
}

async function pickLocalFile(file: File) {
  const input = localFileInput();
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  fireEvent.change(input);
}

async function pasteAndImport(text: string, title?: string) {
  fireEvent.click(screen.getByRole('button', { name: /Pegar CSV\/TSV/i }));
  if (title) {
    fireEvent.change(screen.getByPlaceholderText('Título de la lista'), { target: { value: title } });
  }
  const textarea = document.querySelector('textarea');
  if (!textarea) throw new Error('CSV textarea not found');
  fireEvent.change(textarea, { target: { value: text } });
  // The button stays disabled while the previous import (and its refresh
  // round-trip) is in flight — wait for it instead of racing the worker.
  const btn = await waitFor(() => {
    const node = screen.getByRole('button', { name: /^Importar$/i }) as HTMLButtonElement;
    if (node.disabled) throw new Error('import button still disabled');
    return node;
  });
  fireEvent.click(btn);
}

function importMessages(worker: FakeWorker): Record<string, unknown>[] {
  return worker.messages.filter((m) => String(m.type).startsWith('DICT_PACK_IMPORT_'));
}

/** The hidden coverage-snapshot picker (`accept="application/json,.json"`). */
function coverageFileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"][accept*="application/json"]');
  if (!input) throw new Error('coverage file picker not found');
  return input as HTMLInputElement;
}

async function pickCoverageFile(payload: unknown) {
  const input = coverageFileInput();
  const file = new File([JSON.stringify(payload)], 'coverage.json', {
    type: 'application/json',
  });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  fireEvent.change(input);
}

/** Expand the collapsible "Cobertura" sub-section. */
async function openCoverage() {
  fireEvent.click(screen.getByRole('button', { name: /Qué encuentra sin conexión/i }));
  await waitFor(() => expect(screen.getByRole('button', { name: /^Exportar$/i })).not.toBeNull());
}

function statsMessages(worker: FakeWorker): Record<string, unknown>[] {
  return worker.messages.filter((m) =>
    ['GET_PACK_STATS', 'RESET_PACK_STATS', 'IMPORT_PACK_STATS', 'EXPORT_PACK_STATS'].includes(
      String(m.type),
    ),
  );
}

beforeEach(() => {
  cleanup();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DictPacksSection import route (#32)', { timeout: 30_000 }, () => {
  it('imports a pasted CSV list through the service worker', async () => {
    const worker = installChrome(makeWorker());
    await mountPanel();

    await pasteAndImport('hello,hola\nworld,mundo');

    await waitFor(() => expect(screen.getByText(/2 términos importados/i)).not.toBeNull());
    // The rows landed in the worker's store, under WORKER-created pack ids.
    expect(worker.packs.size).toBe(1);
    const pack = [...worker.packs.values()][0];
    const rows = worker.terms.get(pack.id) ?? [];
    expect(rows.map((r) => r.expression)).toEqual(['hello', 'world']);
    expect(rows[0].definitions).toEqual(['hola']);
    // BEGIN → TERMS → COMMIT, and nothing else.
    expect(importMessages(worker).map((m) => m.type)).toEqual([
      'DICT_PACK_IMPORT_BEGIN',
      'DICT_PACK_IMPORT_TERMS',
      'DICT_PACK_IMPORT_COMMIT',
    ]);
  });

  it('imports a Yomitan .zip picked from disk through the same route', async () => {
    const worker = installChrome(makeWorker());
    await mountPanel();

    const zip = zipSync({
      'index.json': strToU8(JSON.stringify({ title: 'Zip Pack', revision: '2026-01-01', format: 3 })),
      'term_bank_1.json': strToU8(JSON.stringify([['run', '', null, '', 0, ['correr'], 0, null]])),
    });
    await pickLocalFile(new File([zip], 'pack.zip', { type: 'application/zip' }));

    await waitFor(() => expect(screen.getByText(/Zip Pack · 1 términos \(Yomitan\)/i)).not.toBeNull());
    const pack = [...worker.packs.values()][0];
    expect(pack.title).toBe('Zip Pack');
    expect(worker.terms.get(pack.id)?.map((r) => r.expression)).toEqual(['run']);
  });

  it('reports a malformed list without sending anything to the worker', async () => {
    const worker = installChrome(makeWorker());
    await mountPanel();

    // A single column has no translation, so every row is skipped.
    await pasteAndImport('hello\nworld');

    await waitFor(() =>
      expect(screen.getByText(/missing a word or translation/i)).not.toBeNull(),
    );
    expect(importMessages(worker)).toEqual([]);
    expect(worker.packs.size).toBe(0);
  });

  it('replaces the previous rows when the same title is imported again', async () => {
    const worker = installChrome(makeWorker());
    await mountPanel();

    await pasteAndImport('hello,hola\nworld,mundo', 'Mi lista');
    await waitFor(() => expect(screen.getByText(/2 términos importados/i)).not.toBeNull());
    expect(worker.packs.size).toBe(1);
    const packId = [...worker.packs.keys()][0];

    await pasteAndImport('run,correr', 'Mi lista');
    await waitFor(() =>
      expect(screen.getByText(/Mi lista · 1 términos importados/i)).not.toBeNull(),
    );

    // Same id (title-derived), and BEGIN dropped the first import's rows, so
    // the pack owns exactly the new list — no duplicate pack in the panel.
    expect(worker.packs.size).toBe(1);
    expect([...worker.packs.keys()]).toEqual([packId]);
    expect(worker.terms.get(packId)?.map((r) => r.expression)).toEqual(['run']);
  });

  it('surfaces the unavailable worker instead of writing to the page database', async () => {
    const worker = installChrome(makeWorker());
    worker.unavailable = true;
    await mountPanel();

    await pasteAndImport('hello,hola');

    await waitFor(() =>
      expect(screen.getByText(/Service worker no respondió/i)).not.toBeNull(),
    );
    // The attempt went out and failed — no pack exists anywhere the panel can
    // see, so nothing was persisted on the site's origin either.
    expect(importMessages(worker).map((m) => m.type)).toEqual(['DICT_PACK_IMPORT_BEGIN']);
    expect(worker.packs.size).toBe(0);
    expect(screen.queryByText(/términos importados/i)).toBeNull();
  });
});

describe('DictPacksSection coverage route (#32)', { timeout: 30_000 }, () => {
  it('reads the coverage rows from the worker, not the page database', async () => {
    const worker = installChrome(makeWorker());
    worker.stats.set('bundle', { packId: 'bundle', hits: 3, lastUsedAt: 1, createdAt: 1 });
    await mountPanel();

    await openCoverage();

    // The GET went out and its rows drove the widget ("3 lookups").
    await waitFor(() => expect(screen.getAllByText(/3 consultas/i).length).toBeGreaterThan(0));
    expect(statsMessages(worker).map((m) => m.type)).toContain('GET_PACK_STATS');
  });

  it('resets the coverage rows through the worker', async () => {
    const worker = installChrome(makeWorker());
    worker.stats.set('bundle', { packId: 'bundle', hits: 3, lastUsedAt: 1, createdAt: 1 });
    await mountPanel();
    await openCoverage();
    await waitFor(() => expect(screen.getAllByText(/3 consultas/i).length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: /^Reiniciar$/i }));

    await waitFor(() => expect(worker.stats.size).toBe(0));
    expect(statsMessages(worker).map((m) => m.type)).toContain('RESET_PACK_STATS');
    // The refresh after the reset shows the empty state.
    await waitFor(() => expect(screen.getAllByText(/sin datos/i).length).toBeGreaterThan(0));
  });

  it('imports a coverage snapshot through the worker', async () => {
    const worker = installChrome(makeWorker());
    await mountPanel();
    await openCoverage();

    await pickCoverageFile({
      version: 1,
      exportedAt: '2026-11-11T00:00:00.000Z',
      rows: [{ packId: 'pack-real', hits: 5, lastUsedAt: 10, createdAt: 1 }],
    });

    await waitFor(() =>
      expect(screen.getByText(/Cobertura importada: 1 filas nuevas, 0 fusionadas/i)).not.toBeNull(),
    );
    expect(worker.stats.get('pack-real')?.hits).toBe(5);
    expect(statsMessages(worker).map((m) => m.type)).toContain('IMPORT_PACK_STATS');
  });

  it('rejects a malformed snapshot in the worker and shows its reason', async () => {
    const worker = installChrome(makeWorker());
    await mountPanel();
    await openCoverage();

    // Right version, no `rows` — the worker's validator refuses it.
    await pickCoverageFile({ version: 1 });

    await waitFor(() =>
      expect(screen.getByText(/No se pudo importar: .*rows/i)).not.toBeNull(),
    );
    expect(worker.stats.size).toBe(0);
  });

  it('reports an unavailable worker on import instead of touching the page database', async () => {
    const worker = installChrome(makeWorker());
    worker.unavailable = true;
    await mountPanel();
    await openCoverage();

    await pickCoverageFile({ version: 1, exportedAt: '', rows: [] });

    await waitFor(() =>
      expect(screen.getByText(/No se pudo importar: Service worker no respondió/i)).not.toBeNull(),
    );
    expect(worker.stats.size).toBe(0);
  });

  it('exports the snapshot built by the worker', async () => {
    const worker = installChrome(makeWorker());
    worker.stats.set('bundle', { packId: 'bundle', hits: 2, lastUsedAt: 1, createdAt: 1 });
    // happy-dom has no object-URL registry for downloads.
    const createObjectURL = vi.fn(() => 'blob:coverage');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    await mountPanel();
    await openCoverage();
    await waitFor(() => expect(screen.getAllByText(/2 consultas/i).length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: /^Exportar$/i }));

    await waitFor(() =>
      expect(screen.getByText(/Cobertura exportada \(1 filas\)/i)).not.toBeNull(),
    );
    expect(statsMessages(worker).map((m) => m.type)).toContain('EXPORT_PACK_STATS');
    expect(createObjectURL).toHaveBeenCalledOnce();
  });
});
