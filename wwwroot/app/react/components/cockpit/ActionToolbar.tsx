import { Button } from '../common/Button';

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
      <Button variant="danger" size="sm" onClick={onVoid}>Void</Button>
      <Button variant="neutral" size="sm" onClick={onUnvoid}>Un-void</Button>
      <Button variant="secondary" size="sm" onClick={onBulkMoveDate}>Bulk move date...</Button>
      <Button
        variant="warning"
        size="sm"
        onClick={onSendSelected}
        title="Dispatch the selected jobs directly to Live (no locked run required)"
      >
        Send selected to Live
      </Button>
      <Button variant="ghost" size="sm" onClick={onClearSelection}>Clear</Button>
    </div>
  );
}
