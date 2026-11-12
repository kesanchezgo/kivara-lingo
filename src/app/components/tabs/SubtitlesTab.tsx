import { useState } from 'react';
import { Type, Palette, AlignVerticalSpaceBetween, RotateCcw, AlignLeft, GraduationCap } from '../../../ui/icons';
import { t, fmtNumber, useLocale } from '../../../shared/i18n';
import { DEFAULT_STUDY, DEFAULT_SUBTITLE_STYLES } from '../../../shared/store';
import { useKivaraStore } from '../../../shared/use-kivara-store';
import type { SubtitleStyles } from '../../../shared/types';
import { Slider } from '../../../ui/primitives/controls';
import {
  FOCUS, Group, NavRow, SegmentedControl, Toggle, ValueRow as Row, tx, ui,
} from '../../../ui/primitives/settings-primitives';
import { MARK_INK, StatusGlyph } from '../../../content/ui/wordMarks';
import { useWordStudy } from '../../../content/ui/study';
import type { WordStatus } from '../../../shared/study/wordStatus';

/**
 * Subtitles — appearance of the overlay (and of the word card through
 * `cardTheme`) plus the word marks: the legend, the new-word drawing and a way
 * into the Vocabulary tab.
 *
 * The study MODES (translation visibility, listen first, auto-pause) live in
 * Preferences: they change playback, not typography. Inspiration for the
 * split is the prototype, which keeps this tab purely visual.
 */
export function SubtitlesTab({
  styles,
  setStyles,
  onOpenVocab,
}: {
  styles: SubtitleStyles;
  setStyles: (styles: SubtitleStyles) => void;
  /** Jump to the Vocabulary tab (the level row); absent on hosts without tabs. */
  onOpenVocab?: () => void;
}) {
  const [nativeFormatOpen, setNativeFormatOpen] = useState(false);
  const study = useKivaraStore((s) => s.study);
  const setStudy = useKivaraStore((s) => s.setStudy);
  const wordStudy = useWordStudy();
  const locale = useLocale();
  const langName = locale === 'es'
    ? t(`lang.${wordStudy.lang}`).toLocaleLowerCase('es')
    : t(`lang.${wordStudy.lang}`);

  const updateStyle = <K extends keyof SubtitleStyles>(key: K, value: SubtitleStyles[K]) => {
    setStyles({ ...styles, [key]: value });
  };

  const resetOf = <K extends keyof SubtitleStyles>(key: K): (() => void) | undefined =>
    styles[key] !== DEFAULT_SUBTITLE_STYLES[key]
      ? () => updateStyle(key, DEFAULT_SUBTITLE_STYLES[key])
      : undefined;

  // Preset and height describe the same thing — reset them together.
  const resetPosition =
    styles.position !== DEFAULT_SUBTITLE_STYLES.position ||
    styles.verticalOffset !== DEFAULT_SUBTITLE_STYLES.verticalOffset
      ? () => setStyles({
        ...styles,
        position: DEFAULT_SUBTITLE_STYLES.position,
        verticalOffset: DEFAULT_SUBTITLE_STYLES.verticalOffset,
      })
      : undefined;

  // Generic over every key: a new style field can't be forgotten here.
  const isDefault =
    study.newMarks === DEFAULT_STUDY.newMarks &&
    (Object.keys(DEFAULT_SUBTITLE_STYLES) as (keyof SubtitleStyles)[])
      .every((k) => (styles[k] ?? DEFAULT_SUBTITLE_STYLES[k]) === DEFAULT_SUBTITLE_STYLES[k]);
  const resetNewMarks =
    study.newMarks !== DEFAULT_STUDY.newMarks
      ? () => setStudy({ ...study, newMarks: DEFAULT_STUDY.newMarks })
      : undefined;

  return (
    <div className={`flex flex-col h-full min-h-0 text-zinc-900 dark:text-zinc-100 overflow-y-auto ${ui.scroll}`}>
      <div className={ui.body}>
        {/* Typography */}
        <Group
          icon={<Type size={13} />}
          title={t('subs.typography')}
          right={
            <button
              type="button"
              onClick={() => {
                setStyles(DEFAULT_SUBTITLE_STYLES);
                setStudy({ ...study, newMarks: DEFAULT_STUDY.newMarks });
              }}
              disabled={isDefault}
              className={`group inline-flex items-center gap-1.5 text-[12px] font-medium h-6 px-2 -mr-1 rounded-md text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-900/[0.05] dark:hover:bg-white/[0.06] disabled:opacity-40 disabled:pointer-events-none kvl-press ${FOCUS}`}
              title={t('subs.resetAllTitle')}
            >
              <RotateCcw size={12} className="transition-transform duration-500 group-hover:-rotate-180" />
              {t('subs.reset')}
            </button>
          }
        >
          <Row label={t('subs.size')} value={`${styles.fontSize}px`} onReset={resetOf('fontSize')}>
            <Slider
              aria-label={t('subs.size')}
              min={16}
              max={64}
              value={styles.fontSize}
              onChange={(e) => updateStyle('fontSize', parseInt(e.target.value))}
              className="w-full"
            />
          </Row>

          <Row label={t('sub.color')} onReset={resetOf('color')}>
            <div className="flex gap-3 pl-0.5 py-0.5">
              {['#FFFFFF', '#FCD34D', '#A7F3D0', '#FECACA', '#E9D5FF'].map((color) => {
                const selected = styles.color === color;
                return (
                  <button
                    key={color}
                    type="button"
                    title={color}
                    aria-pressed={selected}
                    onClick={() => updateStyle('color', color)}
                    style={{ backgroundColor: color }}
                    className={`kvl-press w-6 h-6 rounded-full p-0 border-0 cursor-pointer outline-none ring-offset-2 ring-offset-white dark:ring-offset-zinc-950 shadow-[inset_0_0_0_1px_rgba(0,0,0,.2)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,.14)] focus-visible:ring-2 focus-visible:ring-indigo-500/50 ${
                      selected ? 'ring-2 ring-indigo-500' : 'hover:scale-110'
                    }`}
                    aria-label={t('sub.ariaTextColor', { color })}
                  />
                );
              })}
            </div>
          </Row>

          <Row label={t('sub.weight')} onReset={resetOf('fontWeight')}>
            <SegmentedControl
              ariaLabel={t('sub.weight')}
              options={[
                { v: 'normal', l: t('sub.weightNormal') },
                { v: 'bold', l: t('sub.weightBold') },
                { v: '900', l: t('sub.weightBlack') },
              ]}
              value={styles.fontWeight}
              onChange={(v) => updateStyle('fontWeight', v)}
            />
          </Row>

          <Row
            label={t('sub.shadow')}
            value={styles.textShadow > 0 ? `${styles.textShadow}%` : t('sub.off')}
            onReset={resetOf('textShadow')}
          >
            <Slider
              aria-label={t('sub.shadow')}
              min={0}
              max={100}
              step={5}
              value={styles.textShadow}
              onChange={(e) => updateStyle('textShadow', parseInt(e.target.value))}
              className="w-full"
            />
          </Row>
        </Group>

        {/* Background */}
        <Group icon={<Palette size={13} />} title={t('sub.background')}>
          <Row label={t('sub.color')} onReset={resetOf('backgroundColor')}>
            <div className="flex gap-3 pl-0.5 py-0.5">
              {['#000000', '#18181B', '#1E3A8A', '#831843'].map((color) => {
                const selected = styles.backgroundColor === color;
                return (
                  <button
                    key={color}
                    type="button"
                    title={color}
                    aria-pressed={selected}
                    onClick={() => updateStyle('backgroundColor', color)}
                    style={{ backgroundColor: color }}
                    className={`kvl-press w-6 h-6 rounded-full p-0 border-0 cursor-pointer outline-none ring-offset-2 ring-offset-white dark:ring-offset-zinc-950 shadow-[inset_0_0_0_1px_rgba(0,0,0,.2)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,.14)] focus-visible:ring-2 focus-visible:ring-indigo-500/50 ${
                      selected ? 'ring-2 ring-indigo-500' : 'hover:scale-110'
                    }`}
                    aria-label={t('sub.ariaColor', { color })}
                  />
                );
              })}
            </div>
          </Row>

          <Row label={t('sub.opacity')} value={`${styles.backgroundOpacity}%`} onReset={resetOf('backgroundOpacity')}>
            <Slider
              aria-label={t('sub.opacity')}
              min={0}
              max={100}
              value={styles.backgroundOpacity}
              onChange={(e) => updateStyle('backgroundOpacity', parseInt(e.target.value))}
              className="w-full"
            />
          </Row>

          <Row label={t('sub.hoverOpacity')} value={`${styles.hoverOpacity}%`} onReset={resetOf('hoverOpacity')}>
            <Slider
              aria-label={t('sub.hoverOpacity')}
              min={0}
              max={100}
              value={styles.hoverOpacity}
              onChange={(e) => updateStyle('hoverOpacity', parseInt(e.target.value))}
              className="w-full"
            />
          </Row>

          <ToggleRow
            label={t('sub.blurBgHover')}
            checked={styles.hoverBlur}
            onChange={(v) => updateStyle('hoverBlur', v)}
            onReset={resetOf('hoverBlur')}
          />

          <Row
            label={t('sub.cardTheme')}
            onReset={(styles.cardTheme ?? 'dark') !== 'dark'
              ? () => updateStyle('cardTheme', 'dark')
              : undefined}
          >
            <SegmentedControl
              ariaLabel={t('sub.cardTheme')}
              options={[
                { v: 'dark', l: t('sub.cardThemeDark') },
                { v: 'light', l: t('sub.cardThemeLight') },
                { v: 'auto', l: t('sub.cardThemeAuto') },
              ]}
              value={styles.cardTheme ?? 'dark'}
              onChange={(v) => updateStyle('cardTheme', v)}
            />
          </Row>
        </Group>

        {/* Position */}
        <Group icon={<AlignVerticalSpaceBetween size={13} />} title={t('subs.position')}>
          <Row label={t('sub.preset')} onReset={resetPosition}>
            <SegmentedControl
              ariaLabel={t('subs.position')}
              options={[
                { v: 'top', l: t('sub.posTop') },
                { v: 'middle', l: t('sub.posMiddle') },
                { v: 'bottom', l: t('sub.posBottom') },
              ]}
              value={styles.position}
              onChange={(v) => {
                const offset = v === 'top' ? 15 : v === 'middle' ? 50 : 85;
                setStyles({ ...styles, position: v, verticalOffset: offset });
              }}
            />
          </Row>
          <Row label={t('sub.height')} value={`${styles.verticalOffset ?? 85}%`} onReset={resetPosition}>
            <div className="relative">
              <Slider
                aria-label={t('sub.height')}
                min={5}
                max={95}
                step={1}
                value={styles.verticalOffset ?? 85}
                onChange={(e) => {
                  const offset = parseInt(e.target.value);
                  const preset: SubtitleStyles['position'] =
                    offset <= 25 ? 'top' : offset >= 75 ? 'bottom' : 'middle';
                  setStyles({ ...styles, verticalOffset: offset, position: preset });
                }}
                className="w-full relative z-10"
              />
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 pointer-events-none h-2">
                {[15, 50, 85].map((p) => (
                  <span
                    key={p}
                    className="absolute top-1/2 -translate-y-1/2 w-px h-2 bg-zinc-300 dark:bg-zinc-600"
                    style={{ left: `${((p - 5) / 90) * 100}%` }}
                  />
                ))}
              </div>
              <div className="flex justify-between text-[12px] text-zinc-400 dark:text-zinc-400 mt-1.5 px-0.5">
                <span>{t('sub.posTop')}</span><span>{t('sub.posMiddle')}</span><span>{t('sub.posBottom')}</span>
              </div>
            </div>
          </Row>
        </Group>

        {/* Word status. One legend for the whole app: the Vocabulary tab shows
            the coverage bar with the same status names, not another legend. */}
        <Group icon={<GraduationCap size={13} />} title={t('ws.sectionTitle')} hint={t('ws.sectionHint')}>
          <Row label={t('ws.marks')}>
            <div role="list" aria-label={t('ws.legendAria')} className={`${MARK_INK} grid grid-cols-2 gap-x-4 gap-y-3`}>
              <LegendItem status="learning" label={t('ws.learning')} meta={t('ws.learningMeta')} />
              <LegendItem status="new" label={t('ws.new')} meta={t('ws.newMeta')} />
              <LegendItem status="known" label={t('ws.known')} meta={t('ws.knownMeta')} />
              <LegendItem status="known" expr label={t('ws.expression')} meta={t('ws.exprMeta')} />
            </div>
          </Row>

          {/* Only the drawing of the new words: it changes neither their status
              nor the «learning» line. */}
          <Row label={t('ws.newMarks')} hint={t('ws.newMarksHint')} onReset={resetNewMarks}>
            <SegmentedControl
              ariaLabel={t('ws.newMarksAria')}
              className={MARK_INK}
              options={[
                { v: 'dotted', l: t('ws.newMarksDotted'), icon: <StatusGlyph status="new" /> },
                { v: 'none', l: t('ws.newMarksNone') },
              ]}
              value={study.newMarks}
              onChange={(v) => setStudy({ ...study, newMarks: v })}
            />
          </Row>

          {/* Level, self-assessment, check and coverage live in their tab: here only the way in. */}
          <NavRow
            data-open-vocab
            label={t('ws.levelIn', { lang: langName })}
            description={wordStudy.estimator.provisional
              ? t('ws.levelRef', { level: wordStudy.estimator.level })
              : `${wordStudy.estimator.level} · ${t(`ws.level.${wordStudy.estimator.level}`)} · ≈\u00a0${fmtNumber(wordStudy.estimator.total)} ${t('ws.words')}`}
            where={t('ws.openVocab')}
            title={t('ws.openVocabTitle')}
            onClick={() => onOpenVocab?.()}
          />
        </Group>

        {/* Native format — collapsible */}
        <Group
          icon={<AlignLeft size={13} />}
          title={t('subs.nativeFormat')}
          hint={t('subs.keepWrapHint')}
          collapsible
          open={nativeFormatOpen}
          onToggle={() => setNativeFormatOpen(!nativeFormatOpen)}
        >
          <ToggleRow
            label={t('subs.keepLineBreaks')}
            checked={styles.keepNativeLineBreaks}
            onChange={(v) => updateStyle('keepNativeLineBreaks', v)}
          />
          <ToggleRow
            label={t('subs.keepAlignment')}
            checked={styles.keepNativeAlignment}
            onChange={(v) => updateStyle('keepNativeAlignment', v)}
          />
        </Group>
      </div>
    </div>
  );
}

/** Row with the control on the right and a hover-only reset button. */
function ToggleRow({
  label,
  description,
  checked,
  onChange,
  onReset,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  onReset?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 min-h-[20px] group/row">
      <span className="min-w-0">
        <span className={`${tx.label} block truncate`}>{label}</span>
        {description && (
          <span className="block text-[12px] leading-4 text-zinc-500 dark:text-zinc-400 mt-0.5">{description}</span>
        )}
      </span>
      <div className="flex items-center gap-1 shrink-0">
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            title={t('subs.resetValueTitle')}
            aria-label={t('subs.resetValueTitle')}
            className="opacity-0 group-hover/row:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity w-6 h-6 inline-flex items-center justify-center rounded-md text-zinc-400 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-900/[0.05] dark:hover:bg-white/[0.06]"
          >
            <RotateCcw size={12} />
          </button>
        )}
        <Toggle on={checked} onChange={onChange} ariaLabel={label} />
      </div>
    </div>
  );
}

/** One legend row: the mark (same drawing as the subtitle) plus its name and note. */
function LegendItem({ status, expr, label, meta }: { status: WordStatus; expr?: boolean; label: string; meta: string }) {
  return (
    <div role="listitem" className="grid grid-cols-[12px_minmax(0,1fr)] gap-x-2.5 items-start">
      <span className="h-[18px] flex items-center"><StatusGlyph status={status} expr={expr} /></span>
      <span className="min-w-0">
        <span className={`${tx.label} block truncate`}>{label}</span>
        <span className="block text-[12px] leading-4 text-zinc-500 dark:text-zinc-400 truncate">{meta}</span>
      </span>
    </div>
  );
}
