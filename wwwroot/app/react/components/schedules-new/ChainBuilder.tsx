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

const LEG_STYLE: Record<LegType, { tag: string; bg: string; border: string; dot: string }> = {
  collection: { tag: 'COLLECTION', bg: 'bg-blue-50',   border: 'border-blue-300',   dot: 'bg-blue-500' },
  depot:      { tag: 'DEPOT',      bg: 'bg-slate-100', border: 'border-slate-300', dot: 'bg-slate-500' },
  linehaul:   { tag: 'LINEHAUL',   bg: 'bg-orange-50', border: 'border-orange-300', dot: 'bg-orange-500' },
  delivery:   { tag: 'DELIVERY',   bg: 'bg-green-50',  border: 'border-green-300',  dot: 'bg-green-500' },
};

interface LookupCatalogue {
  depots: LookupItem[];
  speeds: LookupItem[];
  postcodeGroups: LookupItem[];
  storageStates: Array<{ id: number; label: string }>;
  linehaulRuns: Array<{ id: number; runName: string; fromDepotId: number | null; toDepotId: number | null }>;
  /** Available zone numbers this tenant supports. Optional. */
  zoneNumbers?: number[];
}

interface Props {
  legs: Leg[];
  onChange: (legs: Leg[]) => void;
  lookups: LookupCatalogue;
  /** Read-only mode: no add/remove, no inline edits. Used by the
   *  Schedule Detail modal's Route tab so the same layout works for
   *  both create + read. */
  readOnly?: boolean;
}

const NEW_LEG: Record<LegType, Leg> = {
  collection: { type: 'collection', pickupSource: 'client_address', pickupDepotId: null, speedId: null },
  depot: { type: 'depot', depotId: null, storageState: null },
  linehaul: {
    type: 'linehaul', linehaulRunId: null, fromDepotId: null, toDepotId: null,
    dayOffset: 0, transitMinutes: 0, speedId: null,
    amount: null, amountPercentage: null,
    insertToBulk: null, applyDiscount: null, applyAddOnPercentage: null,
  },
  delivery: { type: 'delivery', regionId: 0, speedId: null, postcodeGroupId: null, zones: [] },
};

export function ChainBuilder({ legs, onChange, lookups, readOnly = false }: Props) {
  const [expanded, setExpanded] = useState<number | null>(0);

  const addLeg = (type: LegType) => {
    const next = [...legs, { ...NEW_LEG[type] }];
    onChange(next);
    setExpanded(next.length - 1);
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

  const lastLeg = legs[legs.length - 1];
  const showChooser = !readOnly && (legs.length === 0 || lastLeg?.type !== 'delivery');

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
        return (
          <div key={i} className={`border ${s.border} ${s.bg} rounded`}>
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? null : i)}
              className="w-full flex items-center gap-3 px-3 py-3 text-left"
            >
              <span className={`text-[10px] font-semibold tracking-wide px-2 py-1 rounded ${s.bg} border ${s.border} text-text-primary`}>
                {s.tag}
              </span>
              <div className="flex-1 text-sm">
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
                <LegEditor leg={leg} onPatch={(p) => patchLeg(i, p as never)} lookups={lookups} />
              </div>
            )}
          </div>
        );
      })}

      {showChooser && (
        <div className="border border-dashed border-brand-cyan/60 rounded p-3 text-center">
          <div className="text-xs font-semibold text-text-muted mb-2">
            {legs.length === 0 ? 'Choose first leg' : 'Add next leg'}
          </div>
          <div className="flex gap-2 justify-center flex-wrap">
            {(['collection', 'depot', 'linehaul', 'delivery'] as LegType[]).map((t) => {
              const s = LEG_STYLE[t];
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => addLeg(t)}
                  className={`text-xs px-3 py-1.5 rounded border ${s.border} ${s.bg} text-text-primary hover:opacity-80 flex items-center gap-1.5`}
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
        <div className="font-medium text-text-primary">
          {runName(leg.linehaulRunId) ?? 'Linehaul (run not set)'}
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
}: {
  leg: Leg;
  onPatch: (patch: Partial<Leg>) => void;
  lookups: LookupCatalogue;
}) {
  if (leg.type === 'collection') {
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
    return (
      <div className="grid grid-cols-2 gap-3">
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
