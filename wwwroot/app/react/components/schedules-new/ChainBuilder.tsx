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
// - Collection: speedId only. Origin moved to the first Depot leg
//   (schedule-origin spec 2026-10-07); the destination is that leg.
// - Depot: depotId, storageState.
// - Linehaul: linehaulRunId, fromDepotId, toDepotId, dayOffset,
//   transitMinutes, speedId (per-leg override), amount, amountPercentage,
//   insertToBulk / applyDiscount / applyAddOnPercentage flags.
// - Delivery: regionId, speedId, postcodeGroupId, zones[] multi-select.

export type LegType = 'collection' | 'depot' | 'linehaul' | 'delivery';

export interface CollectionLeg {
  type: 'collection';
  /** The collection leg no longer carries a source or a depot. It means one
   *  thing: collect from the client's address into the chain's first Depot
   *  leg. The destination is read from that leg, and the save derives
   *  tblBulkRunSchedule.PickupDepotId from it.
   *
   *  Both controls were removed on 2026-10-07 per Steve's schedule-origin
   *  spec. They were redundant rather than wrong: seedLegsFromDto already
   *  seeded the Depot leg as `depotId: d.pickupDepotId`, so the Collection
   *  card and the Depot card showed the same value and a user could put them
   *  out of step with each other. Origin now lives on the Depot leg, which is
   *  also where "Client address" is expressed. */
  speedId: number | null;
  /** Collection zone group -> tblBulkRunSchedule.PickupPostcodeGroupId.
   *  Mirrors the Delivery card's zone group. Lived under Advanced until
   *  2026-10-07; it belongs on the leg it describes. */
  postcodeGroupId: number | null;
  /** Zones this leg collects from -> BulkPickupZoneSchedule rows, the
   *  pickup-side twin of BulkZoneSchedule. Until now there was no way to
   *  pick zone numbers on the pickup side at all, which is why so many
   *  pickup zone groups exist only to express "a subset of zones". */
  zones: number[];
}

export interface DepotLeg {
  type: 'depot';
  depotId: number | null;
  /** True when the goods start at the client's own address instead of one of
   *  our depots. Only the FIRST depot leg may set it; a depot leg that lands
   *  after a linehaul is always a real depot. Persists as
   *  `BookPickup = 1 AND PickupDepotId IS NULL`, which is the encoding the
   *  booking SPs already read as @IsCollectFromClientAddress and which no
   *  schedule uses today (0 rows on all four tenants). */
  clientAddress: boolean;
  /** True when this schedule is DIRECT: the goods leave whatever pickup
   *  address the BOOKING declares and go straight to the delivery address,
   *  with no depot touched at all. Only the FIRST depot leg may set it, and it
   *  is mutually exclusive with clientAddress (the Depot picker is one
   *  dropdown, so choosing one clears the other).
   *
   *  Differs from clientAddress in three ways, all enforced server-side in
   *  ScheduleService.UpsertAsync: no Collection leg (same as client), no
   *  linehaul legs (client allows them), and no origin region at all - a
   *  Direct schedule's dispatch/reporting region is the Delivery leg's
   *  region, which is why `originRegionId` stays null here.
   *
   *  Persists to tblBulkRunScheduleHeader.OriginType = 'direct'. */
  directOrigin: boolean;
  /** Origin region. Only meaningful while clientAddress is true. It is the
   *  counterpart of PickupDepotId, NOT of Region: Region keeps coming from
   *  the Delivery leg and names the delivery branch, while this names the
   *  branch that owns the start of the chain. Persists to
   *  tblBulkRunScheduleHeader.OriginRegionId. */
  originRegionId: number | null;
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
  /** Cartons once: pallets per unit, all cartons charged as one. */
  chargePerConsignment?: boolean;
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

/** The three values tblBulkRunScheduleHeader.OriginType can hold. */
export type ScheduleOriginType = 'depot' | 'client' | 'direct';

/**
 * Origin resolution for the save path: the chain's FIRST Depot leg decides
 * what the header stores. Three-way since 2026-10-08, when Direct joined
 * Depot and Client address.
 *
 *   direct -> OriginType = 'direct', OriginRegionId = NULL. The pickup
 *             address arrives with the booking, so there is no origin branch
 *             to name; the dispatch region is the Delivery leg's region, the
 *             same column every other schedule uses.
 *   client -> OriginType = 'client', OriginRegionId = the Depot card's picker.
 *   depot  -> OriginType = 'depot',  OriginRegionId = NULL.
 *
 * Direct is tested first because the two flags are meant to be mutually
 * exclusive; checking it first means a row that somehow carries both reads as
 * the more restrictive of the two rather than silently allowing linehauls.
 *
 * Pure and exported so both modals derive the origin from ONE place. They each
 * keep their own copy of the rest of the leg walk, and a divergence between
 * the two on the origin specifically would be invisible until save time.
 */
export function deriveOriginFromLegs(legs: Leg[]): {
  originType: ScheduleOriginType;
  originRegionId: number | null;
} {
  const firstDepot = legs.find((l) => l.type === 'depot') as DepotLeg | undefined;
  if (firstDepot?.directOrigin === true) return { originType: 'direct', originRegionId: null };
  if (firstDepot?.clientAddress === true) {
    return { originType: 'client', originRegionId: firstDepot.originRegionId ?? null };
  }
  return { originType: 'depot', originRegionId: null };
}

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
  /** Available zone numbers this tenant supports. Optional.
   *
   *  Kept for the greyed state only. Its source unions BulkZoneSchedule, the
   *  table the picker writes to, so it is self-feeding: a number stays on the
   *  list forever once ticked, with no name and no depot. `zones` below is
   *  what the picker renders. */
  zoneNumbers?: number[];
  /** Tickable zones, labelled and scoped to a depot. `zone` is the value that
   *  persists and is a zone number on both tenants. Optional so an older
   *  cached lookups payload still renders. */
  zones?: Array<{
    zone: number;
    label: string;
    depotId: number;
    zipCount: number;
    groupLabel: string;
  }>;
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
  /** Schedule-level DropOffLocationID. Rendered on the Collection leg
   *  editor per F22, the same relocation F14 did for the box discount: the
   *  write path still hits tblBulkRunSchedule.DropOffLocationID, this is
   *  not a per-leg column. The per-leg one on a linehaul is a different
   *  field (tblBulkScheduleLinehaul.DropOffLocationID) and stays there. */
  dropOffLocationId?: number | null;
  onDropOffLocationIdChange?: (v: number | null) => void;
}

const NEW_LEG: Record<LegType, Leg> = {
  collection: { type: 'collection', speedId: null, postcodeGroupId: null, zones: [] },
  depot: { type: 'depot', depotId: null, clientAddress: false, directOrigin: false, originRegionId: null, storageState: null },
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
  dropOffLocationId,
  onDropOffLocationIdChange,
}: Props) {
  const [expanded, setExpanded] = useState<number | null>(0);

  // Origin is expressed by the FIRST Depot leg. Everything below reads it:
  // the Collection card's destination label, whether a Collection leg may
  // exist at all, and which Depot card offers "Client address".
  const firstDepotIndex = legs.findIndex((l) => l.type === 'depot');
  const originLeg = firstDepotIndex >= 0 ? (legs[firstDepotIndex] as DepotLeg) : null;
  const originIsClientAddress = originLeg?.clientAddress === true;
  const originIsDirect = originLeg?.directOrigin === true;
  const originDepotName = originLeg && !originLeg.clientAddress && !originLeg.directOrigin && originLeg.depotId
    ? (lookups.depots.find((d) => d.id === originLeg.depotId)?.name ?? `#${originLeg.depotId}`)
    : null;
  // Direct names a depot, but only as the dispatch / reporting region, and
  // that region is the Delivery leg's - a Direct schedule has no
  // OriginRegionId of its own. Read here so the Depot card can say which
  // branch the single job is dispatched from.
  const deliveryLeg = legs.find((l) => l.type === 'delivery') as DeliveryLeg | undefined;
  const dispatchRegionName = deliveryLeg?.regionId
    ? (lookups.depots.find((d) => d.id === deliveryLeg.regionId)?.name ?? `#${deliveryLeg.regionId}`)
    : null;

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
    // "Collect from the client into the depot" is meaningless when the depot
    // IS the client. Mirrors the server rule that client origin persists as
    // PickupDepotId NULL, which leaves a collection job no destination.
    if (type === 'collection' && originIsClientAddress) return;
    // Direct is one job, pickup address to delivery address, nothing in
    // between. Both a Collection leg and a linehaul leg contradict that, and
    // the server rejects either outright, so the chooser must not create one.
    if (originIsDirect && (type === 'collection' || type === 'linehaul')) return;
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

    // F22. A drop-off location belongs to one depot, so moving the depot
    // leaves it pointing at a door in a building the freight no longer
    // visits. Nothing complained about that before: the stale id survived
    // the save and the child-job procs stamped it onto the LHP job, so the
    // driver was told to leave it at the wrong depot. Cleared here, at the
    // moment the depot changes, rather than validated later.
    //
    // Two independent fields: the schedule-level one hangs off the FIRST
    // Depot leg, and each linehaul leg has its own hanging off that leg's
    // toDepotId.
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'depotId')) {
      const movedFirstDepot = next.findIndex((l) => l.type === 'depot') === i;
      if (movedFirstDepot && dropOffLocationId != null && onDropOffLocationIdChange) {
        const depotId = (next[i] as DepotLeg).depotId ?? null;
        const stillValid = (lookups.dropOffLocations ?? [])
          .some((d) => d.id === dropOffLocationId && d.depotId === depotId);
        if (!stillValid) onDropOffLocationIdChange(null);
      }
    }
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'toDepotId')
        && next[i].type === 'linehaul') {
      const lh = next[i] as Leg & { toDepotId: number | null; dropOffLocationId: number | null };
      if (lh.dropOffLocationId != null) {
        const stillValid = (lookups.dropOffLocations ?? [])
          .some((d) => d.id === lh.dropOffLocationId && d.depotId === lh.toDepotId);
        if (!stillValid) {
          onChange(next.map((l, idx) =>
            idx === i ? ({ ...l, dropOffLocationId: null } as Leg) : l));
          return;
        }
      }
    }

    onChange(next);
  };

  // Bug 1 (Steve 2026-09-25): the array order of the linehaul legs IS the travel
  // order. It is persisted as tblBulkScheduleLinehaul.LegOrder and read back by
  // DD_/WS_stpBulkScheduleJob_InsertChildJobs to number (LH1..LHn) and, on the
  // US branch, to time each hop. Before LegOrder existed those SPs ordered by
  // clustered Id, i.e. the order the legs were first typed in, which is why hops
  // were being dispatched before the freight reached them. Reordering here is
  // therefore a real dispatch change, not a cosmetic one.
  //
  // Only linehaul legs move, and only into another linehaul's slot. The rest of
  // the chain has a fixed shape - collection, optional depot, the linehauls,
  // then delivery last - which addLeg already enforces, and dragging the
  // delivery leg into the middle would break the family the SPs generate.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const canReorder = (i: number) => !readOnly && legs[i]?.type === 'linehaul';

  const moveLeg = (from: number, to: number) => {
    if (from === to) return;
    if (!canReorder(from) || !canReorder(to)) return;
    const next = [...legs];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    // Keep the open card following the leg it was opened on, not the index.
    if (expanded === from) setExpanded(to);
    else if (expanded !== null && from < expanded && to >= expanded) setExpanded(expanded - 1);
    else if (expanded !== null && from > expanded && to <= expanded) setExpanded(expanded + 1);
    onChange(next);
  };

  /** 1-based position among the linehaul legs, which is the LH number the
   *  booking SPs will stamp on the generated job. Null for other leg types. */
  const linehaulOrdinal = (i: number) =>
    legs[i]?.type === 'linehaul'
      ? legs.slice(0, i).filter((l) => l.type === 'linehaul').length + 1
      : null;

  const linehaulIndexes = legs.reduce<number[]>(
    (acc, l, i) => (l.type === 'linehaul' ? [...acc, i] : acc), []);
  const prevLinehaulIndex = (i: number) => {
    const at = linehaulIndexes.indexOf(i);
    return at > 0 ? linehaulIndexes[at - 1] : null;
  };
  const nextLinehaulIndex = (i: number) => {
    const at = linehaulIndexes.indexOf(i);
    return at >= 0 && at < linehaulIndexes.length - 1 ? linehaulIndexes[at + 1] : null;
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
        const ord = linehaulOrdinal(i);
        const reorderable = canReorder(i);
        const up = prevLinehaulIndex(i);
        const down = nextLinehaulIndex(i);
        const isDropTarget = reorderable && dragOverIndex === i && dragIndex !== null && dragIndex !== i;
        return (
          <div key={i}>
            {/* Leg card - solid coloured left strip + tag pill on the
                left, summary in the middle, edit/remove on the right.
                Matches Steve's schedules-module mockup layout. */}
            <div
              className={`border ${s.border} ${s.bg} rounded flex overflow-hidden`
                + (isDropTarget ? ' ring-2 ring-brand-cyan' : '')
                + (dragIndex === i ? ' opacity-50' : '')}
              draggable={reorderable}
              onDragStart={(e) => {
                if (!reorderable) return;
                setDragIndex(i);
                e.dataTransfer.effectAllowed = 'move';
                // Firefox needs a payload set or the drag never starts.
                e.dataTransfer.setData('text/plain', String(i));
              }}
              onDragOver={(e) => {
                if (!reorderable || dragIndex === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dragOverIndex !== i) setDragOverIndex(i);
              }}
              onDrop={(e) => {
                if (!reorderable || dragIndex === null) return;
                e.preventDefault();
                moveLeg(dragIndex, i);
                setDragIndex(null);
                setDragOverIndex(null);
              }}
              onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
            >
              <div className={`w-1.5 shrink-0 ${s.strip}`} aria-hidden="true" />
              {/* Travel-order gutter. Only linehaul legs have a position that
                  means anything: LH{n} is literally the suffix the booking SPs
                  will stamp on the generated job, and the order is persisted as
                  tblBulkScheduleLinehaul.LegOrder. Drag the card, or use the
                  arrows, to change which hop runs when. */}
              {ord !== null && (
                <div className="shrink-0 flex flex-col items-center justify-center gap-1 px-1.5 py-2 border-r border-border-light">
                  {!readOnly && (
                    <span
                      className="cursor-grab active:cursor-grabbing text-text-muted"
                      title="Drag to change the travel order of this hop"
                      aria-hidden="true"
                    >
                      <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
                        <circle cx="2" cy="2" r="1.2" /><circle cx="8" cy="2" r="1.2" />
                        <circle cx="2" cy="7" r="1.2" /><circle cx="8" cy="7" r="1.2" />
                        <circle cx="2" cy="12" r="1.2" /><circle cx="8" cy="12" r="1.2" />
                      </svg>
                    </span>
                  )}
                  <span
                    className="text-[10px] font-semibold text-text-primary leading-none tabular-nums"
                    title={`Travel order ${ord}. The generated job number ends LH${ord}.`}
                  >
                    LH{ord}
                  </span>
                  {!readOnly && (up !== null || down !== null) && (
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        onClick={() => up !== null && moveLeg(i, up)}
                        disabled={up === null}
                        aria-label={`Move hop LH${ord} earlier`}
                        title="Move earlier"
                        className="text-[9px] leading-none px-1 text-text-muted hover:text-text-primary disabled:opacity-30 disabled:hover:text-text-muted"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => down !== null && moveLeg(i, down)}
                        disabled={down === null}
                        aria-label={`Move hop LH${ord} later`}
                        title="Move later"
                        className="text-[9px] leading-none px-1 text-text-muted hover:text-text-primary disabled:opacity-30 disabled:hover:text-text-muted"
                      >
                        ▼
                      </button>
                    </div>
                  )}
                </div>
              )}
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
                    <LegSummary leg={leg} lookups={lookups} originDepotName={originDepotName}
                      originIsClientAddress={originIsClientAddress}
                      dispatchRegionName={dispatchRegionName}
                      chainHasCollection={hasCollection} />
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
                      isFirstDepot={i === firstDepotIndex}
                      originDepotName={originDepotName}
                      originDepotId={originLeg?.depotId ?? null}
                      pickupBoxDiscount={pickupBoxDiscount ?? null}
                      onPickupBoxDiscountChange={onPickupBoxDiscountChange}
                      dropOffLocationId={dropOffLocationId ?? null}
                      onDropOffLocationIdChange={onDropOffLocationIdChange}
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
              // Direct blocks BOTH Collection and Linehaul (2026-10-08).
              // Client origin blocks Collection only - it still allows a
              // linehaul chain out of the client's site.
              const directBlocks = originIsDirect && (t === 'collection' || t === 'linehaul');
              const disabled =
                (t === 'delivery' && hasDelivery) ||
                (t === 'collection' && (hasCollection || originIsClientAddress)) ||
                directBlocks;
              const directReason =
                'This schedule is Direct: one job from the booking pickup address straight to '
                + 'the delivery address, with no depot in between. Change the first Depot leg '
                + 'to a real depot first.';
              const disabledReason = directBlocks
                ? directReason
                : t === 'delivery'
                ? 'Only one Delivery leg allowed. Remove the existing one to change destination.'
                : t === 'collection'
                  ? originIsClientAddress
                    // Collection means "collect from the client into the
                    // depot". When the depot IS the client there is nothing
                    // to collect (schedule-origin spec 2.1).
                    ? 'This schedule starts at the client address, so there is nothing to collect. Change the first Depot leg to a real depot first.'
                    : 'Only one Collection leg allowed. A schedule has a single pickup source; remove the existing Collection to change it.'
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

function LegSummary({ leg, lookups, originDepotName, originIsClientAddress, dispatchRegionName, chainHasCollection }:
  { leg: Leg; lookups: LookupCatalogue; originDepotName: string | null;
    originIsClientAddress: boolean;
    /** Delivery-leg region name, used as the dispatch region on a Direct
     *  Depot card. Null until a Delivery leg names a region. */
    dispatchRegionName: string | null;
    /** F24 item 3: a depot-origin chain with no Collection leg still keeps
     *  its pickup depot, because the depot names the FROM region of the lane
     *  for availability. The card says so, so the operator can see what the
     *  save preserves rather than inferring it from a field that looks
     *  unused. */
    chainHasCollection: boolean }) {
  const depotName = (id: number | null | undefined) =>
    id ? (lookups.depots.find((d) => d.id === id)?.name ?? `#${id}`) : null;
  const speedName = (id: number | null | undefined) =>
    id ? (lookups.speeds.find((s) => s.id === id)?.name ?? `#${id}`) : null;
  const groupName = (id: number | null | undefined) =>
    id ? (lookups.postcodeGroups.find((g) => g.id === id)?.name ?? `#${id}`) : null;
  const runName = (id: number | null | undefined) =>
    id ? (lookups.linehaulRuns.find((r) => r.id === id)?.runName ?? `run #${id}`) : null;
  const dropOffName = (id: number | null | undefined) =>
    id ? ((lookups.dropOffLocations ?? []).find((d) => d.id === id)?.name ?? null) : null;
  const storageLabel = (id: number | null | undefined) =>
    id ? (lookups.storageStates.find((s) => s.id === id)?.label ?? `#${id}`) : null;

  if (leg.type === 'collection') {
    // Collection always starts at the client address now. The only variable
    // is where it lands, which is the chain's first Depot leg.
    return (
      <>
        <div className="font-medium text-text-primary">
          Collect from client address{originDepotName ? ` -> ${originDepotName}` : ''}
        </div>
        <div className="text-xs text-text-muted">
          Speed {speedName(leg.speedId) ?? '-'}
          {leg.postcodeGroupId ? ` - zone group ${groupName(leg.postcodeGroupId)}` : ''}
          {leg.zones.length > 0 ? ` - zones ${leg.zones.join(', ')}` : ''}
        </div>
      </>
    );
  }
  if (leg.type === 'depot') {
    // Null means the picker has not been filled in yet. Phrase the whole
    // clause here rather than interpolating a placeholder into
    // "Origin region {x}", which read "Origin region region not set".
    const regionLabel = leg.clientAddress
      ? (depotName(leg.originRegionId)
          ? `Origin region ${depotName(leg.originRegionId)}`
          : 'Origin region not set')
      : null;
    // Direct names the depot it is dispatched from, which is the Delivery
    // leg's region: nothing is trucked through it, it is the reporting branch.
    const headline = leg.directOrigin
      ? `Direct: booking pickup address, dispatched from ${dispatchRegionName ?? 'the delivery region'}`
      : leg.clientAddress
        ? 'From client address'
        : depotName(leg.depotId)
          // F24 item 3. The depot is the lane origin whether or not a
          // collection is booked; saying it out loud is what stops the next
          // person reading a populated depot with BookPickup 0 as a mistake
          // and "tidying" it away, which is the bug this item fixed.
          ? `From ${depotName(leg.depotId)}${chainHasCollection ? '' : ' (lane origin, no collection booked)'}`
          : 'Depot (not set)';
    return (
      <>
        <div className="font-medium text-text-primary">
          {headline}
        </div>
        <div className="text-xs text-text-muted">
          {leg.clientAddress && `${regionLabel} - `}
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
          {/* F22. The select is inside the card's edit view, so a dispatcher
              reading the chain had to open every leg to see where the
              freight is actually left. */}
          {leg.dropOffLocationId != null && (
            <> · drop-off {dropOffName(leg.dropOffLocationId) ?? `#${leg.dropOffLocationId}`}</>
          )}
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

/**
 * The zone picker on a leg, for both the Collection and the Delivery card.
 *
 * What persists is a zone NUMBER, and a number only means something next to a
 * depot: the availability function resolves a tick by joining the zone's depot
 * to the schedule's region. So the list is filtered to this leg's depot and
 * each chip carries the zone's name and how many postcodes it covers.
 *
 * Numbers already ticked that have no zone at this depot are shown greyed
 * rather than hidden. They are what the old bare-number picker produced: its
 * source unions the tick table itself, so one tick put a number on the list
 * forever with nothing to explain it. Hiding them would leave a tick the
 * operator cannot see and cannot clear, while the function silently ignores
 * it.
 */
export function LegZonePicker({
  title,
  depotId,
  selected,
  lookups,
  onChange,
  hideCheckbox,
  numberPrefix = '',
}: {
  title: string;
  depotId: number | null;
  selected: number[];
  lookups: LookupCatalogue;
  onChange: (zones: number[]) => void;
  /** The Delivery card renders chips without a visible checkbox. */
  hideCheckbox?: boolean;
  /** Prefix on the bare-number chips of the NZ list. The Delivery card has
   *  always shown "Z1", the Collection card "1". */
  numberPrefix?: string;
}) {
  const labelled = lookups.zones ?? [];

  const toggle = (zone: number, on: boolean) =>
    onChange(on ? [...selected, zone].sort((a, b) => a - b) : selected.filter((v) => v !== zone));

  // NZ, unchanged. The labelled, depot-scoped list is a US change (coverage
  // spec 5.1) and NZ was explicitly left alone, so the server sends no
  // labelled zones there and this keeps the list it has always had: every
  // zone number the tenant uses, on every leg, no filter. Filtering it would
  // have been defensible but it is a visible change nobody asked for.
  if (labelled.length === 0) {
    const numbers = lookups.zoneNumbers ?? [];
    if (numbers.length === 0) return null;
    return (
      <div className="block col-span-2 text-xs">
        <div className="mb-1">{title}</div>
        <div className="flex flex-wrap gap-1">
          {numbers.map((z) => {
            const checked = selected.includes(z);
            return (
              <label
                key={z}
                className={`px-2 py-1 border rounded cursor-pointer ${
                  checked
                    ? 'border-brand-cyan bg-brand-cyan/10 text-text-primary'
                    : 'border-border text-text-muted'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => toggle(z, e.target.checked)}
                  className={hideCheckbox ? 'hidden' : 'mr-1 accent-brand-cyan'}
                />
                {numberPrefix}{z}
              </label>
            );
          })}
        </div>
      </div>
    );
  }

  const available = labelled.filter((z) => depotId != null && z.depotId === depotId);
  const orphans = selected.filter((z) => !available.some((a) => a.zone === z));

  if (available.length === 0 && orphans.length === 0) return null;

  // One heading per zone group so pricing zones and coverage zones read as two
  // families. NZ sends no group, which collapses to a single unlabelled block.
  const groups = Array.from(new Set(available.map((z) => z.groupLabel ?? ''))).sort();

  return (
    <div className="block col-span-2 text-xs">
      <div className="mb-1">{title}</div>
      {groups.map((group) => (
        <div key={group || '_'} className="mb-1">
          {group && <div className="text-text-muted mb-0.5">{group}</div>}
          <div className="flex flex-wrap gap-1">
            {available
              .filter((z) => (z.groupLabel ?? '') === group)
              .map((z) => {
                const checked = selected.includes(z.zone);
                return (
                  <label
                    key={z.zone}
                    title={`Zone ${z.zone} - ${z.zipCount} postcode${z.zipCount === 1 ? '' : 's'}`}
                    className={`px-2 py-1 border rounded cursor-pointer ${
                      checked
                        ? 'border-brand-cyan bg-brand-cyan/10 text-text-primary'
                        : 'border-border text-text-muted'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggle(z.zone, e.target.checked)}
                      className={hideCheckbox ? 'hidden' : 'mr-1 accent-brand-cyan'}
                    />
                    {z.label} <span className="opacity-60">({z.zipCount})</span>
                  </label>
                );
              })}
          </div>
        </div>
      ))}
      {orphans.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {orphans.map((z) => (
            <label
              key={z}
              title={`No zone numbered ${z} at this depot, so this tick never matches. Untick it to clear it.`}
              className="px-2 py-1 border border-dashed border-border rounded cursor-pointer text-text-muted opacity-60"
            >
              <input
                type="checkbox"
                checked
                onChange={() => toggle(z, false)}
                className={hideCheckbox ? 'hidden' : 'mr-1'}
              />
              {z} - no zone numbered {z} at this depot
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function LegEditor({
  leg,
  onPatch,
  lookups,
  isFirstDepot,
  originDepotName,
  originDepotId,
  pickupBoxDiscount,
  onPickupBoxDiscountChange,
  dropOffLocationId,
  onDropOffLocationIdChange,
}: {
  leg: Leg;
  onPatch: (patch: Partial<Leg>) => void;
  lookups: LookupCatalogue;
  /** True for the chain's first Depot leg, the only one that may be the
   *  client's own address. */
  isFirstDepot: boolean;
  /** Name of the depot the Collection leg lands at, read from that same
   *  first Depot leg. Null when it is not set or is the client address. */
  originDepotName: string | null;
  /** Id of that same first Depot leg's depot. The drop-off options are the
   *  tblDropOffLocation rows for it: that is the depot the LHP job delivers
   *  into, which is exactly what the old Advanced filter on pickupDepotId
   *  meant, so this keeps one identity rather than adding a second. */
  originDepotId: number | null;
  /** Schedule-level PickupBoxDiscount value. Rendered on the Collection
   *  leg editor per Steve's F14 relocation; the write path still hits
   *  tblBulkRunSchedule.PickupBoxDiscount (not a per-leg column). */
  pickupBoxDiscount?: number | null;
  onPickupBoxDiscountChange?: (v: number | null) => void;
  dropOffLocationId?: number | null;
  onDropOffLocationIdChange?: (v: number | null) => void;
}) {
  if (leg.type === 'collection') {
    const boxDiscounts = lookups.pickupBoxDiscounts ?? [];
    const showBoxDiscount = boxDiscounts.length > 0 && onPickupBoxDiscountChange != null;
    // Same filter the Advanced panel used, on the same identity: the first
    // Depot leg's depot IS the pickup depot the schedule stores.
    const scheduleDropOffs = (lookups.dropOffLocations ?? []).filter(
      (d) => !originDepotId || d.depotId === originDepotId,
    );
    const scheduleDropOffName = dropOffLocationId != null
      ? ((lookups.dropOffLocations ?? []).find((d) => d.id === dropOffLocationId)?.name ?? null)
      : null;
    return (
      <div className="grid grid-cols-2 gap-3">
        <p className="col-span-2 text-[11px] text-text-muted">
          {/* F22. The old sentence said the destination is set elsewhere,
              which is true of the depot and was being read as true of the
              drop-off too, so nobody setting up a collection ever saw it. */}
          Collects from the client's address into{' '}
          {originDepotName ?? 'the first depot in this route'}, drop-off{' '}
          {scheduleDropOffName ?? 'depot default'}.
        </p>
        <label className="block text-xs">
          Collection speed
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
        <label className="block text-xs">
          Collection zone group
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
        {onDropOffLocationIdChange && (
          <label className="block text-xs" data-testid="collection-drop-off-location">
            Drop-off at {originDepotName ?? 'the first depot'}
            <select
              value={dropOffLocationId ?? ''}
              onChange={(e) => onDropOffLocationIdChange(e.target.value ? Number(e.target.value) : null)}
              className="mt-1 w-full px-2 py-1 border border-border rounded"
            >
              <option value="">- depot default -</option>
              {scheduleDropOffs.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
        )}
        {/* The pickup side writes BulkPickupZoneSchedule, which no booking
            object reads on US yet, so these ticks do not gate anything there.
            The picker is still the labelled one: a bare number is unreadable
            on either tenant. */}
        <LegZonePicker
          title="Zones this leg collects from"
          depotId={originDepotId}
          selected={leg.zones}
          lookups={lookups}
          onChange={(zones) => onPatch({ zones } as Partial<Leg>)}
          numberPrefix=""
        />
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
            value={leg.directOrigin ? 'direct' : leg.clientAddress ? 'client' : (leg.depotId ?? '')}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'client') {
                onPatch({ clientAddress: true, directOrigin: false, depotId: null } as Partial<Leg>);
              } else if (v === 'direct') {
                // Direct carries neither a depot nor an origin region: the
                // pickup address arrives with the booking and the dispatch
                // region is the Delivery leg's.
                onPatch({
                  directOrigin: true,
                  clientAddress: false,
                  originRegionId: null,
                  depotId: null,
                } as Partial<Leg>);
              } else {
                // Leaving client origin drops the origin region: a real
                // depot IS the origin.
                onPatch({
                  clientAddress: false,
                  directOrigin: false,
                  originRegionId: null,
                  depotId: v ? Number(v) : null,
                } as Partial<Leg>);
              }
            }}
            className="mt-1 w-full px-2 py-1 border border-border rounded"
          >
            <option value="">-</option>
            {/* Only the chain's first Depot leg can be the client's own
                address, or Direct. A depot after a linehaul is somewhere we
                actually land, so it has to be a real one. */}
            {isFirstDepot && <option value="client">Client address</option>}
            {isFirstDepot && <option value="direct">Direct (pickup address from the booking)</option>}
            {lookups.depots.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        {leg.directOrigin && (
          <p className="col-span-2 text-[11px] text-text-muted">
            One job, from whatever pickup address the booking declares straight
            to the delivery address. No depot is touched: the depot named on
            this card is the Delivery leg's region, which is the dispatch and
            reporting branch only. A Collection leg and linehaul legs are both
            unavailable while the origin is Direct.
          </p>
        )}
        {leg.clientAddress && (
          <label className="block text-xs">
            Origin region
            <select
              value={leg.originRegionId ?? ''}
              onChange={(e) => onPatch({ originRegionId: e.target.value ? Number(e.target.value) : null } as Partial<Leg>)}
              className="mt-1 w-full px-2 py-1 border border-border rounded"
            >
              <option value="">-</option>
              {lookups.depots.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
        )}
        {leg.clientAddress && (
          <p className="col-span-2 text-[11px] text-text-muted">
            Goods are at the client's own address at the start of this
            schedule. The origin region says which branch owns the start of
            the chain; the delivery region still comes from the Delivery leg.
          </p>
        )}
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
            checked={leg.chargePerConsignment === true}
            onChange={(e) => onPatch({ chargePerConsignment: e.target.checked } as Partial<Leg>)}
            className="accent-brand-cyan"
          />
          Cartons once (pallets per unit, all cartons charged as one)
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
      {/* The delivery side writes BulkZoneSchedule, which IS what the US
          coverage rule reads, so these ticks are the ones that limit what the
          schedule serves once the tenant setting is on. The depot is this
          leg's own region, the same value the SQL joins the zone's depot to. */}
      <LegZonePicker
        title="Zones this leg fulfils"
        depotId={leg.regionId}
        selected={leg.zones}
        lookups={lookups}
        onChange={(zones) => onPatch({ zones } as Partial<Leg>)}
        hideCheckbox
        numberPrefix="Z"
      />
    </div>
  );
}
