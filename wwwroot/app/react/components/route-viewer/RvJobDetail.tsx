import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { routeViewerService, type BulkJob } from '../../services/routeViewerService';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { tenantDate, tenantDateFromSpString, tenantDateTime, tenantTime, tenantTimeFromSpString } from '../../lib/tenantDate';
import { PodPhotoCarousel } from './PodPhotoCarousel';
import { RvGpsEditModal } from './RvGpsEditModal';
import { EditableInfoRow, InfoRow } from './EditableInfoRow';

// Route Viewer Detail pane. Matches the legacy RunViewer Detail layout
// exactly (2026-08-08 standardisation vs the compact P5 stub):
//   1. Dark grey header "Detail for Job {n}" + print / share / kebab icons
//   2. Right-aligned Transfer Route button on the sub-header row
//   3. Related-jobs tab strip (parent -> LHP -> LH1..LHn -> DEL) with
//      the current tab underlined blue
//   4. 7-tile metric strip: Pricing / Ready / Pickup Window / Picked Up
//      / Dispatched / POD Time / POD Name
//   5. Blue Pickup card + Green Delivery card (arrow icon headers,
//      Address block + Company + Contact + Phone [+ Email on delivery])
//   6. Pickup Notes + Delivery Notes side-by-side
//   7. 4-column info strip: Package / Job / Agent / Courier
//
// NP-aware: Pricing tile + Phone rows hidden for network-partner sessions
// per master Section 7.11 access rules.

interface Props {
  bulkJobId: number | null;
  /** Pre-fetched job from the runJobs cache. When provided (which is
   *  the common case - operator drilled from a run), we skip the
   *  single-job SP fetch entirely because RVW_stpBulkRunJobs returns a
   *  much wider row than RVW_stpBulkJob (has amount, book time,
   *  window, refs, etc.). Only when the operator jumps to a job by
   *  deep-link without a run context do we fall back to the fetch. */
  initialJob?: BulkJob | null;
  /** Fires when the operator clicks a sibling job tab. Passes the
   *  FULL sibling payload (including nested BulkJob) so the parent
   *  can display LH legs that have no tblBulkJob row. */
  onPickSibling?: (sibling: import('../../services/routeViewerService').SiblingJob) => void;
  onTransferRoute?: (job: BulkJob) => void;
  onPrint?: (job: BulkJob) => void;
  onSend?: (job: BulkJob) => void;
  /** Fires when the operator clicks the Client Intel jump icon in
   *  the header. Parent scrolls / focuses its ClientIntel box. Icon
   *  is hidden when this callback is not provided. */
  onJumpToClientIntel?: (job: BulkJob) => void;
  /** When set, the pane renders a Google Maps iframe overlay for the
   *  courier (legacy jobDetail.tpl currentCourier block) INSTEAD of
   *  the normal job detail render. Set by RvCouriersBox click via the
   *  parent. Cleared when a job row is picked. Search query = code +
   *  name because the DTO does not carry a base address. */
  selectedCourier?: { code: string; name: string } | null;
}

export function RvJobDetail({ bulkJobId, initialJob, onPickSibling, onTransferRoute, onPrint, onSend, onJumpToClientIntel, selectedCourier }: Props) {
  const user = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [gpsLeg, setGpsLeg] = useState<'pickup' | 'delivery' | null>(null);

  // Click-to-edit helper: fires the text-fields patch endpoint,
  // invalidates the runJobs query so the parent's cache refreshes so
  // this same pane re-renders with the new value. Errors → toast.
  const saveField = async (bulkJobIdArg: number, patch: Parameters<typeof routeViewerService.updateJobTextFields>[1]) => {
    try {
      await routeViewerService.updateJobTextFields(bulkJobIdArg, patch);
      queryClient.invalidateQueries({ queryKey: ['rv-run-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['rv-job-detail', bulkJobIdArg] });
      toast.show('Saved', 'success');
    } catch (e) {
      toast.show(`Save failed: ${(e as Error).message}`, 'error');
    }
  };

  // Edit-affordance gate. Legacy homeControl.js:6392-6395 disabled
  // editDetailField for non-internal clients; LH legs (bulkJobId=0)
  // also can't be saved because there's no tblBulkJob row for
  // WS_stpBulkJob_Update to target. Both conditions collapse into
  // one readOnly flag consumed by every editable primitive.
  const readOnlyEdit = (currentBulkJobId: number) =>
    currentBulkJobId === 0 || user.clientTypeId !== 'Internal';
  // Two cases for resolving `job`:
  //
  //  (a) Parent handed us an `initialJob` (drilled from a run OR
  //      selected via a sibling tab). Use it DIRECTLY - do not go
  //      through useQuery at all. This matters for LH legs that all
  //      share bulkJobId=0: with them all keyed under
  //      `['rv-job-detail', 0]`, React Query returns cached data
  //      from the previously-viewed leg on every switch, so LH1 →
  //      LH2 → LH3 clicks all display the first-viewed leg. Skipping
  //      the query eliminates the cache collision.
  //
  //  (b) Deep-link entry with only a bulkJobId - fetch via the
  //      narrow single-job SP.
  const skipQuery = initialJob != null;
  const jobQ = useQuery({
    queryKey: ['rv-job-detail', bulkJobId],
    queryFn: () => routeViewerService.getBulkJob(bulkJobId!),
    enabled: bulkJobId != null && bulkJobId > 0 && !skipQuery,
    staleTime: 15_000,
  });
  const job = skipQuery ? initialJob : jobQ.data;

  // Sibling family walk. When the operator lands via deep-link we
  // wait for jobQ.data; when they drilled from a run/tab we already
  // have `initialJob` so the query can fire straight away.
  const siblingsQ = useQuery({
    queryKey: ['rv-job-siblings', job?.jobId],
    queryFn: () => routeViewerService.getJobSiblings(job!.jobId),
    enabled: job != null && (job.jobId ?? 0) > 0,
    staleTime: 15_000,
  });

  const tzOpts = { isUsTenant: user.isUsTenant, timeZone: user.timeZone };

  // Courier iframe overlay (legacy jobDetail.tpl:390-393 currentCourier
  // block). Takes over the pane whenever the parent has a courier
  // selected from the RvCouriersBox. Search query = code + name because
  // the CourierListDto does not expose a base address; the plain-embed
  // URL does not need an API key.
  if (selectedCourier) {
    const q = `${selectedCourier.code} ${selectedCourier.name}`.trim();
    const src = `https://maps.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
    return (
      <div data-testid="courier-map-overlay" className="h-full w-full bg-white">
        <iframe
          title={`Map for courier ${selectedCourier.code}`}
          src={src}
          width="100%"
          height="100%"
          style={{ border: 0 }}
          allowFullScreen
        />
      </div>
    );
  }

  if (bulkJobId == null && initialJob == null) {
    return (
      <div className="p-4 text-xs text-text-muted">
        Select a job from the middle pane to see its detail.
      </div>
    );
  }
  if (!skipQuery && jobQ.isLoading) return <div className="p-4 text-xs text-text-muted">Loading job...</div>;
  if (!skipQuery && jobQ.error) return <div className="p-4 text-xs text-error">Failed: {(jobQ.error as Error).message}</div>;
  if (!job) return null;

  // Pickup Window: prefer the pre-formatted SP string (e.g.
  // "02:00:00 - 02:00:00"), stripping trailing ":00" seconds so we
  // land at "02:00 - 02:00". The SP already normalises across the
  // stamped-first + compute-on-read fallback (runviewer-overview.md
  // Recurring windows section) so the client should NOT re-derive
  // from the DateTime cols (those carry epoch 1900-01-01 which
  // Intl.DateTimeFormat then TZ-shifts to something confusing).
  const pickupWindow = job.pickupWindow
    ? job.pickupWindow.split(' - ').map((t) => t.trim().replace(/:00$/, '')).join(' - ')
    : (job.pickupWindowStart && job.pickupWindowEnd
        ? `${tenantTime(job.pickupWindowStart, tzOpts)} - ${tenantTime(job.pickupWindowEnd, tzOpts)}`
        : '-');

  // READY tile: SP emits DeliveryDate = "dd/MM/yyyy" string + ReadyTime
  // = "HH:MM:SS" string. Both arrive pre-formatted so the helpers just
  // re-shape per tenant (US swaps MM/DD + 12h clock). Do NOT go through
  // Intl.DateTimeFormat - "02:00:00" isn't a parseable Date.
  const readyDate = tenantDateFromSpString(job.bookDate, user.isUsTenant);
  const readyTime = tenantTimeFromSpString(job.bookTime, user.isUsTenant);
  const readyDisplay = (readyDate || readyTime)
    ? [readyDate, readyTime].filter(Boolean).join(' ')
    : '-';

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">
      {/* 1. Dark header. */}
      <div className="bg-slate-600 text-white flex items-center gap-2 px-3 py-2 flex-shrink-0">
        <div className="text-sm font-medium flex-1 truncate">
          Detail for Job {job.jobNumber ?? job.bulkJobId}
        </div>
        {onJumpToClientIntel && (job.clientIntel || (job.deliverToPhone ?? job.phone)) && (
          <IconButton
            title="Jump to Client Intel"
            ariaLabel="Jump to Client Intel"
            onClick={() => onJumpToClientIntel(job)}
          >
            <ClientIntelIcon />
          </IconButton>
        )}
        {job.trackingLink && (
          <IconButton
            title="Open Track-It link"
            ariaLabel="Open Track-It link"
            onClick={() => window.open(job.trackingLink!, '_blank')}
          >
            <TrackItIcon />
          </IconButton>
        )}
        <IconButton title="Print" ariaLabel="Print" onClick={() => onPrint?.(job)}>
          <PrinterIcon />
        </IconButton>
        <IconButton title="Send" ariaLabel="Send" onClick={() => onSend?.(job)}>
          <SendIcon />
        </IconButton>
        <IconButton title="More" ariaLabel="More">
          <KebabIcon />
        </IconButton>
      </div>

      <div className="flex-1 overflow-auto">
        {/* 2. Transfer Route button row */}
        <div className="flex justify-end px-3 py-2 border-b border-border">
          <button
            type="button"
            onClick={() => onTransferRoute?.(job)}
            className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium bg-blue-500 text-white rounded uppercase tracking-wide hover:bg-blue-600"
          >
            <TruckIcon /> Transfer Route
          </button>
        </div>

        {/* 3. Related-jobs tab strip - keyed on tucJob.ucjbID so LH
            legs (which have no tblBulkJob row and thus bulkJobId=0)
            still render + stay clickable. */}
        <SiblingTabs
          currentJobId={job.jobId}
          siblings={siblingsQ.data ?? []}
          onPick={onPickSibling}
        />

        {/* 4. Metric tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 border-b border-border">
          {!user.isNetworkPartner && (
            <MetricCell
              label="Pricing"
              value={job.amount != null ? `$${job.amount.toFixed(2)}` : '-'}
            />
          )}
          <MetricCell
            label="Ready"
            value={readyDisplay}
          />
          <MetricCell label="Pickup Window" value={pickupWindow} />
          <MetricCell
            label="Picked Up"
            value={job.pickedUp ? tenantTime(job.pickedUp, tzOpts) : '-'}
          />
          <MetricCell
            label="Dispatched"
            value={job.dispatched ? tenantTime(job.dispatched, tzOpts) : '-'}
          />
          <MetricCell
            label="POD Time"
            value={job.podTime ? tenantDateTime(job.podTime, tzOpts) : '-'}
          />
          <MetricCell label="POD Name" value={job.podName ?? '-'} />
        </div>

        {/* 5. Pickup + Delivery cards. Right-click either card to open
            the GPS edit modal for that leg. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2">
          <div onContextMenu={(e) => { e.preventDefault(); setGpsLeg('pickup'); }}>
            <AddressCard
              side="pickup"
              title="Pickup"
              address={job.fromAddress ?? '-'}
              addressSub={job.fromSuburb ?? ''}
              company={job.fromCompany}
              contact={job.contact}
              phone={user.isNetworkPartner ? null : job.phone}
              missingCoord={job.pickUpLongitude == null || job.pickUpLatitude == null}
            />
          </div>
          <div onContextMenu={(e) => { e.preventDefault(); setGpsLeg('delivery'); }}>
            <AddressCard
              side="delivery"
              title="Delivery"
              address={job.toAddress ?? '-'}
              addressSub={job.toSuburb ?? ''}
              company={job.toCompany}
              contact={job.deliverToContact}
              phone={user.isNetworkPartner ? null : job.deliverToPhone}
              email={job.trackingEmail}
              missingCoord={
                (job.toLng ?? job.deliveryLongitude) == null
                || (job.toLat ?? job.deliveryLatitude) == null
              }
            />
          </div>
        </div>

        {gpsLeg != null && (
          <RvGpsEditModal
            job={job}
            leg={gpsLeg}
            onClose={() => setGpsLeg(null)}
            onSaved={() => {
              setGpsLeg(null);
              queryClient.invalidateQueries({ queryKey: ['rv-run-jobs'] });
              queryClient.invalidateQueries({ queryKey: ['rv-job-detail', job.bulkJobId] });
            }}
          />
        )}

        {/* POD photo carousel - renders when the job has POD photos. */}
        <PodPhotoCarousel bulkJobId={job.bulkJobId} />

        {/* 6. Pickup + Delivery notes - editable (unless LH-leg / non-internal) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 px-2 pb-2">
          <EditableNotesCard
            title="Pickup Notes"
            text={job.notes}
            readOnly={readOnlyEdit(job.bulkJobId)}
            onSave={(v) => saveField(job.bulkJobId, { notes: v })}
          />
          <EditableNotesCard
            title="Delivery Notes"
            text={job.deliveryNotes ?? job.notes}
            readOnly={readOnlyEdit(job.bulkJobId)}
            onSave={(v) => saveField(job.bulkJobId, { notes: v })}
          />
        </div>

        {/* 7. Info strip - Package / Job / Agent / Courier */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 px-2 pb-2">
          <InfoCard title="Package">
            <InfoRow label="Size" value={job.size} />
            <EditableInfoRow
              label="Items"
              value={job.qty != null ? String(job.qty) : null}
              readOnly={readOnlyEdit(job.bulkJobId)}
              onSave={(v) => saveField(job.bulkJobId, { quantity: parseInt(v) || 1 })}
            />
            <InfoRow label="Speed" value={job.speedName ?? (job.speedId != null ? String(job.speedId) : null)} />
          </InfoCard>
          <InfoCard title="Job">
            <InfoRow label="Job #" value={job.jobNumber} />
            <InfoRow label="Date" value={tenantDateFromSpString(job.bookDate, user.isUsTenant) || null} />
            <InfoRow label="Run Time" value={tenantTimeFromSpString(job.bookTime, user.isUsTenant) || null} />
            <EditableInfoRow
              label="Ref A"
              value={job.refA}
              readOnly={readOnlyEdit(job.bulkJobId)}
              onSave={(v) => saveField(job.bulkJobId, { refA: v })}
            />
            <EditableInfoRow
              label="Ref B"
              value={job.refB}
              readOnly={readOnlyEdit(job.bulkJobId)}
              onSave={(v) => saveField(job.bulkJobId, { refB: v })}
            />
            <EditableInfoRow
              label="Our Ref"
              value={job.ourRef}
              readOnly={readOnlyEdit(job.bulkJobId)}
              onSave={(v) => saveField(job.bulkJobId, { ourRef: v })}
            />
            <InfoRow label="Run Order" value={job.runOrder != null ? String(job.runOrder) : null} />
          </InfoCard>
          <InfoCard title="Agent">
            <InfoRow label="Name" value={job.agentName} />
            <InfoRow label="Type" value={job.agentType} />
            {job.isNpAgent && (
              <div className="pt-1">
                <span className="bg-brand-orange text-white text-[10px] px-1.5 py-0.5 rounded">NP</span>
              </div>
            )}
          </InfoCard>
          <InfoCard title="Courier">
            <InfoRow label="Name" value={job.courierName} />
            <InfoRow label="Code" value={job.courierCode} />
            {/* Courier phone lives in a courier lookup and isn't on the
                job DTO surface yet; leave blank until wired. */}
            <InfoRow label="Phone" value={null} />
          </InfoCard>
        </div>
      </div>
    </div>
  );
}

// ---------- Header icon buttons -----------------------------------

function IconButton({
  title,
  ariaLabel,
  onClick,
  children,
}: {
  title: string;
  ariaLabel?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel ?? title}
      onClick={onClick}
      className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/10 text-white"
    >
      {children}
    </button>
  );
}

function PrinterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 17 20 12 15 7" />
      <path d="M4 18v-2a4 4 0 0 1 4-4h12" />
    </svg>
  );
}

function ClientIntelIcon() {
  // "Info" bubble - matches the legacy Client Intel jump affordance.
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function TrackItIcon() {
  // "External link" glyph - opens the tracking URL in a new tab.
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function KebabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  );
}

function TruckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="3" width="15" height="13" />
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="7" r="4" />
      <path d="M4 22c0-4.4 3.6-8 8-8s8 3.6 8 8" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.9.37 1.78.72 2.6a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.48-1.48a2 2 0 0 1 2.11-.45c.82.35 1.7.59 2.6.72A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  );
}

// ---------- Sibling tab strip ------------------------------------

function SiblingTabs({
  currentJobId,
  siblings,
  onPick,
}: {
  currentJobId: number;
  siblings: Array<import('../../services/routeViewerService').SiblingJob>;
  onPick?: (sibling: import('../../services/routeViewerService').SiblingJob) => void;
}) {
  // Show every sibling the SP returned, keyed by tucJob.ucjbID
  // (jobId). Every tucJob row has a unique ucjbID > 0 whereas
  // bulkJobId is 0 for intermediate LH legs. Match the legacy
  // behaviour: full family visible, clickable regardless of tblBulkJob.
  //
  // Sort matches legacy siblingSortKey() (homeControl.js:345-359):
  //   parent (no *) → *LHP → *LH1..LHn (NUMERIC not alphabetic) → *DEL → other
  // The SP's ORDER BY j.ucjbNumber sorts alphabetically which puts LH10
  // before LH2 - wrong. Re-sort client-side.
  const tabs = useMemo(() => {
    if (siblings.length === 0) {
      return [{ jobId: currentJobId, bulkJobId: 0, jobNumber: null, tabLabel: 'This', jobStatus: null, job: null }];
    }
    const key = (s: import('../../services/routeViewerService').SiblingJob): [number, number, string] => {
      const label = (s.tabLabel ?? '').toUpperCase();
      if (!label.startsWith('*')) return [0, 0, label];   // parent / root
      if (label === '*LHP') return [1, 0, ''];
      if (label === '*DEL') return [3, 0, ''];
      const m = /^\*LH(\d+)$/.exec(label);
      if (m) return [2, parseInt(m[1], 10), ''];
      return [4, 0, label];
    };
    return [...siblings].sort((a, b) => {
      const ka = key(a), kb = key(b);
      if (ka[0] !== kb[0]) return ka[0] - kb[0];
      if (ka[1] !== kb[1]) return ka[1] - kb[1];
      return ka[2].localeCompare(kb[2]);
    });
  }, [siblings, currentJobId]);

  return (
    <div className="flex items-center gap-4 px-3 border-b border-border overflow-x-auto">
      {tabs.map((t) => {
        const active = t.jobId === currentJobId;
        return (
          <button
            key={t.jobId}
            type="button"
            onClick={() => { if (!active && onPick) onPick(t); }}
            disabled={active}
            className={`py-2 text-sm whitespace-nowrap transition-colors ${
              active
                ? 'text-blue-500 border-b-2 border-blue-500 font-medium cursor-default'
                : 'text-text-muted hover:text-text-primary cursor-pointer'
            }`}
          >
            {t.tabLabel || t.jobNumber || `#${t.jobId}`}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Metric tile ------------------------------------------

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2 border-r border-border last:border-r-0 text-center">
      <div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className="text-sm text-text-primary mt-1 truncate">{value}</div>
    </div>
  );
}

// ---------- Address card (Pickup / Delivery) ---------------------

function AddressCard({
  side,
  title,
  address,
  addressSub,
  company,
  contact,
  phone,
  email,
  missingCoord,
}: {
  side: 'pickup' | 'delivery';
  title: string;
  address: string;
  addressSub: string;
  company: string | null | undefined;
  contact: string | null | undefined;
  phone: string | null | undefined;
  email?: string | null | undefined;
  /** True when this leg has no lat/lng - render the card with an
   *  error-red border so the operator knows to right-click and Fix
   *  GPS. Mirrors legacy jobDetail.tpl `ng-class fromLng ? '' : 'red'`. */
  missingCoord?: boolean;
}) {
  const headerBg = side === 'pickup' ? 'bg-blue-500' : 'bg-green-500';
  const Arrow = side === 'pickup' ? ArrowUpIcon : ArrowDownIcon;
  const borderCls = missingCoord ? 'border-2 border-error' : 'border border-border';
  return (
    <div
      data-testid={`address-card-${side}`}
      data-missing-coord={missingCoord ? 'true' : 'false'}
      className={`${borderCls} rounded overflow-hidden bg-white`}
    >
      <div className={`${headerBg} text-white flex items-center gap-2 px-3 py-1.5 font-medium uppercase tracking-wide text-xs`}>
        <Arrow /> {title}
      </div>

      {/* Address block */}
      <div className="px-3 py-2 border-b border-border">
        <div className="text-sm text-text-primary">{address}</div>
        {addressSub && <div className="text-xs text-text-muted mt-0.5">{addressSub}</div>}
      </div>

      <AddressRow label="Company" value={company} />
      <AddressRow label="Contact" value={contact} icon={<PersonIcon />} />
      <AddressRow label="Phone" value={phone} icon={<PhoneIcon />} />
      {email !== undefined && (
        <AddressRow label="Email" value={email} />
      )}
    </div>
  );
}

function AddressRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | null | undefined;
  icon?: React.ReactNode;
}) {
  return (
    <div className="px-3 py-2 border-b border-border last:border-b-0">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-text-muted">
        {icon}
        {label}
      </div>
      <div className="text-sm text-text-primary mt-0.5">
        {value || <span className="text-text-muted">-</span>}
      </div>
    </div>
  );
}

// ---------- Notes card -------------------------------------------

function NotesCard({ title, text }: { title: string; text: string | null | undefined }) {
  return (
    <div className="border border-border rounded bg-white">
      <div className="px-3 py-1.5 border-b border-border text-[10px] uppercase tracking-wide text-text-muted font-medium">
        {title}
      </div>
      <div className="px-3 py-2 text-sm text-text-primary whitespace-pre-wrap">
        {text || <span className="text-text-muted">-</span>}
      </div>
    </div>
  );
}

// ---------- Info card + row --------------------------------------

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded bg-white">
      <div className="px-3 py-1.5 border-b border-border text-[11px] font-semibold text-text-muted uppercase tracking-wide bg-surface-cream/60">
        {title}
      </div>
      <div className="divide-y divide-border/50">{children}</div>
    </div>
  );
}

/** Click-to-edit variant of NotesCard. Displays whitespace-preserved
 *  text; click swaps the body to a textarea; Ctrl+Enter (or blur) saves,
 *  Escape cancels. When `readOnly` (LH-leg or non-internal client)
 *  hides the edit button and keeps the body static. */
function EditableNotesCard({
  title,
  text,
  onSave,
  readOnly,
}: {
  title: string;
  text: string | null | undefined;
  onSave: (v: string) => void | Promise<void>;
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(text ?? '');

  const commit = () => {
    setEditing(false);
    if (draft !== (text ?? '')) onSave(draft);
  };

  return (
    <div className="border border-border rounded bg-white">
      <div className="px-3 py-1.5 border-b border-border text-[10px] uppercase tracking-wide text-text-muted font-medium flex items-center gap-2">
        <span>{title}</span>
        {!editing && !readOnly && (
          <button
            type="button"
            onClick={() => { setDraft(text ?? ''); setEditing(true); }}
            className="ml-auto text-[10px] text-brand-cyan hover:underline"
          >
            edit
          </button>
        )}
      </div>
      <div className="px-3 py-2 text-sm text-text-primary">
        {editing ? (
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit();
              if (e.key === 'Escape') { setEditing(false); setDraft(text ?? ''); }
            }}
            rows={3}
            className="w-full border border-brand-cyan rounded px-2 py-1 text-sm"
          />
        ) : (
          <div className="whitespace-pre-wrap">
            {text || <span className="text-text-muted">-</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export type { BulkJob };
