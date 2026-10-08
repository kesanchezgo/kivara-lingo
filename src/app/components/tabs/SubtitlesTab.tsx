import React, { useState } from 'react';
import { t } from '../../../shared/i18n';
import { SubtitleStyles } from '../../types';
import {
  Type, Palette, AlignVerticalSpaceBetween, RotateCcw, AlignLeft, ChevronDown,
} from 'lucide-react';
import { InfoHint } from '../InfoHint';

const DEFAULT_STYLES: SubtitleStyles = {
  fontSize: 32,
  color: '#FCD34D',
  backgroundColor: '#000000',
  backgroundOpacity: 60,
  position: 'bottom',
  verticalOffset: 85,
  fontWeight: 'bold',
  textShadow: 80,
  keepNativeLineBreaks: false,
  keepNativeAlignment: false,
  hoverOpacity: 80,
  hoverBlur: true,
};

interface SubtitlesTabProps {
  styles: SubtitleStyles;
  setStyles: (styles: SubtitleStyles) => void;
}

export function SubtitlesTab({ styles, setStyles }: SubtitlesTabProps) {
  const [nativeFormatOpen, setNativeFormatOpen] = useState(false);

  const updateStyle = (key: keyof SubtitleStyles, value: any) => {
    setStyles({ ...styles, [key]: value });
  };

  // Per-row reset hook — only emits a callback when the value differs from
  // the documented default, so the icon can hide itself otherwise.
  const resetOf = <K extends keyof SubtitleStyles>(key: K): (() => void) | undefined =>
    styles[key] !== DEFAULT_STYLES[key]
      ? () => updateStyle(key, DEFAULT_STYLES[key])
      : undefined;

  const isDefault =
    styles.fontSize === DEFAULT_STYLES.fontSize &&
    styles.color === DEFAULT_STYLES.color &&
    styles.backgroundColor === DEFAULT_STYLES.backgroundColor &&
    styles.backgroundOpacity === DEFAULT_STYLES.backgroundOpacity &&
    styles.position === DEFAULT_STYLES.position &&
    styles.verticalOffset === DEFAULT_STYLES.verticalOffset &&
    styles.fontWeight === DEFAULT_STYLES.fontWeight &&
    styles.textShadow === DEFAULT_STYLES.textShadow &&
    styles.keepNativeLineBreaks === DEFAULT_STYLES.keepNativeLineBreaks &&
    styles.keepNativeAlignment === DEFAULT_STYLES.keepNativeAlignment &&
    styles.hoverOpacity === DEFAULT_STYLES.hoverOpacity &&
    styles.hoverBlur === DEFAULT_STYLES.hoverBlur;

  return (
    <div className="flex flex-col h-full min-h-0 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-y-auto">
      <div className="p-3 pb-6 space-y-3">

        {/* Header bar with global reset */}
        <div className="flex items-center justify-between px-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
            {t('subs.styleTitle')}</span>
          <button
            onClick={() => setStyles(DEFAULT_STYLES)}
            disabled={isDefault}
            className={`group flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md border transition-all ${
              isDefault
                ? 'border-zinc-200 dark:border-zinc-800 text-zinc-400 dark:text-zinc-600 cursor-not-allowed'
                : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-indigo-300 dark:hover:border-indigo-500/50 hover:text-indigo-600 dark:hover:text-indigo-300 hover:bg-indigo-50/50 dark:hover:bg-indigo-500/10'
            }`}
            title={t('subs.resetAllTitle')}
          >
            <RotateCcw size={10} className="transition-transform duration-500 group-hover:-rotate-180" />
            Restablecer
          </button>
        </div>

        {/* Tipografía */}
        <Section icon={<Type size={10} />} title={t('subs.typography')}>
          <Row label={t('subs.size')} value={`${styles.fontSize}px`} onReset={resetOf('fontSize')}>
            <input
              type="range"
              min="16" max="64"
              value={styles.fontSize}
              onChange={(e) => updateStyle('fontSize', parseInt(e.target.value))}
              className="sl-range w-full"
            />
          </Row>

          <Row label="Color" onReset={resetOf('color')}>
            <div className="flex gap-1.5">
              {['#FFFFFF', '#FCD34D', '#A7F3D0', '#FECACA', '#E9D5FF'].map((color) => {
                const selected = styles.color === color;
                return (
                  <button
                    key={color}
                    onClick={() => updateStyle('color', color)}
                    style={{
                      width: 24, height: 24, borderRadius: '50%',
                      border: `2px solid ${selected ? '#818cf8' : '#3f3f46'}`,
                      backgroundColor: color,
                      transform: selected ? 'scale(1.1)' : 'scale(1)',
                      transition: 'transform 150ms, border-color 150ms',
                      outline: 'none', cursor: 'pointer', padding: 0,
                    }}
                    aria-label={`Color ${color}`}
                    title={color}
                  />
                );
              })}
            </div>
          </Row>

          <Row label="Peso" onReset={resetOf('fontWeight')}>
            <SegmentedControl
              options={[{ v: 'normal', l: 'Normal' }, { v: 'bold', l: 'Bold' }, { v: '900', l: 'Black' }]}
              value={styles.fontWeight}
              onChange={(v) => updateStyle('fontWeight', v)}
            />
          </Row>

          <Row label="Sombra" value={styles.textShadow > 0 ? `${styles.textShadow}%` : 'Off'} onReset={resetOf('textShadow')}>
            <input
              type="range"
              min={0} max={100} step={5}
              value={styles.textShadow}
              onChange={(e) => updateStyle('textShadow', parseInt(e.target.value))}
              className="sl-range w-full"
            />
          </Row>
        </Section>

        {/* Fondo */}
        <Section icon={<Palette size={10} />} title="Fondo">
          <Row label="Color" onReset={resetOf('backgroundColor')}>
            <div className="flex gap-1.5">
              {['#000000', '#18181B', '#1E3A8A', '#831843'].map((color) => {
                const selected = styles.backgroundColor === color;
                return (
                  <button
                    key={color}
                    onClick={() => updateStyle('backgroundColor', color)}
                    style={{
                      width: 24, height: 24, borderRadius: '50%',
                      border: `2px solid ${selected ? '#818cf8' : '#3f3f46'}`,
                      backgroundColor: color,
                      transform: selected ? 'scale(1.1)' : 'scale(1)',
                      transition: 'transform 150ms, border-color 150ms',
                      outline: 'none', cursor: 'pointer', padding: 0,
                    }}
                    aria-label={`Fondo ${color}`}
                    title={color}
                  />
                );
              })}
            </div>
          </Row>

          <Row label="Opacidad" value={`${styles.backgroundOpacity}%`} onReset={resetOf('backgroundOpacity')}>
            <input
              type="range"
              min="0" max="100"
              value={styles.backgroundOpacity}
              onChange={(e) => updateStyle('backgroundOpacity', parseInt(e.target.value))}
              className="sl-range w-full"
            />
          </Row>

          <Row label="Opacidad en hover" value={`${styles.hoverOpacity}%`} onReset={resetOf('hoverOpacity')}>
            <input
              type="range"
              min="0" max="100"
              value={styles.hoverOpacity}
              onChange={(e) => updateStyle('hoverOpacity', parseInt(e.target.value))}
              className="sl-range w-full"
            />
          </Row>

          <ToggleRow
            label="Difuminar fondo en hover"
            checked={styles.hoverBlur}
            onChange={(v) => updateStyle('hoverBlur', v)}
            onReset={resetOf('hoverBlur')}
          />
        </Section>

        {/* Posición */}
        <Section icon={<AlignVerticalSpaceBetween size={10} />} title={t('subs.position')}>
          <Row label="Preset" onReset={resetOf('position')}>
            <SegmentedControl
              options={[
                { v: 'top', l: 'Arriba' },
                { v: 'middle', l: 'Medio' },
                { v: 'bottom', l: 'Abajo' },
              ]}
              value={styles.position}
              onChange={(v) => {
                const offset = v === 'top' ? 15 : v === 'middle' ? 50 : 85;
                setStyles({ ...styles, position: v, verticalOffset: offset });
              }}
            />
          </Row>
          <Row label="Altura" value={`${styles.verticalOffset ?? 85}%`} onReset={resetOf('verticalOffset')}>
            <div className="relative">
              <input
                type="range"
                min={5} max={95} step={1}
                value={styles.verticalOffset ?? 85}
                onChange={(e) => {
                  const offset = parseInt(e.target.value);
                  const preset: SubtitleStyles['position'] =
                    offset <= 25 ? 'top' : offset >= 75 ? 'bottom' : 'middle';
                  setStyles({ ...styles, verticalOffset: offset, position: preset });
                }}
                className="sl-range w-full relative z-10"
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
              <div className="flex justify-between text-[9px] text-zinc-400 dark:text-zinc-500 mt-0.5 px-0.5">
                <span>Arriba</span><span>Medio</span><span>Abajo</span>
              </div>
            </div>
          </Row>
        </Section>

        {/* Formato nativo — collapsible (the mock now hides this rare-use
            toggle behind a chevron so the tab feels lighter). */}
        <Section
          icon={<AlignLeft size={10} />}
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
        </Section>
      </div>
    </div>
  );
}

/* ---------- shared (matches CardsTab/SettingsTab look) ---------- */

function Section({
  icon, title, children, collapsible, open, onToggle, hint,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
  hint?: React.ReactNode;
}) {
  const header = (
    <div className="flex items-center justify-between gap-1.5 px-2.5 py-1.5 bg-zinc-50/60 dark:bg-zinc-900/60 border-b border-zinc-100 dark:border-zinc-800/60 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
      <span className="flex items-center gap-1.5">
        {icon}{title}
        {hint && <InfoHint text={hint} />}
      </span>
      {collapsible && (
        <ChevronDown
          size={12}
          className={`text-zinc-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      )}
    </div>
  );

  if (collapsible) {
    return (
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <button
          onClick={onToggle}
          className="w-full text-left hover:bg-zinc-100/40 dark:hover:bg-zinc-800/40 transition-colors"
        >
          {header}
        </button>
        <div
          style={{
            display: 'grid',
            gridTemplateRows: open ? '1fr' : '0fr',
            transition: 'grid-template-rows 220ms ease',
          }}
        >
          <div className="overflow-hidden">
            <div className="p-2.5 space-y-2.5">{children}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      {header}
      <div className="p-2.5 space-y-2.5">{children}</div>
    </div>
  );
}

function Row({
  label, value, children, onReset,
}: {
  label: string;
  value?: string;
  children: React.ReactNode;
  onReset?: () => void;
}) {
  return (
    <div className="space-y-1 group/row">
      <div className="flex items-center justify-between gap-1.5">
        <label className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">{label}</label>
        <div className="flex items-center gap-1">
          {onReset && (
            <button
              onClick={onReset}
              title={t('subs.resetValueTitle')}
              className="opacity-0 group-hover/row:opacity-100 focus:opacity-100 transition-opacity p-0.5 rounded text-zinc-400 dark:text-zinc-500 hover:text-indigo-600 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/10"
              type="button"
            >
              <RotateCcw size={10} />
            </button>
          )}
          {value && (
            <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
              {value}
            </span>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

function ToggleRow({
  label, checked, onChange, onReset,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  onReset?: () => void;
}) {
  const ref = React.useRef<HTMLButtonElement>(null);
  const [isDark, setIsDark] = React.useState(false);
  React.useEffect(() => {
    if (ref.current) setIsDark(!!ref.current.closest('.dark'));
  }, []);
  const bgOn = isDark ? '#6366f1' : '#4f46e5';
  const bgOff = isDark ? '#3f3f46' : '#d4d4d8';

  return (
    <div className="flex items-center justify-between gap-3 group/row">
      <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
      <div className="flex items-center gap-1">
        {onReset && (
          <button
            onClick={onReset}
            title={t('subs.resetValueTitle')}
            className="opacity-0 group-hover/row:opacity-100 focus:opacity-100 transition-opacity p-0.5 rounded text-zinc-400 dark:text-zinc-500 hover:text-indigo-600 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/10"
            type="button"
          >
            <RotateCcw size={10} />
          </button>
        )}
        <button
          ref={ref}
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          style={{
            position: 'relative', flexShrink: 0, width: 34, height: 19,
            borderRadius: 9999, backgroundColor: checked ? bgOn : bgOff,
            border: 'none', cursor: 'pointer', padding: 0, transition: 'background-color 150ms',
          }}
        >
          <span style={{
            position: 'absolute', top: 2, left: 2, width: 15, height: 15,
            borderRadius: 9999, backgroundColor: '#fff',
            boxShadow: '0 1px 2px rgba(0,0,0,0.2)', transition: 'transform 200ms',
            transform: checked ? 'translateX(15px)' : 'translateX(0)',
          }} />
        </button>
      </div>
    </div>
  );
}

function SegmentedControl<T extends string>({
  options, value, onChange,
}: {
  options: { v: T; l: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex bg-zinc-100 dark:bg-zinc-800/70 rounded-md p-0.5">
      {options.map((opt) => (
        <button
          key={opt.v}
          onClick={() => onChange(opt.v)}
          className={`flex-1 text-[11px] font-medium px-2 py-1 rounded transition-all ${
            value === opt.v
              ? 'bg-white dark:bg-zinc-700 text-indigo-600 dark:text-indigo-300 shadow-sm'
              : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
          }`}
        >
          {opt.l}
        </button>
      ))}
    </div>
  );
}
