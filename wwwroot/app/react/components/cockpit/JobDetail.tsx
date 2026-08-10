import { useEffect, useState } from 'react';
import type { BulkJob, Speed } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { postcodeLabel } from '../../lib/tenantLabels';
import { jobService } from '../../services/jobService';

interface Props {
  job: BulkJob | null;
  speeds: Speed[];
  onUpdateField: (jobId: number, field: string, value: string) => Promise<void>;
  onOpenGpsFix?: (job: BulkJob, leg?: 'ToAddress' | 'FromAddress') => void;
}

/**
 * Route Builder Detail pane. Same visual layout as the Route Viewer
 * legacy-style Detail (dark header w/ icons + Transfer Route button +
 * metric strip + blue/green Pickup + Delivery cards + notes + 4-col
 * info strip) but every field remains click-to-edit. The Route Builder
 * doesn't have a scan-history sibling list, so the tab strip is
 * suppressed - everything else matches the Route Viewer exactly.
 */
export function JobDetail(props: Props) {
  const { speeds, onUpdateField, onOpenGpsFix } = props;
  let job = props.job;
  const { isUsTenant } = useAuth();
  const zipLabel = postcodeLabel(isUsTenant, true);

  const [extras, setExtras] = useState<{
    bulkJobId: number;
    notes: string | null;
    trackingEmail: string | null;
    trackingMobile: string | null;
    proofOfDeliveryEmail: string | null;
    proofOfDeliveryMobile: string | null;
  } | null>(null);
  useEffect(() => {
    if (!job) { setExtras(null); return; }
    let cancelled = false;
    jobService.getDetail(job.bulkJobId)
      .then((res) => { if (!cancelled) setExtras(res); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [job?.bulkJobId]);
  const effectiveJob: BulkJob | null = job && extras && extras.bulkJobId === job.bulkJobId
    ? {
        ...job,
        notes: extras.notes ?? job.notes,
        trackingEmail: extras.trackingEmail ?? job.trackingEmail,
        trackingMobile: extras.trackingMobile ?? job.trackingMobile,
        proofOfDeliveryEmail: extras.proofOfDeliveryEmail ?? job.proofOfDeliveryEmail,
        proofOfDeliveryMobile: extras.proofOfDeliveryMobile ?? job.proofOfDeliveryMobile,
      }
    : job;

  const [addrMenu, setAddrMenu] = useState<
    { x: number; y: number; leg: 'FromAddress' | 'ToAddress' } | null
  >(null);
  useEffect(() => {
    if (!addrMenu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAddrMenu(null); };
    const onClick = () => setAddrMenu(null);
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, [addrMenu]);

  if (!job) {
    return (
      <div className="h-full flex flex-col bg-white">
        <div className="bg-slate-600 text-white px-3 py-2 text-sm font-medium">
          Detail for Job
        </div>
        <div className="p-4 text-sm text-text-muted">Select a job to see its details.</div>
      </div>
    );
  }

  job = effectiveJob!;
  const save = (field: string, value: string) => onUpdateField(job.bulkJobId, field, value);
  const openAddrMenu = (e: React.MouseEvent, leg: 'FromAddress' | 'ToAddress') => {
    if (!onOpenGpsFix) return;
    e.preventDefault();
    e.stopPropagation();
    setAddrMenu({ x: e.clientX, y: e.clientY, leg });
  };

  const speedLabel = speeds.find((s) => s.id === job.speed)?.label ?? job.speedName ?? '-';

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">
      {/* Dark header */}
      <div className="bg-slate-600 text-white flex items-center gap-2 px-3 py-2 flex-shrink-0">
        <div className="text-sm font-medium flex-1 truncate">
          Detail for Job {job.jobNumber ?? job.bulkJobId}
        </div>
        <IconButton title="Print"><PrinterIcon /></IconButton>
        <IconButton title="Send"><SendIcon /></IconButton>
        <IconButton title="More"><KebabIcon /></IconButton>
      </div>

      <div className="flex-1 overflow-auto">
        {/* Transfer Route / Fix GPS actions */}
        <div className="flex justify-end gap-2 px-3 py-2 border-b border-border">
          {onOpenGpsFix && (
            <button
              type="button"
              onClick={() => onOpenGpsFix(job)}
              className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium border border-brand-purple text-brand-purple rounded uppercase tracking-wide hover:bg-brand-purple/10"
            >
              Fix GPS
            </button>
          )}
        </div>

        {/* Metric tiles - a mix of editable values (Pricing, Ready) and
            readonly context values (Run / Schedule / Cubic). */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 border-b border-border">
          <MetricCell label="Pricing">
            <EditableCell value={job.amount != null ? String(job.amount) : ''} onSave={(v) => save('Amount', v)} />
          </MetricCell>
          <MetricCell label="Ready">
            <EditableCell
              value={job.bookTime ? formatTime(job.bookTime) : ''}
              onSave={(v) => save('BookTime', v)}
              placeholder="HH:MM"
            />
          </MetricCell>
          <MetricCell label="Pickup Window">
            {formatWindow(job.scheduleWindowStart, job.scheduleWindowEnd)}
          </MetricCell>
          <MetricCell label="Speed">
            <EditableSelect
              value={String(job.speed)}
              options={speeds.map((s) => ({ value: String(s.id), label: s.label }))}
              onSave={(v) => save('Speed', v)}
            />
          </MetricCell>
          <MetricCell label="Run">{job.runName ?? '-'}</MetricCell>
          <MetricCell label="Schedule">{job.scheduleName ?? '-'}</MetricCell>
          <MetricCell label="Cubic">
            {job.jobCubicM3 ? `${Number(job.jobCubicM3).toFixed(3)} m3` : '-'}
          </MetricCell>
        </div>

        {/* Pickup + Delivery cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2">
          <div onContextMenu={(e) => openAddrMenu(e, 'FromAddress')}>
            <AddressCard side="pickup" title="Pickup">
              <AddressBlock
                address={<EditableCell value={job.fromAddress ?? ''} onSave={(v) => save('FromAddress', v)} multiline />}
                addressSub={<EditableCell value={job.fromSuburb ?? ''} onSave={(v) => save('FromSuburb', v)} />}
              />
              <AddressRow label="Company"><EditableCell value={job.fromCompany ?? ''} onSave={(v) => save('FromCompany', v)} /></AddressRow>
              <AddressRow label="Contact" icon={<PersonIcon />}>
                <EditableCell value={job.contact ?? ''} onSave={(v) => save('Contact', v)} />
              </AddressRow>
              <AddressRow label={zipLabel}>
                <EditableCell value={job.fromPostCode?.toString() ?? ''} onSave={(v) => save('FromPostCode', v)} />
              </AddressRow>
              <AddressRow label="GPS">
                <span className={job.pickUpLatitude ? '' : 'text-error'}>
                  {job.pickUpLatitude ? `${job.pickUpLatitude}, ${job.pickUpLongitude}` : 'missing'}
                </span>
              </AddressRow>
            </AddressCard>
          </div>

          <div onContextMenu={(e) => openAddrMenu(e, 'ToAddress')}>
            <AddressCard side="delivery" title="Delivery">
              <AddressBlock
                address={<EditableCell value={job.toAddress ?? ''} onSave={(v) => save('ToAddress', v)} multiline />}
                addressSub={<EditableCell value={job.toSuburb ?? ''} onSave={(v) => save('ToSuburb', v)} />}
              />
              <AddressRow label="Company"><EditableCell value={job.toCompany ?? ''} onSave={(v) => save('ToCompany', v)} /></AddressRow>
              <AddressRow label="Recipient" icon={<PersonIcon />}>
                <EditableCell value={job.deliverToContact ?? ''} onSave={(v) => save('DeliverToContact', v)} />
              </AddressRow>
              <AddressRow label="Phone" icon={<PhoneIcon />}>
                <EditableCell value={job.deliverToPhone ?? ''} onSave={(v) => save('DeliverToPhone', v)} />
              </AddressRow>
              <AddressRow label={zipLabel}>
                <EditableCell value={job.toPostCode?.toString() ?? ''} onSave={(v) => save('ToPostCode', v)} />
              </AddressRow>
              <AddressRow label="Email">
                <EditableCell value={job.trackingEmail ?? ''} onSave={(v) => save('TrackingEmail', v)} />
              </AddressRow>
              <AddressRow label="GPS">
                <span className={job.deliveryLatitude ? '' : 'text-error'}>
                  {job.deliveryLatitude ? `${job.deliveryLatitude}, ${job.deliveryLongitude}` : 'missing'}
                </span>
              </AddressRow>
            </AddressCard>
          </div>
        </div>

        {/* Notes side-by-side. Route Builder has one notes stream so we
            surface the same text under both slots - matches the
            legacy Detail layout. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 px-2 pb-2">
          <NotesCard title="Pickup Notes">
            <EditableCell value={job.notes ?? ''} onSave={(v) => save('Notes', v)} multiline />
          </NotesCard>
          <NotesCard title="Delivery Notes">
            <EditableCell value={job.notes ?? ''} onSave={(v) => save('Notes', v)} multiline />
          </NotesCard>
        </div>

        {/* Info strip: Package / Job / Tracking + POD / Courier */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 px-2 pb-2">
          <InfoCard title="Package">
            <InfoRow label="Size"><EditableCell value={String(job.size ?? '')} onSave={(v) => save('Size', v)} /></InfoRow>
            <InfoRow label="Items"><EditableCell value={String(job.qty ?? '')} onSave={(v) => save('Qty', v)} /></InfoRow>
            <InfoRow label="Weight"><EditableCell value={String(job.weight ?? '')} onSave={(v) => save('Weight', v)} /></InfoRow>
            <InfoRow label="Speed"><span>{speedLabel}</span></InfoRow>
            <InfoRow label="Sig not req">
              <BooleanCheckbox
                value={job.okToLeave ?? false}
                onSave={(v) => save('OkToLeave', v ? 'true' : 'false')}
              />
            </InfoRow>
          </InfoCard>
          <InfoCard title="Job">
            <InfoRow label="Job #"><EditableCell value={job.jobNumber ?? ''} onSave={(v) => save('JobNumber', v)} /></InfoRow>
            <InfoRow label="Date">
              <EditableCell
                value={job.bookDate ? new Date(job.bookDate).toLocaleDateString('en-GB') : ''}
                onSave={(v) => save('BookDate', v)}
                placeholder="dd/mm/yyyy"
              />
            </InfoRow>
            <InfoRow label="Client">{job.clientCode ?? '-'}</InfoRow>
            <InfoRow label="Ref A"><EditableCell value={job.clientRefa ?? ''} onSave={(v) => save('ClientRefa', v)} /></InfoRow>
            <InfoRow label="Ref B"><EditableCell value={job.clientRefb ?? ''} onSave={(v) => save('ClientRefb', v)} /></InfoRow>
            <InfoRow label="Our Ref"><EditableCell value={job.ourRef ?? ''} onSave={(v) => save('OurRef', v)} /></InfoRow>
            <InfoRow label="Barcode"><EditableCell value={job.barcode ?? ''} onSave={(v) => save('Barcode', v)} /></InfoRow>
          </InfoCard>
          <InfoCard title="Tracking / POD">
            <InfoRow label="Track Email"><EditableCell value={job.trackingEmail ?? ''} onSave={(v) => save('TrackingEmail', v)} /></InfoRow>
            <InfoRow label="Track Mobile"><EditableCell value={job.trackingMobile ?? ''} onSave={(v) => save('TrackingMobile', v)} /></InfoRow>
            <InfoRow label="POD Email"><EditableCell value={job.proofOfDeliveryEmail ?? ''} onSave={(v) => save('ProofOfDeliveryEmail', v)} /></InfoRow>
            <InfoRow label="POD Mobile"><EditableCell value={job.proofOfDeliveryMobile ?? ''} onSave={(v) => save('ProofOfDeliveryMobile', v)} /></InfoRow>
          </InfoCard>
          <InfoCard title="Courier">
            <InfoRow label="Name">{job.courierName ?? '-'}</InfoRow>
            <InfoRow label="Run">{job.runName ?? '-'}</InfoRow>
            <InfoRow label="Run Order">{job.runOrder != null ? String(job.runOrder) : '-'}</InfoRow>
          </InfoCard>
        </div>
      </div>

      {addrMenu && onOpenGpsFix && (
        <ul
          className="fixed z-50 bg-surface-white border border-border rounded shadow-lg text-xs min-w-40"
          style={{ top: addrMenu.y, left: addrMenu.x }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <li className="px-3 py-2 bg-surface-cream border-b border-border-light font-medium text-text-primary">
            {addrMenu.leg === 'FromAddress' ? 'Pickup address' : 'Delivery address'}
          </li>
          <li>
            <button
              type="button"
              onClick={() => { onOpenGpsFix(job, addrMenu.leg); setAddrMenu(null); }}
              className="w-full text-left px-3 py-1.5 hover:bg-surface-cream text-text-primary"
            >
              Update GPS...
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

// ---------- Icons (kept in-file so JobDetail is self-contained) --

function IconButton({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
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
function KebabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
    </svg>
  );
}
function PersonIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="7" r="4" /><path d="M4 22c0-4.4 3.6-8 8-8s8 3.6 8 8" />
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
      <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
    </svg>
  );
}
function ArrowDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" />
    </svg>
  );
}

// ---------- Layout primitives -----------------------------------

function MetricCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-2 border-r border-border last:border-r-0 text-center">
      <div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className="text-sm text-text-primary mt-1 truncate">{children}</div>
    </div>
  );
}

function AddressCard({ side, title, children }: { side: 'pickup' | 'delivery'; title: string; children: React.ReactNode }) {
  const headerBg = side === 'pickup' ? 'bg-blue-500' : 'bg-green-500';
  const Arrow = side === 'pickup' ? ArrowUpIcon : ArrowDownIcon;
  return (
    <div className="border border-border rounded overflow-hidden bg-white">
      <div className={`${headerBg} text-white flex items-center gap-2 px-3 py-1.5 font-medium uppercase tracking-wide text-xs`}>
        <Arrow /> {title}
      </div>
      {children}
    </div>
  );
}
function AddressBlock({ address, addressSub }: { address: React.ReactNode; addressSub: React.ReactNode }) {
  return (
    <div className="px-3 py-2 border-b border-border">
      <div className="text-sm text-text-primary">{address}</div>
      <div className="text-xs text-text-muted mt-0.5">{addressSub}</div>
    </div>
  );
}
function AddressRow({ label, children, icon }: { label: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="px-3 py-2 border-b border-border last:border-b-0">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-text-muted">
        {icon}
        {label}
      </div>
      <div className="text-sm text-text-primary mt-0.5">{children}</div>
    </div>
  );
}
function NotesCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded bg-white">
      <div className="px-3 py-1.5 border-b border-border text-[10px] uppercase tracking-wide text-text-muted font-medium">
        {title}
      </div>
      <div className="px-3 py-2 text-sm text-text-primary">
        {children}
      </div>
    </div>
  );
}
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
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 text-sm">
      <span className="text-[11px] uppercase tracking-wide text-text-muted">{label}</span>
      <span className="text-text-primary text-right">{children}</span>
    </div>
  );
}

// ---------- Editors (unchanged behaviour) ----------------------

function formatWindow(start: string | null, end: string | null): string {
  if (!start || !end) return '-';
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
  };
  return `${fmt(start)} - ${fmt(end)}`;
}
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  } catch { return ''; }
}
function EditableCell({
  value, onSave, placeholder, multiline,
}: {
  value: string; onSave: (v: string) => Promise<void>; placeholder?: string; multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const commit = async () => {
    if (draft !== value) { try { await onSave(draft); } catch {} }
    setEditing(false);
  };
  if (!editing) {
    return (
      <span
        onClick={() => { setDraft(value); setEditing(true); }}
        className="cursor-pointer border-b border-dashed border-transparent hover:border-brand-cyan inline-block max-w-full"
        title="Click to edit"
      >
        {value || <em className="text-text-muted">-</em>}
      </span>
    );
  }
  if (multiline) {
    return (
      <textarea autoFocus value={draft} placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setEditing(false);
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit();
        }}
        rows={2}
        className="border border-brand-cyan rounded px-1 py-0.5 text-xs w-full"
      />
    );
  }
  return (
    <input autoFocus value={draft} placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setEditing(false);
      }}
      className="border border-brand-cyan rounded px-1 py-0 text-xs w-full"
    />
  );
}
function BooleanCheckbox({ value, onSave }: { value: boolean; onSave: (v: boolean) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  return (
    <label className="inline-flex items-center gap-1 cursor-pointer">
      <input type="checkbox" checked={value} disabled={saving}
        onChange={async (e) => {
          setSaving(true);
          try { await onSave(e.target.checked); } catch {} finally { setSaving(false); }
        }}
      />
      <span className="text-text-muted">{value ? 'Yes' : 'No'}</span>
    </label>
  );
}
function EditableSelect({
  value, options, onSave,
}: {
  value: string; options: { value: string; label: string }[]; onSave: (v: string) => Promise<void>;
}) {
  return (
    <select value={value}
      onChange={async (e) => {
        if (e.target.value !== value) { try { await onSave(e.target.value); } catch {} }
      }}
      className="text-xs border-b border-dashed border-border-light bg-transparent focus:border-brand-cyan"
    >
      {options.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  );
}
