import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { truckPreviewTotals, type WizardState } from './wizardState';

interface Props {
  open: boolean;
  state: WizardState;
  onBack: () => void;
  onImport: () => void;
  onCancel: () => void;
  importing: boolean;
}

// Truck rows are NZ only, so the currency is always NZD.
const money = (v: number | null) =>
  v == null ? '' : v.toLocaleString(undefined, { style: 'currency', currency: 'NZD' });

/**
 * TruckPreviewModal - the last stop before /import when a truck speed is in
 * play. Shows the price /bulk-import/truck-preview worked out for each truck
 * row, and flags in amber the rows the import would refuse, with the reason.
 * Importing still runs the same checks, and refused rows still reach the summary.
 */
export function TruckPreviewModal({ open, state, onBack, onImport, onCancel, importing }: Props) {
  const preview = state.truckPreview;
  const rows = preview?.rows ?? [];
  const totals = truckPreviewTotals(preview);
  const other = preview?.otherRowCount ?? 0;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Check Truck Prices"
      size="6xl"
      loading={importing}
      loadingMessage="Importing jobs for this depot..."
      footer={
        <div className="flex justify-between items-center">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button variant="neutral" onClick={onBack} disabled={importing}>
              Back
            </Button>
            <Button variant="primary" onClick={onImport} disabled={importing}>
              Import {totals.importCount} job{totals.importCount === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div className="border border-border-light rounded p-3">
            <div className="text-xs text-text-secondary">Truck jobs to import</div>
            <div className="text-2xl font-semibold text-success" data-testid="truck-preview-count">
              {totals.wouldImport}
            </div>
          </div>
          <div
            className={`border rounded p-3 ${
              totals.wouldReject > 0 ? 'border-warning/40 bg-warning/5' : 'border-border-light'
            }`}
          >
            <div className="text-xs text-text-secondary">Would be rejected</div>
            <div
              className={`text-2xl font-semibold ${totals.wouldReject > 0 ? 'text-warning' : 'text-text-muted'}`}
              data-testid="truck-preview-rejected-count"
            >
              {totals.wouldReject}
            </div>
          </div>
          <div className="border border-border-light rounded p-3">
            <div className="text-xs text-text-secondary">Total price (rate + fuel)</div>
            <div className="text-2xl font-semibold text-text-primary" data-testid="truck-preview-total">
              {money(totals.totalPrice)}
            </div>
          </div>
        </div>

        {state.importError && (
          <p
            data-testid="truck-preview-import-error"
            role="alert"
            className="text-xs text-error border border-error/40 bg-error/[0.06] rounded px-2 py-1.5"
          >
            Import failed: {state.importError}
          </p>
        )}

        {other > 0 && (
          <p className="text-xs text-text-secondary" data-testid="truck-preview-other">
            {other} other job{other === 1 ? ' is' : 's are'} not on a truck speed and will be priced at import as usual.
          </p>
        )}

        <div className="border border-border-light rounded max-h-96 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface-cream sticky top-0">
              <tr>
                <th className="text-left px-3 py-1.5">Job Number</th>
                <th className="text-left px-3 py-1.5">Speed</th>
                <th className="text-left px-3 py-1.5">From</th>
                <th className="text-left px-3 py-1.5">To</th>
                <th className="text-right px-3 py-1.5">Pallets</th>
                <th className="text-right px-3 py-1.5">Rate</th>
                <th className="text-right px-3 py-1.5">Fuel</th>
                <th className="text-right px-3 py-1.5">Price</th>
                <th className="text-left px-3 py-1.5">Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.rowIndex}
                  data-testid="truck-preview-row"
                  data-rejected={r.wouldImport ? undefined : 'true'}
                  className={`border-t border-border-light ${r.wouldImport ? '' : 'bg-warning/10'}`}
                >
                  <td className="px-3 py-1.5">{r.jobNumber ?? 'Assigned at import'}</td>
                  <td className="px-3 py-1.5">{r.speedName ?? ''}</td>
                  <td className="px-3 py-1.5">{r.fromSuburb ?? ''}</td>
                  <td className="px-3 py-1.5">{r.toSuburb ?? ''}</td>
                  <td className="px-3 py-1.5 text-right">{r.quantity ?? ''}</td>
                  <td className="px-3 py-1.5 text-right">{money(r.rate)}</td>
                  <td className="px-3 py-1.5 text-right">{money(r.fuel)}</td>
                  <td className="px-3 py-1.5 text-right font-medium" data-testid="truck-preview-price">
                    {money(r.amount)}
                    {r.ratedManually && (
                      <div className="font-normal text-text-secondary" data-testid="truck-preview-manual">
                        Rated manually
                      </div>
                    )}
                  </td>
                  <td
                    className={`px-3 py-1.5 ${r.wouldImport ? 'text-text-secondary' : 'text-warning font-medium'}`}
                    data-testid="truck-preview-reason"
                  >
                    {r.reason ?? r.warning ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
