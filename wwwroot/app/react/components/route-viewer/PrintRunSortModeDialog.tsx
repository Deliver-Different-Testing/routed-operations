import { Modal } from '../common/Modal';
import { Button } from '../common/Button';

// Small sort-mode picker shown when the operator clicks the Print Run
// button on the Run Jobs toolbar (Route Viewer). Mirrors the legacy
// AngularJS labelsForm.tpl: a "Sort Mode" label + three buttons that
// each set labelsSortMode and fire getLabels(). SortMode 1 = Run Name,
// 2 = Product, 3 = Client - the numeric mapping is what the legacy SP
// `RVW_stpJobPrintLabels` @SortMode parameter accepts, so we keep the
// same values here + let the backend proxy pass them through unchanged.

export type PrintRunSortMode = 1 | 2 | 3;

interface Props {
  onPick: (sortMode: PrintRunSortMode) => void;
  onCancel: () => void;
  /** True while the parent is fetching + opening the PDF. Locks the
   *  buttons so a double-click does not fire two label calls. */
  submitting?: boolean;
}

const OPTIONS: Array<{ label: string; mode: PrintRunSortMode }> = [
  { label: 'Run Name', mode: 1 },
  { label: 'Product', mode: 2 },
  { label: 'Client', mode: 3 },
];

export function PrintRunSortModeDialog({ onPick, onCancel, submitting }: Props) {
  return (
    <Modal
      open
      onClose={onCancel}
      title="Sort Mode"
      size="sm"
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-secondary">
          Pick how the printed labels should be sorted.
        </p>
        <div className="flex gap-2 justify-center">
          {OPTIONS.map((o) => (
            <Button
              key={o.mode}
              variant="primary"
              onClick={() => onPick(o.mode)}
              disabled={submitting}
            >
              {o.label}
            </Button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
