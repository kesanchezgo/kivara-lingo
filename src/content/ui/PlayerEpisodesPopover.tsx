/**
 * PR #172 — Kivara's own season/episode picker.
 *
 * The catalog comes from the page's own graph through the bridge (`cmd:
 * 'episodes'`), which is the only place Netflix keeps it. A film (or a build
 * whose graph we cannot read) answers `null`, and then the tray falls back to
 * the site's own button — this component never guesses.
 */
import { useEffect, useState } from 'react';
import { Play, X } from '../../ui/icons';
import { t } from '../../shared/i18n';
import { onRadioKeyDown, radioTabIndex } from '../../ui/primitives/settings-primitives';
import type { NetflixEpisodesCatalog, NetflixSeasonItem } from '../platform-adapters/netflix-episodes';

export interface PlayerEpisodesPopoverProps {
  catalog: NetflixEpisodesCatalog;
  onClose: () => void;
  /** Space between the tray's top edge and the player's, for the max height. */
  availableAbovePx?: number;
}

/** Only a plain numeric id is a Netflix episode id: nothing else gets a URL. */
export function episodeWatchUrl(id: string): string | null {
  return /^\d+$/.test(id) ? `https://www.netflix.com/watch/${id}` : null;
}

export function PlayerEpisodesPopover({ catalog, onClose, availableAbovePx }: PlayerEpisodesPopoverProps) {
  const playing = catalog.seasons.find((season) => season.episodes.some((episode) => episode.current));
  const [seasonId, setSeasonId] = useState(() => (playing ?? catalog.seasons[0])?.id ?? '');
  const season: NetflixSeasonItem | undefined = catalog.seasons.find((item) => item.id === seasonId) ?? catalog.seasons[0];

  // The catalog can arrive a beat after the panel opens (the game between the
  // graph and the mount): never leave the picker on a season that is gone.
  useEffect(() => {
    if (!catalog.seasons.some((item) => item.id === seasonId)) setSeasonId(catalog.seasons[0]?.id ?? '');
  }, [catalog, seasonId]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  const open = (id: string) => {
    const url = episodeWatchUrl(id);
    if (!url) return;
    onClose();
    // The site's own route: a full navigation keeps Netflix's session, history
    // and player bootstrapping exactly as a click on its own list would.
    window.location.assign(url);
  };

  return (
    <div
      data-kvl-episodes-popover=""
      data-kivara-hover-zone="true"
      role="dialog"
      aria-modal="false"
      aria-label={t('player.episodes')}
      onKeyDownCapture={onKeyDown}
      className="absolute bottom-full right-0 mb-3 w-[min(392px,calc(100vw-32px))] flex flex-col rounded-2xl bg-zinc-950/95 backdrop-blur-xl ring-1 ring-white/[0.1] shadow-[0_20px_48px_-12px_rgba(0,0,0,0.85)] text-zinc-100 overflow-hidden pointer-events-auto"
      style={{ maxHeight: `min(380px, max(180px, ${availableAbovePx ?? 380}px))` }}
    >
      <header className="shrink-0 flex items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2">
        {catalog.seasons.length > 1 ? (
          <div
            role="radiogroup"
            aria-label={t('player.episodes')}
            onKeyDown={(event) => onRadioKeyDown(event, catalog.seasons.map((item) => item.id), seasonId, setSeasonId)}
            className="kvl-popover-scroll flex items-center gap-0.5 overflow-x-auto rounded-lg bg-white/[0.06] p-0.5"
          >
            {catalog.seasons.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={item.id === seasonId}
                tabIndex={radioTabIndex(item.id === seasonId, index, true)}
                onClick={() => setSeasonId(item.id)}
                className={`h-6 px-2 rounded-md text-[12px] font-medium whitespace-nowrap kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
                  item.id === seasonId ? 'bg-indigo-500 text-white' : 'text-zinc-300 hover:text-white hover:bg-white/[0.08]'
                }`}
              >
                {item.title || t('player.seasonN', { n: item.number })}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-[12px] font-medium text-zinc-200">
            {season?.title || t('player.seasonN', { n: season?.number ?? 1 })}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="w-6 h-6 rounded-md flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.08] kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
        >
          <X size={13} />
        </button>
      </header>

      <ul className="kvl-popover-scroll min-h-0 flex-1 overflow-y-auto py-1">
        {(season?.episodes ?? []).map((episode) => (
          <li key={episode.id}>
            <button
              type="button"
              onClick={() => open(episode.id)}
              aria-current={episode.current ? 'true' : undefined}
              className={`w-full px-3 py-2 flex items-start gap-2.5 text-left kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
                episode.current ? 'bg-indigo-500/15' : 'hover:bg-white/[0.06]'
              }`}
            >
              <span className={`mt-0.5 w-6 shrink-0 text-[12px] font-medium tabular-nums ${episode.current ? 'text-indigo-300' : 'text-zinc-400'}`}>
                E{episode.number}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5">
                  <span className={`truncate text-[13px] ${episode.current ? 'text-white font-semibold' : 'text-zinc-200'}`}>
                    {episode.title}
                  </span>
                  {episode.current && (
                    <span className="shrink-0 text-[10px] font-medium text-indigo-300">{t('player.currentEpisode')}</span>
                  )}
                  {episode.durationSec !== undefined && (
                    <span className="shrink-0 text-[11px] text-zinc-500">
                      {t('player.durationMin', { m: Math.round(episode.durationSec / 60) })}
                    </span>
                  )}
                </span>
                {episode.synopsis && (
                  <span className="mt-0.5 line-clamp-2 block text-[12px] text-zinc-400">{episode.synopsis}</span>
                )}
              </span>
              {episode.current && <Play size={12} weight="fill" className="mt-0.5 shrink-0 text-indigo-300" />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
