import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useConfirm, useAlert } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { useSequentialBulkAction } from '../../hooks/useSequentialBulkAction';
import { routeViewerService, type BulkJob } from '../../services/routeViewerService';
import { AssignRouteDialog } from './AssignRouteDialog';
import { TransferRouteDialog } from './TransferRouteDialog';
import { BookRedeliveryDialog } from './BookRedeliveryDialog';
import { CreateEventDialog } from './CreateEventDialog';
import { TopUpDialog } from './TopUpDialog';
import { CreateIntelDialog } from './CreateIntelDialog';
import { MoveBackToRunBuilderDialog } from './MoveBackToRunBuilderDialog';

// Route Viewer job-list right-click menu (master Section 7.10
// jobListMenu). Fires against the CURRENTLY SELECTED set (one or many
// jobs). Bulk actions use useSequentialBulkAction so 20-job selections
// don't stampede the SP thread pool (150ms gap per master F1).
//
// NP branch (Section 7.10) collapses to just Assign Courier + Create
// Job Event. Admin sees the full menu.

interface Props {
  x: number;
  y: number;
  jobs: BulkJob[];               // selection - length >= 1
  /** Current filters.runDate from RunViewer. Piped into the Move-back
   *  dialog so the speed dropdown queries the correct date-scoped
   *  useRouteViewerLookups snapshot. Optional (falls back to today) so
   *  callers not yet updated do not crash. */
  runDate?: string;
  onClose: () => void;
  onDone: () => void;             // fires after successful mutation - parent refetches
}

export function RvJobContextMenu({ x, y, jobs, runDate, onClose, onDone }: Props) {
  const user = useAuth();
  const confirm = useConfirm();
  const alert = useAlert();
  const toast = useToast();
  const { run, running, progress } = useSequentialBulkAction<BulkJob, unknown>();
  const menuRef = useRef<HTMLDivElement>(null);

  const [assignOpen, setAssignOpen] = useState(false);
  const [transferRouteOpen, setTransferRouteOpen] = useState(false);
  const [bookRedeliveryOpen, setBookRedeliveryOpen] = useState(false);
  // Legacy has three booking dialogs (Redelivery / RTB / TopUp) that
  // share one endpoint - the mode discriminator switches title +
  // JobNotificationType default so operators pick the right flow.
  const [bookMode, setBookMode] = useState<'redelivery' | 'return-to-base'>('redelivery');
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  // Section S.2 landmine: when the CreateEvent dialog auto-opens after
  // a successful booking (Redelivery / TopUp), the dialog banner reads
  // "your booking succeeded, now log the event". Manual opens keep
  // this false so operators don't see a stale success banner.
  const [eventChainedFromBooking, setEventChainedFromBooking] = useState(false);
  const [intelOpen, setIntelOpen] = useState(false);
  const [moveBackOpen, setMoveBackOpen] = useState(false);

  const primary = jobs[0];
  const isBulk = jobs.length > 1;
  const anyDialogOpen = assignOpen || transferRouteOpen || bookRedeliveryOpen || topUpOpen || eventOpen || intelOpen || moveBackOpen;

  useEffect(() => {
    if (anyDialogOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, anyDialogOpen]);

  const pluralJob = () => isBulk ? `these ${jobs.length} jobs` : 'this job';
  const jobIds = () => jobs.map((j) => j.jobId).filter((id) => id > 0);
  const bulkIds = () => jobs.map((j) => j.bulkJobId).filter((id) => id > 0);

  const bulkRun = async (label: string, fn: (job: BulkJob) => Promise<unknown>, danger = false) => {
    onClose();
    if (!(await confirm({
      title: `${label} ${pluralJob()}`,
      message: `Apply "${label}" to ${pluralJob()}?`,
      danger,
    }))) return;
    const result = await run(jobs, fn, 150);
    if (result.failed.length > 0) {
      await alert({
        title: `${label} - partial`,
        message: `${result.ok.length} succeeded, ${result.failed.length} failed:\n${result.failed.map((f) => (f.item as BulkJob).jobNumber ?? '#').join(', ')}`,
      });
    } else {
      toast.show(`${label}: ${result.ok.length} ${result.ok.length === 1 ? 'job' : 'jobs'}`, 'success');
    }
    onDone();
  };

  const doActivate = () => bulkRun('Activate', (j) => routeViewerService.activateJob(j.jobId));
  const doPickup = () => bulkRun('Pickup', (j) => routeViewerService.pickupJob(j.jobId));
  const doMissing = () => bulkRun('Missing', (j) => routeViewerService.missingJob(j.jobId), true);
  // Release Job wraps RVW_stpReleaseJob per legacy homeControl job menu.
  // Soft release - clears the courier assignment without moving the job
  // back to RunBuilder. Distinct from Void / Cancel.
  const doRelease = () => bulkRun('Release', (j) => routeViewerService.releaseJob(j.jobId), true);
  const doComplete = async () => {
    onClose();
    const podName = window.prompt('POD Name (recipient signature)') ?? '';
    if (!podName.trim()) return;
    await bulkRunSimple('Complete', (j) => routeViewerService.completeJob(j.jobId, podName, null));
  };
  const doMakeLmc = async () => {
    onClose();
    if (!(await confirm({
      title: 'Make LMC',
      message: `Mark ${pluralJob()} as Left Message Card?`,
    }))) return;
    const result = await run(jobs, (j) => routeViewerService.lmcJob(j.jobId, j.bulkJobId, j.courierCode ?? ''), 150);
    reportResult('Make LMC', result);
    onDone();
  };
  const doVoid = async () => {
    onClose();
    if (!(await confirm({
      title: 'Void jobs',
      message: `Void ${pluralJob()}? This CANNOT be undone.`,
      danger: true,
      confirmLabel: 'Void',
    }))) return;
    try {
      await routeViewerService.cancelJobs(bulkIds());
      toast.show(`Voided ${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'}`, 'success');
      onDone();
    } catch (e) {
      await alert({ title: 'Void failed', message: (e as Error).message });
    }
  };
  const doSendSms = async () => {
    onClose();
    const message = window.prompt('SMS message (max 320 chars)') ?? '';
    if (!message.trim()) return;
    const result = await run(
      jobs,
      (j) => routeViewerService.sendSmsToJob(j.jobId, j.proofOfDeliveryMobile ?? j.deliverToPhone ?? '', message),
      150,
    );
    reportResult('Send SMS', result);
    onDone();
  };
  // Tier 2 flow: opens the full MoveBackToRunBuilderDialog (Speed +
  // Book Time + Keep checkbox) instead of the Tier 1 window.confirm().
  // The dialog owns the submit + backend call; success/error hooks
  // relay to toast + onDone here.
  const doMoveBackToRunBuilder = () => {
    setMoveBackOpen(true);
  };

  const bulkRunSimple = async (label: string, fn: (job: BulkJob) => Promise<unknown>) => {
    const result = await run(jobs, fn, 150);
    reportResult(label, result);
    onDone();
  };

  const reportResult = (label: string, result: { ok: unknown[]; failed: Array<{ item: unknown; error: Error }> }) => {
    if (result.failed.length > 0) {
      alert({
        title: `${label} - partial`,
        message: `${result.ok.length} succeeded, ${result.failed.length} failed`,
      });
    } else {
      toast.show(`${label}: ${result.ok.length} ${result.ok.length === 1 ? 'job' : 'jobs'}`, 'success');
    }
  };

  return (
    <>
      <div
        ref={menuRef}
        className={`fixed z-50 bg-surface-white border border-border rounded-md shadow-lg py-1 text-sm min-w-[18rem] ${
          anyDialogOpen ? 'hidden' : ''
        }`}
        style={{ left: x, top: y }}
      >
        <div className="px-3 py-1 text-[10px] uppercase text-text-muted border-b border-border">
          {isBulk ? `${jobs.length} jobs selected` : primary.jobNumber ?? `Job #${primary.bulkJobId}`}
          {running && (
            <span className="ml-2 text-brand-cyan">Running... {progress.done}/{progress.total}</span>
          )}
        </div>

        {!user.isNetworkPartner && (
          <>
            <MenuItem onClick={doActivate} disabled={running}>Activate</MenuItem>
            <MenuItem onClick={() => { setTransferRouteOpen(true); }} disabled={running || isBulk}>
              Transfer Route
            </MenuItem>
            <MenuItem onClick={() => setAssignOpen(true)} disabled={running || isBulk}>
              Transfer Courier
            </MenuItem>
            <MenuItem onClick={doSendSms} disabled={running}>Send SMS</MenuItem>
            <MenuItem onClick={doMoveBackToRunBuilder} disabled={running}>
              Move back to RunBuilder
            </MenuItem>

            <div className="border-t border-border my-1" />
            <MenuItem onClick={doPickup} disabled={running}>Pickup</MenuItem>
            <MenuItem onClick={doMissing} disabled={running}>Missing</MenuItem>
            <MenuItem onClick={doComplete} disabled={running}>Complete</MenuItem>
            <MenuItem onClick={doMakeLmc} disabled={running}>Make LMC</MenuItem>
            <MenuItem onClick={doRelease} disabled={running}>Release</MenuItem>
            <MenuItem onClick={doVoid} disabled={running}>Void</MenuItem>

            <div className="border-t border-border my-1" />
            <MenuItem onClick={() => { setBookMode('redelivery'); setBookRedeliveryOpen(true); }} disabled={running || isBulk}>
              Book Direct Redelivery
            </MenuItem>
            <MenuItem onClick={() => { setBookMode('return-to-base'); setBookRedeliveryOpen(true); }} disabled={running || isBulk}>
              Return to Base
            </MenuItem>
            <MenuItem onClick={() => setTopUpOpen(true)} disabled={running || isBulk}>
              Top Up
            </MenuItem>
          </>
        )}

        {user.isNetworkPartner && (
          <MenuItem onClick={() => setAssignOpen(true)} disabled={running || isBulk}>
            Assign Courier
          </MenuItem>
        )}

        <div className="border-t border-border my-1" />
        <MenuItem onClick={() => setEventOpen(true)} disabled={running || isBulk}>
          Create Job Event
        </MenuItem>
        <MenuItem onClick={() => setIntelOpen(true)} disabled={running || isBulk || !primary.proofOfDeliveryMobile}>
          Create Client Intel
        </MenuItem>
      </div>

      {assignOpen && (
        <AssignRouteDialog
          // Job menu is already scoped to the operator's current
          // selection; hand those tucJob ids straight to the dialog
          // per the legacy Run Viewer pattern (caller owns scope).
          // Under the pre-2026-09-18 shape the dialog re-fetched the
          // whole run and assigned every job on it, ignoring the
          // selection - George's Medical-Prod bug.
          jobIds={jobIds()}
          runLabel={
            jobs.length === 1
              ? `Job ${primary.jobNumber ?? `#${primary.jobId}`}`
              : `${jobs.length} selected jobs`
          }
          anchorJobId={primary.jobId}
          onClose={() => { setAssignOpen(false); onClose(); }}
          onSuccess={(msg) => { setAssignOpen(false); onClose(); toast.show(msg, 'success'); onDone(); }}
        />
      )}
      {transferRouteOpen && (
        <TransferRouteDialog
          runId={primary.bulkRunId ?? 0}
          jobs={jobs.map((j) => ({
            jobId: j.jobId,
            jobNumber: j.jobNumber,
            fromAddress: j.fromAddress,
            currentRouteName: j.runName,
          }))}
          onClose={() => { setTransferRouteOpen(false); onClose(); }}
          onSuccess={(msg) => { setTransferRouteOpen(false); onClose(); toast.show(msg, 'success'); onDone(); }}
        />
      )}
      {bookRedeliveryOpen && (
        <BookRedeliveryDialog
          sourceJobId={primary.bulkJobId}
          mode={bookMode}
          onClose={() => { setBookRedeliveryOpen(false); onClose(); }}
          onBooked={(newJobId) => {
            setBookRedeliveryOpen(false);
            toast.show(`Redelivery booked (job #${newJobId})`, 'success');
            // Section S.2: chain to Create Event after successful booking
            // so operators can log the follow-up event in one flow.
            setEventChainedFromBooking(true);
            setEventOpen(true);
          }}
        />
      )}
      {topUpOpen && (
        <TopUpDialog
          jobId={primary.bulkJobId}
          jobNumber={primary.jobNumber ?? undefined}
          onClose={() => { setTopUpOpen(false); onClose(); }}
          onBooked={() => {
            setTopUpOpen(false);
            toast.show('Top up booked.', 'success');
            // Section S.2: same chain-to-event flow as Redelivery so the
            // TopUp booking gets its follow-up event log entry.
            setEventChainedFromBooking(true);
            setEventOpen(true);
          }}
        />
      )}
      {eventOpen && (
        <CreateEventDialog
          jobId={primary.bulkJobId}
          jobNumber={primary.jobNumber ?? undefined}
          courierCode={primary.courierCode}
          chainedFromBooking={eventChainedFromBooking}
          onClose={() => { setEventOpen(false); setEventChainedFromBooking(false); onClose(); }}
          onCreated={() => { setEventOpen(false); setEventChainedFromBooking(false); onClose(); toast.show('Event created.', 'success'); onDone(); }}
        />
      )}
      {intelOpen && primary.proofOfDeliveryMobile && (
        <CreateIntelDialog
          mobile={primary.proofOfDeliveryMobile}
          onClose={() => { setIntelOpen(false); onClose(); }}
          onCreated={() => { setIntelOpen(false); onClose(); toast.show('Client intel saved.', 'success'); onDone(); }}
        />
      )}
      {moveBackOpen && (
        <MoveBackToRunBuilderDialog
          jobs={jobs}
          runDate={runDate ?? new Date().toISOString().slice(0, 10)}
          onClose={() => { setMoveBackOpen(false); onClose(); }}
          onSuccess={(msg) => {
            setMoveBackOpen(false);
            onClose();
            toast.show(msg, 'success');
            onDone();
          }}
          onError={(msg) => { toast.show(msg, 'error'); }}
        />
      )}
    </>
  );
}

function MenuItem({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`w-full text-left px-3 py-1.5 ${
        disabled
          ? 'text-text-muted cursor-not-allowed'
          : 'text-text-primary hover:bg-brand-cyan/10 cursor-pointer'
      }`}
    >
      {children}
    </button>
  );
}
