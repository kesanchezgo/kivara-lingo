import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { t } from '../../../shared/i18n';
import { WHISPER_BUILD } from '../../../shared/whisper-flag';
import { useKivaraStore } from '../../../shared/store';
import type { AsrSettings } from '../../../shared/types';
import { WHISPER_MODEL_PRESETS, type WhisperModelKey } from '../../../shared/whisper-presets';
import { InfoHint } from '../InfoHint';

function sectionId(title: string, id?: string): string {
  return id ?? `kivara-section-${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
}

export function Accordion({
  icon, title, summary, summaryColor, open, onToggle, children, noPadding, description, id,
}: {
  icon: React.ReactNode;
  title: string;
  summary?: string;
  summaryColor?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  noPadding?: boolean;
  /** Stable DOM id so a deep link (OPEN_SETTINGS) can open AND scroll to it. */
  id?: string;
  /**
   * Optional one-liner shown as an InfoHint next to the section title.
   * Mirrors the design mock pattern: we standardize "what is this & when
   * to use it" instead of leaving users to guess.
   */
  description?: React.ReactNode;
}) {
  return (
    <div id={id} className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <button
        id={`${sectionId(title, id)}-button`}
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`${sectionId(title, id)}-panel`}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-2 bg-zinc-50/60 dark:bg-zinc-900/60 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/40 transition-colors"
      >
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {icon}{title}
          {description && <InfoHint text={description} />}
        </span>
        <span className="flex items-center gap-2 ml-auto shrink-0">
          {summary && !open && (
            <span className={`text-[10px] font-medium normal-case tracking-normal ${summaryColor ?? 'text-zinc-400 dark:text-zinc-500'}`}>
              {summary}
            </span>
          )}
          <ChevronDown size={12} className={`text-zinc-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      <div
        id={`${sectionId(title, id)}-panel`}
        role="region"
        aria-labelledby={`${sectionId(title, id)}-button`}
        // A collapsed accordion must not be keyboard-reachable: the grid hides
        // it visually but its controls stay tabbable, so a closed section's
        // inputs and selects remain in the page's tab order while invisible to
        // sighted users. Inert keeps the CSS transition (an unmount would
        // jump) and disappears on an open panel. Spread because this React
        // version's div types do not know the `inert` prop yet.
        {...({ inert: open ? undefined : true } as { inert?: boolean })}
        style={{
          display: 'grid',
          gridTemplateRows: open ? '1fr' : '0fr',
          transition: 'grid-template-rows 220ms ease',
        }}
      >
        <div className="overflow-hidden">
          <div className={noPadding ? '' : 'p-2.5 space-y-2 border-t border-zinc-100 dark:border-zinc-800/60'}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── NestedAccordion ────────────────────────────────────────────────── */

export function NestedAccordion({
  title, open, onToggle, children,
}: {
  title: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-800/80 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 bg-zinc-50/50 dark:bg-zinc-800/30 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/60 transition-colors"
      >
        <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">{title}</span>
        <ChevronRight size={11} className={`text-zinc-400 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>
      <div
        style={{
          display: 'grid',
          gridTemplateRows: open ? '1fr' : '0fr',
          transition: 'grid-template-rows 200ms ease',
        }}
      >
        <div className="overflow-hidden">
          <div className="p-2 space-y-2 border-t border-zinc-100 dark:border-zinc-800/60">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export function WhisperAsrSection() {
  if (!WHISPER_BUILD) {
    // Compile-time off, on purpose: see shared/whisper-flag.ts. The glue cannot
    // load under MV3's CSP, so the whole section was a form that could only
    // fail later; the code behind it stays for when it is packaged.
    return (
      <p className="text-[10.5px] leading-snug text-zinc-500 dark:text-zinc-400 px-2 py-1.5">
        ASR local no disponible en esta compilación: Whisper necesita empaquetar
        su glue y su WASM dentro de la extensión (la CSP de MV3 no permite
        cargar el glue desde una URL remota).
      </p>
    );
  }
  const asr = useKivaraStore((s) => s.asr);
  const setAsr = (next: Partial<AsrSettings>) =>
    useKivaraStore.setState((s) => ({ asr: { ...s.asr, ...next } }));
  // Safe as written because `WHISPER_BUILD` is a compile-time constant: this
  // return is a stable branch, so the hook order is identical on every mount
  // of a given build and only the compiled-out build leaves them unused.
  return (
    <>
      <Row label="Habilitar Whisper ASR">
        <Toggle on={asr.enabled} onChange={(v) => setAsr({ enabled: v })} />
      </Row>
      {asr.enabled && (
        <>
          <Row label="Modelo">
            <select
              value={asr.model}
              onChange={(e) => {
                const next = e.target.value as WhisperModelKey;
                setAsr({
                  model: next,
                  modelUrl: WHISPER_MODEL_PRESETS[next].url,
                });
              }}
              className="sl-select w-full"
            >
              {(Object.entries(WHISPER_MODEL_PRESETS) as Array<[
                WhisperModelKey,
                (typeof WHISPER_MODEL_PRESETS)[WhisperModelKey],
              ]>).map(([key, preset]) => (
                <option key={key} value={key}>{preset.label}</option>
              ))}
            </select>
          </Row>
          <Row label="Glue URL (whisper.js)">
            <input
              type="text"
              value={asr.glueUrl ?? ''}
              onChange={(e) => setAsr({ glueUrl: e.target.value.trim() || undefined })}
              placeholder="https://tu-cdn.com/whisper.js"
              className="sl-input sl-mono w-full"
            />
          </Row>
          <WhisperModelUrlRow setAsr={setAsr} asr={asr} />
        </>
      )}
    </>
  );
}

function WhisperModelUrlRow({
  asr,
  setAsr,
}: {
  asr: AsrSettings;
  setAsr: (next: Partial<AsrSettings>) => void;
}) {
  return (
    <Row label="Modelo URL (override)">
      <input
        type="text"
        value={asr.modelUrl ?? ''}
        onChange={(e) => setAsr({ modelUrl: e.target.value.trim() || undefined })}
        placeholder={WHISPER_MODEL_PRESETS[asr.model].url}
        className="sl-input sl-mono w-full"
      />
    </Row>
  );
}

export function QuickRow({
  label, hint, info, children,
}: {
  label: string; hint?: string; info?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-2.5 py-2 gap-2">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
        {info && <InfoHint text={info} />}
        {hint && <span className="text-[10px] text-zinc-400 dark:text-zinc-600 font-mono">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/* ─── Row ────────────────────────────────────────────────────────────── */

export function Row({
  label, value, children, hint,
}: {
  label: React.ReactNode;
  value?: string;
  children: React.ReactNode;
  /** Optional contextual help shown as an InfoHint next to the label. */
  hint?: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
          <span>{label}</span>
          {hint && <InfoHint text={hint} />}
        </label>
        {value && (
          <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
            {value}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/* ─── SegmentedControl ───────────────────────────────────────────────── */

export function SegmentedControl<T extends string>({
  options, value, onChange,
}: {
  options: { v: T; l: string }[]; value: T; onChange: (v: T) => void;
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

/* ─── Toggle ─────────────────────────────────────────────────────────── */

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  const ref = React.useRef<HTMLButtonElement>(null);
  const [isDark, setIsDark] = React.useState(false);
  React.useEffect(() => {
    if (ref.current) setIsDark(!!ref.current.closest('.dark'));
  }, []);
  const bgOn = isDark ? '#6366f1' : '#4f46e5';
  const bgOff = isDark ? '#3f3f46' : '#d4d4d8';
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onChange(!on)}
      style={{
        position: 'relative', flexShrink: 0, width: 34, height: 19,
        borderRadius: 9999, backgroundColor: on ? bgOn : bgOff,
        transition: 'background-color 150ms', border: 'none', cursor: 'pointer', padding: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: 2, width: 15, height: 15,
        borderRadius: 9999, backgroundColor: '#fff',
        boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        transition: 'transform 200ms',
        transform: on ? 'translateX(15px)' : 'translateX(0)',
      }} />
    </button>
  );
}

/* ─── CompactSlider ──────────────────────────────────────────────────── */

export function CompactSlider({
  label, defaultValue, max, unit,
}: {
  label: string; defaultValue: number; max: number; unit: string;
}) {
  const [v, setV] = useState(defaultValue);
  return (
    <Row label={label} value={`${v}${unit}`}>
      <input
        type="range" min={0} max={max} step={50} value={v}
        onChange={(e) => setV(Number(e.target.value))}
        className="sl-range w-full"
      />
    </Row>
  );
}

/* ─── DonateBtn ──────────────────────────────────────────────────────── */

export function DonateBtn({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="p-1.5 rounded-md text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50/60 dark:hover:bg-indigo-500/10 transition-colors"
      title={t('common.donateVia', { label })}
      aria-label={t('common.donateVia', { label })}
    >
      {icon}
    </a>
  );
}

export function PaypalIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944.901C5.026.382 5.474 0 5.998 0h7.46c2.57 0 4.578.543 5.69 1.81 1.01 1.15 1.304 2.42 1.012 4.287-.023.143-.047.288-.077.437-.983 5.05-4.349 6.797-8.647 6.797h-2.19c-.524 0-.968.382-1.05.9l-1.12 7.106zm14.146-14.42a3.35 3.35 0 0 0-.607-.541c-.013.076-.026.175-.041.254-.93 4.778-4.005 7.201-9.138 7.201h-2.19a.563.563 0 0 0-.556.479l-1.187 7.527h-.506l-.24 1.516a.56.56 0 0 0 .554.647h3.882c.46 0 .85-.334.922-.788l.038-.197.732-4.643.047-.255a.929.929 0 0 1 .922-.787h.58c3.76 0 6.705-1.528 7.565-5.946.36-1.847.174-3.388-.777-4.467z"/>
    </svg>
  );
}
