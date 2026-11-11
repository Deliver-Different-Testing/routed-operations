import { useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useAuth } from '../../context/AuthContext';
import { request } from '../../services/api';

// Route Viewer Create Event dialog (master Section 7.16). Auto-opens
// after Book Direct Redelivery / Return to Base / Top Up per Section S.2
// (chained event dialog rule). Rendering-only P7 core - Booking landmines
// on the JSON body (Internal + ClientFollowup as true/false, NOT 1/0) are
// preserved in the submit payload.
//
// 2026-11-09 (#1003, Steve D2): Create Job Event is multi-select. With
// `targets` the dialog posts one event per selected job, one after the
// other, and reports "N of M created". Each post carries the tucJob id as
// well as the bulk id, because Route Viewer rows on synthetic route runs
// have bulkJobId 0 and the server now resolves the bulk row from the job
// id (RouteViewerEventService.ResolveBulkJobIdAsync). Jobs that fail stay
// in the dialog so Save retries only those, never re-posting a success.

export interface EventTarget {
  /** tblBulkJob.BulkJobID, 0 when the row has none on screen. */
  bulkJobId: number;
  /** tucJob.ucjbID, 0 when unknown. */
  jobId: number;
  jobNumber: string | null;
}

interface Props {
  /** Single-job caller (CustomerServices): tblBulkJob.BulkJobID. Ignored
   *  when `targets` is supplied. */
  jobId: number;
  jobNumber?: string;
  courierCode?: string | null;
  /** Multi-job caller (RvJobContextMenu): one event per entry. */
  targets?: EventTarget[];
  onClose: () => void;
  /** Called once every target has an event. `summary` is "N of N created". */
  onCreated: (summary?: string) => void;
  /** When true, this dialog auto-opened after a booking - the header
   *  banner tells the operator "your booking succeeded, now log the
   *  event". Optional. */
  chainedFromBooking?: boolean;
}

export function CreateEventDialog({
  jobId, jobNumber, courierCode, targets, onClose, onCreated, chainedFromBooking,
}: Props) {
  const user = useAuth();
  const allTargets: EventTarget[] = targets && targets.length > 0
    ? targets
    : [{ bulkJobId: jobId, jobId: 0, jobNumber: jobNumber ?? null }];
  // Targets still without an event. Shrinks as posts succeed.
  const [pending, setPending] = useState<EventTarget[]>(allTargets);
  const isMulti = allTargets.length > 1;
  const [followupClient, setFollowupClient] = useState(false);   // false = UCL, true = Client
  const [yourName, setYourName] = useState(user.fullName ?? '');
  const [notes, setNotes] = useState('');
  const [clientVisible, setClientVisible] = useState(false);
  const [notifyClient, setNotifyClient] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const failed: Array<{ target: EventTarget; message: string }> = [];
    // Sequential on purpose: one SP call at a time, like the other bulk
    // job actions (useSequentialBulkAction).
    for (const t of pending) {
      try {
        // Section 3.2.1 landmine: BulkEvent bools MUST serialise as
        // true/false (not 1/0). Sending 0/1 makes the SP branch as
        // "flag unset" on both sides because it strict-equals a bool.
        const res = await request<{ response?: { bulkEventId?: number } }>('/runviewer/events', {
          method: 'POST',
          body: JSON.stringify({
            bulkJobId: t.bulkJobId > 0 ? t.bulkJobId : null,
            jobId: t.jobId > 0 ? t.jobId : null,
            courierId: null,
            notes,
            name: yourName,
            internal: !followupClient,
            clientFollowup: !!followupClient,
            clientCreated: !!clientVisible,
            eventDate: new Date().toISOString(),
            notify: !!notifyClient,
          }),
        });
        // The server answers 200 with bulkEventId 0 when it did not
        // create anything (partner session), so 0 is not a success.
        if (!res?.response?.bulkEventId) {
          failed.push({ target: t, message: 'no event was created' });
        }
      } catch (e) {
        failed.push({ target: t, message: (e as Error).message });
      }
    }
    setSubmitting(false);
    const total = allTargets.length;
    const created = total - failed.length;
    if (failed.length === 0) {
      onCreated(`${created} of ${total} created.`);
      return;
    }
    setPending(failed.map((f) => f.target));
    const label = (t: EventTarget) => t.jobNumber ?? `#${t.jobId || t.bulkJobId}`;
    setError(
      `${created} of ${total} created. Failed: ${failed.map((f) => `${label(f.target)} (${f.message})`).join('; ')}`,
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Create event"
      size="md"
      loading={submitting}
      loadingMessage="Saving event..."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!notes || !yourName || submitting}>
            {submitting ? 'Saving...' : 'Save'}
          </Button>
        </div>
      }
    >
      {chainedFromBooking && (
        <div className="mb-2 text-xs bg-brand-cyan/10 border border-brand-cyan/40 rounded px-2 py-1 text-text-primary">
          Booking succeeded - log the event so the customer service thread stays complete.
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <div className="text-xs text-text-muted">{isMulti ? 'Jobs' : 'Job number'}</div>
          <div>
            {isMulti
              ? `${allTargets.length} jobs selected${pending.length < allTargets.length ? ` (${pending.length} left)` : ''}`
              : (allTargets[0].jobNumber ?? `#${jobId}`)}
          </div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Courier code</div>
          <div>{courierCode ?? '-'}</div>
        </div>

        <div className="col-span-2">
          <div className="text-xs text-text-muted mb-1">Follow-up owner</div>
          <div className="flex gap-3">
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                checked={!followupClient}
                onChange={() => setFollowupClient(false)}
                className="accent-brand-cyan"
              />
              UCL
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                checked={followupClient}
                onChange={() => setFollowupClient(true)}
                className="accent-brand-cyan"
              />
              Client
            </label>
          </div>
        </div>

        <label className="flex flex-col gap-0.5 col-span-2">
          <span className="text-xs text-text-muted">Your name *</span>
          <input
            type="text"
            value={yourName}
            onChange={(e) => setYourName(e.target.value)}
            className="border border-border rounded px-2 py-1"
          />
        </label>

        {!user.isNetworkPartner && (
          <>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={clientVisible}
                onChange={(e) => setClientVisible(e.target.checked)}
                className="accent-brand-cyan"
              />
              Client visible
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={notifyClient}
                onChange={(e) => setNotifyClient(e.target.checked)}
                className="accent-brand-cyan"
              />
              Notify client
            </label>
          </>
        )}

        <label className="flex flex-col gap-0.5 col-span-2">
          <span className="text-xs text-text-muted">Notes *</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            className="border border-border rounded px-2 py-1"
          />
        </label>
      </div>

      {error && <div className="mt-2 text-xs text-error">{error}</div>}
    </Modal>
  );
}
