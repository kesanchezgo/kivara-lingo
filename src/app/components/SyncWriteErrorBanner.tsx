/**
 * Banner for a failed chrome.storage.sync write.
 *
 * The storage adapter keeps the blob in a write-through fallback, so the UI
 * keeps working — but chrome.storage is still holding the previous state and
 * the next remote change would overwrite whatever this device just saved.
 * That used to be a console.warn nobody read; now the popup and Settings
 * show this strip so the user knows why a setting "didn't stick".
 *
 * State comes from the tiny external store in shared/store.ts (NOT from
 * KivaraState: `setItem` runs inside a persist write, so pushing the flag
 * through the store would schedule another write, which would push the flag
 * again). Two notices: a write that never reached sync (retryable) and local
 * edits a remote change already replaced (not retryable — only explanatory).
 */
import { useSyncExternalStore } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { t } from '../../shared/i18n';
import { getSyncWriteStatus, subscribeSyncWriteStatus, retrySyncWrite, dismissSyncDiscarded } from '../../shared/store';

export function SyncWriteErrorBanner({ compact = false }: { compact?: boolean }) {
  const status = useSyncExternalStore(
    subscribeSyncWriteStatus,
    getSyncWriteStatus,
    () => ({ failed: false, discarded: false }),
  );
  // Discarded outranks failed: a remote change consumed the pending blob, so
  // a retry would send nothing — only the explanation is left.
  if (status.discarded) {
    return (
      <div
        role="status"
        className={
          compact
            ? 'flex items-start gap-1.5 rounded-lg border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/60 px-2.5 py-1.5 text-[10.5px] leading-snug text-zinc-600 dark:text-zinc-400'
            : 'flex items-start gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/60 px-3 py-2 text-[11px] leading-snug text-zinc-600 dark:text-zinc-400'
        }
      >
        <span className="flex-1 min-w-0">{t('storage.syncDiscarded')}</span>
        <button
          type="button"
          onClick={() => dismissSyncDiscarded()}
          title={t('storage.syncDismiss')}
          className="shrink-0 p-1 rounded-md text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <X size={11} />
        </button>
      </div>
    );
  }
  if (!status.failed) return null;

  return (
    <div
      role="status"
      className={
        compact
          ? 'flex items-start gap-2 rounded-lg border border-amber-200/80 dark:border-amber-500/25 bg-amber-50/70 dark:bg-amber-500/10 px-2.5 py-2 text-[10.5px] leading-snug text-amber-800 dark:text-amber-300'
          : 'flex items-start gap-2 rounded-xl border border-amber-200 dark:border-amber-500/25 bg-amber-50/70 dark:bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-800 dark:text-amber-300'
      }
    >
      <span className="flex-1 min-w-0">{t('storage.syncWriteFailed')}</span>
      <button
        type="button"
        onClick={() => void retrySyncWrite()}
        title={t('storage.syncRetry')}
        className="shrink-0 p-1 rounded-md text-amber-600 dark:text-amber-400 hover:bg-amber-100/70 dark:hover:bg-amber-500/15 transition-colors"
      >
        <RefreshCw size={11} />
      </button>
    </div>
  );
}
