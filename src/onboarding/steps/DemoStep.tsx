/* Demo — how it works: the tour, host access and shortcuts (F8; prototype view). */
import { useState } from 'react';
import { Play, Rocket, Subtitles, MousePointerClick, Save, LayoutGrid, Mic, Globe, CheckCircle2, Loader2 } from '../../ui/icons';
import { t } from '../../shared/i18n';
import { richText } from '../../shared/i18n/rich';
import { useShortcuts } from '../../app/hooks/useShortcuts';
import { InfoHint } from '../../app/components/InfoHint';
import { HostPermissionsRow, HOST_GROUPS, isGroupComplete, originsFor, useGrantedOrigins } from '../../app/components/HostPermissionsRow';
import { requestHosts } from '../../shared/host-permissions';
import { StepSection } from './StepSection';
import { ShortcutsPreview } from './ShortcutsPreview';

/**
 * "Permitir todo" — one click, one Chrome dialog. The card owns the missing
 * count and the gesture; the rows below keep the per-group state so a user
 * who wants only DeepL can still grant that group alone.
 */
export function HostAccessCard() {
  const granted = useGrantedOrigins();
  const [busy, setBusy] = useState(false);
  const missing = HOST_GROUPS.filter((g) => !isGroupComplete(g, granted));
  const done = missing.length === 0;

  const allowAll = async () => {
    // `requestHosts` fires `chrome.permissions.request` synchronously in the
    // click's task, so every missing origin rides ONE prompt instead of one
    // dialog per group.
    setBusy(true);
    try {
      await requestHosts(missing.flatMap((g) => originsFor(g.providers)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl bg-white dark:bg-white/[0.03] ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.06] shadow-[0_1px_2px_rgba(16,24,40,.04)] dark:shadow-none p-4 flex items-center gap-3">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${done ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300' : 'bg-indigo-500/[0.08] dark:bg-indigo-400/[0.12] text-indigo-600 dark:text-indigo-300'}`}>
        {done ? <CheckCircle2 size={16} /> : <Globe size={16} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
          {t('onb.hostTitle')}
          <InfoHint text={t('vipx.permWhatBody')} maxWidth={260} />
        </p>
        <p className="text-[12px] text-zinc-500 dark:text-zinc-400 mt-0.5">
          {done
            ? t('onb.hostDone')
            : missing.length === 1
              ? t('onb.hostDescOne')
              : t('onb.hostDesc', { n: missing.length })}
        </p>
      </div>
      {!done && (
        <button
          type="button"
          data-testid="onb-host-allow-all"
          disabled={busy}
          onClick={() => void allowAll()}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-indigo-600 text-white text-[12px] font-semibold hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-default transition-colors"
        >
          {busy && <Loader2 size={12} className="animate-spin" />}
          {t('onb.hostAllow')}
        </button>
      )}
    </div>
  );
}

export function DemoStep() {
  const { map } = useShortcuts();
  const items = [
    { icon: <Subtitles size={16} />, text: t('onb.styledSubs') },
    { icon: <MousePointerClick size={16} />, text: t('onb.hoverPopover') },
    { icon: <Save size={16} />, text: t('onb.saveToAnkiHint') },
    { icon: <LayoutGrid size={16} />, text: t('onb.sidePanelReady') },
  ];
  const tileCls = 'bg-indigo-500/[0.08] dark:bg-indigo-400/[0.12] text-indigo-600 dark:text-indigo-300';
  const saveCombo = map.save ?? '';

  return (
    <StepSection
      icon={<Play size={20} />}
      title={t('onb.allSetToTry')}
      subtitle={t('onb.allSetToTryDescProto')}
    >
      {/* Main piece: what happens when Start is pressed */}
      <div className="rounded-2xl bg-white dark:bg-white/[0.03] ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.06] shadow-[0_12px_32px_-18px_rgba(16,24,40,.25)] dark:shadow-none px-5 py-5">
        <p className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-500 dark:text-zinc-400 mb-4">
          <Rocket size={12} className="text-indigo-500 dark:text-indigo-400" /> {t('onb.whatYouSee')}
        </p>
        <ol className="relative">
          <span aria-hidden className="absolute left-4 top-4 bottom-4 w-px bg-zinc-900/[0.08] dark:bg-white/[0.08]" />
          {items.map((item, i) => (
            <li key={i} className="relative flex items-center gap-3 py-2">
              <div className="relative rounded-lg bg-white dark:bg-zinc-950 shrink-0">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${tileCls}`}>
                  {item.icon}
                </div>
              </div>
              <p className="flex-1 text-[13px] text-zinc-700 dark:text-zinc-300 leading-[19px]">{item.text}</p>
              <span className="text-[11px] font-mono text-zinc-300 dark:text-zinc-600 tabular-nums">0{i + 1}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Host access: the allow-all card plus the repo's real chrome.permissions rows */}
      <HostAccessCard />
      <HostPermissionsRow showGrantAll={false} />

      <ShortcutsPreview />

      <p className="text-center text-[12px] leading-[18px] text-zinc-500 dark:text-zinc-400 px-6 pt-1">
        <Mic size={13} className="inline-block align-[-2px] mr-1.5 text-zinc-400" />
        <span>
          {richText(
            saveCombo ? t('onb.enableCapture', { combo: saveCombo }) : t('onb.enableCaptureNoKey'),
            { action: <span className="font-medium text-zinc-700 dark:text-zinc-300">{t('popup.capture.off')}</span> },
          )}
        </span>
      </p>
    </StepSection>
  );
}
