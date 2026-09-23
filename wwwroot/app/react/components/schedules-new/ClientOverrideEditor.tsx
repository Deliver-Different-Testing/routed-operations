import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../common/Modal';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { schedulesV2Service } from '../../services/schedulesV2Service';
import type {
  ScheduleOverride,
  ScheduleOverridePutBody,
  ScheduleScopeOverride,
  LegScopeOverride,
} from '../../services/schedulesV2Service';
import { schedulesV2Keys } from '../../hooks/queries/useSchedulesV2';

interface Props {
  scheduleId: number | null;
  scheduleName: string;
  clientId: number | null;
  clientCode: string | null;
  clientName: string | null;
  /** Existing delta for this client, if any. Used to seed the form. */
  existing: ScheduleOverride | null;
  onClose: () => void;
}

/**
 * Per-client delta editor. Replaces the clone-based CreateOverrideModal
 * with a form that writes to tblBulkRunScheduleOverride via
 * PUT /api/v2/schedules/{id}/overrides/{clientId}.
 *
 * Steve F1 (2026-09-20): the base schedule is NOT copied. Only the
 * fields this client actually differs on are stored, one row per scope.
 *
 * Phase 1 shape: three collapsible scope sections. Every field is
 * clearable (returns to base). Save calls the PUT endpoint with the
 * full delta; delete removes every scope for this client on this
 * schedule.
 */
export function ClientOverrideEditor({
  scheduleId,
  scheduleName,
  clientId,
  clientCode,
  clientName,
  existing,
  onClose,
}: Props) {
  const qc = useQueryClient();
  const auth = useAuth();
  const tenantId = auth.currentTenantId ?? 0;
  const toast = useToast();

  const open = scheduleId != null && clientId != null;

  // Schedule scope
  const [cutoffHours, setCutoffHours] = useState<string>('');
  const [weekDays, setWeekDays] = useState<string>('');
  const [displayName, setDisplayName] = useState<string>('');
  const [displayDescription, setDisplayDescription] = useState<string>('');

  // Collection scope
  const [collSpeedId, setCollSpeedId] = useState<string>('');
  const [collZoneGroupId, setCollZoneGroupId] = useState<string>('');
  const [collPickupTimeMode, setCollPickupTimeMode] = useState<string>('');
  const [collPickupWindowStart, setCollPickupWindowStart] = useState<string>('');
  const [collPickupWindowEnd, setCollPickupWindowEnd] = useState<string>('');

  // Delivery scope
  const [delSpeedId, setDelSpeedId] = useState<string>('');
  const [delZoneGroupId, setDelZoneGroupId] = useState<string>('');

  // Reseed form on open / existing change.
  useEffect(() => {
    if (!open) return;
    setCutoffHours(existing?.schedule?.cutoffHours != null ? String(existing.schedule.cutoffHours) : '');
    setWeekDays(existing?.schedule?.weekDays ?? '');
    setDisplayName(existing?.schedule?.displayName ?? '');
    setDisplayDescription(existing?.schedule?.displayDescription ?? '');
    setCollSpeedId(existing?.collection?.speedId != null ? String(existing.collection.speedId) : '');
    setCollZoneGroupId(existing?.collection?.zoneGroupId != null ? String(existing.collection.zoneGroupId) : '');
    setCollPickupTimeMode(existing?.collection?.pickupTimeMode ?? '');
    setCollPickupWindowStart(existing?.collection?.pickupWindowStart ?? '');
    setCollPickupWindowEnd(existing?.collection?.pickupWindowEnd ?? '');
    setDelSpeedId(existing?.delivery?.speedId != null ? String(existing.delivery.speedId) : '');
    setDelZoneGroupId(existing?.delivery?.zoneGroupId != null ? String(existing.delivery.zoneGroupId) : '');
  }, [open, existing]);

  const putMut = useMutation({
    mutationFn: (body: ScheduleOverridePutBody) =>
      schedulesV2Service.putOverride(scheduleId!, clientId!, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: schedulesV2Keys.listAll(tenantId) });
      qc.invalidateQueries({ queryKey: schedulesV2Keys.detailAll(tenantId) });
      qc.invalidateQueries({ queryKey: schedulesV2Keys.overridesAll(tenantId) });
      toast.show('Client override saved.', 'success');
      onClose();
    },
    onError: (e: Error) => toast.show(`Save failed: ${e.message}`, 'error'),
  });

  const deleteMut = useMutation({
    mutationFn: () => schedulesV2Service.deleteOverride(scheduleId!, clientId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: schedulesV2Keys.listAll(tenantId) });
      qc.invalidateQueries({ queryKey: schedulesV2Keys.detailAll(tenantId) });
      qc.invalidateQueries({ queryKey: schedulesV2Keys.overridesAll(tenantId) });
      toast.show('Client override removed.', 'success');
      onClose();
    },
    onError: (e: Error) => toast.show(`Delete failed: ${e.message}`, 'error'),
  });

  if (!open) return null;

  const parseInt10 = (v: string) => (v.trim() === '' ? null : Number.parseInt(v, 10));
  const nzOrNull = (v: string) => (v.trim() === '' ? null : v);

  const scheduleScope: ScheduleScopeOverride = {
    cutoffHours: parseInt10(cutoffHours),
    cutoffDay: null,
    cutoffTime: null,
    weekDays: nzOrNull(weekDays),
    isActive: null,
    displayName: nzOrNull(displayName),
    displayDescription: nzOrNull(displayDescription),
  };
  const scheduleHasValues =
    scheduleScope.cutoffHours != null
    || scheduleScope.weekDays != null
    || scheduleScope.displayName != null
    || scheduleScope.displayDescription != null;

  const collectionScope: LegScopeOverride = {
    speedId: parseInt10(collSpeedId),
    zoneGroupId: parseInt10(collZoneGroupId),
    pickupTimeMode: nzOrNull(collPickupTimeMode),
    pickupWindowStart: nzOrNull(collPickupWindowStart),
    pickupWindowEnd: nzOrNull(collPickupWindowEnd),
    additionalItemChargingLogic: null,
  };
  const collectionHasValues =
    collectionScope.speedId != null
    || collectionScope.zoneGroupId != null
    || collectionScope.pickupTimeMode != null
    || collectionScope.pickupWindowStart != null
    || collectionScope.pickupWindowEnd != null;

  const deliveryScope: LegScopeOverride = {
    speedId: parseInt10(delSpeedId),
    zoneGroupId: parseInt10(delZoneGroupId),
    pickupTimeMode: null,
    pickupWindowStart: null,
    pickupWindowEnd: null,
    additionalItemChargingLogic: null,
  };
  const deliveryHasValues = deliveryScope.speedId != null || deliveryScope.zoneGroupId != null;

  const handleSave = () => {
    putMut.mutate({
      schedule: scheduleHasValues ? scheduleScope : null,
      collection: collectionHasValues ? collectionScope : null,
      delivery: deliveryHasValues ? deliveryScope : null,
    });
  };

  const hasExistingDelta = existing != null;
  const busy = putMut.isPending || deleteMut.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={hasExistingDelta ? 'Edit client override' : 'Create client override'}
      size="2xl"
    >
      <div className="space-y-6">
        <header className="text-sm text-text-muted">
          <div>
            <span className="text-text-primary font-medium">{clientName ?? clientCode ?? `Client #${clientId}`}</span>
            {clientCode && <span className="ml-2 font-mono text-xs">{clientCode}</span>}
          </div>
          <div className="mt-1">
            on schedule <span className="font-mono text-brand-cyan">#{scheduleId}</span> {scheduleName}
          </div>
          <p className="mt-2 text-xs italic">
            Only fill fields that differ from the base. Empty fields inherit from the base schedule.
          </p>
        </header>

        <section className="border border-border rounded p-4">
          <h4 className="text-sm font-semibold text-text-primary mb-3">Schedule scope</h4>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col text-xs text-text-muted gap-1">
              Cutoff hours
              <input
                type="number"
                value={cutoffHours}
                onChange={(e) => setCutoffHours(e.target.value)}
                placeholder="Inherit"
                className="input"
                data-testid="override-cutoff-hours"
              />
            </label>
            <label className="flex flex-col text-xs text-text-muted gap-1">
              Week days
              <input
                type="text"
                value={weekDays}
                onChange={(e) => setWeekDays(e.target.value)}
                placeholder="e.g. 1111100 (Mon-Fri)"
                maxLength={7}
                className="input"
                data-testid="override-week-days"
              />
            </label>
            <label className="flex flex-col text-xs text-text-muted gap-1 col-span-2">
              Client-facing display name
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Inherit"
                className="input"
                data-testid="override-display-name"
              />
            </label>
            <label className="flex flex-col text-xs text-text-muted gap-1 col-span-2">
              Display description
              <textarea
                value={displayDescription}
                onChange={(e) => setDisplayDescription(e.target.value)}
                placeholder="Inherit"
                rows={2}
                className="input"
                data-testid="override-display-description"
              />
            </label>
          </div>
        </section>

        <section className="border border-border rounded p-4">
          <h4 className="text-sm font-semibold text-text-primary mb-3">Collection scope</h4>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col text-xs text-text-muted gap-1">
              Speed id
              <input
                type="number"
                value={collSpeedId}
                onChange={(e) => setCollSpeedId(e.target.value)}
                placeholder="Inherit"
                className="input"
              />
            </label>
            <label className="flex flex-col text-xs text-text-muted gap-1">
              Zone group id
              <input
                type="number"
                value={collZoneGroupId}
                onChange={(e) => setCollZoneGroupId(e.target.value)}
                placeholder="Inherit"
                className="input"
              />
            </label>
            <label className="flex flex-col text-xs text-text-muted gap-1">
              Pickup time mode
              <select
                value={collPickupTimeMode}
                onChange={(e) => setCollPickupTimeMode(e.target.value)}
                className="input"
              >
                <option value="">Inherit</option>
                <option value="window">Window</option>
                <option value="fixed">Fixed</option>
                <option value="on_demand">On demand</option>
              </select>
            </label>
            <div />
            <label className="flex flex-col text-xs text-text-muted gap-1">
              Pickup window start
              <input
                type="time"
                value={collPickupWindowStart}
                onChange={(e) => setCollPickupWindowStart(e.target.value)}
                className="input"
              />
            </label>
            <label className="flex flex-col text-xs text-text-muted gap-1">
              Pickup window end
              <input
                type="time"
                value={collPickupWindowEnd}
                onChange={(e) => setCollPickupWindowEnd(e.target.value)}
                className="input"
              />
            </label>
          </div>
        </section>

        <section className="border border-border rounded p-4">
          <h4 className="text-sm font-semibold text-text-primary mb-3">Delivery scope</h4>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col text-xs text-text-muted gap-1">
              Speed id
              <input
                type="number"
                value={delSpeedId}
                onChange={(e) => setDelSpeedId(e.target.value)}
                placeholder="Inherit"
                className="input"
              />
            </label>
            <label className="flex flex-col text-xs text-text-muted gap-1">
              Zone group id
              <input
                type="number"
                value={delZoneGroupId}
                onChange={(e) => setDelZoneGroupId(e.target.value)}
                placeholder="Inherit"
                className="input"
              />
            </label>
          </div>
        </section>

        <footer className="flex items-center gap-3 justify-end pt-2 border-t border-border">
          {hasExistingDelta && (
            <button
              type="button"
              onClick={() => deleteMut.mutate()}
              disabled={busy}
              className="px-3 py-1.5 text-sm rounded border border-danger-border text-danger hover:bg-danger-bg disabled:opacity-40"
              data-testid="override-delete"
            >
              Remove override
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 text-sm rounded border border-border text-text-primary hover:bg-surface-light disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className="px-3 py-1.5 text-sm rounded bg-brand-cyan text-white hover:bg-brand-cyan-hover disabled:opacity-40"
            data-testid="override-save"
          >
            {putMut.isPending ? 'Saving...' : hasExistingDelta ? 'Save changes' : 'Create override'}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
