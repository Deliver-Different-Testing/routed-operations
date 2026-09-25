import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import {
  linehaulService,
  LinehaulMode,
  extractLinehaulError,
  type TenantLinehaulRun,
  type TenantLinehaulRunUpsert,
} from '../../services/linehaulService';
import type { LinehaulRunLookup, LookupItem } from '../../services/scheduleService';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Current linehaul runs list from schedule lookups. Used to seed the picker. */
  runs: LinehaulRunLookup[];
  /** Depot dropdown options (schedule modal already has these). */
  depots: LookupItem[];
  /** Courier dropdown options (schedule modal already has these). */
  couriers: LookupItem[];
  /** Fires with the refreshed runs list after a save or delete so the
   *  parent (ScheduleEditModal) can update its `lookups.linehaulRuns`
   *  cache without a full lookups refetch. */
  onRunsChanged: (runs: LinehaulRunLookup[]) => void;
}

/**
 * Nested Linehaul Run CRUD modal opened from the pencil icon next to the
 * "Run" column in the Schedule modal's Linehaul Legs section. Parity with
 * the legacy AngularJS `.linehaulRun-modal` in
 * `ClientManager/wwwroot/app/components/schedules/schedulesView.html`.
 *
 * Flow: pick an existing run in the top dropdown to edit it, or click
 * "+ New" to create one. Fields mirror the legacy modal: name, from/to
 * depots, start time, despatch time, courier. Save posts to
 * /api/recurring-linehaul-runs (create or update). Delete is guarded by
 * a confirm and by the server's "in use by schedules" 409 check.
 *
 * The four extra fields that the RoutedOperations linehaul model
 * introduced beyond the legacy schedule modal (defaultTargetType /
 * defaultTargetId / speedId / mode / masterBookingId) are preserved
 * on edit (fetched via linehaulService.get) and defaulted on create
 * (mode = Road, everything else null). Full editing of those fields
 * lives in the Recurring Routes -> Linehaul tab.
 */
export function LinehaulRunModal({ open, onClose, runs, depots, couriers, onRunsChanged }: Props) {
  const toast = useToast();
  const askConfirm = useConfirm();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<TenantLinehaulRunUpsert>(emptyRun());
  /** Preserved values from the full fetch when editing an existing run,
   *  so the extra fields (defaultTarget*, speedId, mode, masterBookingId)
   *  round-trip unchanged when we save the legacy-shaped edit. */
  const [preserved, setPreserved] = useState<Pick<TenantLinehaulRunUpsert,
    'defaultTargetType' | 'defaultTargetId' | 'speedId' | 'mode' | 'masterBookingId'>>({
      defaultTargetType: null, defaultTargetId: null, speedId: null,
      mode: LinehaulMode.Road, masterBookingId: null,
    });

  const sortedRuns = useMemo(() => runs.slice().sort((a, b) => a.runName.localeCompare(b.runName)), [runs]);
  const isEditing = selectedId !== null;

  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setForm(emptyRun());
      setPreserved({ defaultTargetType: null, defaultTargetId: null, speedId: null, mode: LinehaulMode.Road, masterBookingId: null });
    }
  }, [open]);

  const pickForEdit = async (id: number) => {
    setSelectedId(id);
    setBusy(true);
    try {
      const full = await linehaulService.get(id);
      setForm({
        runName: full.runName,
        fromDepotId: full.fromDepotId,
        toDepotId: full.toDepotId,
        startTime: full.startTime,
        despatchTime: full.despatchTime,
        defaultTargetType: full.defaultTargetType,
        defaultTargetId: full.defaultTargetId,
        speedId: full.speedId,
        mode: full.mode,
        masterBookingId: full.masterBookingId,
      });
      setPreserved({
        defaultTargetType: full.defaultTargetType,
        defaultTargetId: full.defaultTargetId,
        speedId: full.speedId,
        mode: full.mode,
        masterBookingId: full.masterBookingId,
      });
    } catch (e) {
      toast.show(extractLinehaulError(e, 'Failed to load linehaul run'), 'error');
      setSelectedId(null);
    } finally {
      setBusy(false);
    }
  };

  const startNew = () => {
    setSelectedId(null);
    setForm(emptyRun());
    setPreserved({ defaultTargetType: null, defaultTargetId: null, speedId: null, mode: LinehaulMode.Road, masterBookingId: null });
  };

  const save = async () => {
    if (!form.runName?.trim()) { toast.show('Run name is required', 'error'); return; }
    if (!form.fromDepotId) { toast.show('From depot is required', 'error'); return; }
    if (!form.toDepotId) { toast.show('To depot is required', 'error'); return; }
    // Courier is nullable server-side; the legacy modal treated it the same way.
    setBusy(true);
    try {
      const payload: TenantLinehaulRunUpsert = { ...preserved, ...form };
      const saved = isEditing
        ? await linehaulService.update(selectedId!, payload)
        : await linehaulService.create(payload);
      onRunsChanged(mergeRunIntoList(runs, toLookup(saved)));
      toast.show(isEditing ? 'Linehaul run updated' : 'Linehaul run created', 'success');
      setSelectedId(saved.id);
      // Preserved extras may have been derived server-side; refresh from the response.
      setPreserved({
        defaultTargetType: saved.defaultTargetType,
        defaultTargetId: saved.defaultTargetId,
        speedId: saved.speedId,
        mode: saved.mode,
        masterBookingId: saved.masterBookingId,
      });
    } catch (e) {
      toast.show(extractLinehaulError(e, 'Failed to save linehaul run'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!isEditing) return;
    const ok = await askConfirm({
      title: 'Delete linehaul run',
      message: `Permanently delete "${form.runName}"? Blocked if any schedule still uses this run.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await linehaulService.remove(selectedId!);
      onRunsChanged(runs.filter((r) => r.id !== selectedId));
      toast.show('Linehaul run deleted', 'success');
      startNew();
    } catch (e) {
      toast.show(extractLinehaulError(e, 'Failed to delete linehaul run'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="2xl"
      title="Linehaul Runs"
      loading={busy}
      footer={
        <div className="flex justify-between">
          <div>
            {isEditing && (
              <Button variant="danger" size="sm" onClick={remove} disabled={busy}>Delete</Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="neutral" onClick={onClose} disabled={busy}>Close</Button>
            <Button variant="secondary" data-primary="true" onClick={save} disabled={busy}>
              {isEditing ? 'Save' : 'Add'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
          <div>
            <div className="text-[11px] font-semibold text-text-muted mb-0.5">Existing runs</div>
            <select
              className={INPUT_CLASS}
              value={selectedId ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '') { startNew(); return; }
                void pickForEdit(Number(v));
              }}
            >
              <option value="">- New run -</option>
              {sortedRuns.map((r) => <option key={r.id} value={r.id}>{r.runName}</option>)}
            </select>
          </div>
          <div>
            <Button variant="neutral" size="sm" onClick={startNew} disabled={busy}>+ New</Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Field label="Run Name" required>
            <input
              className={INPUT_CLASS}
              value={form.runName ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, runName: e.target.value }))}
            />
          </Field>
          <Field label="Default Courier">
            <select
              className={INPUT_CLASS}
              value={form.defaultTargetId ?? ''}
              onChange={(e) => setForm((f) => ({
                ...f,
                defaultTargetType: e.target.value ? 'Courier' : null,
                defaultTargetId: e.target.value ? Number(e.target.value) : null,
              }))}
            >
              <option value="">- None -</option>
              {couriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Field label="From Depot" required>
            <select
              className={INPUT_CLASS}
              value={form.fromDepotId || ''}
              onChange={(e) => setForm((f) => ({ ...f, fromDepotId: Number(e.target.value) }))}
            >
              <option value="">Choose...</option>
              {depots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="To Depot" required>
            <select
              className={INPUT_CLASS}
              value={form.toDepotId || ''}
              onChange={(e) => setForm((f) => ({ ...f, toDepotId: Number(e.target.value) }))}
            >
              <option value="">Choose...</option>
              {depots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Field label="Start Time">
            <input
              type="time"
              className={INPUT_CLASS}
              value={form.startTime ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value || null }))}
            />
          </Field>
          <Field label="Despatch Time">
            <input
              type="time"
              className={INPUT_CLASS}
              value={form.despatchTime ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, despatchTime: e.target.value || null }))}
            />
          </Field>
        </div>

        <div className="text-[11px] text-text-muted italic">
          Advanced fields (default agent / network partner, speed, mode, master booking)
          are managed on the Recurring Routes &gt; Linehaul tab. Values on this run are
          preserved when you save.
        </div>
      </div>
    </Modal>
  );
}

const INPUT_CLASS =
  'w-full border border-border rounded-lg px-2 py-1.5 text-sm bg-surface-white focus:outline-none focus:ring-1 focus:ring-brand-cyan disabled:opacity-50 disabled:bg-surface-cream';

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

function emptyRun(): TenantLinehaulRunUpsert {
  return {
    runName: '',
    fromDepotId: 0,
    toDepotId: 0,
    startTime: null,
    despatchTime: null,
    defaultTargetType: null,
    defaultTargetId: null,
    speedId: null,
    mode: LinehaulMode.Road,
    masterBookingId: null,
  };
}

function toLookup(r: TenantLinehaulRun): LinehaulRunLookup {
  return {
    id: r.id,
    runName: r.runName,
    fromDepotId: r.fromDepotId,
    toDepotId: r.toDepotId,
    startTime: r.startTime,
    despatchTime: r.despatchTime,
    courierId: r.courierId,
  };
}

function mergeRunIntoList(list: LinehaulRunLookup[], updated: LinehaulRunLookup): LinehaulRunLookup[] {
  const i = list.findIndex((r) => r.id === updated.id);
  if (i < 0) return [...list, updated];
  const copy = list.slice();
  copy[i] = updated;
  return copy;
}
