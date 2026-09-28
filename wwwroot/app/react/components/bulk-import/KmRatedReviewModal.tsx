import { useMemo } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useAuth } from '../../context/AuthContext';
import { downloadCsv } from '../../lib/csvExport';
import type { BulkImportJobCreateDto } from '../../services/bulkImportService';
import type { WizardAction, WizardState } from './wizardState';
import {
  KM_RATED_DISCLAIMER,
  dtoToSourceLayout,
  sourceRowsCsv,
  type CsvCell,
} from './sourceRowExport';

interface Props {
  open: boolean;
  state: WizardState;
  dispatch: (action: WizardAction) => void;
  onUploadSelected: (deselectedRows: BulkImportJobCreateDto[]) => void;
  onSkip: () => void;
  onCancel: () => void;
  importing: boolean;
}

/**
 * KmRatedReviewModal - Step 7. Presented when the first-pass /import call
 * returns `response.jobs` populated with km-rated rows (rows the server
 * priced by distance rather than by fixed-zone rate). The operator picks
 * which rows to actually book with those distance rates; deselected rows
 * are stashed as `failedImportJobs` for the closing "unimported" list.
 *
 * "Upload selected" fires the re-import with `isKmRatedJobs: true` (the
 * wizard's fireImport reads this flag from state.kmRatedConfirmed).
 * "Skip km-rated" closes the modal without any second call - matches
 * BulkImportHyper homeView.html:767 "Skip these jobs" which just advances
 * to the next depot rather than calling /import again.
 *
 * Mirrors homeView.html:642-768 in BulkImportHyper.
 */
export function KmRatedReviewModal({
  open,
  state,
  dispatch,
  onUploadSelected,
  onSkip,
  onCancel,
  importing,
}: Props) {
  const auth = useAuth();
  const isUs = auth.isUsTenant || state.client?.isUsTenant || false;
  const rows = state.kmRatedRows;
  const selectedCount = state.kmRatedSelected.size;
  const total = rows.length;
  const allSelected = total > 0 && selectedCount === total;

  // Currency formatter for the Amount column. NZ = NZD, US = USD.
  const fmtAmount = useMemo(() => {
    const code = isUs ? 'USD' : 'NZD';
    return (v: number | null | undefined) =>
      v == null
        ? '-'
        : v.toLocaleString(undefined, { style: 'currency', currency: code });
  }, [isUs]);

  function toggleAll() {
    dispatch({ type: 'SET_ALL_KMRATED_SELECTED', selected: !allSelected });
  }

  function handleUpload() {
    // Hand the de-selected rows back to the parent wizard so it can merge
    // them into failedImportJobsRef alongside any server-rejected rows the
    // upcoming /import call returns. Doing the merge here (instead of
    // dispatching directly) avoids the stale-closure hazard: the fireImport
    // path runs in the same tick and would otherwise spread pre-merge
    // state.failedImportJobs. Legacy homeControl.js failedImportJobs pattern.
    const deselected = rows.filter((_, i) => !state.kmRatedSelected.has(i));
    onUploadSelected(deselected);
  }

  function handleExport() {
    // Mirrors BulkImportHyper's `exportToExcel('kmRatedJobs')`, but exports
    // the client's whole original row (every column, original headers) with
    // the km-rated Amount as column A, so the file can be corrected and
    // re-imported as-is. Rows that couldn't be traced back to the source
    // file are laid out under the same headers from the server's copy.
    if (!state.parsed) return;
    const parsed = state.parsed;
    const csvRows: CsvCell[][] = [sourceRowsCsv(parsed, [], [])[0]];
    rows.forEach((j, i) => {
      const sourceRow = state.kmRatedSourceRows[i];
      const cells =
        sourceRow != null
          ? sourceRowsCsv(parsed, [sourceRow])[1]
          : dtoToSourceLayout(parsed, state.mapping, j);
      csvRows.push([j.amount ?? '', ...cells]);
    });
    downloadCsv(csvRows, `km-rated-jobs-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Confirm km-rated jobs"
      size="4xl"
      loading={importing}
      loadingMessage="Booking selected km-rated jobs. This may take up to 10 minutes for large batches."
      footer={
        <div className="flex justify-between items-center">
          <Button variant="ghost" onClick={onCancel} disabled={importing}>
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button
              variant="neutral"
              size="sm"
              onClick={handleExport}
              disabled={importing || rows.length === 0 || !state.parsed}
              title={KM_RATED_DISCLAIMER}
            >
              Export CSV
            </Button>
            <Button variant="neutral" onClick={onSkip} disabled={importing}>
              Skip km-rated
            </Button>
            <Button
              variant="primary"
              onClick={handleUpload}
              disabled={importing || selectedCount === 0}
            >
              {importing ? 'Uploading...' : `Upload selected (${selectedCount})`}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="text-xs text-text-secondary">
          The rows below did not match a fixed-zone rate for this client. They will
          be booked at the km-rated price shown. Untick any rows you do not want
          to book; they will appear on the summary as unimported.
        </div>
        <div className="text-[11px] text-text-muted">
          Export CSV downloads these rows in your original file layout with the
          Amount in column A. {KM_RATED_DISCLAIMER}
        </div>
        <div className="max-h-[500px] overflow-auto border border-border rounded">
          <table className="w-full text-xs">
            <thead className="bg-surface-cream sticky top-0">
              <tr>
                <th className="p-2 text-left w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Toggle all"
                  />
                </th>
                <th className="p-2 text-left">#</th>
                <th className="p-2 text-left">Job Number</th>
                <th className="p-2 text-left">To Address</th>
                <th className="p-2 text-left">{isUs ? 'Zip' : 'Suburb'}</th>
                <th className="p-2 text-right">Amount</th>
                <th className="p-2 text-left">Error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={i}
                  className={`border-t border-border-light ${
                    state.kmRatedSelected.has(i) ? '' : 'opacity-60'
                  }`}
                >
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={state.kmRatedSelected.has(i)}
                      onChange={() => dispatch({ type: 'TOGGLE_KMRATED_ROW', index: i })}
                    />
                  </td>
                  <td className="p-2">{i + 1}</td>
                  <td className="p-2 font-mono">{r.jobNumber ?? '-'}</td>
                  <td className="p-2">{r.toAddress ?? '-'}</td>
                  <td className="p-2">{isUs ? r.toZipCode ?? '-' : r.toSuburb ?? '-'}</td>
                  <td className="p-2 text-right">{fmtAmount(r.amount ?? null)}</td>
                  <td className="p-2 text-error">{r.errorMessage ?? ''}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-4 text-center text-text-muted">
                    No km-rated rows to review.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
