import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Subtitles, LayoutGrid, Settings, X, ExternalLink, Moon, Sun, GripVertical } from 'lucide-react';
import { KivaraLingoLogo } from '../../app/components/KivaraLingoLogo';
import { SubtitlesTab } from '../../app/components/tabs/SubtitlesTab';
import { CardsTab } from '../../app/components/tabs/CardsTab';
import { SettingsTab } from '../../app/components/tabs/SettingsTab';
import { SubtitleStyles, AnkiMapping } from '../../app/types';
import { useKivaraStore, type PanelPosition } from '../../shared/store';
import { t } from '../../shared/i18n';
import { consumeOpenSettingsSection } from '../../shared/open-settings-section';

interface SidePanelProps {
  isPopupMode: boolean;
  /** Popup-mode toggle. Optional: a host that does not offer a floating
   * panel (e.g. the options page, which IS the app at full size) should
   * omit this and the button is not rendered, rather than showing a dead
   * onClick that silently swallows the click. */
  togglePopupMode?: () => void;
  /** ✕ button handler. Optional for the same reason: options has nothing
   * to close. */
  onClose?: () => void;
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  styles: SubtitleStyles;
  setStyles: (styles: SubtitleStyles) => void;
  mapping: AnkiMapping;
  /** Value or updater — see CardsTabProps.setMapping. */
  setMapping: (mapping: AnkiMapping | ((prev: AnkiMapping) => AnkiMapping)) => void;
  mockData: any;
}

const POPUP_WIDTH = 360;
const POPUP_HEIGHT = 600;
const POPUP_PADDING = 8;

/**
 * Default position when none is persisted: top-right corner with the same
 * 24px / 32px insets the panel had before drag was added. Works for any
 * viewport size — the clamp logic in `clampPosition` handles tiny windows.
 */
function defaultPopupPosition(): PanelPosition {
  if (typeof window === 'undefined') return { top: 96, left: 200 };
  return {
    top: 96,
    left: Math.max(0, window.innerWidth - POPUP_WIDTH - 32),
  };
}

/**
 * Keep the panel inside the visible viewport with a small breathing margin.
 * Without this the user can drag the panel mostly off-screen (especially
 * after the window resizes between sessions) and lose access to it.
 */
function clampPosition(pos: PanelPosition): PanelPosition {
  if (typeof window === 'undefined') return pos;
  const maxLeft = Math.max(0, window.innerWidth - POPUP_WIDTH - POPUP_PADDING);
  const maxTop = Math.max(0, window.innerHeight - POPUP_HEIGHT - POPUP_PADDING);
  return {
    top: Math.min(Math.max(POPUP_PADDING, pos.top), maxTop),
    left: Math.min(Math.max(POPUP_PADDING, pos.left), maxLeft),
  };
}

/**
 * Deep-link section for a panel that was opened to fix something.
 *
 * Hash first because it is on the URL and survives a reload; the session slot
 * second because that is what the OPEN_SETTINGS service-worker handler writes
 * just before `chrome.tabs.create`. Both sides consume the same shared module,
 * so a SettingsTab deep link and the panel's initial tab can never disagree.
 *
 * `nonce` is one counter per resolution delivered outside the state object: a
 * SECOND deep link while Settings is already mounted sends the same section
 * again, so the section alone cannot tell React that anything happened — the
 * counter is what makes it an event (see SettingsTab).
 */
function useDeepLinkSection(): { pending: boolean; section: string | undefined; nonce: number } {
  const [resolved, setResolved] = useState<{
    pending: boolean;
    section: string | undefined;
    nonce: number;
  }>(() => {
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
    return () => {
      alive = false;
    };
  }, [resolved.pending, deliver]);

  // A second deep link into the SAME page (the strip clicked again while
  // Options stayed open) changes the hash: deliver again so the section is
  // re-applied instead of keeping whatever the first visit resolved to.
  useEffect(() => {
    const onHashChange = () => {
      void (async () => {
        deliver(await consumeOpenSettingsSection());
      })();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [deliver]);
  return resolved;
}

function readHash(): string | undefined {
  return typeof window !== 'undefined' && window.location.hash
    ? window.location.hash.replace('#', '').trim() || undefined
    : undefined;
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
  mockData
}: SidePanelProps) {
  /**
   * Deep link, read ONCE before the tab content renders: the hash (reload-safe)
   * synchronously, then the session slot the OPEN_SETTINGS handler writes.
   * Without this the panels opened for a permission grant — cards and options
   * alike — stayed on the Cards tab, which never mounts SettingsTab, so the
   * accordion the user was sent to expand was unreachable.
   *
   * `pending` keeps the first paint blank instead of flashing the Cards tab;
   * the resolve default is Settings when a section was on the URL.
   */
  const deepLink = useDeepLinkSection();
  const [activeTab, setActiveTab] = useState<'subtitles' | 'cards' | 'settings'>('cards');
  // Switch as soon as the section is known — a deep link must not land on the
  // Cards tab, which never mounts SettingsTab at all. The nonce is a dependency
  // too: the section ALONE does not change when a second deep link asks for the
  // same one while the user has since switched away, and that request must
  // still bring them back.
  useEffect(() => {
    if (deepLink.pending) return;
    if (deepLink.section) setActiveTab('settings');
  }, [deepLink.pending, deepLink.section, deepLink.nonce]);
  const persistedPosition = useKivaraStore((s) => s.panelPosition);
  const setPersistedPosition = useKivaraStore((s) => s.setPanelPosition);

  // Live position during drag — rendered through transform/top/left without
  // re-persisting on every mousemove (we only commit on drop). Initialised
  // from chrome.storage on first render so the panel reopens where the user
  // left it.
  const [position, setPosition] = useState<PanelPosition>(() =>
    clampPosition(persistedPosition ?? defaultPopupPosition()),
  );
  /** Raw mirror of `position`, readable from an event handler without
   *  reaching through a setState updater (see the mouseup persistence). */
  const positionRef = useRef<PanelPosition>(position);
  /** Trailing-edge debounce for the STORED position. 500 ms is far longer than
   *  a resize burst and short enough that the panel still settles on the
   *  persisted value when the window stops moving. */
  const RESIZE_DEBOUNCE_MS = 500;
  const resizeTimerRef = useRef<number | null>(null);
  const setPersistedPositionDebounced = useCallback((next: PanelPosition) => {
    if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
    resizeTimerRef.current = window.setTimeout(() => {
      resizeTimerRef.current = null;
      setPersistedPosition(next);
    }, RESIZE_DEBOUNCE_MS);
  }, [setPersistedPosition]);
  const [isDragging, setIsDragging] = useState(false);
  const dragStateRef = useRef<{
    moved: boolean;
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
  } | null>(null);

  // Re-clamp whenever the viewport resizes so the panel never disappears off
  // the screen edge. Persists the clamped value so reopening loads sane
  // coordinates.
  useEffect(() => {
    if (!isPopupMode) return;
    const flushResize = () => {
      // Compute and persist OUTSIDE the state updater entirely. Two reasons:
      //  • a `setState(prev => …)` callback must be pure — React may run it
      //    twice, so the storage write used to happen twice per resize;
      //  • a debounced write keeps the burst inside chrome.storage's budget:
      //    `resize` fires dozens of times per second while a drag handle is
      //    used, and sync allows 120 writes per minute.
      const next = clampPosition(positionRef.current);
      positionRef.current = next;
      setPosition(next);
      setPersistedPositionDebounced(next);
    };
    // Trailing-edge debounce: the clamped value settles a moment after the
    // last resize, and writing once at 500 ms cannot overflow the quota no
    // matter how fast the window is dragged. The position shown on screen is
    // immediate (setPosition above); only the STORAGED value is delayed.
    const onResize = () => {
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = window.setTimeout(flushResize, RESIZE_DEBOUNCE_MS);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      // Nothing in flight lost: the last computed value was already held.
    };
    // The debounced writer is listed: it is a stable `useCallback` over a
    // store setter, so the effect re-runs only if the store itself changes.
  }, [isPopupMode, setPersistedPosition, setPersistedPositionDebounced]);

  // Sync persisted → local position when popup mode is re-entered. Also
  // re-clamp the persisted value (in case the previous session was on a
  // larger monitor) and MIRRORS it into the ref, which every later write
  // reads (a ref that skips this update writes back coordinates from before);
  // this effect also re-clamps when the viewport changes size.
  useEffect(() => {
    if (!isPopupMode) return;
    const clamped = clampPosition(persistedPosition ?? defaultPopupPosition());
    positionRef.current = clamped;
    setPosition(clamped);
  }, [isPopupMode, persistedPosition]);

  const handleDragStart = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (!isPopupMode) return;
      // Only start dragging from a primary-button click on the handle —
      // not from the buttons inside the header (those have their own
      // onClick and we don't want a click+drag to misfire as a drag).
      const target = e.target as HTMLElement;
      if (target.closest('button')) return;
      e.preventDefault();
      setIsDragging(true);
      dragStateRef.current = {
        moved: false,
        startX: e.clientX,
        startY: e.clientY,
        originLeft: position.left,
        originTop: position.top,
      };
    },
    [isPopupMode, position.left, position.top],
  );

  // Global mousemove / mouseup so the drag survives the cursor leaving the
  // header area (otherwise fast drags would lose tracking).
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const start = dragStateRef.current;
      if (!start) return;
      const next = clampPosition({
        left: start.originLeft + (e.clientX - start.startX),
        top: start.originTop + (e.clientY - start.startY),
      });
      setPosition(next);
      start.moved = true;
      // The mirror ref makes the raw value readable from an event handler
      // (mouseup) without going through a setState updater — see the note in
      // onUp about why the write cannot live inside an updater.
      positionRef.current = next;
    };
    const onUp = () => {
      setIsDragging(false);
      const start = dragStateRef.current;
      dragStateRef.current = null;
      // Persist only on a real move: a plain click on the handle used to
      // write the position anyway, and the next clamp then "snapped" the
      // panel back — which read as the header click having moved it.
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
        // Disable the transition while dragging so the panel tracks the
        // cursor exactly, then re-enable it for the snap-on-drop animation.
        transition: isDragging ? 'none' : 'box-shadow 150ms ease',
        boxShadow: isDragging
          ? '0 25px 50px -12px rgba(0,0,0,0.5)'
          : '0 20px 25px -5px rgba(0,0,0,0.3), 0 10px 10px -5px rgba(0,0,0,0.15)',
      }
    : undefined;

  return (
    <div
      // Accessibility: the panel is a popup-style surface (draggable card in
      // popup mode, slide-in in side-panel mode), so it is exposed as a
      // dialog and Escape hands control back to the page — matching what
      // `Alt+K` and the ✕ button do.
      role="dialog"
      aria-label={t('panel.title')}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        // Escape is the keyboard twin of the ✕ button: only act when the
        // host actually gave us a close handler.
        onClose?.();
      }}
      className={`flex flex-col bg-white dark:bg-zinc-950 shadow-2xl overflow-hidden ${
        isPopupMode
          ? 'rounded-xl fixed z-50 border border-zinc-200 dark:border-zinc-800'
          : 'w-[400px] h-full rounded-none border-l border-zinc-200 dark:border-zinc-800'
      } ${isDragging ? 'select-none' : ''}`}
      style={popupStyle}
    >
      {/* Header — also serves as the drag handle in popup mode. The
          GripVertical icon hints at the drag affordance to the user. */}
      <div
        className={`flex items-center justify-between p-4 border-b border-zinc-100 dark:border-zinc-800/60 bg-zinc-50/50 dark:bg-zinc-900/50 backdrop-blur ${
          isPopupMode ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : ''
        }`}
        onMouseDown={handleDragStart}
        title={isPopupMode ? t('panel.dragHint') : undefined}
      >
        <div className="flex items-center gap-2 min-w-0">
          {isPopupMode && (
            <GripVertical
              size={14}
              className="text-zinc-400 dark:text-zinc-600 shrink-0"
              aria-hidden="true"
            />
          )}
          <KivaraLingoLogo size={18} isDark={isDarkMode} />
        </div>
        <div className="flex items-center gap-1">
          <button 
            onClick={toggleDarkMode}
            className="p-1.5 text-zinc-400 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
            title={isDarkMode ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          >
            {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>
            {togglePopupMode && (
              <button
                onClick={togglePopupMode}
                className="p-1.5 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-md transition-colors"
                title={isPopupMode ? 'Anclar al lateral' : t('panel.openFloating')}
              >
                {isPopupMode ? <LayoutGrid size={16} /> : <ExternalLink size={16} />}
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="p-1.5 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition-colors"
                title={t('panel.closeTitle')}
              >
                <X size={16} />
              </button>
            )}
        </div>
      </div>

      {/* Tabs Nav — sliding indicator with smooth ease-out animation */}
      <div
        role="tablist"
        aria-label={t('a11y.panelTabs')}
        className="relative flex border-b border-zinc-200 dark:border-zinc-800/60 bg-white dark:bg-zinc-950"
      >
        {(() => {
          const TABS = [
            { id: 'subtitles', label: 'Subtitles', icon: Subtitles },
            { id: 'cards',     label: 'Cards',     icon: LayoutGrid },
            { id: 'settings',  label: 'Settings',  icon: Settings },
          ] as const;
          const tabIndex = TABS.findIndex((t) => t.id === activeTab);
          return (
            <>
              <div
                className="absolute bottom-0 h-0.5 bg-indigo-600 dark:bg-indigo-500 rounded-full transition-all duration-300 ease-out"
                style={{ width: '33.333%', left: `${tabIndex * 33.333}%` }}
              />
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  role="tab"
                  type="button"
                  aria-selected={activeTab === tab.id}
                  aria-controls={`kivara-panel-body-${tab.id}`}
                  id={`kivara-panel-tab-${tab.id}`}
                  tabIndex={activeTab === tab.id ? 0 : -1}
                  onClick={() => setActiveTab(tab.id as any)}
                  onKeyDown={(e) => {
                    // Roving tabindex + arrow keys: the documented widget
                    // pattern for tab bars. Without it a screen reader reads
                    // three buttons and nothing about which one is active.
                    const dir =
                      e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                    if (dir === 0) return;
                    e.preventDefault();
                    const next = (tabIndex + dir + TABS.length) % TABS.length;
                    setActiveTab(TABS[next].id as any);
                    requestAnimationFrame(() =>
                      document.getElementById(`kivara-panel-tab-${TABS[next].id}`)?.focus(),
                    );
                  }}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors relative ${
                    activeTab === tab.id
                      ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-500/5'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900/50'
                  }`}
                >
                  <tab.icon size={16} aria-hidden="true" />
                  {tab.label}
                </button>
              ))}
            </>
          );
        })()}
      </div>

      {/* Tab Content — `min-h-0` lets `flex-1` shrink below its content
          so the inner `overflow-y-auto` actually scrolls instead of pushing
          the panel taller than its container. The `key={activeTab}` +
          `sl-animate-fade-up` re-trigger the slide-up entrance whenever
          the user switches tabs (matches the design mock). */}
      <div
        key={activeTab}
        id={`kivara-panel-body-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`kivara-panel-tab-${activeTab}`}
        tabIndex={0}
        className="flex-1 min-h-0 overflow-hidden sl-animate-fade-up"
        style={{ animationDuration: '220ms' }}
      >
        {activeTab === 'subtitles' && (
          <SubtitlesTab styles={styles} setStyles={setStyles} />
        )}
        {activeTab === 'cards' && (
          <CardsTab mapping={mapping} setMapping={setMapping} mockData={mockData} />
        )}
        {activeTab === 'settings' && (
          <SettingsTab initialSection={deepLink.section} initialNonce={deepLink.nonce} />
        )}
      </div>
    </div>
  );
}
