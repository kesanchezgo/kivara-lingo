import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Subtitles, LayoutGrid, Settings, X, ExternalLink, Moon, Sun, GripVertical, GraduationCap,
} from '../../ui/icons';
import { BrandGlyph } from '../../ui/BrandGlyph';
import { t } from '../../shared/i18n';
import type { PanelPosition } from '../../shared/store';
import { useKivaraStore } from '../../shared/use-kivara-store';
import type { AnkiMapping, SubtitleStyles } from '../../shared/types';
import { consumeOpenSettingsSection } from '../../shared/open-settings-section';
import { SubtitlesTab } from '../../app/components/tabs/SubtitlesTab';
import { CardsTab } from '../../app/components/tabs/CardsTab';
import { SettingsTab } from '../../app/components/tabs/SettingsTab';
import { VocabTab, VOCAB_TAB_ENABLED } from '../../app/components/tabs/VocabTab';
import { useRecentCards, isPending } from '../../app/components/tabs/RecentCards';
import { SegPill, FOCUS } from '../../ui/primitives/settings-primitives';
import type { CardPreviewData } from '../../app/components/tabs/CardPreview';

/**
 * Side panel. The layout is the prototype's (16px header, segmented tab bar,
 * all tabs kept mounted); the drag, the clamp, the persisted position and the
 * deep link are the repo's.
 *
 * Tabs: Subtitles · Vocabulary · Cards · Preferences. Vocabulary lands in F5:
 * the word-status store, the level estimator and the check are real, so the
 * tab is enabled and only the episode coverage waits for F6 (it needs the full
 * subtitle track).
 */

interface SidePanelProps {
  isPopupMode: boolean;
  /** Floating-mode toggle. Optional: a host with nothing to float (Options)
   * omits it and the button is not rendered. */
  togglePopupMode?: () => void;
  /** ✕ button handler. Optional for the same reason. */
  onClose?: () => void;
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  styles: SubtitleStyles;
  setStyles: (styles: SubtitleStyles) => void;
  mapping: AnkiMapping;
  setMapping: (mapping: AnkiMapping | ((prev: AnkiMapping) => AnkiMapping)) => void;
  mockData: CardPreviewData;
}

type PanelTab = 'subtitles' | 'vocab' | 'cards' | 'settings';

const POPUP_WIDTH = 440;
const POPUP_HEIGHT = 640;
const POPUP_PADDING = 8;

const HEAD_BTN = 'w-7 h-7 inline-flex items-center justify-center rounded-lg text-zinc-400 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-900/[0.05] dark:hover:bg-white/[0.07] kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40';

/** Default position with no stored one: top-right, inside the viewport. */
function defaultPopupPosition(): PanelPosition {
  if (typeof window === 'undefined') return { top: 96, left: 200 };
  return { top: 96, left: Math.max(0, window.innerWidth - POPUP_WIDTH - 32) };
}

/** Keep the panel inside the visible viewport with a small margin. */
function clampPosition(pos: PanelPosition): PanelPosition {
  if (typeof window === 'undefined') return pos;
  const maxLeft = Math.max(0, window.innerWidth - POPUP_WIDTH - POPUP_PADDING);
  const maxTop = Math.max(0, window.innerHeight - POPUP_HEIGHT - POPUP_PADDING);
  return {
    top: Math.min(Math.max(POPUP_PADDING, pos.top), maxTop),
    left: Math.min(Math.max(POPUP_PADDING, pos.left), maxLeft),
  };
}

function readHash(): string | undefined {
  return typeof window !== 'undefined' && window.location.hash
    ? window.location.hash.replace('#', '').trim() || undefined
    : undefined;
}

/**
 * Deep link, read ONCE before the tab content renders: the hash (reload-safe)
 * synchronously, then the session slot the OPEN_SETTINGS handler writes.
 *
 * `nonce` is one counter per resolution: a SECOND deep link while Settings is
 * already mounted delivers the same section again, so the section alone cannot
 * tell React that anything happened — the counter makes it an event.
 */
function useDeepLinkSection(): { pending: boolean; section: string | undefined; nonce: number } {
  const [resolved, setResolved] = useState(() => {
    const hash = readHash();
    return { pending: !hash, section: hash || undefined, nonce: hash ? 1 : 0 };
  });
  const deliver = useCallback((section: string | undefined) => {
    setResolved((prev) => ({ pending: false, section, nonce: prev.nonce + 1 }));
  }, []);
  useEffect(() => {
    if (!resolved.pending) return;
    let alive = true;
    void (async () => {
      const section = await consumeOpenSettingsSection();
      if (alive) deliver(section);
    })();
    return () => { alive = false; };
  }, [resolved.pending, deliver]);
  useEffect(() => {
    const onHashChange = () => {
      void (async () => { deliver(await consumeOpenSettingsSection()); })();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [deliver]);
  return resolved;
}

export function SidePanel({
  isPopupMode,
  togglePopupMode,
  onClose,
  isDarkMode,
  toggleDarkMode,
  styles,
  setStyles,
  mapping,
  setMapping,
  mockData,
}: SidePanelProps) {
  const deepLink = useDeepLinkSection();
  const [activeTab, setActiveTab] = useState<PanelTab>('cards');

  // A deep link must not land on Cards: that tab never mounts SettingsTab, so
  // the accordion the user was sent to expand would be unreachable. The nonce
  // is a dependency too — a second request for the SAME section while the user
  // has switched away must still bring them back.
  useEffect(() => {
    if (deepLink.pending) return;
    if (deepLink.section) setActiveTab('settings');
  }, [deepLink.pending, deepLink.section, deepLink.nonce]);

  const tabs: Array<{ id: PanelTab; label: string; icon: typeof Subtitles }> = [
    { id: 'subtitles', label: t('panel.tabSubtitles'), icon: Subtitles },
    ...(VOCAB_TAB_ENABLED
      ? [{ id: 'vocab' as PanelTab, label: t('panel.tabVocab'), icon: GraduationCap }]
      : []),
    { id: 'cards', label: t('panel.tabCards'), icon: LayoutGrid },
    { id: 'settings', label: t('panel.tabSettings'), icon: Settings },
  ];
  const tabIndex = tabs.findIndex((tab) => tab.id === activeTab);
  const pendingCards = useRecentCards().filter(isPending).length;
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  /* ── Drag + persisted position ───────────────────────────────────────── */
  const persistedPosition = useKivaraStore((s) => s.panelPosition);
  const setPersistedPosition = useKivaraStore((s) => s.setPanelPosition);
  const [position, setPosition] = useState<PanelPosition>(() =>
    clampPosition(persistedPosition ?? defaultPopupPosition()),
  );
  const positionRef = useRef<PanelPosition>(position);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{
    moved: boolean; startX: number; startY: number; originLeft: number; originTop: number;
  } | null>(null);

  const RESIZE_DEBOUNCE_MS = 500;
  const resizeTimerRef = useRef<number | null>(null);
  const setPersistedPositionDebounced = useCallback((next: PanelPosition) => {
    if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
    resizeTimerRef.current = window.setTimeout(() => {
      resizeTimerRef.current = null;
      setPersistedPosition(next);
    }, RESIZE_DEBOUNCE_MS);
  }, [setPersistedPosition]);

  // Re-clamp on resize so the panel can never end up off-screen — and persist
  // the clamped value (debounced: `resize` fires dozens of times per second and
  // sync allows 120 writes per minute).
  useEffect(() => {
    if (!isPopupMode) return;
    const flushResize = () => {
      const next = clampPosition(positionRef.current);
      positionRef.current = next;
      setPosition(next);
      setPersistedPositionDebounced(next);
    };
    const onResize = () => {
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = window.setTimeout(flushResize, RESIZE_DEBOUNCE_MS);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
    };
  }, [isPopupMode, setPersistedPositionDebounced]);

  // Persisted → local on (re)entering popup mode, clamped for the CURRENT
  // viewport and mirrored into the ref so later writes read the right base.
  useEffect(() => {
    if (!isPopupMode) return;
    const clamped = clampPosition(persistedPosition ?? defaultPopupPosition());
    positionRef.current = clamped;
    setPosition(clamped);
  }, [isPopupMode, persistedPosition]);

  const handleDragStart = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!isPopupMode || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    dragRef.current = {
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      originLeft: positionRef.current.left,
      originTop: positionRef.current.top,
    };
    setIsDragging(true);
  }, [isPopupMode]);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const start = dragRef.current;
      if (!start) return;
      const next = clampPosition({
        left: start.originLeft + (e.clientX - start.startX),
        top: start.originTop + (e.clientY - start.startY),
      });
      start.moved = true;
      positionRef.current = next;
      setPosition(next);
    };
    const onUp = () => {
      setIsDragging(false);
      const start = dragRef.current;
      dragRef.current = null;
      // Persist only on a real move: a plain click on the handle used to write
      // the position anyway, and the next clamp "snapped" the panel back.
      if (start?.moved) setPersistedPosition(positionRef.current);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, setPersistedPosition]);

  const popupStyle: React.CSSProperties | undefined = isPopupMode
    ? {
      top: position.top,
      left: position.left,
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
      maxHeight: `calc(100vh - ${POPUP_PADDING * 2}px)`,
      transition: isDragging ? 'none' : 'box-shadow 150ms ease',
      boxShadow: isDragging
        ? '0 25px 50px -12px rgba(0,0,0,0.5)'
        : '0 20px 25px -5px rgba(0,0,0,0.3), 0 10px 10px -5px rgba(0,0,0,0.15)',
    }
    : undefined;

  const close = onClose ?? (isPopupMode ? togglePopupMode : undefined);

  const selectTab = (id: PanelTab) => setActiveTab(id);

  return (
    <div
      role={isPopupMode ? 'dialog' : 'complementary'}
      aria-label={t('panel.title')}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !close) return;
        e.stopPropagation();
        close();
      }}
      className={`kvl-ui flex flex-col bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 shadow-2xl overflow-hidden ${
        isPopupMode
          ? 'rounded-xl fixed z-50 ring-1 ring-zinc-900/[0.08] dark:ring-white/[0.08]'
          : 'w-full h-full rounded-none border-l border-zinc-900/[0.06] dark:border-white/[0.06]'
      } ${isDragging ? 'select-none' : ''}`}
      style={popupStyle}
    >
      {/* Header — drag handle in floating mode */}
      <div
        className={`flex items-center justify-between h-16 shrink-0 pl-4 pr-3 ${
          isPopupMode ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : ''
        }`}
        onMouseDown={handleDragStart}
        title={isPopupMode ? t('panel.dragHint') : undefined}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {isPopupMode && (
            <GripVertical size={14} className="text-zinc-400 dark:text-zinc-600 shrink-0 -ml-1" aria-hidden="true" />
          )}
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
            <BrandGlyph size={16} className="text-white" />
          </div>
          <div className="min-w-0">
            <div className="text-[15px] leading-5 font-semibold tracking-[-0.01em] text-zinc-900 dark:text-white truncate">
              Kivara <span className="text-indigo-500 dark:text-indigo-400">Lingo</span>
            </div>
            <div className="text-[12px] leading-tight text-zinc-500 dark:text-zinc-400 truncate">{t('panel.subtitle')}</div>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          {togglePopupMode && (
            <button
              type="button"
              onClick={togglePopupMode}
              className={HEAD_BTN}
              title={isPopupMode ? t('panel.dockToSide') : t('panel.openFloating')}
              aria-label={isPopupMode ? t('panel.dockToSide') : t('panel.openFloating')}
            >
              {isPopupMode ? <LayoutGrid size={16} /> : <ExternalLink size={16} />}
            </button>
          )}
          <button
            type="button"
            onClick={toggleDarkMode}
            className={HEAD_BTN}
            title={isDarkMode ? t('panel.lightMode') : t('panel.darkMode')}
            aria-label={isDarkMode ? t('panel.lightMode') : t('panel.darkMode')}
          >
            {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          {close && (
            <button
              type="button"
              onClick={close}
              className={HEAD_BTN}
              title={t('panel.closeTitle')}
              aria-label={t('panel.closeTitle')}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label={t('a11y.panelTabs')} className="@container px-4 pb-3 shrink-0">
        <div className="relative flex rounded-lg bg-zinc-900/[0.05] dark:bg-white/[0.06] p-0.5">
          <SegPill index={tabIndex} count={tabs.length} />
          {tabs.map((tab) => (
            <button
              key={tab.id}
              ref={(el) => { tabRefs.current[tab.id] = el; }}
              role="tab"
              type="button"
              id={`kivara-panel-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls={`kivara-panel-body-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => selectTab(tab.id)}
              onKeyDown={(e) => {
                const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                if (dir === 0) return;
                e.preventDefault();
                const nextId = tabs[(tabIndex + dir + tabs.length) % tabs.length].id;
                selectTab(nextId);
                requestAnimationFrame(() => tabRefs.current[nextId]?.focus());
              }}
              className={`kvl-press relative z-10 flex-1 min-w-0 flex items-center justify-center gap-1.5 h-7 rounded-md text-[12px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
                activeTab === tab.id
                  ? 'text-zinc-900 dark:text-white'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              <tab.icon
                size={14}
                weight={activeTab === tab.id ? 'fill' : 'regular'}
                aria-hidden="true"
                className={`shrink-0 @max-[383px]:hidden ${activeTab === tab.id ? 'text-indigo-500 dark:text-indigo-400' : ''}`}
              />
              <span className="truncate">{tab.label}</span>
              {tab.id === 'cards' && pendingCards > 0 && (
                <span
                  className="min-w-[15px] h-[15px] px-1 rounded-full bg-amber-500 dark:bg-amber-400 text-white dark:text-zinc-950 text-[9px] font-bold leading-[15px] text-center tabular-nums shrink-0 -ml-0.5"
                  title={t('recent.queuedCount', { n: pendingCards })}
                  aria-label={t('recent.queuedCount', { n: pendingCards })}
                >
                  {pendingCards}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content — every tab stays mounted (hidden) so Settings/Cards keep
          their local state when the user switches tabs. */}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`kivara-panel-body-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`kivara-panel-tab-${tab.id}`}
          hidden={activeTab !== tab.id}
          tabIndex={0}
          className={`flex-1 min-h-0 overflow-hidden ${FOCUS} border-t border-zinc-900/[0.06] dark:border-white/[0.06] bg-zinc-50/80 dark:bg-transparent`}
        >
          {tab.id === 'subtitles' && (
            <SubtitlesTab styles={styles} setStyles={setStyles} onOpenVocab={() => selectTab('vocab')} />
          )}
          {tab.id === 'cards' && (
            <CardsTab mapping={mapping} setMapping={setMapping} mockData={mockData} />
          )}
          {tab.id === 'settings' && (
            <SettingsTab
              initialSection={deepLink.section}
              initialNonce={deepLink.nonce}
              onOpenTab={(target) => selectTab(target === 'vocab' ? 'vocab' : target)}
            />
          )}
          {tab.id === 'vocab' && <VocabTab onOpenCards={() => selectTab('cards')} />}
        </div>
      ))}
    </div>
  );
}
