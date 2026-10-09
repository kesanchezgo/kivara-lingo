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
 */
export const WHISPER_BUILD: boolean = process.env.KIVARA_WHISPER === '1';
