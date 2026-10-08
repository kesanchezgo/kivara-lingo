import { t } from '../shared/i18n';
/// <reference types="chrome" />

const DEFAULT_URL = 'http://127.0.0.1:8765';
const DEFAULT_VERSION = 6;
const DEFAULT_TIMEOUT_MS = 4000;

export type AnkiErrorCode = 'NETWORK' | 'CORS' | 'TIMEOUT' | 'HTTP' | 'ANKI' | 'API_KEY';

export class AnkiConnectError extends Error {
  constructor(message: string, public readonly code?: AnkiErrorCode) {
    super(message);
    this.name = 'AnkiConnectError';
  }
}

/**
 * Normalize the user-entered URL. AnkiConnect listens on
 * `http://127.0.0.1:8765` by default; we accept several common shapes
 * (`localhost`, missing port, missing scheme, trailing slash) so that
 * the user never sees "sin conexión" because of a tiny typo.
 */
function normalizeUrl(raw?: string): string {
  let url = (raw ?? '').trim();
  if (!url) return DEFAULT_URL;
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
  // Strip trailing slash so fetch() doesn't 404 on the root handler.
  url = url.replace(/\/+$/, '');
  // Add the default port when missing on a localhost-style URL.
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(url)) {
    if (!/:\d+$/.test(url)) url = url + ':8765';
  }
  return url;
}

/**
 * Pair (127.0.0.1, localhost). When the user-entered URL only covers
 * one we'll automatically try the other on a network failure — useful
 * when AnkiConnect binds only to `localhost` (or vice versa).
 */
function fallbackUrls(url: string): string[] {
  const out = [url];
  if (url.includes('127.0.0.1')) {
    out.push(url.replace('127.0.0.1', 'localhost'));
  } else if (url.includes('localhost')) {
    out.push(url.replace('localhost', '127.0.0.1'));
  }
  return out;
}

interface InvokeOptions {
  url?: string;
  apiKey?: string;
  timeoutMs?: number;
  /** Media-heavy calls (addNote with audio+picture) need a longer budget
   * than the 4 s default — a slow Anki that created the note but answered
   * late used to read as TIMEOUT, and the localhost fallback then created
   * the SAME note a second time. Callers carrying media pass a higher
   * timeout instead of risking a duplicate. */
}

async function invokeOnce<T = unknown>(
  action: string,
  params: Record<string, unknown>,
  url: string,
  apiKey: string | undefined,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const body = JSON.stringify({
    action,
    version: DEFAULT_VERSION,
    params,
    ...(apiKey ? { key: apiKey } : {}),
  });

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeout);
    const reason = err instanceof Error ? err.message : String(err);
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    if (aborted) {
      throw new AnkiConnectError(
        `AnkiConnect tardó más de ${timeoutMs}ms en responder.`,
        'TIMEOUT',
      );
    }
    // Distinguish CORS-style failures from outright "host unreachable".
    // Chrome reports both as "Failed to fetch" — the most actionable
    // tip is the same in both cases (open Anki, install AnkiConnect,
    // check the URL).
    throw new AnkiConnectError(
      `No se pudo contactar AnkiConnect (${reason}). ¿Está Anki abierto y AnkiConnect instalado?`,
      'NETWORK',
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new AnkiConnectError(`AnkiConnect respondió ${response.status}.`, 'HTTP');
  }

  const json = (await response.json()) as { result: T; error: string | null };
  if (json.error) {
    const msg = json.error;
    if (/api ?key|valid key/i.test(msg)) {
      throw new AnkiConnectError(
        t('anki.apiKeyRequired'),
        'API_KEY',
      );
    }
    throw new AnkiConnectError(msg, 'ANKI');
  }
  return json.result;
}

async function invoke<T = unknown>(
  action: string,
  params: Record<string, unknown> = {},
  opts: InvokeOptions = {},
): Promise<T> {
  const primary = normalizeUrl(opts.url);
  const urls = fallbackUrls(primary);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastErr: unknown = null;
  for (const url of urls) {
    try {
      return await invokeOnce<T>(action, params, url, opts.apiKey, timeoutMs);
    } catch (err) {
      lastErr = err;
      // Only retry on transport-level failures — don't retry on Anki
      // protocol errors (HTTP 500 / wrong API key / duplicate note).
      if (
        err instanceof AnkiConnectError &&
        (err.code === 'HTTP' || err.code === 'ANKI' || err.code === 'API_KEY')
      ) {
        throw err;
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new AnkiConnectError('Error desconocido contactando AnkiConnect.', 'NETWORK');
}

export interface AnkiNote {
  deckName: string;
  modelName: string;
  fields: Record<string, string>;
  tags?: string[];
  audio?: AnkiMedia[];
  picture?: AnkiMedia[];
  options?: {
    allowDuplicate?: boolean;
    duplicateScope?: 'deck' | 'collection';
    duplicateScopeOptions?: {
      deckName?: string;
      checkChildren?: boolean;
      checkAllModels?: boolean;
    };
  };
}

export interface AnkiMedia {
  filename: string;
  data: string; // base64
  fields: string[];
}

export interface AnkiPingOk { ok: true; version: number; }
export interface AnkiPingErr { ok: false; error: string; code?: AnkiErrorCode; }
export type AnkiPingResult = AnkiPingOk | AnkiPingErr;

export const ankiConnect = {
  async ping(url?: string, apiKey?: string): Promise<AnkiPingResult> {
    try {
      const version = await invoke<number>('version', {}, { url, apiKey, timeoutMs: 2000 });
      return { ok: true, version };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      const code = err instanceof AnkiConnectError ? err.code : undefined;
      return { ok: false, error: message, code };
    }
  },

  async deckNames(url?: string, apiKey?: string): Promise<string[]> {
    return invoke<string[]>('deckNames', {}, { url, apiKey });
  },

  async modelNames(url?: string, apiKey?: string): Promise<string[]> {
    return invoke<string[]>('modelNames', {}, { url, apiKey });
  },

  async modelFieldNames(modelName: string, url?: string, apiKey?: string): Promise<string[]> {
    return invoke<string[]>('modelFieldNames', { modelName }, { url, apiKey });
  },

  async addNote(note: AnkiNote, url?: string, apiKey?: string): Promise<number> {
    // Media travels as [sound:]/<img> field references after storeMediaFile
    // (single-upload rule — note.audio/picture are always empty now), so the
    // old `hasMedia` gate on those arrays never fires. Detect media from the
    // FIELD TEXT instead: a note carrying audio or an image routinely exceeds
    // the 4 s default on a cold Anki, and a slow-but-created note reads as
    // TIMEOUT — then the 127.0.0.1↔localhost fallback creates it a SECOND
    // time. 15 s keeps the duplicate path shut in practice.
    const fieldText = Object.values(note.fields ?? {}).join(' ');
    const hasMedia = /\[sound:|\<img/i.test(fieldText);
    return invoke<number>('addNote', { note }, { url, apiKey, timeoutMs: hasMedia ? 15000 : undefined });
  },

  /**
   * Patch one or more fields on an existing note in-place. Used by the
   * `recapture_frame` hotkey so the user can replace a bad auto-captured
   * frame without having to re-save the whole card.
   *
   * Note: AnkiConnect's `updateNoteFields` action takes the same shape as
   * `addNote` but only the `id` + `fields` are honoured.
   */
  async updateNoteFields(
    noteId: number,
    fields: Record<string, string>,
    url?: string,
    apiKey?: string,
  ): Promise<null> {
    return invoke<null>(
      'updateNoteFields',
      { note: { id: noteId, fields } },
      { url, apiKey },
    );
  },

  async storeMediaFile(
    filename: string,
    dataBase64: string,
    url?: string,
    apiKey?: string,
  ): Promise<string> {
    return invoke<string>('storeMediaFile', { filename, data: dataBase64 }, { url, apiKey });
  },

  async createDeck(deck: string, url?: string, apiKey?: string): Promise<number> {
    return invoke<number>('createDeck', { deck }, { url, apiKey });
  },

  /**
   * Find note IDs matching a query. Used to check which words the user
   * already has in their deck so the overlay can mark them as "saved" from
   * the start (green highlight + check icon) without the user needing to
   * hover each one.
   */
  async findNotes(query: string, url?: string, apiKey?: string): Promise<number[]> {
    return invoke<number[]>('findNotes', { query }, { url, apiKey });
  },

  /**
   * Get the content of specific fields from notes by ID. Used alongside
   * findNotes to extract the actual saved word values.
   */
  async notesInfo(notes: number[], url?: string, apiKey?: string): Promise<Array<{ noteId: number; fields: Record<string, { value: string }> }>> {
    return invoke<Array<{ noteId: number; fields: Record<string, { value: string }> }>>('notesInfo', { notes }, { url, apiKey });
  },
};

/** Strip the `data:...;base64,` prefix from a data URL. */
export function dataUrlToBase64(dataUrl: string): string {
  const idx = dataUrl.indexOf(',');
  return idx === -1 ? dataUrl : dataUrl.slice(idx + 1);
}
