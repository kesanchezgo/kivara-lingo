/**
 * Point 4 — the track is in another language than the one being learned.
 *
 * Only the FAILED case lands here: Kivara switches the track itself, and this
 * explains the rare player that refuses. The shape is the mock's in-overlay
 * hint (dark pill, indigo glyph, title + body), not a banner of its own.
 */
import type { ReactNode } from 'react';
import { t } from '../../shared/i18n';
import { languageOf } from '../../shared/languages';
import { Subtitles } from '../../ui/icons';

const PLATFORM_NAMES: Record<string, string> = {
  youtube: 'YouTube',
  netflix: 'Netflix',
  disney: 'Disney+',
  hbo: 'Max',
  prime: 'Prime Video',
};

/** Human name for a two-letter code: its endonym, which both locales agree on. */
function languageLabel(code: string): string {
  const info = languageOf((code || '').slice(0, 2).toLowerCase());
  return info?.endonym ?? code;
}

/** The mock's hint pill — shared by every in-overlay notice. */
export function NoticePill({ title, body, tone = 'indigo', children }: {
  title: string;
  body: string;
  tone?: 'indigo' | 'amber';
  children?: ReactNode;
}) {
  const glyph = tone === 'amber'
    ? 'bg-amber-400/[0.14] text-amber-300'
    : 'bg-indigo-400/[0.14] text-indigo-300';
  return (
    <div className="flex items-center gap-2.5 bg-zinc-900/90 backdrop-blur-md ring-1 ring-white/[0.08] rounded-xl pl-1.5 pr-3 py-1.5 shadow-[0_12px_32px_-8px_rgba(0,0,0,.5)] pointer-events-none max-w-full">
      <span className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center ${glyph}`}>
        {children ?? <Subtitles size={14} />}
      </span>
      <span className="min-w-0 flex flex-col">
        <span className="text-[12.5px] font-medium text-white leading-tight">{title}</span>
        <span className="text-[11.5px] text-zinc-400 leading-tight">{body}</span>
      </span>
    </div>
  );
}

export interface LanguageMismatchProps {
  /** Language the cues are actually in (`es`). */
  track: string;
  /** `translate.sourceLang`: the language being learned (`en`). */
  learning: string;
  /** Source platform tag, for the "couldn't switch it in X" half. */
  platform?: string;
}

export function LanguageMismatchNotice({ track, learning, platform }: LanguageMismatchProps) {
  const name = (platform && PLATFORM_NAMES[platform]) || '';
  const vars = { track: languageLabel(track), learning: languageLabel(learning), platform: name };
  return (
    <div data-kvl-lang-mismatch aria-live="polite" className="max-w-full">
      <NoticePill
        title={t('rail.langMismatchTitle', vars)}
        body={name ? t('rail.langMismatch', vars) : t('rail.langMismatchGeneric', vars)}
      />
    </div>
  );
}
