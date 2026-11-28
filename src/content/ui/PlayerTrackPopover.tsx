/**
 * PR #172 — Kivara's own Audio / Subtitles / Translation menu.
 *
 * Netflix's own drawer is a full-screen sheet that covers the picture; this is a
 * compact glass panel anchored to our tray. It talks to the player through the
 * Cadmium bridge (the session's own track lists), and every choice is reported
 * to the subtitle watcher so the automatic loop cannot undo what the user just
 * picked.
 *
 * When the player exposes nothing (`applied: false` on every path, or no API at
 * all) the panel says so in one short line and offers the site's own menu — the
 * fallback is a button, never a dead end.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Languages, Volume2 } from '../../ui/icons';
import { t } from '../../shared/i18n';
import { useKivaraStore } from '../../shared/use-kivara-store';
import { onRadioKeyDown, radioTabIndex } from '../../ui/primitives/settings-primitives';
import {
  listAudioTracks,
  listSubtitleTracks,
  selectAudioTrackThroughMainWorld,
  selectSubtitleTrackByIdThroughMainWorld,
  type NetflixAudioTrackInfo,
} from '../platform-adapters/netflix-main-bridge';
import type { TimedTextTrackInfo } from '../platform-adapters/timed-text';

const TRANSLATIONS = ['visible', 'blur', 'hidden'] as const;

export interface PlayerTrackPopoverProps {
  onClose: () => void;
  /** Open Netflix's own menu: the fallback when the player exposes nothing. */
  onFallbackNative?: () => void;
  /**
   * The user chose by hand. The watcher marks the episode as decided, so the
   * automatic language switch does not put its track back 2.5 s later.
   */
  onManualChoice?: () => void;
  /** Space between the tray's top edge and the player's, for the max height. */
  availableAbovePx?: number;
}

export function PlayerTrackPopover({
  onClose, onFallbackNative, onManualChoice, availableAbovePx,
}: PlayerTrackPopoverProps) {
  const [audio, setAudio] = useState<NetflixAudioTrackInfo[]>([]);
  const [audioCurrent, setAudioCurrent] = useState<string | null>(null);
  const [subtitles, setSubtitles] = useState<TimedTextTrackInfo[]>([]);
  const [subtitleCurrent, setSubtitleCurrent] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const translation = useKivaraStore((state) => state.study.translation);
  const setStudy = useKivaraStore((state) => state.setStudy);
  const setSubtitlesVisible = useKivaraStore((state) => state.setSubtitlesVisible);

  // The player's own lists, read once when the panel opens.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [audioList, subtitleList] = await Promise.all([
        listAudioTracks().catch(() => ({ tracks: [], current: null })),
        listSubtitleTracks().catch(() => ({ tracks: [], current: null })),
      ]);
      if (cancelled) return;
      setAudio(audioList.tracks);
      setAudioCurrent(audioList.current?.trackId ?? null);
      // An "off" pseudo-track is not a list entry: the Off row is ours, always
      // in the same place, and the image-based tracks cannot be learned from.
      setSubtitles(subtitleList.tracks.filter((track) => !track.isNoneTrack && !track.isImageBased));
      setSubtitleCurrent(subtitleList.current?.trackId ?? null);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const chooseAudio = useCallback((track: NetflixAudioTrackInfo) => {
    // Optimistic: the MAIN-world round trip is a frame behind the click.
    setAudioCurrent(track.trackId);
    void selectAudioTrackThroughMainWorld(track.trackId).catch(() => {});
  }, []);

  const chooseSubtitle = useCallback((rawTrackId: string | null | undefined) => {
    const trackId = rawTrackId ?? null;
    onManualChoice?.();
    setSubtitleCurrent(trackId);
    void selectSubtitleTrackByIdThroughMainWorld(trackId).catch(() => {});
    setSubtitlesVisible(trackId !== null);
  }, [onManualChoice, setSubtitlesVisible]);

  // Escape closes the MENU, not fullscreen: the key is consumed here.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  const empty = loaded && audio.length === 0 && subtitles.length === 0;

  return (
    <div
      ref={panelRef}
      data-kvl-track-popover=""
      data-kivara-hover-zone="true"
      role="dialog"
      aria-modal="false"
      aria-label={t('player.audioAndSubtitles')}
      onKeyDownCapture={onKeyDown}
      className="absolute bottom-full right-0 mb-3 w-[min(392px,calc(100vw-32px))] flex flex-col rounded-2xl bg-zinc-950/95 backdrop-blur-xl ring-1 ring-white/[0.1] shadow-[0_20px_48px_-12px_rgba(0,0,0,0.85)] text-zinc-100 overflow-hidden pointer-events-auto"
      style={{ maxHeight: `min(380px, max(180px, ${availableAbovePx ?? 380}px))` }}
    >
      {empty ? (
        <div className="px-3.5 py-4 flex flex-col gap-3">
          <p className="text-[12px] text-zinc-400">{t('player.tracksUnavailable')}</p>
          {onFallbackNative && (
            <button
              type="button"
              onClick={onFallbackNative}
              className="self-start h-8 px-3 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] text-[12px] font-medium kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
            >
              {t('player.openNativeMenu')}
            </button>
          )}
        </div>
      ) : (
        <div className="kvl-popover-scroll min-h-0 flex-1 grid grid-cols-2 divide-x divide-white/[0.06] overflow-y-auto">
          {/* ── Audio ─────────────────────────────────────────────────── */}
          {/* Radio rows need a radiogroup PARENT: inside a plain section
              axe reports aria-required-parent on every row. */}
          <div role="radiogroup" className="px-2 py-2" aria-label={t('player.audio')}>
            <p className="px-1.5 pb-1 flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
              <Volume2 size={12} /> {t('player.audio')}
            </p>
            {audio.map((track) => {
              const active = track.trackId === audioCurrent;
              return (
                <button
                  key={track.trackId}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => chooseAudio(track)}
                  className={`w-full h-8 px-1.5 rounded-lg flex items-center gap-1.5 text-left text-[13px] kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
                    active ? 'bg-indigo-500/20 text-indigo-200' : 'text-zinc-300 hover:bg-white/[0.06] hover:text-white'
                  }`}
                >
                  <span className="w-3.5 shrink-0">{active && <Check size={13} weight="bold" />}</span>
                  <span className="truncate">{track.displayName ?? track.bcp47 ?? track.trackId}</span>
                  {track.isNative && <span className={BADGE}>{t('player.originalAudio')}</span>}
                  {track.trackType === 'ASSISTIVE' && <span className={BADGE}>AD</span>}
                </button>
              );
            })}
          </div>

          {/* ── Subtitles ─────────────────────────────────────────────── */}
          <div role="radiogroup" className="px-2 py-2" aria-label={t('player.subtitles')}>
            <p className="px-1.5 pb-1 flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
              <Languages size={12} /> {t('player.subtitles')}
            </p>
            <button
              type="button"
              role="radio"
              aria-checked={subtitleCurrent === null}
              onClick={() => chooseSubtitle(null)}
              className={`w-full h-8 px-1.5 rounded-lg flex items-center gap-1.5 text-left text-[13px] kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
                subtitleCurrent === null ? 'bg-indigo-500/20 text-indigo-200' : 'text-zinc-300 hover:bg-white/[0.06] hover:text-white'
              }`}
            >
              <span className="w-3.5 shrink-0">{subtitleCurrent === null && <Check size={13} weight="bold" />}</span>
              <span className="truncate">{t('player.subtitlesOff')}</span>
            </button>
            {subtitles.map((track) => {
              const active = track.trackId === subtitleCurrent;
              const cc = track.rawTrackType === 'CLOSEDCAPTIONS' || track.trackType === 'ASSISTIVE';
              return (
                <button
                  key={track.trackId}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => chooseSubtitle(track.trackId ?? null)}
                  className={`w-full h-8 px-1.5 rounded-lg flex items-center gap-1.5 text-left text-[13px] kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
                    active ? 'bg-indigo-500/20 text-indigo-200' : 'text-zinc-300 hover:bg-white/[0.06] hover:text-white'
                  }`}
                >
                  <span className="w-3.5 shrink-0">{active && <Check size={13} weight="bold" />}</span>
                  <span className="truncate">{track.displayName ?? track.bcp47 ?? track.trackId}</span>
                  {cc && <span className={BADGE}>CC</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Fixed footer: what Kivara does with the subtitles it reads ──── */}
      <div className="shrink-0 border-t border-white/[0.06] px-3.5 py-2.5 flex items-center justify-between gap-3">
        <span className="text-[11px] font-medium text-zinc-400">{t('tr.title')}</span>
        <div
          role="radiogroup"
          aria-label={t('tr.title')}
          className="flex items-center gap-0.5 rounded-lg bg-white/[0.06] p-0.5"
          onKeyDown={(event) => onRadioKeyDown(event, TRANSLATIONS, translation, (value) => setStudy((prev) => ({ ...prev, translation: value })))}
        >
          {TRANSLATIONS.map((value, index) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={translation === value}
              tabIndex={radioTabIndex(translation === value, index, true)}
              onClick={() => setStudy((prev) => ({ ...prev, translation: value }))}
              className={`h-6 px-2 rounded-md text-[11px] font-medium kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
                translation === value ? 'bg-indigo-500 text-white' : 'text-zinc-300 hover:text-white hover:bg-white/[0.08]'
              }`}
            >
              {t(value === 'visible' ? 'tr.visible' : value === 'blur' ? 'tr.blur' : 'tr.hidden')}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const BADGE = 'shrink-0 rounded bg-white/[0.1] px-1 py-0.5 text-[10px] font-medium text-zinc-300';
