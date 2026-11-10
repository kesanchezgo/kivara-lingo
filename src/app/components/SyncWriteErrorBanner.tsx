/**
 * Banner for a failed chrome.storage.sync write.
 *
 * The storage adapter keeps the blob in a write-through fallback, so the UI
 * keeps working — but chrome.storage still holds the previous state and the
 * next remote change would overwrite whatever this device just saved. Two
 * notices: a write that never reached sync (retryable) and local edits a
 * remote change already replaced (not retryable — only explanatory). A refused
 * save outranks both: the credential the user just typed is in memory only.
 *
 * The view is the prototype's (Callout + action); the state machine is the
 * repo's tiny external store in shared/store.ts, NOT KivaraState — setItem runs
 * inside a persist write, so pushing the flag through the store would schedule
 * another write.
 */
import { ShieldAlert, RefreshCw, X, Cloud } from '../../ui/icons';
import { t } from '../../shared/i18n';
import {
  getSyncWriteStatus,
  subscribeSyncWriteStatus,
  retrySyncWrite,
  dismissSyncDiscarded,
  dismissSecretSaveRefused,
} from '../../shared/store';
import { Button, Callout } from '../../ui/primitives/settings-primitives';
import { useSyncExternalStore } from 'react';

export function SyncWriteErrorBanner(_props: { compact?: boolean }) {
  const status = useSyncExternalStore(
    subscribeSyncWriteStatus,
    getSyncWriteStatus,
    () => ({ failed: false, discarded: false, secretSaveRefused: false }),
  );

  // A REFUSED save outranks everything else: the credential the user just
  // typed is in memory only, and the alternative is letting them believe it
  // saved and reload into a silent break.
  if (status.secretSaveRefused) {
    return (
      <Callout
        role="alert"
        tone="danger"
        icon={<ShieldAlert size={12} />}
        action={(
          <button
            type="button"
            onClick={() => dismissSecretSaveRefused()}
            title={t('storage.syncDismiss')}
            aria-label={t('storage.syncDismiss')}
            className="p-1 rounded-md text-current opacity-60 hover:opacity-100 transition-opacity"
          >
            <X size={12} />
          </button>
        )}
      >
        {t('storage.secretSaveRefused')}
      </Callout>
    );
  }
  // Discarded outranks failed: a remote change consumed the pending blob, so a
  // retry would send nothing — only the explanation is left.
  if (status.discarded) {
    return (
      <Callout
        role="status"
        tone="neutral"
        icon={<Cloud size={12} />}
        action={(
          <button
            type="button"
            onClick={() => dismissSyncDiscarded()}
            title={t('storage.syncDismiss')}
            aria-label={t('storage.syncDismiss')}
            className="p-1 rounded-md text-current opacity-60 hover:opacity-100 transition-opacity"
          >
            <X size={12} />
          </button>
        )}
      >
        {t('storage.syncDiscarded')}
      </Callout>
    );
  }
  if (!status.failed) return null;

  return (
    <Callout
      role="status"
      tone="warning"
      icon={<Cloud size={12} />}
      action={(
        <Button
          size="sm"
          variant="secondary"
          icon={<RefreshCw size={10} />}
          onClick={() => void retrySyncWrite()}
        >
          {t('storage.syncRetry')}
        </Button>
      )}
    >
      {t('storage.syncWriteFailedShort')}
    </Callout>
  );
}