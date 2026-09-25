import { useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useRouteViewerLookups } from '../../hooks/queries/useRouteViewerLookups';
import { routeViewerService, type BulkJob } from '../../services/routeViewerService';

// Route Viewer "Move back to RunBuilder" dialog. Port of the legacy
// moveToRunBuilder.html md-dialog (RunViewer_Claude tpls). Replaces the
// Tier 1 window.confirm() shortcut in RvJobContextMenu with the full
// form: editable Speed dropdown, editable Book Time (datetime-local),
// Keep Job(s) checkbox. Submit hits
// POST /api/runviewer/jobs/move-back-to-runbuilder via
// routeViewerService.moveJobsBackToRunBuilder. Backend Void flag is the
// INVERSE of the Keep checkbox: keep=false means void the originals.

interface Props {
  jobs: BulkJob[];
  runDate: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

// datetime-local wants "YYYY-MM-DDTHH:mm" in local (not UTC) time. Node
// toISOString is UTC and off by the tz offset, so build it by hand.
function nowForDateTimeLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MoveBackToRunBuilderDialog({ jobs, runDate, onClose, onSuccess, onError }: Props) {
  const { speeds, isLoading: speedsLoading } = useRouteViewerLookups(runDate);
  const primary = jobs[0];
  const [speedId, setSpeedId] = useState<number>(primary?.speedId ?? 0);
  const [bookTime, setBookTime] = useState<string>(nowForDateTimeLocal());
  const [keep, setKeep] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bulkIds = useMemo(
    () => jobs.map((j) => j.bulkJobId).filter((id) => id > 0),
    [jobs],
  );

  const canSubmit = !submitting && speedId > 0 && !!bookTime && bulkIds.length > 0;
  const jobLabel = jobs.length === 1 ? 'this job' : `these ${jobs.length} jobs`;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      // Backend contract: `void` = "cancel originals after move". The
      // legacy checkbox is inverted ("Keep Job(s)?" ticked means DO NOT
      // void), so flip here.
      const voidOriginal = !keep;
      await routeViewerService.moveJobsBackToRunBuilder(bulkIds, bookTime, speedId, voidOriginal);
      onSuccess(`Moved ${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'} back to RunBuilder`);
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      onError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Move back to RunBuilder"
      size="md"
      loading={submitting}
      loadingMessage="Sending jobs back to RunBuilder..."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit}>
            {submitting ? 'Moving...' : 'Move to RunBuilder'}
          </Button>
        </div>
      }
    >
      <div className="text-xs text-text-muted mb-3">
        Enter new booking details for {jobLabel}. Original(s) will be cancelled unless you tick Keep.
      </div>

      <div className="grid grid-cols-1 gap-3 text-sm">
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-text-muted">Speed</span>
          <select
            aria-label="Speed"
            value={speedId}
            onChange={(e) => setSpeedId(Number(e.target.value))}
            className="border border-border rounded px-2 py-1"
            disabled={speedsLoading}
          >
            {speedId === 0 && <option value={0}>-- pick a speed --</option>}
            {speeds.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-text-muted">Book Time</span>
          <input
            type="datetime-local"
            aria-label="Book Time"
            step={60}
            value={bookTime}
            onChange={(e) => setBookTime(e.target.value)}
            className="border border-border rounded px-2 py-1"
          />
        </label>

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            aria-label="Keep Jobs"
            checked={keep}
            onChange={(e) => setKeep(e.target.checked)}
            className="mt-1"
          />
          <span className="flex flex-col">
            <span className="text-sm text-text-primary">Keep Job(s)</span>
            <span className="text-[11px] text-text-muted">
              Copy the jobs to RunBuilder without cancelling the originals.
            </span>
          </span>
        </label>
      </div>

      {error && <div className="mt-3 text-xs text-error">{error}</div>}
    </Modal>
  );
}
