/* Anki connection — ping + link diagram (F8; prototype view, repo ping/testids). */
import { AlertTriangle, Loader2, Play, Plug, Globe, BookText, PlugZap } from '../../ui/icons';
import type { AnkiMapping } from '../../shared/types';
import { t } from '../../shared/i18n';
import { richText } from '../../shared/i18n/rich';
import { Button } from '../../ui/primitives/settings-primitives';
import { inputLgCls } from '../../ui/primitives/controls';
import { StepSection } from './StepSection';
import { ConnNode, ConnLink } from './Conn';

interface AnkiStepProps {
  mapping: AnkiMapping;
  setMapping: (m: AnkiMapping) => void;
  ping: { status: 'idle' | 'pinging' | 'ok' | 'error'; version?: number; error?: string };
  onRunPing: () => void;
}

export function AnkiStep({ mapping, setMapping, ping, onRunPing }: AnkiStepProps) {
  const state = ping.status; // idle | pinging | ok | error
  const isOk = state === 'ok';
  const isErr = state === 'error';
  const isBusy = state === 'pinging';
  const accent = isOk
    ? 'emerald'
    : isErr
      ? 'rose'
      : isBusy
        ? 'indigo'
        : 'zinc';
  const accentClasses: Record<string, { text: string; bg: string; line: string }> = {
    emerald: { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10', line: 'bg-emerald-400' },
    rose:    { text: 'text-rose-600 dark:text-rose-400',       bg: 'bg-rose-50 dark:bg-rose-500/10',       line: 'bg-rose-400' },
    indigo:  { text: 'text-indigo-600 dark:text-indigo-400',   bg: 'bg-indigo-50 dark:bg-indigo-500/10',   line: 'bg-indigo-400' },
    zinc:    { text: 'text-zinc-500 dark:text-zinc-400',       bg: 'bg-zinc-100 dark:bg-zinc-800',         line: 'bg-zinc-300 dark:bg-zinc-700' },
  };
  const a = accentClasses[accent]!;

  return (
    <StepSection
      icon={<PlugZap size={20} />}
      title={t('onb.ankiConnection')}
      subtitle={t('onb.ankiConnectionDesc')}
    >
      {/* Main piece: connection diagram + URL in one card */}
      <div className="rounded-2xl bg-white dark:bg-white/[0.03] ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.06] shadow-[0_12px_32px_-18px_rgba(16,24,40,.25)] dark:shadow-none overflow-hidden">
        <div className="px-6 pt-7 pb-6 bg-[radial-gradient(80%_100%_at_50%_0%,rgba(99,102,241,.06),transparent)] dark:bg-[radial-gradient(80%_100%_at_50%_0%,rgba(129,140,248,.08),transparent)]">
          <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2">
            <ConnNode icon={<Globe size={22} />} label="Kivara Lingo" sub={t('onb.browserExtension')} tone="indigo" />
            <ConnLink busy={isBusy} ok={isOk} err={isErr} accentLine={a.line} />
            <ConnNode icon={<BookText size={22} />} label="Anki Desktop" sub={t('onb.viaAnkiConnect')} tone="amber" />
          </div>
          <div className="mt-6 flex justify-center">
            <div className={`inline-flex items-center gap-2 h-7 px-3 rounded-full ${a.bg}`}>
              {isOk && (
                <span className="relative flex w-2 h-2">
                  <span className="absolute inset-0 rounded-full bg-emerald-400/50 animate-ping [animation-duration:2s]" />
                  <span className="relative w-2 h-2 rounded-full bg-emerald-500" />
                </span>
              )}
              {isErr && <AlertTriangle size={12} className={a.text} />}
              {isBusy && <Loader2 size={12} className={`${a.text} animate-spin`} />}
              {state === 'idle' && <PlugZap size={12} className={a.text} />}
              <span
                data-testid="onboarding-anki-status"
                data-ping-status={state}
                aria-live="polite"
                className={`text-[12px] font-medium ${a.text}`}
              >
                {isOk ? t('onb.connectedFmt', { v: ping.version ?? '' })
                  : isErr ? (ping.error || t('onb.noResponse'))
                    : isBusy ? t('onb.testingConnection')
                      : t('onb.pendingTest')}
              </span>
            </div>
          </div>
        </div>
        <div className="border-t border-zinc-900/[0.06] dark:border-white/[0.06] px-4 py-3.5">
          <label htmlFor="kivara-onb-anki-url" className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-500 dark:text-zinc-400 mb-2">
            <Plug size={12} /> {t('onb.ankiUrlLabel')}
          </label>
          <div className="flex gap-2">
            <input
              id="kivara-onb-anki-url"
              type="text"
              spellCheck={false}
              autoComplete="off"
              value={mapping.ankiUrl}
              onChange={(e) => setMapping({ ...mapping, ankiUrl: e.target.value })}
              className={`${inputLgCls} flex-1 font-mono`}
            />
            <Button
              variant="primary"
              data-testid="onboarding-anki-ping"
              aria-label={t('onb.probeAction')}
              onClick={onRunPing}
              disabled={isBusy}
              icon={isBusy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              className="h-auto px-3.5 text-[12px] font-semibold"
            >
              {t('onb.probeAction')}
            </Button>
          </div>
        </div>
      </div>

      {/* Help: discreet note, like the Anki notice in the welcome step */}
      <p className="text-center text-[12px] leading-[18px] text-zinc-500 dark:text-zinc-400 px-4 pt-1">
        <AlertTriangle size={13} className="inline-block align-[-2px] mr-1.5 text-zinc-400" />
        <span>
          {richText(t('onb.ankiHelp'), {
            path: <span className="font-medium text-zinc-700 dark:text-zinc-300">{t('onb.ankiConfigPath')}</span>,
            setting: <span className="font-mono text-[11px] px-1.5 py-0.5 rounded-md bg-zinc-900/[0.05] dark:bg-white/[0.07] text-zinc-700 dark:text-zinc-300">webBindAddress</span>,
            value: <span className="font-mono text-[11px] px-1.5 py-0.5 rounded-md bg-zinc-900/[0.05] dark:bg-white/[0.07] text-zinc-700 dark:text-zinc-300">127.0.0.1</span>,
          })}
        </span>
      </p>
    </StepSection>
  );
}
