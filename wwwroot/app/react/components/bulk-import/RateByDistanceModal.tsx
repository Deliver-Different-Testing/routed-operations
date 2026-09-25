import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useAuth } from '../../context/AuthContext';
import type { WizardState } from './wizardState';

interface Props {
  open: boolean;
  state: WizardState;
  onBack: () => void;
  onNext: () => void;
  onCancel: () => void;
  importing: boolean;
}

/**
 * RateByDistanceModal - Step 7 (US only, coverage-only buckets).
 *
 * The book date + time + speed + schedule are now picked in
 * SchedulePickerModal (Step 6). This modal is a plain acknowledgement /
 * origin-recap screen for US Rate-By-Distance rows so the operator sees
 * where the coverage-only jobs will rate from before firing the final
 * import. If no such rows exist the wizard skips this step and imports
 * straight from SchedulePicker.onNext.
 */
export function RateByDistanceModal({
  open,
  state,
  onBack,
  onNext,
  onCancel,
  importing,
}: Props) {
  const auth = useAuth();
  const originLabel = state.options.routeStartsFromClientSite
    ? 'Client site (from import file)'
    : state.options.originLocation != null
      ? `Location #${state.options.originLocation}`
      : 'Unset origin';

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Rate by Distance"
      size="xl"
      footer={
        <div className="flex justify-between items-center">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button variant="neutral" onClick={onBack} disabled={importing}>
              Back
            </Button>
            <Button variant="primary" onClick={onNext} disabled={importing}>
              {importing ? 'Importing...' : 'Next'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="text-xs text-text-secondary">
          Import Type:{' '}
          <span className="font-semibold text-text-primary">
            {state.importType === 'routed'
              ? auth.isUsTenant
                ? 'Routed'
                : 'Scheduled'
              : 'On-Demand'}
          </span>
        </div>

        {auth.isUsTenant && (
          <div className="border border-brand-cyan/40 bg-brand-cyan/5 rounded p-3 text-xs text-text-primary">
            Rating origin: <span className="font-semibold">{originLabel}</span>. These rows will
            rate by distance.
          </div>
        )}
      </div>
    </Modal>
  );
}
