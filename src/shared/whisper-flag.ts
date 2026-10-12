/**
 * Whisper ASR build flag.
 *
 * On-device ASR cannot work in this build and pretending otherwise costs the
 * user a form they can only fail:
 *
 *  • the glue (`whisper.js`) lives on a remote URL, and MV3 extension pages
 *    run under `script-src 'self'` — the request never leaves;
 *  • the WASM + model are ~75 MB, so packaging them inflates the zip and the
 *    model download stays unbounded.
 *
 * The ASR code (whisper-asr.ts, the AUDIO-CAPTURE offscreen path) is kept,
 * behind this flag, because the pipeline around it is sound: when the glue and
 * WASM ship inside `dist/`, flip it back on and the rest still applies.
 *
 * `KIVARA_WHISPER=1` at build time re-enables the Settings section.
 *
 * This is a BUILD-TIME constant, not a runtime `process.env` read: a plain
 * `process.env.KIVARA_WHISPER` compiles into a live lookup of `process`, which
 * does not exist in a bundled MV3 page and throws `ReferenceError` on import —
 * so the panel would not open at all. `vite.config.ts` injects the boolean
 * through `define`, which makes the flag literally `false` in the bundle and
 * lets the bundler drop the dead branch.
 */
declare const __KIVARA_WHISPER__: boolean;

export const WHISPER_BUILD: boolean = __KIVARA_WHISPER__ === true;

/** Mirrors `__KIVARA_WHISPER_GLUE_PACKAGED__`. */
declare const __KIVARA_WHISPER_GLUE_PACKAGED__: boolean;

/**
 * Whether this build ships a loadable whisper.cpp glue.
 *
 * Separate from `WHISPER_BUILD` because they stop being the same question the
 * moment anyone turns the feature on. `WHISPER_BUILD` compiles the code in;
 * THIS says whether `script.src` can resolve to a file inside the extension,
 * which is the only thing `assertExtensionScriptUrl` will accept (see
 * shared/whisper-url.ts).
 *
 * It is `false` right now and the Settings panel has to say so, rather than
 * offering a switch that turns Whisper on and can only fail afterwards: the
 * glue and its WASM live upstream and are not packaged into `dist/`. Whoever
 * packages them sets this true in the same change — along with the
 * `web_accessible_resources` entry the offscreen needs to reach them.
 */
export const WHISPER_GLUE_PACKAGED: boolean =
  __KIVARA_WHISPER__ === true && __KIVARA_WHISPER_GLUE_PACKAGED__ === true;
