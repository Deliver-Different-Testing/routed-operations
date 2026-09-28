import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { downloadCsv } from '../../lib/csvExport';
import type { DepotBucket, WizardState } from './wizardState';
import { sourceRowsCsv } from './sourceRowExport';

interface Props {
  open: boolean;
  state: WizardState;
  isUs: boolean;
  // The Unmatched bucket (depotId 0) or a no-service depot bucket.
  bucket: DepotBucket | null;
  onClose: () => void;
}

/**
 * UnmatchedRowsModal - read-only review of the rows in a bucket that cannot
 * be imported (Unmatched postcodes, or a depot with no service for this
 * client such as an airline depot). Lists the basics per row and exports
 * the rows in the client's original file layout so they can be corrected
 * and re-imported. Legacy offered an Excel download of the unmatched rows
 * (FINAL-LEGACY-GAPS.md:196); tester report 2026-09-22 asked for a review
 * step like "Confirm km-rated jobs".
 */
export function UnmatchedRowsModal({ open, state, isUs, bucket, onClose }: Props) {
  const parsed = state.parsed;
  const m = state.mapping;
  const rowIndexes = bucket?.jobIndexes ?? [];
  const isUnmatched = bucket?.depotId === 0;
  const codeField = isUs ? 'toZipCode' : 'toPostCode';
  const codeLabel = isUs ? 'Zip' : 'Postcode';

  const cell = (rowIndex: number, field: string) => {
    const col = m[field];
    if (!col || !parsed) return '';
    return String(parsed.rows[rowIndex]?.[col] ?? '').trim();
  };

  const reason = (rowIndex: number) => {
    if (!isUnmatched) return `No service for this client at ${bucket?.depotName ?? 'this depot'}`;
    if (!m[codeField]) return `${codeLabel} column not mapped`;
    return cell(rowIndex, codeField)
      ? `${codeLabel} not covered by any ${isUs ? 'region' : 'depot'}`
      : `Missing ${codeLabel.toLowerCase()}`;
  };

  function handleExport() {
    if (!parsed || !bucket) return;
    const slug = isUnmatched
      ? 'unmatched'
      : bucket.depotName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    downloadCsv(
      sourceRowsCsv(parsed, rowIndexes),
      `${slug}-rows-${new Date().toISOString().slice(0, 10)}.csv`
    );
  }

  const title = isUnmatched
    ? `Unmatched rows (${rowIndexes.length})`
    : `${bucket?.depotName ?? ''} - no service (${rowIndexes.length})`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="4xl"
      footer={
        <div className="flex justify-between items-center">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="neutral"
            size="sm"
            onClick={handleExport}
            disabled={!parsed || rowIndexes.length === 0}
            title="Download these rows in the original file layout"
          >
            Export CSV
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="text-xs text-text-secondary">
          These rows cannot be imported. Export CSV downloads them in your original
          file layout so you can correct them and import the file again.
        </div>
        <div className="max-h-[500px] overflow-auto border border-border rounded">
          <table className="w-full text-xs">
            <thead className="bg-surface-cream sticky top-0">
              <tr>
                <th className="p-2 text-left">Row</th>
                <th className="p-2 text-left">Name / Company</th>
                <th className="p-2 text-left">Address</th>
                <th className="p-2 text-left">{isUs ? 'City' : 'Suburb'}</th>
                <th className="p-2 text-left">{codeLabel}</th>
                <th className="p-2 text-left">Reason</th>
              </tr>
            </thead>
            <tbody>
              {rowIndexes.map((i) => (
                <tr key={i} className="border-t border-border-light">
                  {/* +2: header row plus 1-based numbering, matching the spreadsheet. */}
                  <td className="p-2">{i + 2}</td>
                  <td className="p-2">{cell(i, 'toCompany') || cell(i, 'toContact') || '-'}</td>
                  <td className="p-2">{cell(i, 'toAddress') || '-'}</td>
                  <td className="p-2">{cell(i, isUs ? 'toCity' : 'toSuburb') || '-'}</td>
                  <td className="p-2 font-mono">{cell(i, codeField) || '-'}</td>
                  <td className="p-2 text-warning">{reason(i)}</td>
                </tr>
              ))}
              {rowIndexes.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-text-muted">
                    No rows.
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
