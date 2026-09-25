import { Modal } from '../common/Modal';
import { Button } from '../common/Button';

export interface VoidRelationshipContext {
  selectedIds: number[];
  expandedIds: number[];   // includes multibox siblings
  isVoid: boolean;         // true = void, false = un-void
  jobNumbersById: Map<number, string>;
}

interface Props {
  context: VoidRelationshipContext | null;
  onConfirm: (idsToVoid: number[]) => void;
  onCancel: () => void;
}

/**
 * Void / un-void relationship dialog. Direct port of legacy
 * $scope.showVoidRelationshipDialog (homeControl.js:1338-1391).
 *
 * When the operator selects a job that has multibox siblings, they get to
 * choose whether to void just the selection or the whole multibox family.
 * Legacy has three buttons; we present the same three choices with the
 * job numbers spelled out so the operator can make an informed call.
 */
export function VoidRelationshipDialog({ context, onConfirm, onCancel }: Props) {
  if (!context) return null;

  const verb = context.isVoid ? 'Void' : 'Un-void';
  const selectedCount = context.selectedIds.length;
  const extraCount = context.expandedIds.length - selectedCount;
  const selectedNames = context.selectedIds
    .map((id) => context.jobNumbersById.get(id) ?? String(id))
    .join(', ');
  const extraIds = context.expandedIds.filter((id) => !context.selectedIds.includes(id));
  const extraNames = extraIds
    .map((id) => context.jobNumbersById.get(id) ?? String(id))
    .join(', ');

  return (
    <Modal
      open={true}
      onClose={onCancel}
      title={`${verb} multibox family?`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onCancel}>Cancel</Button>
          <Button
            variant="neutral"
            onClick={() => onConfirm(context.selectedIds)}
            title="Void only what the operator selected. Siblings stay live."
          >
            {verb} {selectedCount} selected only
          </Button>
          <Button
            variant="danger"
            onClick={() => onConfirm(context.expandedIds)}
            title={`Void the selected ${selectedCount} plus the ${extraCount} multibox sibling(s)`}
          >
            {verb} full family ({context.expandedIds.length})
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          The {selectedCount} job(s) you selected are part of a multibox family with{' '}
          {extraCount} sibling(s). Choose whether to {verb.toLowerCase()} the
          selection only, or the entire family together.
        </p>
        <div className="border border-border-light rounded p-2 bg-surface-cream">
          <div className="font-medium text-text-primary mb-1">
            Selected ({selectedCount})
          </div>
          <div className="text-xs text-text-secondary break-words">{selectedNames}</div>
        </div>
        <div className="border border-border-light rounded p-2 bg-surface-cream">
          <div className="font-medium text-text-primary mb-1">
            Multibox siblings ({extraCount})
          </div>
          <div className="text-xs text-text-secondary break-words">{extraNames}</div>
        </div>
      </div>
    </Modal>
  );
}
