import { useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';

// Legacy labelsForm.tpl (RunViewer AngularJS) fired three
// buttons that each set `labelsSortMode` before calling
// getLabels(). Route Viewer surfaces the same three-choice
// picker as a small radio modal so operators pick a sort mode
// (Run Name / Product / Client) before firing the label PDF.
// Numeric codes match the legacy $parent.labelsSortMode values
// so the downstream RVW_stpLabels_* SPs keep working unchanged.

export type LabelsSortMode = 1 | 2 | 3;

const OPTIONS: Array<{ value: LabelsSortMode; label: string }> = [
  { value: 1, label: 'Run Name' },
  { value: 2, label: 'Product' },
  { value: 3, label: 'Client' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onPrint: (sortMode: LabelsSortMode) => void;
  /** Initial radio selection. Defaults to Run Name (legacy default). */
  initialSortMode?: LabelsSortMode;
}

export function LabelsSortPickerModal({ open, onClose, onPrint, initialSortMode = 1 }: Props) {
  const [sortMode, setSortMode] = useState<LabelsSortMode>(initialSortMode);

  const handlePrint = () => {
    onPrint(sortMode);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Print Labels"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handlePrint}>Print</Button>
        </div>
      }
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs text-text-muted mb-1">Sort mode</legend>
        {OPTIONS.map((opt) => (
          <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name="labels-sort-mode"
              value={opt.value}
              checked={sortMode === opt.value}
              onChange={() => setSortMode(opt.value)}
              className="accent-brand-cyan"
            />
            <span>{opt.label}</span>
          </label>
        ))}
      </fieldset>
    </Modal>
  );
}
