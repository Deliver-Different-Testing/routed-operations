import { useState } from 'react';
import type { LookupItem } from '../../services/scheduleService';

// Vertical stacked leg builder - MVP of Dane's schedules-module
// ChainBuilder (SCHEDULES.md section A4). Steve's brief section 2b
// locks the leg types: Collection = blue, Depot = slate, Linehaul =
// orange, Delivery = green. Each leg card expands inline (one open at
// a time); a "Choose first / next leg" chooser appears when the last
// leg is not a Delivery (or when the chain is empty). Free ordering -
// any leg after any leg. Steve's "may end at depot or linehaul" rule
// means Delivery is optional.
//
// This is a smaller reimplementation than Dane's full module
// (~1000 lines across ChainBuilder + LegNode + LegConfigPanel +
// ZoneSelector) but covers every field Steve's mockup requires:
// - Collection: pickupSource (client_address / depot / booking),
//   pickupDepotId, speedId.
// - Depot: depotId, storageState.
// - Linehaul: linehaulRunId, fromDepotId, toDepotId, dayOffset,
//   transitMinutes, speedId (per-leg override), amount, amountPercentage,
//   insertToBulk / applyDiscount / applyAddOnPercentage flags.
// - Delivery: regionId, speedId, postcodeGroupId, zones[] multi-select.

export type LegType = 'collection' | 'depot' | 'linehaul' | 'delivery';

export interface CollectionLeg {
  type: 'collection';
  pickupSource: 'client_address' | 'depot' | 'booking';
  pickupDepotId: number | null;
  speedId: number | null;
}

export interface DepotLeg {
  type: 'depot';
  depotId: number | null;
  storageState: number | null;
}

export interface LinehaulLeg {
  type: 'linehaul';
  linehaulRunId: number | null;
  fromDepotId: number | null;
  toDepotId: number | null;
  dayOffset: number;
  transitMinutes: number;
  /** Per-linehaul-leg speed override (Dane's full-builder item). */
  speedId: number | null;
  /** Flat fee for this leg. Null = inherit run defaults. */
  amount: number | null;
  /** Extra percentage on top of the run rate for this leg. */
  amountPercentage: number | null;
  /** Additional-item-charging flags (Dane's full-builder items). */
  insertToBulk: boolean | null;
  applyDiscount: boolean | null;
  applyAddOnPercentage: boolean | null;
  /** Human-readable leg name (surfaces in the roster chip strip).
   *  Falls back to `Linehaul run #{linehaulRunId}` when null. */
  name: string | null;
  /** Active flag - operator can add a leg then defer it via this. */
  active: boolean;
  /** 7-day array (Mon..Sun) of 1/0. Null falls back to the schedule's
   *  overall day mask, matching legacy default; setting the array on a
   *  leg overrides so uneven-week patterns work (e.g. Mon Wed Fri
   *  linehaul on a Mon-Fri schedule). */
  weekDay: number[] | null;
  /** Drop-off location at the destination end of this leg. */
  dropOffLocationId: number | null;
  /** If true, the leg picks up from the booking's client address
   *  instead of `fromDepotId`. Legacy checkbox "Book from client
   *  address". */
  fromClientAddress: boolean | null;
}

export interface DeliveryLeg {
  type: 'delivery';
  regionId: number;
  speedId: number | null;
  postcodeGroupId: number | null;
  /** Zones this delivery leg fulfils (Dane's zone selector). */
  zones: number[];
}

export type Leg = CollectionLeg | DepotLeg | LinehaulLeg | DeliveryLeg;

const LEG_STYLE: Record<LegType, { tag: string; bg: string; border: string; dot: string; strip: string; chevron: string }> = {
  collection: { tag: 'COLLECTION', bg: 'bg-blue-50',   border: 'border-blue-300',   dot: 'bg-blue-500',   strip: 'bg-blue-500',   chevron: 'text-blue-400' },
  depot:      { tag: 'DEPOT',      bg: 'bg-slate-100', border: 'border-slate-300', dot: 'bg-slate-500',  strip: 'bg-slate-500',  chevron: 'text-slate-400' },
  linehaul:   { tag: 'LINEHAUL',   bg: 'bg-orange-50', border: 'border-orange-300', dot: 'bg-orange-500', strip: 'bg-orange-500', chevron: 'text-orange-400' },
  delivery:   { tag: 'DELIVERY',   bg: 'bg-green-50',  border: 'border-green-300',  dot: 'bg-green-500',  strip: 'bg-green-500',  chevron: 'text-green-400' },
};

interface LookupCatalogue {
  depots: LookupItem[];
  speeds: LookupItem[];
  postcodeGroups: LookupItem[];
  storageStates: Array<{ id: number; label: string }>;
  linehaulRuns: Array<{ id: number; runName: string; fromDepotId: number | null; toDepotId: number | null }>;
  /** Available zone numbers this tenant supports. Optional. */
  zoneNumbers?: number[];
  /** Drop-off locations for the linehaul leg destination end. Optional. */
  dropOffLocations?: Array<{ id: number; name: string; depotId: number }>;
  /** Pickup box-discount options. Optional; rendered on the Collection
   *  leg editor when provided (Steve's F14 relocation - the value is
   *  schedule-level, not per-leg, but it visually belongs with the
   *  pickup config). */
  pickupBoxDiscounts?: Array<{ id: number; label: string }>;
}

interface Props {
  legs: Leg[];
  onChange: (legs: Leg[]) => void;
  lookups: LookupCatalogue;
  /** Read-only mode: no add/remove, no inline edits. Used by the
   *  Schedule Detail modal's Route tab so the same layout works for
   *  both create + read. */
  readOnly?: boolean;
  /** Schedule-level PickupBoxDiscount value + setter, threaded down so
   *  the picker can live on the Collection leg card even though the
   *  underlying column (tblBulkRunSchedule.PickupBoxDiscount) is not
   *  per-leg. Optional; if omitted the picker is hidden. */
  pickupBoxDiscount?: number | null;
  onPickupBoxDiscountChange?: (v: number | null) => void;
}

const NEW_LEG: Record<LegType, Leg> = {
  collection: { type: 'collection', pickupSource: 'client_address', pickupDepotId: null, speedId: null },
  depot: { type: 'depot', depotId: null, storageState: null },
  linehaul: {
    type: 'linehaul', linehaulRunId: null, fromDepotId: null, toDepotId: null,
    dayOffset: 0, transitMinutes: 0, speedId: null,
    amount: null, amountPercentage: null,
    insertToBulk: null, applyDiscount: null, applyAddOnPercentage: null,
    name: null, active: true, weekDay: null,
    dropOffLocationId: null, fromClientAddress: null,
  },
  delivery: { type: 'delivery', regionId: 0, speedId: null, postcodeGroupId: null, zones: [] },
};

export function ChainBuilder({
  legs,
  onChange,
  lookups,
  readOnly = false,
  pickupBoxDiscount,
  onPickupBoxDiscountChange,
}: Props) {
  const [expanded, setExpanded] = useState<number | null>(0);

  const addLeg = (type: LegType) => {
    // Delivery must terminate the chain (Steve's brief section 2b:
    // route may end at Depot or Linehaul OR Delivery, but Delivery
    // cannot appear mid-chain). If the last leg is already a Delivery,
    // insert the new non-Delivery leg BEFORE it so the terminator
    // stays put; if the new leg IS a Delivery and one already exists,
    // no-op (operator should Remove the existing one first).
    // Collection is the reciprocal rule: only one Collection allowed
    // per schedule (a schedule has ONE pickup source). No-op if a
    // Collection already exists.
    const hasTerminalDelivery = legs.length > 0 && legs[legs.length - 1].type === 'delivery';
    const hasCollectionAlready = legs.some((l) => l.type === 'collection');
    if (type === 'collection' && hasCollectionAlready) return;
    let next: Leg[];
    let insertAt: number;
    if (type === 'delivery') {
      if (hasTerminalDelivery) return;
      next = [...legs, { ...NEW_LEG[type] }];
      insertAt = next.length - 1;
    } else if (hasTerminalDelivery) {
      insertAt = legs.length - 1;
      next = [...legs.slice(0, insertAt), { ...NEW_LEG[type] }, ...legs.slice(insertAt)];
    } else {
      next = [...legs, { ...NEW_LEG[type] }];
      insertAt = next.length - 1;
    }
    onChange(next);
    setExpanded(insertAt);
  };
  const removeLeg = (i: number) => {
    const next = legs.filter((_, idx) => idx !== i);
    onChange(next);
    setExpanded(null);
  };
  const patchLeg = <T extends Leg>(i: number, patch: Partial<T>) => {
    const next = legs.map((l, idx) => idx === i ? { ...l, ...patch } as Leg : l);
    onChange(next);
  };

  const hasDelivery = legs.some((l) => l.type === 'delivery');
  const hasCollection = legs.some((l) => l.type === 'collection');
  // Chooser stays visible whenever we're editable, so operators can add
  // additional Linehaul / Depot legs. Delivery + Collection are both
  // one-per-schedule rules: their buttons disable when one already
  // exists (only one pickup source, only one terminator).
  const showChooser = !readOnly;

  return (
    <div className="space-y-2">
      {legs.length === 0 && readOnly && (
        <div className="text-xs text-text-muted italic border border-border rounded p-4 text-center">
          No route legs configured.
        </div>
      )}

      {legs.map((leg, i) => {
        const s = LEG_STYLE[leg.type];
        const isOpen = expanded === i;
        const isLast = i === legs.length - 1;
        return (
          <div key={i}>
            {/* Leg card - solid coloured left strip + tag pill on the
                left, summary in the middle, edit/remove on the right.
                Matches Steve's schedules-module mockup layout. */}
            <div className={`border ${s.border} ${s.bg} rounded flex overflow-hidden`}>
              <div className={`w-1.5 shrink-0 ${s.strip}`} aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : i)}
                  className="w-full flex items-center gap-3 px-3 py-3 text-left"
                >
                  <span className={`text-[10px] font-semibold tracking-wide px-2 py-1 rounded ${s.bg} border ${s.border} text-text-primary`}>
                    {s.tag}
                  </span>
                  <div className="flex-1 text-sm min-w-0">
                    <LegSummary leg={leg} lookups={lookups} />
                  </div>
                  {!readOnly && (
                    <>
                      <span className="text-xs text-text-muted">{isOpen ? 'close' : 'edit'} ▼</span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeLeg(i); }}
                        className="text-xs text-error hover:underline"
                      >
                        Remove
                      </button>
                    </>
                  )}
                </button>
                {isOpen && !readOnly && (
                  <div className="px-4 pb-3 pt-1 border-t border-border-light space-y-2">
                    <LegEditor
                      leg={leg}
                      onPatch={(p) => patchLeg(i, p as never)}
                      lookups={lookups}
                      pickupBoxDiscount={pickupBoxDiscount ?? null}
                      onPickupBoxDiscountChange={onPickupBoxDiscountChange}
                    />
                  </div>
                )}
              </div>
            </div>
            {/* Chevron connector between legs (Steve's mockup shows a
                downward arrow indicating flow direction). Hidden after
                the last leg. */}
            {!isLast && (
              <div className={`flex justify-center py-0.5 ${s.chevron}`} aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
            )}
          </div>
        );
      })}

      {showChooser && (
        <div className="border border-dashed border-brand-cyan/60 rounded p-3 text-center">
          <div className="text-xs font-semibold text-text-muted mb-2">
            {legs.length === 0
              ? 'Choose first leg'
              : hasDelivery
                ? 'Insert another leg (before Delivery)'
                : 'Add next leg'}
          </div>
          <div className="flex gap-2 justify-center flex-wrap">
            {(['collection', 'depot', 'linehaul', 'delivery'] as LegType[]).map((t) => {
              const s = LEG_STYLE[t];
              const disabled =
                (t === 'delivery' && hasDelivery) ||
                (t === 'collection' && hasCollection);
              const disabledReason = t === 'delivery'
                ? 'Only one Delivery leg allowed. Remove the existing one to change destination.'
                : t === 'collection'
                  ? 'Only one Collection leg allowed. A schedule has a single pickup source; remove the existing Collection to change it.'
                  : `Add a ${s.tag} leg`;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => addLeg(t)}
                  disabled={disabled}
                  title={disabled ? disabledReason : `Add a ${s.tag} leg`}
                  className={`text-xs px-3 py-1.5 rounded border ${s.border} ${s.bg} text-text-primary hover:opacity-80 flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  <span className={`w-2 h-2 rounded-sm ${s.dot}`} />
                  {s.tag}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {legs.length === 0 && !readOnly && (
        <p className="text-xs text-warning italic border border-warning/30 bg-warning-bg/40 rounded px-3 py-2">
          Route has no legs configured.
        </p>
      )}
    </div>
  );
}

// ─── One-line leg summary shown in the collapsed header ──────────────

function LegSummary({ leg, lookups }: { leg: Leg; lookups: LookupCatalogue }) {
  const depotName = (id: number | null | undefined) =>
    id ? (lookups.depots.find((d) => d.id === id)?.name ?? `#${id}`) : null;
  const speedName = (id: number | null | undefined) =>
    id ? (lookups.speeds.find((s) => s.id === id)?.name ?? `#${id}`) : null;
  const groupName = (id: number | null | undefined) =>
    id ? (lookups.postcodeGroups.find((g) => g.id === id)?.name ?? `#${id}`) : null;
  const runName = (id: number | null | undefined) =>
    id ? (lookups.linehaulRuns.find((r) => r.id === id)?.runName ?? `run #${id}`) : null;
  const storageLabel = (id: number | null | undefined) =>
    id ? (lookups.storageStates.find((s) => s.id === id)?.label ?? `#${id}`) : null;

  if (leg.type === 'collection') {
    const src = leg.pickupSource === 'depot'
      ? (depotName(leg.pickupDepotId) ?? 'Depot')
      : leg.pickupSource === 'booking'
        ? 'Booking-declared'
        : 'Client address';
    return (
      <>
        <div className="font-medium text-text-primary">Collect from {src}</div>
        <div className="text-xs text-text-muted">Speed {speedName(leg.speedId) ?? '-'}</div>
      </>
    );
  }
  if (leg.type === 'depot') {
    return (
      <>
        <div className="font-medium text-text-primary">{depotName(leg.depotId) ?? 'Depot (not set)'}</div>
        <div className="text-xs text-text-muted">
          {leg.storageState != null ? `Storage ${storageLabel(leg.storageState) ?? leg.storageState}` : 'Storage -'}
        </div>
      </>
    );
  }
  if (leg.type === 'linehaul') {
    return (
      <>
        <div className="font-medium text-text-primary flex items-center gap-2">
          {leg.name ?? runName(leg.linehaulRunId) ?? 'Linehaul (run not set)'}
          {!leg.active && (
            <span className="text-[10px] text-warning uppercase tracking-wide">inactive</span>
          )}
        </div>
        <div className="text-xs text-text-muted">
          {depotName(leg.fromDepotId) ?? '?'} - {depotName(leg.toDepotId) ?? '?'} · +{leg.dayOffset}d
          {leg.speedId != null && <> · Speed {speedName(leg.speedId)}</>}
          {leg.amount != null && <> · ${leg.amount.toFixed(2)}</>}
          {leg.amountPercentage != null && leg.amountPercentage !== 0 && (
            <> · +{leg.amountPercentage}%</>
          )}
        </div>
      </>
    );
  }
  // delivery
  return (
    <>
      <div className="font-medium text-text-primary">
        Deliver in {depotName(leg.regionId) ?? '(region not set)'}
      </div>
      <div className="text-xs text-text-muted">
        Speed {speedName(leg.speedId) ?? '-'} · zone group {groupName(leg.postcodeGroupId) ?? '-'}
        {leg.zones?.length > 0 && <> · zones {leg.zones.join(', ')}</>}
      </div>
    </>
  );
}

// ─── Inline editor per leg type ──────────────────────────────────────

function LegEditor({
  leg,
  onPatch,
  lookups,
  pickupBoxDiscount,
  onPickupBoxDiscountChange,
}: {
  leg: Leg;
  onPatch: (patch: Partial<Leg>) => void;
  lookups: LookupCatalogue;
  /** Schedule-level PickupBoxDiscount value. Rendered on the Collection
   *  leg editor per Steve's F14 relocation; the write path still hits
   *  tblBulkRunSchedule.PickupBoxDiscount (not a per-leg column). */
  pickupBoxDiscount?: number | null;
  onPickupBoxDiscountChange?: (v: number | null) => void;
}) {
  if (leg.type === 'collection') {
    const boxDiscounts = lookups.pickupBoxDiscounts ?? [];
    const showBoxDiscount = boxDiscounts.length > 0 && onPickupBoxDiscountChange != null;
    return (
      <div className="grid grid-cols-2 gap-3">
        <label className="block col-span-2 text-xs">
          Pickup source
          <select
            value={leg.pickupSource}
            onChange={(e) => onPatch({ pickupSource: e.target.value as CollectionLeg['pickupSource'] } as Partial<Leg>)}
            className="mt-1 w-full px-2 py-1 border border-border rounded"
          >
            <option value="client_address">Client address</option>
            <option value="depot">Depot</option>
            <option value="booking">Booking-declared</option>
          </select>
        </label>
        {leg.pickupSource === 'depot' && (
          <label className="block text-xs">
            Pickup depot
            <select
              value={leg.pickupDepotId ?? ''}
              onChange={(e) => onPatch({ pickupDepotId: e.target.value ? Number(e.target.value) : null } as Partial<Leg>)}
              className="mt-1 w-full px-2 py-1 border border-border rounded"
            >
              <option value="">-</option>
              {lookups.depots.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className="block text-xs">
          Pickup speed
          <select
            value={leg.speedId ?? ''}
            onChange={(e) => onPatch({ speedId: e.target.value ? Number(e.target.value) : null } as Partial<Leg>)}
            className="mt-1 w-full px-2 py-1 border border-border rounded"
          >
            <option value="">-</option>
            {lookups.speeds.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        {showBoxDiscount && (
          <label className="block col-span-2 text-xs">
            Collection box discount
            <span className="ml-2 text-[10px] text-text-muted normal-case">
              schedule-level (applies once per booking, not per leg)
            </span>
            <select
              value={pickupBoxDiscount ?? ''}
              onChange={(e) => onPickupBoxDiscountChange!(e.target.value ? Number(e.target.value) : null)}
              className="mt-1 w-full px-2 py-1 border border-border rounded"
            >
              <option value="">- none -</option>
              {boxDiscounts.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>
        )}
      </div>
    );
  }
  if (leg.type === 'depot') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs">
          Depot
          <select
            value={leg.depotId ?? ''}
            onChange={(e) => onPatch({ depotId: e.target.value ? Number(e.target.value) : null } as Partial<Leg>)}
            className="mt-1 w-full px-2 py-1 border border-border rounded"
          >
            <option value="">-</option>
            {lookups.depots.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          Storage state
          <select
            value={leg.storageState ?? ''}
            onChange={(e) => onPatch({ storageState: e.target.value ? Number(e.target.value) : null } as Partial<Leg>)}
            className="mt-1 w-full px-2 py-1 border border-border rounded"
          >
            <option value="">-</option>
            {lookups.storageStates.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
      </div>
    );
  }
  if (leg.type === 'linehaul') {
    const dropOffs = (lookups.dropOffLocations ?? []).filter(
      (d) => !leg.toDepotId || d.depotId === leg.toDepotId,
    );
    const weekDay = leg.weekDay ?? [1, 1, 1, 1, 1, 0, 0];
    return (
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs">
          Leg name
          <input
            type="text"
            value={leg.name ?? ''}
            onChange={(e) => onPatch({ name: e.target.value || null } as Partial<Leg>)}
            className="mt-1 w-full px-2 py-1 border border-border rounded"
            placeholder="e.g. AKL - CHCH Night Air"
          />
        </label>
        <label className="flex items-center gap-2 text-xs mt-4">
          <input
            type="checkbox"
            checked={leg.active}
            onChange={(e) => onPatch({ active: e.target.checked } as Partial<Leg>)}
            className="accent-brand-cyan"
          />
          Active leg (uncheck to add-but-defer)
        </label>
        <label className="block col-span-2 text-xs">
          Linehaul run
          <select
            value={leg.linehaulRunId ?? ''}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : null;
              const run = lookups.linehaulRuns.find((r) => r.id === id);
              onPatch({
                linehaulRunId: id,
                fromDepotId: run?.fromDepotId ?? leg.fromDepotId,
                toDepotId: run?.toDepotId ?? leg.toDepotId,
              } as Partial<Leg>);
            }}
            className="mt-1 w-full px-2 py-1 border border-border rounded"
          >
            <option value="">- pick a run -</option>
            {lookups.linehaulRuns.map((r) => (
              <option key={r.id} value={r.id}>{r.runName}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          From depot
          <select
            value={leg.fromDepotId ?? ''}
            disabled={leg.fromClientAddress === true}
            onChange={(e) => onPatch({ fromDepotId: e.target.value ? Number(e.target.value) : null } as Partial<Leg>)}
            className="mt-1 w-full px-2 py-1 border border-border rounded disabled:bg-surface-light disabled:cursor-not-allowed"
            title={leg.fromClientAddress === true ? 'Disabled while "Book from client address" is on' : undefined}
          >
            <option value="">- pick a depot -</option>
            {lookups.depots.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          To depot
          <select
            value={leg.toDepotId ?? ''}
            onChange={(e) => onPatch({ toDepotId: e.target.value ? Number(e.target.value) : null } as Partial<Leg>)}
            className="mt-1 w-full px-2 py-1 border border-border rounded"
          >
            <option value="">- pick a depot -</option>
            {lookups.depots.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          Day offset
          <input
            type="number"
            min={0}
            value={leg.dayOffset}
            onChange={(e) => onPatch({ dayOffset: Number(e.target.value) } as Partial<Leg>)}
            className="mt-1 w-full px-2 py-1 border border-border rounded"
          />
        </label>
        <label className="block text-xs">
          Transit (min)
          <input
            type="number"
            min={0}
            value={leg.transitMinutes}
            onChange={(e) => onPatch({ transitMinutes: Number(e.target.value) } as Partial<Leg>)}
            className="mt-1 w-full px-2 py-1 border border-border rounded"
          />
        </label>
        <label className="block col-span-2 text-xs">
          Speed override
          <select
            value={leg.speedId ?? ''}
            onChange={(e) => onPatch({ speedId: e.target.value ? Number(e.target.value) : null } as Partial<Leg>)}
            className="mt-1 w-full px-2 py-1 border border-border rounded"
          >
            <option value="">- inherit from run -</option>
            {lookups.speeds.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          Amount ($)
          <input
            type="number"
            step="0.01"
            min={0}
            value={leg.amount ?? ''}
            onChange={(e) => onPatch({ amount: e.target.value === '' ? null : Number(e.target.value) } as Partial<Leg>)}
            className="mt-1 w-full px-2 py-1 border border-border rounded"
            placeholder="inherit"
          />
        </label>
        <label className="block text-xs">
          Add-on %
          <input
            type="number"
            step="0.1"
            value={leg.amountPercentage ?? ''}
            onChange={(e) => onPatch({ amountPercentage: e.target.value === '' ? null : Number(e.target.value) } as Partial<Leg>)}
            className="mt-1 w-full px-2 py-1 border border-border rounded"
            placeholder="0"
          />
        </label>
        <label className="col-span-2 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={leg.insertToBulk === true}
            onChange={(e) => onPatch({ insertToBulk: e.target.checked } as Partial<Leg>)}
            className="accent-brand-cyan"
          />
          Insert into bulk (roll this leg's charge into the parent booking)
        </label>
        <label className="col-span-2 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={leg.applyDiscount === true}
            onChange={(e) => onPatch({ applyDiscount: e.target.checked } as Partial<Leg>)}
            className="accent-brand-cyan"
          />
          Apply schedule discount
        </label>
        <label className="col-span-2 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={leg.applyAddOnPercentage === true}
            onChange={(e) => onPatch({ applyAddOnPercentage: e.target.checked } as Partial<Leg>)}
            className="accent-brand-cyan"
          />
          Apply add-on percentage
        </label>
        <label className="col-span-2 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={leg.fromClientAddress === true}
            onChange={(e) => onPatch({ fromClientAddress: e.target.checked } as Partial<Leg>)}
            className="accent-brand-cyan"
          />
          Book from client address (overrides From depot)
        </label>
        <label className="block col-span-2 text-xs">
          Drop-off location
          <select
            value={leg.dropOffLocationId ?? ''}
            onChange={(e) => onPatch({ dropOffLocationId: e.target.value ? Number(e.target.value) : null } as Partial<Leg>)}
            className="mt-1 w-full px-2 py-1 border border-border rounded"
          >
            <option value="">- default -</option>
            {dropOffs.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <div className="col-span-2 text-xs">
          <div className="mb-1">
            Active days for this leg
            <span className="text-text-muted ml-2">
              (uncheck to override the schedule's overall day mask)
            </span>
          </div>
          <div className="flex gap-1">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, di) => {
              const on = weekDay[di] === 1;
              return (
                <label
                  key={di}
                  className={`px-2 py-1 border rounded cursor-pointer ${
                    on ? 'border-orange-400 bg-orange-100 text-orange-800' : 'border-border text-text-muted'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => {
                      const wd = [...weekDay];
                      wd[di] = e.target.checked ? 1 : 0;
                      onPatch({ weekDay: wd } as Partial<Leg>);
                    }}
                    className="hidden"
                  />
                  {label}
                </label>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
  // delivery
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block text-xs">
        Region
        <select
          value={leg.regionId || ''}
          onChange={(e) => onPatch({ regionId: e.target.value ? Number(e.target.value) : 0 } as Partial<Leg>)}
          className="mt-1 w-full px-2 py-1 border border-border rounded"
        >
          <option value="">- pick a region -</option>
          {lookups.depots.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </label>
      <label className="block text-xs">
        Speed
        <select
          value={leg.speedId ?? ''}
          onChange={(e) => onPatch({ speedId: e.target.value ? Number(e.target.value) : null } as Partial<Leg>)}
          className="mt-1 w-full px-2 py-1 border border-border rounded"
        >
          <option value="">-</option>
          {lookups.speeds.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>
      <label className="block col-span-2 text-xs">
        Delivery zone group
        <select
          value={leg.postcodeGroupId ?? ''}
          onChange={(e) => onPatch({ postcodeGroupId: e.target.value ? Number(e.target.value) : null } as Partial<Leg>)}
          className="mt-1 w-full px-2 py-1 border border-border rounded"
        >
          <option value="">-</option>
          {lookups.postcodeGroups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </label>
      {(lookups.zoneNumbers?.length ?? 0) > 0 && (
        <div className="block col-span-2 text-xs">
          <div className="mb-1">Zones this leg fulfils</div>
          <div className="flex flex-wrap gap-1">
            {lookups.zoneNumbers!.map((z) => {
              const checked = leg.zones.includes(z);
              return (
                <label
                  key={z}
                  className={`px-2 py-1 border rounded cursor-pointer ${
                    checked ? 'border-brand-cyan bg-brand-cyan/10 text-text-primary' : 'border-border text-text-muted'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...leg.zones, z].sort((a, b) => a - b)
                        : leg.zones.filter((v) => v !== z);
                      onPatch({ zones: next } as Partial<Leg>);
                    }}
                    className="hidden"
                  />
                  Z{z}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
