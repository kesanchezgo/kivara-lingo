/* Demo — how it works: the tour, host access and shortcuts (F8; prototype view). */
import { Play, Rocket, Subtitles, MousePointerClick, Save, LayoutGrid, Mic, Globe } from '../../ui/icons';
import { t } from '../../shared/i18n';
import { richText } from '../../shared/i18n/rich';
import { useShortcuts } from '../../app/hooks/useShortcuts';
import { InfoHint } from '../../app/components/InfoHint';
import { HostPermissionsRow } from '../../app/components/HostPermissionsRow';
import { StepSection } from './StepSection';
import { ShortcutsPreview } from './ShortcutsPreview';

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

      {/* Host access: the repo's real chrome.permissions rows */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 px-0.5">
          <Globe size={13} className="text-zinc-400" />
          <span className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{t('onb.hostTitle')}</span>
          <InfoHint text={t('vipx.permWhatBody')} maxWidth={260} />
        </div>
        <HostPermissionsRow />
      </div>

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
