# Kivara Lingo Audio Capture Design

## Goal

Subtitle audio should work in every realistic learning scenario:

- the video is playing when the user saves,
- the video was paused by Kivara hover,
- the user paused manually on the word,
- the subtitle has already finished,
- the subtitle is still in progress,
- tabCapture is active but the real audio cannot be completed.

The user should not need to know any of this. The UI can keep the capture button in the popup and the left panel, but the capture owner is the background/offscreen pipeline.

## Browser constraints

Chrome `tabCapture` exposes a live `MediaStream` for the current tab. It captures audio that the tab actually plays. It cannot read future audio from a paused media element. If a subtitle has not played yet, the missing tail does not exist in the rolling recorder buffer.

Because of that, a premium implementation must actively complete the missing tail when possible, then fall back gracefully when the browser or platform refuses temporary playback.

## Runtime architecture

1. Popup or panel starts capture.
2. Background creates/keeps the offscreen document.
3. Offscreen owns the live tab `MediaStream` and rolling audio buffer.
4. Content script owns video control because only it can read and control the page video element.
5. When saving a card, content captures the frame first, then ensures subtitle audio is available.

## Save-time behavior

If the video is playing or the cue has already finished:

- save immediately,
- send `videoTimeAtSave` to background,
- background slices the rolling buffer.

If the video is paused before cue end:

- briefly play until cue end plus small post-roll,
- pause again,
- seek back to the exact original time,
- send the audio anchor time to background,
- background slices the now-complete rolling buffer.

If temporary playback fails:

- preserve the user's paused position,
- use sentence TTS fallback,
- never save a silent or partial live clip as if it were correct.

## Field semantics for the default KivaraLingo model

- `word` maps to `selection`.
- `phonetic` maps to `phonetic`.
- `sentence` maps to `cue`.
- `bilingual` maps to the word-level bilingual gloss.
- `monolingual` maps to the source-language definition.
- `translation` maps to machine translation of the exact source sentence, not the dual subtitle line.
- `picture` maps to the captured video frame.
- `sentence audio` maps to the real subtitle audio when available, otherwise sentence TTS.
- `word audio` maps to pronunciation audio only, never duplicated word text.

## Translation quality rule

Local dictionaries are fast first paint, not always the final quality source. Bundled translations can be too literal or POS-skewed. Standard/VIP enrichment and the configured MT chain are allowed to replace bundled word glosses. User-provided Yomitan packs keep priority.
