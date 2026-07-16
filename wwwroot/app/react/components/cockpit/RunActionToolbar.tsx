interface Props {
  selectedRunCount: number;
  hasLockedInSelection: boolean;
  hasUnlockedInSelection: boolean;
  onLockAll: () => void;
  onUnlockAll: () => void;
  onDeleteAll: () => void;
  onDispatchAll: () => void;
  onClearSelection: () => void;
}

/**
 * Bulk-actions toolbar for the Runs pane. Mirrors the jobs ActionToolbar
 * pattern: only shows when the operator has multi-selected one or more runs.
 * Legacy analogue: multiSelectedRuns processing scattered across
 * homeControl.js - hoisted here into an explicit toolbar.
 */
export function RunActionToolbar({
  selectedRunCount,
  hasLockedInSelection,
  hasUnlockedInSelection,
  onLockAll,
  onUnlockAll,
  onDeleteAll,
  onDispatchAll,
  onClearSelection,
}: Props) {
  if (selectedRunCount === 0) return null;
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-brand-purple/10 border-b border-brand-purple/30 text-xs">
      <span className="font-medium text-brand-dark">
        {selectedRunCount} run{selectedRunCount === 1 ? '' : 's'} selected
      </span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onLockAll}
        disabled={!hasUnlockedInSelection}
        className="px-2 py-0.5 border border-border rounded hover:bg-surface-cream disabled:opacity-40"
        title={hasUnlockedInSelection ? 'Lock all unlocked runs in selection' : 'All selected runs are already locked'}
      >
        Lock all
      </button>
      <button
        type="button"
        onClick={onUnlockAll}
        disabled={!hasLockedInSelection}
        className="px-2 py-0.5 border border-border rounded hover:bg-surface-cream disabled:opacity-40"
        title={hasLockedInSelection ? 'Unlock all locked runs in selection' : 'No selected run is locked'}
      >
        Unlock all
      </button>
      <button
        type="button"
        onClick={onDispatchAll}
        disabled={!hasLockedInSelection}
        className="px-2 py-0.5 bg-brand-orange text-white rounded disabled:opacity-40"
        title={hasLockedInSelection ? 'Send all locked runs in selection to Live' : 'Lock at least one run first'}
      >
        Dispatch locked
      </button>
      <button
        type="button"
        onClick={onDeleteAll}
        className="px-2 py-0.5 border border-error text-error rounded hover:bg-error-bg"
      >
        Delete all
      </button>
      <button
        type="button"
        onClick={onClearSelection}
        className="px-2 py-0.5 text-text-muted hover:text-text-primary"
      >
        Clear
      </button>
    </div>
  );
}
