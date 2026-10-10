import React, { useState } from 'react';
import { t } from '../../shared/i18n';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { useGrantedOrigins, refreshHostPermissions, hasOrigin } from '../../shared/host-permissions-store';
import { requestHosts, revokeHosts, ensureProviderHosts } from '../../shared/host-permissions';
import { providerHosts } from '../../shared/provider-hosts';

/**
 * The UI half of `optional_host_permissions`.
 *
 * Chrome Web Store review reads a manifest with ~96 host permissions as a
 * data-collection extension, so those origins live in
 * `optional_host_permissions` and are granted HERE — on purpose, in groups,
 * exactly when the user says yes. The service worker cannot prompt at all, so
 * every grant happens here (or in a provider `onChange`).
 */

interface PermissionGroup {
  id: string;
  label: string;
  hint: string;
  providers: string[];
}

/** Translation, AI, TTS, media and packs each get their own switch: a user who
 * only wants DeepL never grants the other dictionary origins. */
const GROUPS: PermissionGroup[] = [
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
    providers: ['ai:openai', 'ai:anthropic', 'ai:google-ai'],
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

function originsFor(providers: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of providers) for (const host of providerHosts(id)) out.add(host);
  return [...out];
}

export function HostPermissionsRow() {
  const granted = useGrantedOrigins();
  const [pending, setPending] = useState(false);

  const run = async (providers: string[], revokeIt: boolean) => {
    setPending(true);
    try {
      if (revokeIt) await revokeHosts(originsFor(providers));
      else await requestHosts(originsFor(providers));
      await refreshHostPermissions();
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-2">
      {GROUPS.map((group) => {
        const own = originsFor(group.providers);
        const have = own.filter((o) => granted.includes(o) || hasOrigin(o)).length;
        const complete = have === own.length;
        return (
          <div
            key={group.id}
            className="flex items-start justify-between gap-2 rounded-md border border-zinc-200 dark:border-zinc-800 px-2.5 py-2"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                {complete
                  ? <ShieldCheck size={11} className="text-emerald-500 shrink-0" />
                  : <KeyRound size={11} className="text-zinc-400 shrink-0" />}
                <span className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                  {group.label}
                </span>
              </div>
              <p className="text-[10px] leading-snug text-zinc-500 dark:text-zinc-400 mt-0.5">
                {group.hint}
              </p>
              <p className="text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500 mt-0.5">
                {have}/{own.length} {t('perm.hosts')}
              </p>
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <button
                type="button"
                disabled={pending || complete}
                onClick={() => void run(group.providers, false)}
                className="text-[10px] font-semibold px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {complete ? t('perm.granted') : t('perm.grant')}
              </button>
              {have > 0 && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void run(group.providers, true)}
                  className="text-[10px] font-semibold px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                >
                  {t('perm.revoke')}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
