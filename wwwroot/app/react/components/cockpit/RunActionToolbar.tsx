import { Button } from '../common/Button';

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
      <Button
        variant="neutral"
        size="sm"
        onClick={onLockAll}
        disabled={!hasUnlockedInSelection}
        title={hasUnlockedInSelection ? 'Lock all unlocked runs in selection' : 'All selected runs are already locked'}
      >
        Lock all
      </Button>
      <Button
        variant="neutral"
        size="sm"
        onClick={onUnlockAll}
        disabled={!hasLockedInSelection}
        title={hasLockedInSelection ? 'Unlock all locked runs in selection' : 'No selected run is locked'}
      >
        Unlock all
      </Button>
      <Button
        variant="warning"
        size="sm"
        onClick={onDispatchAll}
        disabled={!hasLockedInSelection}
        title={hasLockedInSelection ? 'Send all locked runs in selection to Live' : 'Lock at least one run first'}
      >
        Dispatch locked
      </Button>
      <Button variant="danger" size="sm" onClick={onDeleteAll}>Delete all</Button>
      <Button variant="ghost" size="sm" onClick={onClearSelection}>Clear</Button>
    </div>
  );
}
