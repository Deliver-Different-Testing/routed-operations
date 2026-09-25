import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../common/Modal';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { schedulesV2Service } from '../../services/schedulesV2Service';
import { scheduleService } from '../../services/scheduleService';
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

// Day labels for the click-to-add operating-days picker. Order matches
// the WeekDays mask (Mon=index 0, Sun=index 6) that the backend stores
// on tblBulkRunScheduleOverride.WeekDays.
const DAY_PICKER: Array<{ n: number; label: string }> = [
  { n: 1, label: 'Mon' },
  { n: 2, label: 'Tue' },
  { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' },
  { n: 5, label: 'Fri' },
  { n: 6, label: 'Sat' },
  { n: 7, label: 'Sun' },
];

/** Convert a 7-char WeekDays mask (Mon=index 0..Sun=index 6) to the set
 *  of DAY_PICKER.n values it selects. Any non-'1' character reads as
 *  "not chosen"; unusable input returns an empty set. */
function parseWeekDaysMask(mask: string | null): number[] {
  if (!mask || mask.length !== 7) return [];
  const chosen: number[] = [];
  for (let i = 0; i < 7; i++) {
    if (mask[i] === '1') chosen.push(i + 1);
  }
  return chosen;
}

/** Convert a set of DAY_PICKER.n values back to a 7-char mask. Order-
 *  independent (Mon..Sun always at fixed indices). Empty set yields
 *  '0000000' which the caller then folds to NULL before sending. */
function chosenToMask(chosen: number[]): string {
  const buf = ['0', '0', '0', '0', '0', '0', '0'];
  for (const n of chosen) {
    if (n >= 1 && n <= 7) buf[n - 1] = '1';
  }
  return buf.join('');
}

/**
 * Per-client delta editor. Replaces the clone-based CreateOverrideModal
 * with a form that writes to tblBulkRunScheduleOverride via
 * PUT /api/v2/schedules/{id}/overrides/{clientId}.
 *
 * Steve F1 (2026-09-20): the base schedule is NOT copied. Only the
 * fields this client actually differs on are stored, one row per scope.
 *
 * 2026-09-24 UX polish: WeekDays is a click-to-add day picker instead
 * of a raw mask string; Speed / Zone-group ids are selects populated
 * from /api/schedules/lookups. Modal styling normalized against
 * NewScheduleModal + ScheduleDetailModal so the schedules-new family
 * reads as one design.
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

  // Lookups drive the Speed / Zone-group selects on both leg scopes.
  // NewScheduleModal + ScheduleDetailModal load the same query with the
  // same key so it comes from cache when the editor opens.
  const lookupsQuery = useQuery({
    queryKey: schedulesV2Keys.lookups(tenantId),
    queryFn: () => scheduleService.lookups().then((r) => r.response),
    staleTime: 5 * 60_000,
    enabled: open,
  });

  // Schedule scope
  // F11 Phase C (2026-09-24): cutoffHours dropped from the wire in favour
  // of the absolute (cutoffDay, cutoffTime) pair. The Phase 1 form does
  // not surface those inputs yet, so we send null-null and let the client
  // inherit the base schedule's cutoff. When the pair inputs land here
  // they seed off existing.schedule.cutoffDay / cutoffTime.
  const [weekDays, setWeekDays] = useState<number[]>([]);
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
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
    setWeekDays(parseWeekDaysMask(existing?.schedule?.weekDays ?? null));
    setDisplayName(existing?.schedule?.displayName ?? '');
    setDisplayDescription(existing?.schedule?.displayDescription ?? '');
    setCollSpeedId(existing?.collection?.speedId != null ? String(existing.collection.speedId) : '');
    setCollZoneGroupId(existing?.collection?.zoneGroupId != null ? String(existing.collection.zoneGroupId) : '');
    setCollPickupTimeMode(existing?.collection?.pickupTimeMode ?? '');
    setCollPickupWindowStart(existing?.collection?.pickupWindowStart ?? '');
    setCollPickupWindowEnd(existing?.collection?.pickupWindowEnd ?? '');
    setDelSpeedId(existing?.delivery?.speedId != null ? String(existing.delivery.speedId) : '');
    setDelZoneGroupId(existing?.delivery?.zoneGroupId != null ? String(existing.delivery.zoneGroupId) : '');
    setDayPickerOpen(false);
  }, [open, existing]);

  // Close the day picker on outside click / Escape so the popover
  // dismisses without a click on the (currently-hidden) options.
  const dayPickerContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!dayPickerOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!dayPickerContainerRef.current) return;
      if (dayPickerContainerRef.current.contains(e.target as Node)) return;
      setDayPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDayPickerOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [dayPickerOpen]);

  const availableDays = useMemo(
    () => DAY_PICKER.filter((d) => !weekDays.includes(d.n)),
    [weekDays],
  );

  const addDay = (n: number) => {
    setWeekDays((prev) => (prev.includes(n) ? prev : [...prev, n].sort((a, b) => a - b)));
  };
  const removeDay = (n: number) => {
    setWeekDays((prev) => prev.filter((x) => x !== n));
  };

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

  // F11 Phase C (2026-09-24): cutoffHours dropped; cutoffDay + cutoffTime
  // stay null-null on the Phase 1 form (no editor inputs yet).
  const weekDaysMask = weekDays.length > 0 ? chosenToMask(weekDays) : null;
  const scheduleScope: ScheduleScopeOverride = {
    cutoffDay: null,
    cutoffTime: null,
    weekDays: weekDaysMask,
    isActive: null,
    displayName: nzOrNull(displayName),
    displayDescription: nzOrNull(displayDescription),
  };
  const scheduleHasValues =
    scheduleScope.cutoffDay != null
    || scheduleScope.cutoffTime != null
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
  const speeds = lookupsQuery.data?.speeds ?? [];
  const postcodeGroups = lookupsQuery.data?.postcodeGroups ?? [];

  // Reusable classNames pulled from NewScheduleModal + ScheduleDetailModal
  // so the visual family matches. Do NOT hardcode colours; every colour
  // is a theme token.
  const inputCls =
    'w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40';
  const labelCls = 'block';
  const labelSpanCls = 'text-xs uppercase tracking-wide text-text-muted';
  const sectionCls = 'border border-border rounded p-4 bg-surface-white space-y-3';
  const sectionHeaderCls = 'text-xs uppercase tracking-wide text-text-muted';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={hasExistingDelta ? 'Edit client override' : 'Create client override'}
      size="2xl"
      loading={busy}
      loadingMessage={putMut.isPending ? 'Saving override...' : 'Removing override...'}
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          {hasExistingDelta && (
            <button
              type="button"
              onClick={() => deleteMut.mutate()}
              disabled={busy}
              className="mr-auto px-4 py-2 text-sm rounded border border-error/30 text-error hover:bg-error-bg/40 disabled:opacity-40 disabled:cursor-not-allowed"
              data-testid="override-delete"
            >
              Remove override
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm rounded border border-border hover:bg-surface-light disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className="px-4 py-2 text-sm rounded bg-brand-cyan text-brand-dark font-medium disabled:bg-brand-cyan/40 disabled:text-brand-dark/60 disabled:cursor-not-allowed"
            data-testid="override-save"
          >
            {hasExistingDelta ? 'Save changes' : 'Create override'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <header className="text-sm text-text-muted space-y-1">
          <div>
            <span className="text-text-primary font-medium">{clientName ?? clientCode ?? `Client #${clientId}`}</span>
            {clientCode && <span className="ml-2 font-mono text-xs">{clientCode}</span>}
          </div>
          <div>
            on schedule <span className="font-mono text-brand-cyan">#{scheduleId}</span> {scheduleName}
          </div>
          <p className="text-xs italic">
            Only fill fields that differ from the base. Empty fields inherit from the base schedule.
          </p>
        </header>

        <section className={sectionCls}>
          <h4 className={sectionHeaderCls}>Schedule scope</h4>
          <div className="grid grid-cols-2 gap-3">
            {/* F11 Phase C (2026-09-24): cutoffHours input removed. The
                absolute (cutoffDay + cutoffTime) pair inputs will land
                here in a follow-up; for now the schedule-scope form
                still edits week-days and display copy only. */}
            <div className="col-span-2 relative" ref={dayPickerContainerRef}>
              <span className={labelSpanCls}>Operating days</span>
              <button
                type="button"
                onClick={() => setDayPickerOpen((v) => !v)}
                className={`mt-1 ${inputCls} text-left`}
                data-testid="override-week-days-trigger"
              >
                {weekDays.length === 0 ? (
                  <span className="text-text-muted">Click to add operating days</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {weekDays.map((n) => {
                      const day = DAY_PICKER.find((d) => d.n === n)!;
                      return (
                        <span
                          key={n}
                          className="inline-flex items-center gap-1 text-[11px] font-medium bg-brand-cyan/15 text-brand-cyan border border-brand-cyan/30 px-1.5 py-0.5 rounded"
                        >
                          {day.label}
                          <span
                            role="button"
                            aria-label={`Remove ${day.label}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              removeDay(n);
                            }}
                            className="cursor-pointer text-brand-cyan/70 hover:text-brand-cyan"
                          >
                            x
                          </span>
                        </span>
                      );
                    })}
                  </span>
                )}
              </button>
              {dayPickerOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 z-20 border border-border rounded bg-surface-white shadow-lg p-2 flex flex-wrap gap-1">
                  {availableDays.length === 0 && (
                    <span className="text-xs text-text-muted italic px-1">All days added</span>
                  )}
                  {availableDays.map((d) => (
                    <button
                      key={d.n}
                      type="button"
                      onClick={() => addDay(d.n)}
                      className="text-xs font-medium px-2 py-1 rounded border border-border hover:bg-surface-light text-text-primary"
                      data-testid={`override-week-days-add-${d.label}`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <label className={`${labelCls} col-span-2`}>
              <span className={labelSpanCls}>Client-facing display name</span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Inherit"
                className={`mt-1 ${inputCls}`}
                data-testid="override-display-name"
              />
            </label>
            <label className={`${labelCls} col-span-2`}>
              <span className={labelSpanCls}>Display description</span>
              <textarea
                value={displayDescription}
                onChange={(e) => setDisplayDescription(e.target.value)}
                placeholder="Inherit"
                rows={2}
                className={`mt-1 ${inputCls} resize-y`}
                data-testid="override-display-description"
              />
            </label>
          </div>
        </section>

        <section className={sectionCls}>
          <h4 className={sectionHeaderCls}>Collection scope</h4>
          <div className="grid grid-cols-2 gap-3">
            <label className={labelCls}>
              <span className={labelSpanCls}>Speed</span>
              <select
                value={collSpeedId}
                onChange={(e) => setCollSpeedId(e.target.value)}
                className={`mt-1 ${inputCls}`}
                data-testid="override-collection-speed"
              >
                <option value="">Inherit</option>
                {speeds.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              <span className={labelSpanCls}>Zone group</span>
              <select
                value={collZoneGroupId}
                onChange={(e) => setCollZoneGroupId(e.target.value)}
                className={`mt-1 ${inputCls}`}
                data-testid="override-collection-zone-group"
              >
                <option value="">Inherit</option>
                {postcodeGroups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              <span className={labelSpanCls}>Pickup time mode</span>
              <select
                value={collPickupTimeMode}
                onChange={(e) => setCollPickupTimeMode(e.target.value)}
                className={`mt-1 ${inputCls}`}
              >
                <option value="">Inherit</option>
                <option value="window">Window</option>
                <option value="fixed">Fixed</option>
                <option value="on_demand">On demand</option>
              </select>
            </label>
            <div />
            <label className={labelCls}>
              <span className={labelSpanCls}>Pickup window start</span>
              <input
                type="time"
                value={collPickupWindowStart}
                onChange={(e) => setCollPickupWindowStart(e.target.value)}
                className={`mt-1 ${inputCls}`}
              />
            </label>
            <label className={labelCls}>
              <span className={labelSpanCls}>Pickup window end</span>
              <input
                type="time"
                value={collPickupWindowEnd}
                onChange={(e) => setCollPickupWindowEnd(e.target.value)}
                className={`mt-1 ${inputCls}`}
              />
            </label>
          </div>
        </section>

        <section className={sectionCls}>
          <h4 className={sectionHeaderCls}>Delivery scope</h4>
          <div className="grid grid-cols-2 gap-3">
            <label className={labelCls}>
              <span className={labelSpanCls}>Speed</span>
              <select
                value={delSpeedId}
                onChange={(e) => setDelSpeedId(e.target.value)}
                className={`mt-1 ${inputCls}`}
                data-testid="override-delivery-speed"
              >
                <option value="">Inherit</option>
                {speeds.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              <span className={labelSpanCls}>Zone group</span>
              <select
                value={delZoneGroupId}
                onChange={(e) => setDelZoneGroupId(e.target.value)}
                className={`mt-1 ${inputCls}`}
                data-testid="override-delivery-zone-group"
              >
                <option value="">Inherit</option>
                {postcodeGroups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </label>
          </div>
        </section>
      </div>
    </Modal>
  );
}
