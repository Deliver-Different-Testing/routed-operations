import { useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useToast } from '../../context/ToastContext';
import {
  scheduleService,
  type ScheduleGroup,
  type ScheduleLookups,
} from '../../services/scheduleService';
import { ClientMultiPicker } from './ClientMultiPicker';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Source group being copied. Cannot be null - the modal is only
   *  mounted when the operator has picked a row to copy. */
  source: ScheduleGroup;
  lookups: ScheduleLookups | null;
  onCopied: (row: ScheduleGroup) => void;
}

/**
 * Copy schedule modal - mirrors the legacy ClientManager "Client Copy
 * From / Copy To" workflow, adapted to the new junction-based model.
 *
 * Copy From is fixed: whichever schedule the operator picked "Copy..."
 * on. Shows current name + client bindings (read-only).
 *
 * Copy To is editable: operator picks a new name (defaults to
 * "<source> (copy)") and a client set (defaults to source's clients so
 * "copy this default schedule to client X" is one edit away).
 *
 * Everything else is copied verbatim - day-windows, zones, linehauls,
 * polygon bindings, individual postcode bindings. Server-side
 * ScheduleService.CopyAsync handles the row cloning + junction rekey.
 */
export function ScheduleCopyModal({ open, onClose, source, lookups, onCopied }: Props) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState(() => `${source.name ?? ''} (copy)`);
  const [targetClientCodes, setTargetClientCodes] = useState<Set<string>>(
    () => new Set(source.clientCodes ?? []));

  const toggleClient = (code: string) => {
    setTargetClientCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await scheduleService.copy({
        sourceScheduleId: source.scheduleId,
        newName: newName.trim(),
        clientCodes: Array.from(targetClientCodes),
      });
      onCopied(res.response);
      toast.show('Schedule copied', 'success');
      onClose();
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setSaving(false); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Copy schedule - ${source.name}`}
      size="2xl"
      loading={saving}
      loadingMessage="Copying schedule..."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="secondary" data-primary="true" onClick={save} disabled={saving || !newName.trim()}>
            {saving ? 'Copying...' : 'Create Copy'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <Section title="Copy From">
          <Field label="Schedule">
            <input className={INPUT_CLASS + ' bg-surface-cream'} value={source.name ?? ''} readOnly />
          </Field>
          <Field label="Current clients">
            <div className="min-h-[28px] flex flex-wrap gap-1 items-center">
              {source.clientCodes.length === 0 && (
                <span className="text-[11px] text-text-muted italic">
                  (default - not bound to any client)
                </span>
              )}
              {source.clientCodes.map((c) => (
                <span key={c} className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-brand-cyan/15 text-brand-cyan">
                  {c}
                </span>
              ))}
            </div>
          </Field>
        </Section>

        <Section title="Copy To">
          <Field label="New schedule name" required>
            <input className={INPUT_CLASS} value={newName} autoFocus
              onChange={(e) => setNewName(e.target.value)} />
          </Field>
          <Field label="Assign to clients (defaults to source's clients)">
            <ClientMultiPicker
              selectedCodes={targetClientCodes}
              onToggle={toggleClient}
              initialList={lookups?.clients}
            />
          </Field>
        </Section>

        <p className="text-[11px] text-text-muted italic">
          Copies every day-window, active zone, linehaul leg, coverage polygon binding, and individual postcode binding from the source schedule.
        </p>
      </div>
    </Modal>
  );
}

const INPUT_CLASS =
  'w-full border border-border rounded-lg px-2 py-1.5 text-sm bg-surface-white focus:outline-none focus:ring-1 focus:ring-brand-cyan';

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-text-muted mb-0.5">
        {label}{required && <span className="text-red-600"> *</span>}
      </div>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-white p-3 space-y-3">
      <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wide">{title}</h4>
      {children}
    </section>
  );
}
