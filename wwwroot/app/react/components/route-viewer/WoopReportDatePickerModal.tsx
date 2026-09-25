import { useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';

// Legacy woopReportForm.tpl (RunViewer AngularJS) collected
// fromDate + toDate before firing downloadWoopReport(). Route
// Viewer surfaces the same two-input date range picker as a
// small modal so operators pick the date window before hitting
// the WoopRunNumber XLSX endpoint. Both inputs default to today
// so a single-day report is one Download click away.

interface Props {
  open: boolean;
  onClose: () => void;
  onDownload: (fromDate: string, toDate: string) => void;
  /** Initial value for both inputs. Callers pass the current
   *  Route Viewer runDate (YYYY-MM-DD) so the default window
   *  matches the cockpit context. */
  defaultDate: string;
}

export function WoopReportDatePickerModal({ open, onClose, onDownload, defaultDate }: Props) {
  const [fromDate, setFromDate] = useState<string>(defaultDate);
  const [toDate, setToDate] = useState<string>(defaultDate);

  const handleDownload = () => {
    onDownload(fromDate, toDate);
    onClose();
  };

  // Disable Download when either date is blank or the window is
  // reversed (from > to). The backend tolerates a reversed range
  // but returns an empty XLSX, which surprises operators.
  const invalid = !fromDate || !toDate || fromDate > toDate;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Woop Run Number Report"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleDownload} disabled={invalid}>Download</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-text-muted">From date</span>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="border border-border rounded px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-text-muted">To date</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="border border-border rounded px-2 py-1 text-sm"
          />
        </label>
        {invalid && fromDate && toDate && (
          <p className="text-xs text-error">From date must be on or before To date.</p>
        )}
      </div>
    </Modal>
  );
}
