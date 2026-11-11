/**
 * "Explain sentence" card (docs/REDESIGN-V2.md §5.1, §7 F6/F7).
 *
 * Ported from the prototype's `player/SentenceExplain.tsx`. The view is
 * complete; the request is the F7 `AiPort` (`AI_EXPLAIN_SENTENCE`). The
 * transcript rail only renders the ✦ action when `aiConfigured(store.ai)` —
 * so an unconfigured extension never shows a button that can only fail.
 *
 * The card explains, it never saves: cards are created from the subtitle or
 * with the + of the line, exactly as in the prototype.
 */
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Sparkles, X } from '../../ui/icons';
import { t } from '../../shared/i18n';
import { Badge, surface, tx } from '../../ui/primitives/settings-primitives';
import type { AiPort } from '../../ui/ports/ai';
import type { SentenceExplanation } from '../../ui/ports/types';
import type { SubtitleCue } from '../platform-adapters/types';

const CHIP =
  'text-[11px] leading-none text-zinc-600 dark:text-zinc-300 bg-zinc-900/[0.06] dark:bg-white/[0.06] ring-1 ring-zinc-900/[0.08] dark:ring-white/[0.08] h-5 inline-flex items-center px-1.5 rounded-md whitespace-nowrap';
/** IPA between slashes: monospaced, same pill as the word card's phonetics. */
const IPA = `${CHIP} font-mono`;
const SAY = `${CHIP} font-medium`;
const TERM = 'font-medium text-zinc-800 dark:text-zinc-100';
const SECTION = 'px-3.5 py-2.5 border-t border-zinc-900/[0.06] dark:border-white/[0.06]';

/**
 * Quoted fragments and bare IPA are highlighted. A slash glued to a word
 * ("solo/a") is not IPA.
 */
const RICH = /«[^»]+»|“[^”]+”|\/[^/\s]+\//g;
function rich(text: string): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(RICH)) {
    const token = match[0];
    const at = match.index ?? 0;
    if (token.startsWith('/')) {
      const before = text[at - 1];
      const after = text[at + token.length];
      if (
        (before !== undefined && !/[\s(]/.test(before)) ||
        (after !== undefined && !/[\s.,;:)]/.test(after))
      ) {
        continue;
      }
    }
    if (at > last) out.push(text.slice(last, at));
    out.push(
      token.startsWith('/') ? (
        <span key={at} className={`${IPA} !h-[18px] mx-px align-[1px]`}>
          {token}
        </span>
      ) : (
        <Fragment key={at}>
          {token[0]}
          <span className={TERM}>{token.slice(1, -1)}</span>
          {token[token.length - 1]}
        </Fragment>
      ),
    );
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const soundChips = (sounds: string) =>
  sounds.split(' · ').map((part) => (
    <span key={part} className={part.startsWith('/') ? IPA : SAY}>
      {part}
    </span>
  ));

export interface SentenceExplainProps {
  id: string;
  cue: SubtitleCue;
  /** Neighbouring lines, for disambiguation only. */
  prev?: string;
  next?: string;
  lang: string;
  uiLang: string;
  nativeLang: string;
  ai: AiPort;
  onClose: () => void;
  /** Content (and final height) ready: the transcript scrolls it into view. */
  onReady?: () => void;
}

type ExplainState =
  | { status: 'loading' }
  | { status: 'ready'; data: SentenceExplanation }
  | { status: 'error' };

export function SentenceExplain({
  id,
  cue,
  prev,
  next,
  lang,
  uiLang,
  nativeLang,
  ai,
  onClose,
  onReady,
}: SentenceExplainProps) {
  const [state, setState] = useState<ExplainState>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    ai
      .explainSentence({ prev, line: cue.text, next, lang, uiLang, nativeLang })
      .then((data) => {
        if (alive) setState({ status: 'ready', data });
      })
      .catch(() => {
        if (alive) setState({ status: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [ai, cue.text, lang, nativeLang, next, prev, uiLang]);

  useEffect(() => {
    if (state.status === 'ready') requestAnimationFrame(() => onReady?.());
  }, [state.status, onReady]);

  return (
    <div
      id={id}
      role="region"
      aria-label={t('explain.title')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
      className={`${surface.group} mt-1 mb-2 ml-[62px] mr-1 overflow-hidden kvl-animate-fade-up`}
    >
      <div className="flex items-center justify-between gap-2 pl-3.5 pr-2 h-9">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-zinc-800 dark:text-zinc-100">
          <Sparkles size={13} className="text-fuchsia-500 dark:text-fuchsia-400" />
          {t('explain.title')}
          <Badge tone="fuchsia" className="!h-4 !px-1 text-[10px]">
            {t('explain.badge')}
          </Badge>
        </span>
        <button
          type="button"
          onClick={onClose}
          title={t('explain.close')}
          aria-label={t('explain.close')}
          className="w-6 h-6 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-900/[0.06] dark:hover:bg-white/10 kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
        >
          <X size={12} weight="bold" />
        </button>
      </div>

      {state.status === 'loading' && (
        <div aria-busy="true" className="px-3.5 pb-3 space-y-2">
          <span className="sr-only" aria-live="polite">
            {t('explain.loading')}
          </span>
          <div className="border-l-2 border-fuchsia-300/40 dark:border-fuchsia-700/40 pl-2.5 space-y-1.5">
            <div className="h-3 w-11/12 rounded bg-zinc-900/[0.06] dark:bg-white/[0.07] animate-pulse" />
            <div className="h-3 w-3/5 rounded bg-zinc-900/[0.06] dark:bg-white/[0.07] animate-pulse" />
          </div>
          <div className="h-2.5 w-4/5 rounded bg-zinc-900/[0.05] dark:bg-white/[0.06] animate-pulse" />
          <div className="h-2.5 w-2/3 rounded bg-zinc-900/[0.05] dark:bg-white/[0.06] animate-pulse" />
        </div>
      )}

      {state.status === 'error' && (
        <p role="alert" className="px-3.5 pb-3 text-[12px] leading-[18px] text-zinc-500 dark:text-zinc-400">
          {t('explain.error')}
        </p>
      )}

      {state.status === 'ready' && (
        <dl aria-live="polite">
          <div className="px-3.5 pb-3">
            <dt className="sr-only">{t('explain.meaning')}</dt>
            <dd className="border-l-2 border-fuchsia-300/70 dark:border-fuchsia-700/60 pl-2.5 text-[13px] leading-[19px] text-zinc-800 dark:text-zinc-100">
              {state.data.meaning}
            </dd>
          </div>

          {state.data.grammar && (
            <div className={SECTION}>
              <dt className={tx.meta}>{t('explain.grammar')}</dt>
              <dd className="mt-1 text-[12px] leading-[18px] text-zinc-600 dark:text-zinc-400">
                {rich(state.data.grammar)}
              </dd>
            </div>
          )}

          {state.data.expressions.length > 0 && (
            <div className={SECTION}>
              <dt className={tx.meta}>{t('explain.expressions')}</dt>
              <dd className="mt-1.5 grid grid-cols-[fit-content(48%)_1fr] gap-x-3 gap-y-1.5 text-[12px] leading-[17px]">
                {state.data.expressions.map((expression) => (
                  <Fragment key={expression.text}>
                    <span lang={lang} className={TERM}>
                      {expression.text}
                    </span>
                    <span className="text-zinc-500 dark:text-zinc-400">{expression.gloss}</span>
                  </Fragment>
                ))}
              </dd>
            </div>
          )}

          {state.data.sound.length > 0 && (
            <div className={SECTION}>
              <dt className={tx.meta}>{t('explain.sound')}</dt>
              <dd className="mt-1.5 grid grid-cols-[fit-content(48%)_1fr] gap-x-3 gap-y-2 text-[12px] leading-[17px]">
                {state.data.sound.map((sound) => (
                  <Fragment key={sound.phrase}>
                    <span lang={lang} className={`${TERM} leading-5`}>
                      {sound.phrase}
                    </span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap gap-1">{soundChips(sound.sounds)}</span>
                      {sound.note && (
                        <span className="block mt-1 text-zinc-500 dark:text-zinc-400">
                          {rich(sound.note)}
                        </span>
                      )}
                    </span>
                  </Fragment>
                ))}
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
