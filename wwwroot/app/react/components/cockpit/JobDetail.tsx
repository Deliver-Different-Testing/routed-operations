import { useEffect, useState } from 'react';
import type { BulkJob, Speed } from '../../types';
import { Panel } from '../common/Panel';
import { useAuth } from '../../context/AuthContext';
import { postcodeLabel } from '../../lib/tenantLabels';

interface Props {
  job: BulkJob | null;
  speeds: Speed[];
  onUpdateField: (jobId: number, field: string, value: string) => Promise<void>;
  // L2.P3.2 Optional side hint. When the operator right-clicks a specific
  // address section we open FixGpsModal pre-focused on that leg (pickup or
  // delivery). The header "Fix GPS" button still calls this with no leg,
  // preserving the pre-existing default.
  onOpenGpsFix?: (job: BulkJob, leg?: 'ToAddress' | 'FromAddress') => void;
}

/**
 * Inline-editable job detail. Every field the legacy RunBuilder allowed
 * operators to edit is here, grouped into logical sections:
 *   Booking     - JobNumber, BookDate, BookTime
 *   Pickup      - FromCompany, FromAddress, FromSuburb, FromPostCode, GPS
 *   Delivery    - ToCompany, ToAddress, ToSuburb, ToPostCode, GPS
 *   Contacts    - Contact, DeliverToContact, DeliverToPhone
 *   Load        - Speed, Qty, Weight, Size, Amount
 *   References  - OurRef, ClientRefa, ClientRefb, Barcode
 *   Tracking    - Tracking + POD email + mobile
 *   Notes       - Free-text notes
 *   Schedule    - Read-only: current run, schedule, window, cubic
 * Backed by PATCH /api/jobs/{id} for every editable field.
 */
export function JobDetail({ job, speeds, onUpdateField, onOpenGpsFix }: Props) {
  const { isUsTenant } = useAuth();
  const zipLabel = postcodeLabel(isUsTenant, true);
  // L2.P3.2 Small right-click popover on the pickup / delivery address
  // sections. Legacy jobDetail.tpl:11,21 bound `context-menu="detailAddressMenu"`
  // on those rows and offered a single "Update GPS" item that opened the
  // Fix GPS modal pre-focused on the clicked side. We keep the shape:
  // right-click -> mini menu -> "Update GPS" -> onOpenGpsFix(job, leg).
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
      <Panel title="Job detail">
        <div className="p-4 text-sm text-text-muted">
          Select a job to see its details.
        </div>
      </Panel>
    );
  }

  const save = (field: string, value: string) => onUpdateField(job.bulkJobId, field, value);

  const openAddrMenu = (e: React.MouseEvent, leg: 'FromAddress' | 'ToAddress') => {
    if (!onOpenGpsFix) return;
    e.preventDefault();
    e.stopPropagation();
    setAddrMenu({ x: e.clientX, y: e.clientY, leg });
  };

  return (
    <Panel
      title={`Job ${job.jobNumber}`}
      actions={
        onOpenGpsFix ? (
          <button
            type="button"
            onClick={() => onOpenGpsFix(job)}
            className="px-2 py-0.5 text-xs border border-brand-purple text-brand-purple rounded"
            title="Fix pickup / delivery GPS coordinates"
          >
            Fix GPS
          </button>
        ) : null
      }
    >
      <div className="p-3 space-y-3 text-xs">
        <Section title="Booking">
          <Row label="Job #">
            <EditableCell value={job.jobNumber ?? ''} onSave={(v) => save('JobNumber', v)} />
          </Row>
          <Row label="Client">{job.clientCode}</Row>
          <Row label="Date">
            <EditableCell
              value={job.bookDate ? new Date(job.bookDate).toLocaleDateString('en-GB') : ''}
              onSave={(v) => save('BookDate', v)}
              placeholder="dd/mm/yyyy"
            />
          </Row>
          <Row label="Ready Time">
            <EditableCell
              value={job.bookTime ? formatTime(job.bookTime) : ''}
              onSave={(v) => save('BookTime', v)}
              placeholder="HH:MM"
            />
          </Row>
        </Section>

        {/* L2.P3.2 Right-click anywhere in the Pickup section -> "Update
            GPS" shortcut that opens FixGpsModal pre-focused on FromAddress. */}
        <div onContextMenu={(e) => openAddrMenu(e, 'FromAddress')}>
          <Section title="Pickup address">
            <Row label="Company">
              <EditableCell value={job.fromCompany ?? ''} onSave={(v) => save('FromCompany', v)} />
            </Row>
            <Row label="Address">
              <EditableCell
                value={job.fromAddress ?? ''}
                onSave={(v) => save('FromAddress', v)}
                multiline
              />
            </Row>
            <Row label="Suburb">
              <EditableCell value={job.fromSuburb ?? ''} onSave={(v) => save('FromSuburb', v)} />
            </Row>
            <Row label={zipLabel}>
              <EditableCell
                value={job.fromPostCode?.toString() ?? ''}
                onSave={(v) => save('FromPostCode', v)}
              />
            </Row>
            <Row label="GPS">
              <span className={job.pickUpLatitude ? '' : 'text-error'}>
                {job.pickUpLatitude ? `${job.pickUpLatitude}, ${job.pickUpLongitude}` : 'missing'}
              </span>
            </Row>
          </Section>
        </div>

        {/* L2.P3.2 Same shortcut on Delivery -> pre-focus ToAddress. */}
        <div onContextMenu={(e) => openAddrMenu(e, 'ToAddress')}>
          <Section title="Delivery address">
            <Row label="Company">
              <EditableCell value={job.toCompany ?? ''} onSave={(v) => save('ToCompany', v)} />
            </Row>
            <Row label="Address">
              <EditableCell
                value={job.toAddress ?? ''}
                onSave={(v) => save('ToAddress', v)}
                multiline
              />
            </Row>
            <Row label="Suburb">
              <EditableCell value={job.toSuburb ?? ''} onSave={(v) => save('ToSuburb', v)} />
            </Row>
            <Row label={zipLabel}>
              <EditableCell
                value={job.toPostCode?.toString() ?? ''}
                onSave={(v) => save('ToPostCode', v)}
              />
            </Row>
            <Row label="GPS">
              <span className={job.deliveryLatitude ? '' : 'text-error'}>
                {job.deliveryLatitude ? `${job.deliveryLatitude}, ${job.deliveryLongitude}` : 'missing'}
              </span>
            </Row>
          </Section>
        </div>

        <Section title="Contacts">
          <Row label="Client Contact">
            <EditableCell value={job.contact ?? ''} onSave={(v) => save('Contact', v)} />
          </Row>
          <Row label="Deliver To">
            <EditableCell
              value={job.deliverToContact ?? ''}
              onSave={(v) => save('DeliverToContact', v)}
            />
          </Row>
          <Row label="Phone">
            <EditableCell
              value={job.deliverToPhone ?? ''}
              onSave={(v) => save('DeliverToPhone', v)}
            />
          </Row>
        </Section>

        <Section title="Load">
          <Row label="Speed">
            <EditableSelect
              value={String(job.speed)}
              options={speeds.map((s) => ({ value: String(s.id), label: s.label }))}
              onSave={(v) => save('Speed', v)}
            />
          </Row>
          <Row label="Qty">
            <EditableCell value={String(job.qty ?? '')} onSave={(v) => save('Qty', v)} />
          </Row>
          <Row label="Weight">
            <EditableCell value={String(job.weight ?? '')} onSave={(v) => save('Weight', v)} />
          </Row>
          <Row label="Size">
            <EditableCell value={String(job.size ?? '')} onSave={(v) => save('Size', v)} />
          </Row>
          <Row label="Amount">
            <EditableCell value={String(job.amount ?? '')} onSave={(v) => save('Amount', v)} />
          </Row>
          {/* Legacy jobDetail.tpl:91-94 "Sig not req". Persists onto
              tblBulkJob.DeliverToPrivateBusiness via the OkToLeave alias
              (see BulkJobDto + JobService UpdateJobDetailAsync branch). */}
          <Row label="Sig not req">
            <BooleanCheckbox
              value={job.okToLeave ?? false}
              onSave={(v) => save('OkToLeave', v ? 'true' : 'false')}
            />
          </Row>
        </Section>

        <Section title="References">
          <Row label="Our Ref">
            <EditableCell value={job.ourRef ?? ''} onSave={(v) => save('OurRef', v)} />
          </Row>
          <Row label="Client Ref A">
            <EditableCell value={job.clientRefa ?? ''} onSave={(v) => save('ClientRefa', v)} />
          </Row>
          <Row label="Client Ref B">
            <EditableCell value={job.clientRefb ?? ''} onSave={(v) => save('ClientRefb', v)} />
          </Row>
          <Row label="Barcode">
            <EditableCell value={job.barcode ?? ''} onSave={(v) => save('Barcode', v)} />
          </Row>
        </Section>

        <Section title="Tracking + POD">
          <Row label="Track Email">
            <EditableCell
              value={job.trackingEmail ?? ''}
              onSave={(v) => save('TrackingEmail', v)}
            />
          </Row>
          <Row label="Track Mobile">
            <EditableCell
              value={job.trackingMobile ?? ''}
              onSave={(v) => save('TrackingMobile', v)}
            />
          </Row>
          <Row label="POD Email">
            <EditableCell
              value={job.proofOfDeliveryEmail ?? ''}
              onSave={(v) => save('ProofOfDeliveryEmail', v)}
            />
          </Row>
          <Row label="POD Mobile">
            <EditableCell
              value={job.proofOfDeliveryMobile ?? ''}
              onSave={(v) => save('ProofOfDeliveryMobile', v)}
            />
          </Row>
        </Section>

        <Section title="Notes">
          <div className="col-span-2">
            <EditableCell
              value={job.notes ?? ''}
              onSave={(v) => save('Notes', v)}
              multiline
            />
          </div>
        </Section>

        <Section title="Schedule">
          <Row label="Run">{job.runName ?? '(none)'}</Row>
          <Row label="Schedule">{job.scheduleName ?? '(none)'}</Row>
          <Row label="Window">{formatWindow(job.scheduleWindowStart, job.scheduleWindowEnd)}</Row>
          <Row label="Cubic">
            {job.jobCubicM3 ? `${Number(job.jobCubicM3).toFixed(3)} m3` : '(none)'}
          </Row>
        </Section>
      </div>

      {/* L2.P3.2 Address-row right-click popover. Single "Update GPS"
          item that opens FixGpsModal with the pre-selected leg. Mirrors the
          styling of GoogleMap's map-menu (fixed-position, cyan-hover). */}
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
              onClick={() => {
                onOpenGpsFix(job, addrMenu.leg);
                setAddrMenu(null);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-surface-cream text-text-primary"
            >
              Update GPS...
            </button>
          </li>
        </ul>
      )}
    </Panel>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-text-muted font-medium mb-1">
        {title}
      </div>
      <dl className="grid grid-cols-2 gap-y-0.5">{children}</dl>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function formatWindow(start: string | null, end: string | null): string {
  if (!start || !end) return '(no window)';
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
  } catch {
    return '';
  }
}

function EditableCell({
  value,
  onSave,
  placeholder,
  multiline,
}: {
  value: string;
  onSave: (v: string) => Promise<void>;
  placeholder?: string;
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const commit = async () => {
    if (draft !== value) {
      try { await onSave(draft); } catch { /* toast handled upstream */ }
    }
    setEditing(false);
  };
  if (!editing) {
    return (
      <span
        onClick={() => { setDraft(value); setEditing(true); }}
        className="cursor-pointer border-b border-dashed border-transparent hover:border-brand-cyan block truncate"
        title="Click to edit"
      >
        {value || <em className="text-text-muted">empty</em>}
      </span>
    );
  }
  if (multiline) {
    return (
      <textarea
        autoFocus
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setEditing(false);
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit();
        }}
        rows={3}
        className="border border-brand-cyan rounded px-1 py-0.5 text-xs w-full"
      />
    );
  }
  return (
    <input
      autoFocus
      value={draft}
      placeholder={placeholder}
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

function BooleanCheckbox({
  value,
  onSave,
}: {
  value: boolean;
  onSave: (v: boolean) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <label className="inline-flex items-center gap-1 cursor-pointer">
      <input
        type="checkbox"
        checked={value}
        disabled={saving}
        onChange={async (e) => {
          setSaving(true);
          try { await onSave(e.target.checked); } catch { /* toast handled upstream */ }
          finally { setSaving(false); }
        }}
      />
      <span className="text-text-muted">{value ? 'Yes' : 'No'}</span>
    </label>
  );
}

function EditableSelect({
  value,
  options,
  onSave,
}: {
  value: string;
  options: { value: string; label: string }[];
  onSave: (v: string) => Promise<void>;
}) {
  return (
    <select
      value={value}
      onChange={async (e) => {
        if (e.target.value !== value) {
          try { await onSave(e.target.value); } catch { /* toast handled upstream */ }
        }
      }}
      className="text-xs border-b border-dashed border-border-light bg-transparent focus:border-brand-cyan w-full"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
