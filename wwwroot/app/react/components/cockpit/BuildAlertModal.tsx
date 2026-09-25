import { Modal } from '../common/Modal';
import { Button } from '../common/Button';

export interface BuildBucketPreview {
  key: string;
  hhmm: string | null;
  jobCount: number;
  // Human-readable window label for delivery-window mode. Optional so
  // Max Boxes mode buckets can render without a window.
  windowLabel?: string | null;
}

export interface BuildSkipReport {
  missingWindow: number;
  missingCubic: number;
  missingPostcode: number;
}

interface Props {
  open: boolean;
  buckets: BuildBucketPreview[];
  skips: BuildSkipReport;
  totalValid: number;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Pre-build preview modal (P1.11, legacy homeControl.js:3657-3685
 * buildMultiWindowInfoHtml). Renders the buckets that are about to be
 * built so operators can eyeball the schedule window mix, expected job
 * counts, and any skipped rows before firing the build.
 *
 * Replaces the earlier toast-only path in CockpitPage.doBuildRuns. The
 * confirm button fires the caller-supplied onConfirm; cancel closes with
 * no side effects.
 */
export function BuildAlertModal({
  open,
  buckets,
  skips,
  totalValid,
  onCancel,
  onConfirm,
}: Props) {
  const hasSkips =
    skips.missingWindow > 0 || skips.missingCubic > 0 || skips.missingPostcode > 0;
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={`Confirm build - ${buckets.length} run bucket(s), ${totalValid} valid job(s)`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" size="sm" onClick={onCancel}>Cancel</Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onConfirm}
            disabled={buckets.length === 0}
            data-primary="true"
          >
            {buckets.length === 0 ? 'Nothing to build' : `Build ${buckets.length} bucket(s)`}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        {hasSkips && (
          <div className="p-2 border border-warning bg-warning-bg rounded text-xs space-y-0.5">
            <div className="font-medium text-warning">Skipped rows in this build:</div>
            {skips.missingWindow > 0 && (
              <div>- {skips.missingWindow} missing schedule window</div>
            )}
            {skips.missingCubic > 0 && (
              <div>- {skips.missingCubic} missing cubic data (vehicle capacity mode)</div>
            )}
            {skips.missingPostcode > 0 && (
              <div>- {skips.missingPostcode} missing postcode (max boxes mode)</div>
            )}
          </div>
        )}
        {buckets.length === 0 ? (
          <div className="text-warning text-xs">
            No buckets formed. Adjust the selection or the build config and try again.
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead className="bg-surface-cream">
              <tr className="text-left text-text-muted">
                <th className="px-2 py-1 border-b border-border-light">Bucket</th>
                {buckets.some((b) => b.windowLabel) && (
                  <th className="px-2 py-1 border-b border-border-light">Window</th>
                )}
                <th className="px-2 py-1 border-b border-border-light text-right">Jobs</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={`${b.key}-${b.hhmm ?? ''}`} className="border-b border-border-light">
                  <td className="px-2 py-1 font-medium">
                    {b.hhmm ? `DW${b.hhmm}` : b.key}
                  </td>
                  {buckets.some((x) => x.windowLabel) && (
                    <td className="px-2 py-1 text-text-muted">{b.windowLabel ?? ''}</td>
                  )}
                  <td className="px-2 py-1 text-right">{b.jobCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="text-[10px] text-text-muted">
          Each bucket may split into multiple runs after the vehicle-capacity /
          max-boxes / window-fit checks. This preview shows the pre-split shape.
        </div>
      </div>
    </Modal>
  );
}
