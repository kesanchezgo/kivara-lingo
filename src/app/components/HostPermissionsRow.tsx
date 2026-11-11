import React, { useSyncExternalStore, useState } from 'react';
import { t } from '../../shared/i18n';
import { sendMessage } from 'webext-bridge/content-script';
import { KeyRound, ShieldCheck, Loader2 } from '../../ui/icons';
import { subscribeHostPermissions, getGrantedOrigins, refreshHostPermissions, hasOrigin } from '../../shared/host-permissions-store';
import { requestHosts, revokeHosts, permissionsApiAvailable } from '../../shared/host-permissions';
import { providerHosts } from '../../shared/provider-hosts';
import { Button, ListGroup, QuickRow, Toggle } from '../../ui/primitives/settings-primitives';
import { InfoHint } from './InfoHint';

/**
 * The UI half of `optional_host_permissions` — one switch per group, all of
 * them grantable only from a user gesture.
 *
 * The prototype supplies the view (summary line, one row per group, a switch);
 * the repo supplies the logic: real `chrome.permissions` via
 * `requestHosts`/`revokeHosts`, the content-script fallback that opens Options
 * instead of pretending a request happened, and the granted-origins store.
 */

export interface PermissionGroup {
  id: string;
  label: string;
  hint: string;
  providers: string[];
}

/** Translation, AI, TTS, media and packs each get their own switch: a user
 * who only wants DeepL never grants the other dictionary origins. */
export const HOST_GROUPS: PermissionGroup[] = [
  {
    id: 'dict',
    label: t('perm.groupDict'),
    hint: t('perm.groupDictHint'),
    providers: [
      'dict:wiktionary', 'dict:datamuse', 'dict:dictionaryapi', 'dict:moby',
      'dict:thesauruscom', 'dict:dictionarycom', 'dict:wordhippo', 'dict:theidioms',
      'dict:cambridge', 'dict:oxford', 'dict:merriam', 'dict:britannica', 'dict:ozdic',
      'dict:reverso', 'dict:pons', 'dict:babla', 'dict:dictcc', 'dict:linguee',
      'dict:promt', 'dict:wordreference', 'dict:spanishdict', 'dict:tatoeba', 'dict:etymonline',
    ],
  },
  {
    id: 'translate',
    label: t('perm.groupTranslate'),
    hint: t('perm.groupTranslateHint'),
    providers: [
      'translate:deepl', 'translate:google', 'translate:mymemory',
      'translate:lingva', 'translate:libretranslate',
    ],
  },
  {
    id: 'ai',
    label: t('perm.groupAi'),
    hint: t('perm.groupAiHint'),
    providers: ['ai:openai', 'ai:anthropic', 'ai:google-ai', 'ai:openai-compatible'],
  },
  {
    id: 'tts',
    label: t('perm.groupTts'),
    hint: t('perm.groupTtsHint'),
    providers: ['tts:google', 'tts:elevenlabs'],
  },
  {
    id: 'media',
    label: t('perm.groupMedia'),
    hint: t('perm.groupMediaHint'),
    providers: [
      'vip:unsplash', 'vip:pixabay', 'vip:openverse', 'vip:bing', 'vip:ddg',
      'vip:wikimedia', 'vip:forvo', 'vip:lingualibre', 'video:youglish',
    ],
  },
  {
    id: 'packs',
    label: t('perm.groupPacks'),
    hint: t('perm.groupPacksHint'),
    providers: ['packs:cdn'],
  },
];

export function originsFor(providers: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of providers) for (const host of providerHosts(id)) out.add(host);
  return [...out];
}

/** A group is complete when every one of its origins is covered — either by
 * the reactive store or by a pattern the browser reports as granted. */
export function isGroupComplete(group: PermissionGroup, granted: string[]): boolean {
  return originsFor(group.providers).every((o) => granted.includes(o) || hasOrigin(o));
}

/** React binding for the plain-JS store in shared/host-permissions-store.ts —
 * kept in the consumer so the SW graph (which reaches that module through
 * shared/host-permissions.ts) never imports React. */
export function useGrantedOrigins(): string[] {
  return useSyncExternalStore(subscribeHostPermissions, getGrantedOrigins, () => []);
}

export function HostPermissionsRow({ showGrantAll = true }: { showGrantAll?: boolean } = {}) {
  const granted = useGrantedOrigins();
  const [pending, setPending] = useState<string | null>(null);
  // `chrome.permissions` does not exist inside a CONTENT SCRIPT: this panel is
  // the same React tree that runs there, and without this check the grant
  // button would report success for a request that was never made. The options
  // page is a real extension page and can prompt; pointing there is honest.
  const canPrompt = permissionsApiAvailable();

  const openOptions = () => {
    // `chrome.runtime.openOptionsPage` only exists in an EXTENSION page. This
    // panel also runs in a content script, so the click goes to the service
    // worker, the same door the card's "Open settings" link uses.
    void sendMessage(
      'OPEN_SETTINGS' as const,
      { section: 'permissions' },
      'background',
    ).catch(() => {
      // Nothing to show in a context that cannot reach the worker either.
    });
  };

  const run = async (providers: string[], revokeIt: boolean, id: string) => {
    if (!canPrompt) {
      openOptions();
      return;
    }
    setPending(id);
    try {
      if (revokeIt) await revokeHosts(originsFor(providers));
      else await requestHosts(originsFor(providers));
      await refreshHostPermissions();
    } finally {
      setPending(null);
    }
  };

  const completeOf = (group: PermissionGroup): boolean => isGroupComplete(group, granted);
  const grantedGroups = HOST_GROUPS.filter(completeOf).length;
  const missing = HOST_GROUPS.filter((g) => !completeOf(g));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 px-0.5">
        <span className="text-[12px] tabular-nums text-zinc-500 dark:text-zinc-400">
          {t('vipx.permSummary', { on: grantedGroups, total: HOST_GROUPS.length })}
        </span>
        {/* The prototype folds the two parity notes into this hint: the
            groups drive SOURCES, not video sites — those go through the
            manifest's fixed content-script matches. */}
        <InfoHint text={`${t('perm.intro')} ${t('vipx.permDiffVip')} ${t('vipx.permDiffSites')}`} maxWidth={260} />
        <span className="ml-auto" />
        {showGrantAll && missing.length > 0 && (
          <Button
            size="sm"
            variant="soft"
            disabled={pending !== null}
            onClick={() => void run(missing.flatMap((g) => g.providers), false, '__all')}
            icon={pending === '__all' ? <Loader2 size={11} className="animate-spin" /> : undefined}
          >
            {t('vipx.grantAll')}
          </Button>
        )}
      </div>

      <ListGroup>
        {HOST_GROUPS.map((group) => {
          const complete = completeOf(group);
          const own = originsFor(group.providers);
          const have = own.filter((o) => granted.includes(o) || hasOrigin(o)).length;
          const busy = pending === group.id || pending === '__all';
          return (
            <QuickRow
              key={group.id}
              label={group.label}
              hint={`${have}/${own.length} ${t('perm.hosts')}`}
              info={
                <span className="flex items-start gap-1.5">
                  {complete
                    ? <ShieldCheck size={12} className="shrink-0 mt-0.5 text-emerald-500" />
                    : <KeyRound size={12} className="shrink-0 mt-0.5 text-zinc-400" />}
                  <span>{group.hint}</span>
                </span>
              }
            >
              <span className="flex items-center gap-2">
                {busy && <Loader2 size={11} className="animate-spin text-zinc-400" />}
                {!canPrompt ? (
                  <Button size="sm" variant="secondary" onClick={openOptions}>
                    {t('perm.openOptions')}
                  </Button>
                ) : (
                  <Toggle
                    on={complete}
                    disabled={pending !== null}
                    onChange={(v) => void run(group.providers, !v, group.id)}
                    ariaLabel={group.label}
                  />
                )}
              </span>
            </QuickRow>
          );
        })}
      </ListGroup>
    </div>
  );
}
