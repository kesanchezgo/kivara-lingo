/**
 * 'Kivara Inter' — Inter variable, registered with the FontFace API.
 *
 * Why not CSS: a `@font-face` rule declared at document level does not apply
 * inside our closed shadow root (font faces are resolved against the
 * document, not the shadow tree), and the shadow root's own stylesheet cannot
 * declare one either. The `FontFace` API is document-scoped in the same way
 * but it *adds* the face to `document.fonts`, which the shadow tree then
 * resolves against — measured in Chromium the shadow content picks the family
 * up as soon as it is added.
 *
 * Why not Google Fonts: a third-party request on every streaming page. The
 * woff2 subsets ship in the package (src/assets/fonts, listed in
 * web_accessible_resources) and are served from the extension origin, in line
 * with PRIVACY.md.
 *
 * The family name is deliberately NOT 'Inter': the host page may already have
 * its own Inter (or load one), and ours must not be shadowed by it.
 */

/** Subset ranges from the official Fontsource/Google split, so the browser
 * picks the right file per codepoint instead of downloading both. */
const LATIN_RANGE =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT_RANGE =
  'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';

const FACES: Array<{ file: string; unicodeRange: string }> = [
  { file: 'src/assets/fonts/kivara-inter-latin.woff2', unicodeRange: LATIN_RANGE },
  { file: 'src/assets/fonts/kivara-inter-latin-ext.woff2', unicodeRange: LATIN_EXT_RANGE },
];

function assetUrl(file: string): string {
  try {
    const runtime = (globalThis as { chrome?: { runtime?: { getURL?: (p: string) => string } } }).chrome?.runtime;
    if (runtime?.getURL) return runtime.getURL(file);
  } catch {
    /* no extension runtime — fall through to the document-relative path */
  }
  return `/${file}`;
}

let pending: Promise<void> | null = null;

/** Idempotent: the first call registers the faces, later ones await the same
 * promise. Never rejects — a page without WebFont support keeps the system
 * stack from `--kvl-font-sans`. */
export function ensureKivaraInter(): Promise<void> {
  if (pending) return pending;
  pending = (async () => {
    if (typeof document === 'undefined' || !document.fonts) return;
    if (document.fonts.check("12px 'Kivara Inter'")) return;
    const faces: FontFace[] = [];
    for (const { file, unicodeRange } of FACES) {
      const face = new FontFace('Kivara Inter', `url(${assetUrl(file)})`, {
        weight: '100 900',
        style: 'normal',
        unicodeRange,
        display: 'swap',
      });
      await face.load();
      faces.push(face);
    }
    for (const face of faces) document.fonts.add(face);
  })().catch(() => {
    /* keep the fallback stack; the UI never blocks on the font */
  });
  return pending;
}
