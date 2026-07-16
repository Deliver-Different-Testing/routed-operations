interface Props {
  selectedJobCount: number;
  onVoid: () => void;
  onUnvoid: () => void;
  onBulkMoveDate: () => void;
  onSendSelected: () => void;
  onClearSelection: () => void;
}

/**
 * Contextual bar above the Jobs list. Only shows when the operator has
 * multi-selected one or more jobs, so the read-only cockpit stays uncluttered
 * until an action is actually possible.
 */
export function ActionToolbar({
  selectedJobCount,
  onVoid,
  onUnvoid,
  onBulkMoveDate,
  onSendSelected,
  onClearSelection,
}: Props) {
  if (selectedJobCount === 0) return null;
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-brand-cyan/10 border-b border-brand-cyan/30 text-xs">
      <span className="font-medium text-brand-dark">
        {selectedJobCount} job{selectedJobCount === 1 ? '' : 's'} selected
      </span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onVoid}
        className="px-2 py-1 border border-error text-error rounded hover:bg-error-bg"
      >
        Void
      </button>
      <button
        type="button"
        onClick={onUnvoid}
        className="px-2 py-1 border border-border rounded hover:bg-surface-cream"
      >
        Un-void
      </button>
      <button
        type="button"
        onClick={onBulkMoveDate}
        className="px-2 py-1 border border-brand-purple text-brand-purple rounded hover:bg-brand-purple/10"
      >
        Bulk move date...
      </button>
      <button
        type="button"
        onClick={onSendSelected}
        className="px-2 py-1 bg-brand-orange text-white rounded hover:brightness-95"
        title="Dispatch the selected jobs directly to Live (no locked run required)"
      >
        Send selected to Live
      </button>
      <button
        type="button"
        onClick={onClearSelection}
        className="px-2 py-1 text-text-muted hover:text-text-primary"
      >
        Clear
      </button>
    </div>
  );
}
