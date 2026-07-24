import { useMemo } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useAuth } from '../../context/AuthContext';
import type { WizardState } from './wizardState';
import { postcodeLabel, cityLabel } from '../../lib/tenantLabels';
import { downloadCsv } from '../../lib/csvExport';

interface Props {
  open: boolean;
  state: WizardState;
  onClose: () => void;
}

/**
 * ImportSummaryModal - final summary shown after every depot has fired. Shows
 * total imported / failed counts and a table of un-imported rows (from
 * state.failedImportJobs + per-depot skipped km-rated). Mirrors
 * BulkImportHyper's homeView.html "Unimported Jobs" block which appears
 * after the loop completes if any rows didn't land.
 *
 * When the operator ticks "Skip km-rated" in KmRatedReviewModal, those rows
 * flow into state.failedImportJobs. Any per-depot server-side rejects are
 * accumulated on state.perDepotResults.failed (count only - the row detail
 * comes back via the /import response body which the wizard toasts).
 */
export function ImportSummaryModal({ open, state, onClose }: Props) {
  const auth = useAuth();
  const isUs = auth.isUsTenant || state.client?.isUsTenant || false;

  const totals = useMemo(() => {
    const imported = state.perDepotResults.reduce((s, r) => s + r.imported, 0);
    const failed = state.perDepotResults.reduce((s, r) => s + r.failed, 0);
    return { imported, failed };
  }, [state.perDepotResults]);

  const perDepot = state.perDepotResults;
  const failedRows = state.failedImportJobs;

  function handleExportFailed() {
    if (failedRows.length === 0) return;
    const suburbHeader = cityLabel(isUs);
    const postHeader = postcodeLabel(isUs);
    const csvRows: (string | number | null | undefined)[][] = [
      ['Job Number', 'To Address', suburbHeader, postHeader],
    ];
    for (const j of failedRows) {
      csvRows.push([
        j.jobNumber ?? '',
        j.toAddress ?? '',
        (isUs ? j.toCity : j.toSuburb) ?? '',
        (isUs ? j.toZipCode : j.toPostCode) ?? '',
      ]);
    }
    downloadCsv(csvRows, `unimported-jobs-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={totals.failed > 0 ? 'Import Summary - some jobs skipped' : 'Import Summary'}
      size="3xl"
      footer={
        <div className="flex justify-between items-center">
          {failedRows.length > 0 ? (
            <Button
              variant="neutral"
              size="sm"
              onClick={handleExportFailed}
              title="Download the unimported job list as CSV"
            >
              Export unimported CSV
            </Button>
          ) : (
            <span />
          )}
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="border border-success/40 bg-success/5 rounded p-3">
            <div className="text-xs text-text-secondary">Imported</div>
            <div className="text-2xl font-semibold text-success">{totals.imported}</div>
          </div>
          <div
            className={`border rounded p-3 ${
              totals.failed > 0
                ? 'border-warning/40 bg-warning/5'
                : 'border-border-light bg-surface-cream'
            }`}
          >
            <div className="text-xs text-text-secondary">Failed / Skipped</div>
            <div
              className={`text-2xl font-semibold ${
                totals.failed > 0 ? 'text-warning' : 'text-text-muted'
              }`}
            >
              {totals.failed}
            </div>
          </div>
        </div>

        {perDepot.length > 1 && (
          <div className="border border-border-light rounded">
            <div className="text-xs font-medium text-text-secondary px-3 py-2 border-b border-border-light">
              Per-depot breakdown
            </div>
            <table className="w-full text-xs">
              <thead className="bg-surface-cream">
                <tr>
                  <th className="text-left px-3 py-1.5">Depot</th>
                  <th className="text-right px-3 py-1.5">Imported</th>
                  <th className="text-right px-3 py-1.5">Failed</th>
                </tr>
              </thead>
              <tbody>
                {perDepot.map((r, i) => {
                  const bucket = state.depots.find((d) => d.depotId === r.depotId);
                  return (
                    <tr key={`${r.depotId}-${i}`} className="border-t border-border-light">
                      <td className="px-3 py-1.5">
                        {bucket?.depotName ?? `Depot ${r.depotId}`}
                      </td>
                      <td className="px-3 py-1.5 text-right text-success">{r.imported}</td>
                      <td className="px-3 py-1.5 text-right text-warning">
                        {r.failed > 0 ? r.failed : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {failedRows.length > 0 && (
          <div className="border border-warning/40 bg-warning/5 rounded">
            <div className="text-xs font-medium text-text-primary px-3 py-2 border-b border-warning/40">
              Unimported jobs ({failedRows.length})
            </div>
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-warning/10 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-1.5">Job Number</th>
                    <th className="text-left px-3 py-1.5">To Address</th>
                    <th className="text-left px-3 py-1.5">To Suburb</th>
                    <th className="text-left px-3 py-1.5">{postcodeLabel(isUs)}</th>
                  </tr>
                </thead>
                <tbody>
                  {failedRows.map((j, i) => (
                    <tr key={`${j.jobNumber ?? ''}-${i}`} className="border-t border-warning/20">
                      <td className="px-3 py-1.5">{j.jobNumber ?? ''}</td>
                      <td className="px-3 py-1.5">{j.toAddress ?? ''}</td>
                      <td className="px-3 py-1.5">{j.toSuburb ?? j.toCity ?? ''}</td>
                      <td className="px-3 py-1.5">{j.toPostCode ?? j.toZipCode ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {failedRows.length === 0 && totals.failed === 0 && (
          <p className="text-xs text-text-muted">
            All jobs imported successfully.
          </p>
        )}
      </div>
    </Modal>
  );
}
