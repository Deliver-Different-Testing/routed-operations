import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../common/Modal';
import { schedulesV2Keys, useScheduleOccurrences, useSchedulesV2Detail } from '../../hooks/queries/useSchedulesV2';
import { schedulesV2Service } from '../../services/schedulesV2Service';
import { scheduleService, type ScheduleGroup, type ScheduleGroupUpsertBody } from '../../services/scheduleService';
import {
  recurringRouteService,
  type RecurringRoute,
  type RouteRosterEntry,
} from '../../services/recurringRouteService';
import {
  linehaulService,
  LinehaulMode,
  type TenantLinehaulRun,
  type LinehaulRosterRow,
} from '../../services/linehaulService';
import { bulkPolygonService, type BulkPolygon } from '../../services/bulkPolygonService';
import { ChainBuilder, deriveOriginFromLegs, type Leg, type DepotLeg } from './ChainBuilder';
// Kevin 2026-09-25: `<ClientOverrideEditor>` popup is retired as an
// entry point (both nested-row click on the Schedules list and the
// Clients tab "Edit / Configure override" buttons now re-open this
// same modal in override-edit mode). ClientOverrideEditor.tsx was left on
// disk at the time and deleted on 2026-10-13: three weeks of nothing
// importing it was enough, and leaving it there had already cost two
// people time. Garry hit it mapping the Routed Ops feature switches and
// had to ask whether DeleteOverride was still live, and the per-client
// occurrences field was built into it by someone who did not know it was
// dead, so that field shipped invisible until it was moved here.
import type {
  ScheduleOverride,
  ScheduleOverridePutBody,
  ScheduleScopeOverride,
  LegScopeOverride,
} from '../../services/schedulesV2Service';
import { PostcodeLookupInput } from './PostcodeLookupInput';
import { ScheduleCoverageMap } from '../schedules/ScheduleCoverageMap';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { clientsService, type ClientGeocodeResult } from '../../services/clientsService';

// Edit modal for the Schedules NEW page (Steve's 2026-09-08 brief
// section 2). 4 tabs: Clients / Route / Operating days / Roster.
// Name + Description + Book-immediately + Route + Operating days are editable
// in place; Save PUTs a ScheduleGroupUpsertBody via
// schedulesV2Service.update, or create when there is no scheduleId yet.
//
// This said scheduleService.upsert, the v1 endpoint, until 2026-10-13. It
// had been wrong since the v2 write path landed, and it cost real time:
// Garry mapped the Routed Ops feature switches from it and keyed the v1
// Schedules upsert to this page, which would have put the wrong switch in
// front of the save. Schedules NEW calls v1 for lookups, client search and
// the auto-book toggle, and for nothing else. Clients tab
// still uses the dedicated /api/v2 attach/detach endpoints so the
// audit trail on link rows carries "attach"/"detach" verbs; Roster
// tab is display-only (linehauls are edited on the Route tab as
// LINEHAUL legs; recurring routes are edited on the Recurring Routes
// page).

type ModalTab = 'clients' | 'route' | 'days' | 'coverage' | 'roster';

const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];


/**
 * "Fri 10 Oct" from an ISO date. Weekday first because that is what an
 * operator checks against the ticked days; no year, because the preview
 * never reaches more than 60 days out.
 */
function formatOccurrence(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' });
}

interface DayForm {
  id: number | null;
  enabled: boolean;
  startTime: string;
  endTime: string;
  /** F11 Phase C (2026-09-24). Absolute cutoff day-of-week
   *  (1=Mon..7=Sun). NULL until the operator picks. */
  cutoffDay: number | null;
  /** F11 Phase C (2026-09-24). Absolute cutoff wall-clock time as
   *  "HH:mm". */
  cutoffTime: string | null;
}

// F11 Phase C default: same-day 06:00 cutoff. cutoffDay stays null in
// the shared shape; seedDaysFromDto pulls the DTO value and
// setDayActive-style enable handlers seed it to the day's own dayOfWeek.
const EMPTY_DAY: Omit<DayForm, 'enabled'> = {
  id: null,
  startTime: '08:00',
  endTime: '17:00',
  cutoffDay: null,
  cutoffTime: '06:00',
};

function seedDaysFromDto(dtoDays: ScheduleGroup['dayWindows']): DayForm[] {
  const byDay = new Map(dtoDays.map((d) => [d.dayOfWeek, d]));
  return [1, 2, 3, 4, 5, 6, 7].map((n) => {
    const d = byDay.get(n);
    return d
      ? {
          id: d.id,
          enabled: true,
          startTime: d.startTime,
          endTime: d.endTime,
          // F11 Phase C: seed the absolute pair straight from the DTO.
          // Legacy rows return null-null here and stay on the CutoffHours
          // fallback the backend derives on write.
          cutoffDay: d.cutoffDay,
          cutoffTime: d.cutoffTime,
        }
      : { ...EMPTY_DAY, enabled: false };
  });
}

// Canonical projection of a linehaul upsert row used ONLY for dirty
// detection (F7 Steve 2026-09-20). Not sent on the wire. Keeping the
// key set + ordering stable lets us JSON.stringify + compare the
// seed's derived output against the current derived output; a mismatch
// means the operator touched a linehaul leg somewhere in the chain.
function canonicalLinehaul(l: LinehaulUpsertRow): string {
  return JSON.stringify({
    name: l.name ?? null, active: l.active ?? null,
    amount: l.amount ?? null, amountPercentage: l.amountPercentage ?? null,
    fromDepotId: l.fromDepotId ?? null, toDepotId: l.toDepotId ?? null,
    minutes: l.minutes ?? null, linehaulRunId: l.linehaulRunId ?? null,
    insertToBulk: l.insertToBulk ?? null, applyDiscount: l.applyDiscount ?? null,
    applyAddOnPercentage: l.applyAddOnPercentage ?? null,
    weekDay: l.weekDay ?? [],
    departureAdvanceDays: l.departureAdvanceDays ?? null,
    fromClientAddress: l.fromClientAddress ?? null,
    dropOffLocationId: l.dropOffLocationId ?? null,
    speedId: l.speedId ?? null,
  });
}

// Non-null linehaul row shape - used inline by deriveFromLegs' local
// array and by canonicalLinehaul. Same as one element of
// ScheduleGroupUpsertBody['linehauls'] with the wrapping null stripped.
type LinehaulUpsertRow = NonNullable<ScheduleGroupUpsertBody['linehauls']>[number];

// Walks the leg chain, mirroring the `derived` useMemo body inside the
// component. Extracted so both the seed useEffect and the render
// memo run the SAME derivation logic - a mismatch between the two
// would produce a false "dirty" signal on first render (see F7).
function deriveFromLegs(legs: Leg[], days: DayForm[]) {
  let pickupDepotId: number | null = null;
  let pickupRatingSpeed: number | null = null;
  let pickupPostcodeGroupId: number | null = null;
  let pickupZones: number[] = [];
  let regionId = 0;
  let speedId: number | null = null;
  let postcodeGroupId: number | null = null;
  let storageState: number | null = null;
  const linehauls: LinehaulUpsertRow[] = [];
  const zones: number[] = [];
  for (const leg of legs) {
    if (leg.type === 'collection') {
      // The collection leg no longer carries a depot. Its destination, and
      // therefore PickupDepotId, is resolved from the first Depot leg after
      // this loop. It does carry the pickup zone group and zones,
      // which mirror the Delivery card (spec 3.2).
      pickupRatingSpeed = leg.speedId;
      pickupPostcodeGroupId = leg.postcodeGroupId;
      pickupZones = [...leg.zones].sort((a, b) => a - b);
    } else if (leg.type === 'depot') {
      storageState = leg.storageState;
    } else if (leg.type === 'linehaul') {
      linehauls.push({
        name: leg.name, active: leg.active,
        amount: leg.amount, amountPercentage: leg.amountPercentage,
        fromDepotId: leg.fromDepotId, toDepotId: leg.toDepotId,
        minutes: leg.transitMinutes || null,
        linehaulRunId: leg.linehaulRunId,
        insertToBulk: leg.insertToBulk, applyDiscount: leg.applyDiscount,
        applyAddOnPercentage: leg.applyAddOnPercentage,
        weekDay: leg.weekDay ?? days.map((d) => (d.enabled ? 1 : 0)),
        departureAdvanceDays: leg.dayOffset,
        fromClientAddress: leg.fromClientAddress, dropOffLocationId: leg.dropOffLocationId,
        speedId: leg.speedId,
        // Bug 1 (Steve 2026-09-25): persist the leg's position in the chain.
        // The save path deletes and re-inserts every linehaul row, so without
        // this the backfilled travel order is wiped and the booking SPs fall
        // back to Id order, i.e. the bug returns for this schedule.
        legOrder: linehauls.length + 1,
      });
    } else if (leg.type === 'delivery') {
      regionId = leg.regionId;
      speedId = leg.speedId;
      postcodeGroupId = leg.postcodeGroupId;
      for (const z of leg.zones) if (!zones.includes(z)) zones.push(z);
    }
  }
  // ── Origin resolution (schedule-origin spec, 2026-10-07) ──────────
  // Origin is expressed by the chain's first Depot leg and stored on the
  // header as OriginType / OriginRegionId.
  //
  //   client origin -> BookPickup = 0, PickupDepotId = NULL,
  //                    OriginRegionId = the Depot card's picker
  //   depot  origin -> PickupDepotId from the Depot leg ALWAYS, and
  //                    BookPickup = whether the chain has a Collection leg
  //                    (corrected for F24; it used to gate both on the
  //                    Collection leg, which wiped the depot on save)
  //
  // Region is NOT touched here. It keeps coming from the Delivery leg and
  // names the delivery branch; OriginRegionId names the branch that owns the
  // start of the chain. That is the same split a collection schedule already
  // has between PickupDepotId and Region, which is why first-leg jobs and
  // delivery jobs can sit under different teams.
  //
  // PickupDepotId is no longer picked on the Collection card; deriving it
  // from the Depot leg is an identity round-trip, because seedLegsFromDto
  // seeds that leg from PickupDepotId in the first place. That is what keeps
  // existing LHP + DEL schedules behaving exactly as before.
  //
  // Three-way since 2026-10-08 (Direct). The three-way resolution itself
  // lives in ChainBuilder's deriveOriginFromLegs so this modal and
  // NewScheduleModal cannot disagree about it.
  //
  //   direct origin -> BookPickup = 0, PickupDepotId = NULL,
  //                    OriginRegionId = NULL. No Collection leg and no
  //                    linehaul legs, both blocked in the chooser and
  //                    rejected server-side.
  const firstDepot = legs.find((l) => l.type === 'depot') as DepotLeg | undefined;
  const hasCollection = legs.some((l) => l.type === 'collection');
  const { originType, originRegionId } = deriveOriginFromLegs(legs);
  let bookPickup = false;
  if (originType === 'depot') {
    // F24 (BLOCKER, Anisah's 14 to 16 Oct staging smoke test). The depot has
    // to be carried whenever the origin IS a depot, not only when the chain
    // also happens to have a Collection leg. Gating it on hasCollection meant
    // a plain rename-and-save on a cross-depot schedule with BookPickup = 0
    // nulled PickupDepotId on every day row: Client Manager then showed
    // "Client Address" and #1591 ROSED dropped off the booking page
    // altogether. The same gate is why "add Depot leg" did not persist.
    //
    // Measured on Urgent production 2026-10-19: 5,211 day rows across 1,531
    // schedules sit in exactly the state this destroys (PickupDepotId set,
    // BookPickup 0), 5,127 of them on live headers. Any one save on any of
    // them would have done it.
    pickupDepotId = firstDepot?.depotId ?? null;
    // BookPickup answers "does this schedule book a collection job", which is
    // exactly whether the chain has a Collection leg. It is not a statement
    // about where the chain starts, and conflating the two is what caused F24.
    bookPickup = hasCollection;
  }
  zones.sort((a, b) => a - b);
  return { bookPickup, originType, originRegionId, hasCollection, pickupPostcodeGroupId, pickupZones, pickupDepotId, pickupRatingSpeed, regionId, speedId, postcodeGroupId, storageState, linehauls, zones };
}

// ─── Override-mode helpers (Kevin 2026-09-25) ──────────────────────
// Convert a 7-char WeekDays mask (Mon=0..Sun=6) to a set of ISO day
// numbers (1=Mon..7=Sun). Any non-'1' char reads as "not chosen".
// Unusable input returns an empty set.
function parseMaskToDays(mask: string | null): number[] {
  if (!mask || mask.length !== 7) return [];
  const chosen: number[] = [];
  for (let i = 0; i < 7; i++) {
    if (mask[i] === '1') chosen.push(i + 1);
  }
  return chosen;
}

// Inverse: set of ISO day numbers -> 7-char mask. Empty set yields
// '0000000' which the caller then folds to NULL before sending.
function daysToMask(days: number[]): string {
  const buf = ['0', '0', '0', '0', '0', '0', '0'];
  for (const n of days) {
    if (n >= 1 && n <= 7) buf[n - 1] = '1';
  }
  return buf.join('');
}

// Sorted-array equality, tolerant of input order. Used for the WeekDays
// override delta check ({1,2,3,4,5} equal to a base of [3,2,1,4,5]).
function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const s = [...a].sort((x, y) => x - y);
  const t = [...b].sort((x, y) => x - y);
  for (let i = 0; i < s.length; i++) if (s[i] !== t[i]) return false;
  return true;
}

// Empty-string-safe accessor. Empty and whitespace-only strings both
// resolve to null so the operator's "clear the field" gesture and
// "leave it untouched" gesture converge on the same null wire value.
function nzOrNull(v: string | null | undefined): string | null {
  if (v == null) return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

function seedLegsFromDto(d: ScheduleGroup): Leg[] {
  const legs: Leg[] = [];
  // Client origin is a stored fact on the header, never derived here. The
  // section 5.2 derivation is read-side only; using it to seed the editor
  // would let an unflagged schedule be saved back as client origin.
  const clientOrigin = d.originType === 'client';
  // Same rule for Direct (2026-10-08): seeded from the stored OriginType so
  // the Depot card's dropdown reopens on the value that was saved.
  const directOrigin = d.originType === 'direct';
  // A Collection leg only when the schedule actually books a collection.
  // This used to be unconditional, which is why a delivery-only schedule
  // rendered as "Collect from Auckland" (F6).
  if (d.bookPickup === true && d.pickupDepotId) {
    legs.push({
      type: 'collection',
      speedId: d.pickupRatingSpeed ?? null,
      postcodeGroupId: d.pickupPostcodeGroupId ?? null,
      zones: (d.pickupZones ?? [])
        .filter((z) => z.active !== false)
        .map((z) => z.zone)
        .sort((a, b) => a - b),
    });
  }
  if (directOrigin) {
    // Direct carries no depot and no origin region. The Depot card still
    // exists because it is where the origin is expressed; it names the
    // Delivery leg's region as the dispatch branch, read live rather than
    // stored here.
    legs.push({
      type: 'depot', depotId: null, clientAddress: false, directOrigin: true,
      originRegionId: null, storageState: d.storageState,
    });
  } else if (clientOrigin) {
    legs.push({
      type: 'depot', depotId: null, clientAddress: true, directOrigin: false,
      originRegionId: d.originRegionId ?? null, storageState: d.storageState,
    });
  } else if (d.pickupDepotName) {
    legs.push({
      type: 'depot', depotId: d.pickupDepotId ?? null, clientAddress: false,
      directOrigin: false,
      originRegionId: null, storageState: d.storageState,
    });
  }
  for (const lh of d.linehauls) {
    legs.push({
      type: 'linehaul',
      linehaulRunId: lh.linehaulRunId ?? null,
      fromDepotId: lh.fromDepotId ?? null,
      toDepotId: lh.toDepotId ?? null,
      dayOffset: lh.departureAdvanceDays ?? 0,
      transitMinutes: lh.minutes ?? 0,
      speedId: lh.speedId ?? null,
      amount: lh.amount ?? null,
      amountPercentage: lh.amountPercentage ?? null,
      insertToBulk: lh.insertToBulk ?? null,
      applyDiscount: lh.applyDiscount ?? null,
      applyAddOnPercentage: lh.applyAddOnPercentage ?? null,
      name: lh.name ?? null,
      active: lh.active !== false,
      weekDay: Array.isArray(lh.weekDay) && lh.weekDay.length === 7 ? lh.weekDay : null,
      dropOffLocationId: lh.dropOffLocationId ?? null,
      fromClientAddress: lh.fromClientAddress ?? null,
    });
  }
  legs.push({
    type: 'delivery',
    regionId: d.regionId,
    speedId: d.speedId,
    postcodeGroupId: d.postcodeGroupId,
    zones: (d.zones ?? []).filter((z) => z.active !== false).map((z) => z.zone),
  });
  return legs;
}

/** Override-edit mode context (Kevin 2026-09-25). When set, the same
 *  modal renders as a per-client override editor: structure fields lock
 *  (read-only for context), only the fields backed by
 *  tblBulkRunScheduleOverride columns are editable, and Save routes to
 *  the override PUT endpoint instead of the base upsert.
 *
 *  Two entry paths converge here:
 *   1. Clicking a nested override row on the Schedules NEW list
 *      (SchedulesNew.tsx OverrideNestedRow row-click).
 *   2. Clicking "Edit override" or "Configure override" next to an
 *      attached client on a BASE schedule's Clients tab.
 *  Both trigger the parent's onOpenOverride callback with this payload. */
export interface OverrideEditContext {
  clientId: number;
  clientCode: string;
  clientName: string;
  /** Field labels the client differs on ("Auto-book off (base on);
   *  Cut-off 24 all days" etc.). Empty when there is no existing
   *  override for this client yet ("Configure override" entry). */
  deltaLabels: string[];
}

interface Props {
  scheduleId: number | null;
  onClose: () => void;
  /** Open the Attach Clients modal for a schedule id. Callback owned by
   *  the parent (SchedulesNew.tsx) which manages `attachScheduleId`
   *  state, so the AttachClientsModal stays a single instance at the
   *  page level even when the detail modal triggers it. */
  onAttachClients: (scheduleId: number) => void;
  /** Navigate the modal to a different schedule id (e.g. jumping from
   *  a base schedule to one of its overrides via the Client Overrides
   *  section). Updates the ?edit=<id> URL param via the parent. */
  onOpenSchedule: (scheduleId: number) => void;
  /** Re-open this modal in override-edit mode for a specific client.
   *  Called from the Clients tab "Edit override" / "Configure override"
   *  buttons and from any other place that wants to jump straight into
   *  a delta edit. The parent swaps its open-target state so the same
   *  modal instance re-renders as an override editor. */
  onOpenOverride: (scheduleId: number, client: OverrideEditContext) => void;
  /** When set, the modal opens in override-edit mode for the named
   *  client. Structure is locked; only fields backed by
   *  tblBulkRunScheduleOverride columns are editable; Save routes to
   *  the override PUT endpoint instead of the base upsert. */
  overrideMode?: OverrideEditContext | null;
}

export function ScheduleDetailModal({
  scheduleId,
  onClose,
  onAttachClients,
  onOpenSchedule,
  onOpenOverride,
  overrideMode = null,
}: Props) {
  const isOverride = overrideMode != null;
  const [tab, setTab] = useState<ModalTab>('clients');
  const query = useSchedulesV2Detail(scheduleId);
  const data = query.data;
  const qc = useQueryClient();
  const auth = useAuth();
  const tenantId = auth.currentTenantId ?? 0;
  const toast = useToast();
  // Not-found guard for ?edit=99999999 style URLs. Backend returns
  // 200 + null for missing ids; without this the modal sits in
  // "loading" forever because retry:false suppresses error surfacing.
  // Audit HIGH #7 (2026-09-17).
  useEffect(() => {
    if (scheduleId == null) return;
    if (query.isLoading || query.isFetching) return;
    if (query.data == null && !query.isError) {
      toast.show(`Schedule #${scheduleId} not found.`, 'error');
      onClose();
    }
  }, [scheduleId, query.isLoading, query.isFetching, query.data, query.isError, toast, onClose]);
  // Kevin 2026-09-25: the compact `<ClientOverrideEditor>` popup is
  // retired as an entry point. Both the nested-row click on the Schedules
  // list and the "Edit override" / "Configure override" buttons on the
  // Clients tab of a BASE schedule now re-open this same modal in
  // override-edit mode (see `overrideMode` prop + `onOpenOverride`
  // callback above). ClientOverrideEditor.tsx was deleted on 2026-10-13;
  // see the note at the top of this file. It used to be left on disk
  // untouched; nothing renders it.

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formAutoBook, setFormAutoBook] = useState(true);
  // F21 (Steve 2026-09-20): header-level bookable flag. Separate from
  // AutoBook - IsActive gates whether the schedule can be booked at all;
  // AutoBook gates book-immediately vs stage. Default true so freshly
  // seeded schedules with no explicit value stay bookable.
  const [formIsActive, setFormIsActive] = useState(true);
  // Spec 6.1 rule 5: "Who can book this schedule" is a real control now. It
  // was a disabled radio pair whose checked state was derived from
  // clientIds.length, so it both lied on a default that had a client
  // configured and could not be changed. State lives here rather than in
  // ClientsTab because it ships in the Save body with everything else.
  const [formIsDefault, setFormIsDefault] = useState(true);
  // F13 (Steve 2026-09-20): client-facing display copy. Empty string is
  // saved as NULL so the backend can distinguish "cleared" from "unset".
  const [formDisplayName, setFormDisplayName] = useState('');
  // Occurrences ahead. Kept as a string so an empty box means "leave it
  // alone", which is different from any number the operator could type.
  const [formOccurrencesAhead, setFormOccurrencesAhead] = useState('');
  // The preview follows the box, but a request per keystroke would be
  // three wasted round trips on the way from 5 to 12. 350ms is long enough
  // to finish typing a two-digit number and short enough to feel live.
  const [debouncedOccurrences, setDebouncedOccurrences] = useState<string>('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedOccurrences(formOccurrencesAhead), 350);
    return () => clearTimeout(t);
  }, [formOccurrencesAhead]);
  const [formDisplayDescription, setFormDisplayDescription] = useState('');
  const [formLegs, setFormLegs] = useState<Leg[]>([]);
  const [formDays, setFormDays] = useState<DayForm[]>(() => seedDaysFromDto([]));
  const [saveError, setSaveError] = useState<string | null>(null);
  // Not an error: the save succeeded, the schedule just stayed on one row
  // per day. Held so the modal can say so instead of closing silently.
  const [convertNotice, setConvertNotice] = useState<string | null>(null);
  const [seededForId, setSeededForId] = useState<number | null>(null);
  // Tier 2 - Collection zone group + individual postcodes + coverage
  // polygons. Editable on the detail modal write-side, mirroring the
  // legacy /schedules parity added to NewScheduleModal.
  const [formPickupPostcodeGroupId, setFormPickupPostcodeGroupId] = useState<number | null>(null);
  const [formParentSpeedId, setFormParentSpeedId] = useState<number | null>(null);
  const [formDeliveryState, setFormDeliveryState] = useState<number | null>(null);
  const [formPickupBoxDiscount, setFormPickupBoxDiscount] = useState<number | null>(null);
  const [formDropOffLocationId, setFormDropOffLocationId] = useState<number | null>(null);
  const [formApplyPickupCutoff, setFormApplyPickupCutoff] = useState(false);
  const [formPickupCutoff, setFormPickupCutoff] = useState<number | null>(null);
  const [formPostcodeIds, setFormPostcodeIds] = useState<number[]>([]);
  const [formPolygonIds, setFormPolygonIds] = useState<number[]>([]);
  // ─── Override-mode state (Kevin 2026-09-25) ──────────────────────
  // When `overrideMode != null`, the modal renders as a per-client
  // delta editor. Each state variable below shadows a column on
  // tblBulkRunScheduleOverride. All start `null` / empty ("inherit
  // from base") and get seeded from the existing override row (if any)
  // once the listOverrides query resolves. On save we ship the current
  // value only when it differs from the base seeded value; otherwise
  // ship `null` so the override row drops that column (client falls
  // back to the base). See computeOverridePutBody() below.
  const [ovIsActive, setOvIsActive] = useState<boolean | null>(null);
  const [ovDisplayName, setOvDisplayName] = useState<string>('');
  // Not edited here, carried so a save does not drop it. See the comment
  // where it goes back into scheduleScope.
  // A string, not a number, because blank has to stay tellable apart from
  // every number the operator could type: blank means this client inherits
  // the schedule, and 1 is a real and very different answer.
  const [ovOccurrencesAhead, setOvOccurrencesAhead] = useState<string>('');
  const [ovDisplayDescription, setOvDisplayDescription] = useState<string>('');
  // WeekDays override lives as a set of ISO day numbers (1=Mon..7=Sun);
  // converted to the 7-char mask on save via daysToMask().
  const [ovWeekDays, setOvWeekDays] = useState<number[]>([]);
  const [ovCutoffDay, setOvCutoffDay] = useState<number | null>(null);
  const [ovCutoffTime, setOvCutoffTime] = useState<string>('');
  // Collection-scope override fields (five columns; the remaining
  // "additionalItemChargingLogic" column is not yet surfaced in the UI
  // and is preserved on save via the existing override row).
  const [ovCollSpeedId, setOvCollSpeedId] = useState<number | null>(null);
  const [ovCollZoneGroupId, setOvCollZoneGroupId] = useState<number | null>(null);
  const [ovCollPickupTimeMode, setOvCollPickupTimeMode] = useState<string>('');
  const [ovCollPickupWindowStart, setOvCollPickupWindowStart] = useState<string>('');
  const [ovCollPickupWindowEnd, setOvCollPickupWindowEnd] = useState<string>('');
  // Delivery-scope override fields (two columns).
  const [ovDelSpeedId, setOvDelSpeedId] = useState<number | null>(null);
  const [ovDelZoneGroupId, setOvDelZoneGroupId] = useState<number | null>(null);
  // Seeded existing override row for this client, or null if none exists
  // yet ("Configure override" entry). Populated from a filtered
  // listOverrides call because the backend has no single-client GET
  // endpoint today (checked schedulesV2Service; only list + PUT +
  // DELETE). Cheap because listOverrides is already fetched by the
  // Clients tab under the same query key.
  const [ovSeeded, setOvSeeded] = useState<boolean>(false);

  // Snapshot of the seeded form state for dirty-state tracking.
  // A no-op Save on a legacy per-client schedule would still trigger
  // the "migration to a link row happens on next save" side effect,
  // so we gate Save on the form actually differing from the seed.
  const [initialSnapshot, setInitialSnapshot] = useState<string>('');
  // F7 (Steve 2026-09-20): canonical seeded projections for zones +
  // linehauls, captured at seed time. Compared against derived.* on
  // save so we can send `null` (preserve) when the operator did not
  // touch that array, vs `[...]` (replace) when they did. Prevents the
  // save payload from silently wiping BulkZoneSchedule rows when the
  // operator only edits e.g. the description on a schedule that has
  // its delivery geography stored as zone rows.
  const [seededZonesJson, setSeededZonesJson] = useState<string | null>(null);
  const [seededLinehaulsJson, setSeededLinehaulsJson] = useState<string | null>(null);

  const currentSnapshot = useMemo(
    () => JSON.stringify({
      name: formName, description: formDescription, autoBook: formAutoBook,
      isActive: formIsActive,
      isDefault: formIsDefault,
      displayName: formDisplayName, displayDescription: formDisplayDescription,
      occurrencesAhead: formOccurrencesAhead,
      legs: formLegs, days: formDays,
      pickupPostcodeGroupId: formPickupPostcodeGroupId,
      parentSpeedId: formParentSpeedId,
      deliveryState: formDeliveryState,
      pickupBoxDiscount: formPickupBoxDiscount,
      dropOffLocationId: formDropOffLocationId,
      applyPickupCutoff: formApplyPickupCutoff,
      pickupCutoff: formPickupCutoff,
      postcodeIds: formPostcodeIds,
      polygonIds: formPolygonIds,
    }),
    [formName, formDescription, formAutoBook, formIsActive, formIsDefault,
     formDisplayName, formDisplayDescription, formOccurrencesAhead,
     formLegs, formDays,
     formPickupPostcodeGroupId, formParentSpeedId, formDeliveryState,
     formPickupBoxDiscount, formDropOffLocationId, formApplyPickupCutoff,
     formPickupCutoff, formPostcodeIds, formPolygonIds],
  );
  const isDirty = initialSnapshot !== '' && currentSnapshot !== initialSnapshot;

  // Only ask for a preview once the typed value is usable. An out-of-range
  // number has no answer worth showing, and blank means "the schedule's own
  // value", which the server resolves.
  const previewN = (() => {
    const t = debouncedOccurrences.trim();
    if (t === '') return null;
    const v = Number.parseInt(t, 10);
    return Number.isNaN(v) || v < 1 || v > 60 ? null : v;
  })();
  // Both shapes, deliberately. Storing a per-schedule N needs the detail
  // row, so the FIELD is collapsed-only, but "which dates does this offer"
  // is a fair question about any schedule and the server answers it the
  // same way for both: an old-shape schedule falls back to one week's
  // worth, which is what the booking page uses for it today. Gating the
  // preview on isCollapsed would have hidden it from almost every schedule
  // on the tenant, which is most of the value.
  const occurrencesQuery = useScheduleOccurrences(scheduleId, previewN);

  // 1 to 60, matching the CHECK on the column. Blank is valid and means
  // leave it alone, so only a typed value is range-checked.
  const occurrencesAheadError = (() => {
    const t = formOccurrencesAhead.trim();
    if (t === '') return null;
    const n = Number.parseInt(t, 10);
    return Number.isNaN(n) || n < 1 || n > 60
      ? 'Enter a number from 1 to 60, or leave blank.'
      : null;
  })();

  // Seed form state once per scheduleId. Deliberately NOT keyed on
  // `data` reference: React Query invalidations after attach/detach
  // return a fresh reference and would otherwise blow away mid-edit
  // state. Close+reopen (scheduleId changes back through null) is the
  // signal to reseed.
  useEffect(() => {
    if (!data) return;
    if (seededForId === data.scheduleId) return;
    const seedName = data.name ?? '';
    const seedDescription = data.description ?? '';
    const seedAutoBook = data.autoBook ?? true;
    const seedIsActive = data.isActive ?? true;
    // Spec 6.1: the header's own flag. The fallback is the pre-6.1
    // derivation, kept only for a cached payload that pre-dates the field;
    // once the API ships it, data.isDefault is always present.
    const seedIsDefault = data.isDefault
      ?? (data.legacyClientId == null && data.clientIds.length === 0);
    const seedDisplayName = data.displayName ?? '';
    const seedDisplayDescription = data.displayDescription ?? '';
    const seedLegs = seedLegsFromDto(data);
    const seedDays = seedDaysFromDto(data.dayWindows);
    // F7 (Steve 2026-09-20): run the same derivation the render memo
    // uses so the seeded canonical string and the first-render current
    // canonical string agree. Any mismatch after seed = the operator
    // touched a zone / linehaul leg in the chain builder.
    const initialDerived = deriveFromLegs(seedLegs, seedDays);
    const seedPickupPostcodeGroupId = data.pickupPostcodeGroupId ?? null;
    const seedParentSpeedId = data.parentSpeedId ?? null;
    const seedDeliveryState = data.deliveryState ?? null;
    const seedPickupBoxDiscount = data.pickupBoxDiscount ?? null;
    const seedDropOffLocationId = data.dropOffLocationId ?? null;
    const seedApplyPickupCutoff = data.applyPickupCutoff === true;
    const seedPickupCutoff = data.pickupCutoff ?? null;
    // Blank on an old-shape schedule: it has no detail row, so there is no
    // value to show and nothing the box could usefully say.
    const seedOccurrencesAhead = data.occurrencesAhead != null
      ? String(data.occurrencesAhead) : '';
    const seedPostcodeIds = [...(data.postcodeIds ?? [])];
    const seedPolygonIds = [...(data.polygonIds ?? [])];
    setFormName(seedName);
    setFormDescription(seedDescription);
    setFormAutoBook(seedAutoBook);
    setFormIsActive(seedIsActive);
    setFormIsDefault(seedIsDefault);
    setFormDisplayName(seedDisplayName);
    setFormDisplayDescription(seedDisplayDescription);
    setFormOccurrencesAhead(seedOccurrencesAhead);
    setFormLegs(seedLegs);
    setFormDays(seedDays);
    setFormPickupPostcodeGroupId(seedPickupPostcodeGroupId);
    setFormParentSpeedId(seedParentSpeedId);
    setFormDeliveryState(seedDeliveryState);
    setFormPickupBoxDiscount(seedPickupBoxDiscount);
    setFormDropOffLocationId(seedDropOffLocationId);
    setFormApplyPickupCutoff(seedApplyPickupCutoff);
    setFormPickupCutoff(seedPickupCutoff);
    setFormPostcodeIds(seedPostcodeIds);
    setFormPolygonIds(seedPolygonIds);
    setSaveError(null);
    setSeededForId(data.scheduleId);
    // F7: cache canonical seed for zones + linehauls. Compared against
    // current derived on save to decide null (preserve) vs [...] (replace).
    setSeededZonesJson(JSON.stringify(initialDerived.zones));
    setSeededLinehaulsJson(JSON.stringify(initialDerived.linehauls.map(canonicalLinehaul)));
    setInitialSnapshot(JSON.stringify({
      name: seedName, description: seedDescription, autoBook: seedAutoBook,
      isActive: seedIsActive,
      isDefault: seedIsDefault,
      displayName: seedDisplayName, displayDescription: seedDisplayDescription,
      occurrencesAhead: seedOccurrencesAhead,
      legs: seedLegs, days: seedDays,
      pickupPostcodeGroupId: seedPickupPostcodeGroupId,
      parentSpeedId: seedParentSpeedId,
      deliveryState: seedDeliveryState,
      pickupBoxDiscount: seedPickupBoxDiscount,
      dropOffLocationId: seedDropOffLocationId,
      applyPickupCutoff: seedApplyPickupCutoff,
      pickupCutoff: seedPickupCutoff,
      postcodeIds: seedPostcodeIds,
      polygonIds: seedPolygonIds,
    }));
  }, [data, seededForId]);

  // Reset the seed key on close so reopening the same scheduleId
  // reseeds from the (possibly refetched) data.
  useEffect(() => {
    if (scheduleId == null) {
      setSeededForId(null);
      setInitialSnapshot('');
      setSeededZonesJson(null);
      setSeededLinehaulsJson(null);
      setOvSeeded(false);
    }
  }, [scheduleId]);

  // Reset the override-mode seed flag when the modal transitions in or
  // out of override mode, or the target client changes, so the next
  // ovListQuery success reseeds cleanly.
  useEffect(() => {
    setOvSeeded(false);
  }, [isOverride, overrideMode?.clientId]);

  const lookupsQuery = useQuery({
    queryKey: schedulesV2Keys.lookups(tenantId),
    queryFn: () => scheduleService.lookups().then((r) => r.response),
    staleTime: 5 * 60_000,
  });
  const lookups = useMemo(
    () => ({
      depots: lookupsQuery.data?.depots ?? [],
      speeds: lookupsQuery.data?.speeds ?? [],
      postcodeGroups: (lookupsQuery.data?.postcodeGroups ?? []).map((g) => ({
        id: g.id, name: g.name, depotId: g.depotId ?? null,
      })),
      storageStates: lookupsQuery.data?.storageStates ?? [],
      deliveryStates: lookupsQuery.data?.deliveryStates ?? [],
      pickupBoxDiscounts: lookupsQuery.data?.pickupBoxDiscounts ?? [],
      linehaulRuns: (lookupsQuery.data?.linehaulRuns ?? []).map((r) => ({
        id: r.id, runName: r.runName, fromDepotId: r.fromDepotId, toDepotId: r.toDepotId,
      })),
      zoneNumbers: lookupsQuery.data?.zoneNumbers ?? [],
      dropOffLocations: lookupsQuery.data?.dropOffLocations ?? [],
    }),
    [lookupsQuery.data],
  );

  // Coverage polygons - lazy-fetched on modal open, cached.
  const polygonsQuery = useQuery({
    queryKey: schedulesV2Keys.bulkPolygons(tenantId),
    queryFn: () => bulkPolygonService.list().then((r) => r.response),
    staleTime: 5 * 60_000,
    enabled: scheduleId != null,
  });

  // Override-mode: fetch every override on this schedule and pick out
  // the one for our client, if any. No single-client GET endpoint
  // exists yet, so we filter the list response. Cheap because the
  // Clients tab already fetches this under the same query key.
  //
  // F25: enabled in BASE mode too, not just override mode. The occurrences
  // field needs to know whether any linked client holds an override, because
  // a schedule-level change does not reach those clients and without the
  // hint that reads as the field being broken. Same query key as the Clients
  // tab, so in practice this is a cache hit rather than a second fetch.
  const ovListQuery = useQuery({
    queryKey: schedulesV2Keys.overrides(tenantId, scheduleId ?? 0),
    queryFn: () => schedulesV2Service.listOverrides(scheduleId!),
    enabled: scheduleId != null,
    staleTime: 30_000,
  });

  // F25: how many linked clients hold their OWN occurrences number. Only the
  // schedule scope carries it, so a client with a delivery-speed override and
  // no occurrences override is not counted: the question being answered is
  // "will my edit to this field reach everyone", not "who has any override".
  const clientsOverridingOccurrences = useMemo(
    () => (ovListQuery.data ?? []).filter(
      (o) => o.schedule?.occurrencesAhead != null).length,
    [ovListQuery.data]);
  const ovExisting = useMemo<ScheduleOverride | null>(() => {
    if (!isOverride || !overrideMode || !ovListQuery.data) return null;
    return ovListQuery.data.find((o) => o.clientId === overrideMode.clientId) ?? null;
  }, [isOverride, overrideMode, ovListQuery.data]);

  // Seed override state from the existing delta row (if any). Runs once
  // per override-mode session per client; every field falls back to the
  // base schedule value when the override row is missing that column,
  // so the initial form matches what the client actually resolves to
  // today. Placed here (after ovListQuery + ovExisting) so its deps
  // resolve without a use-before-declaration.
  useEffect(() => {
    if (!isOverride || !overrideMode || !data) return;
    if (ovListQuery.isLoading || ovListQuery.isFetching) return;
    if (ovSeeded) return;
    const ex = ovExisting;
    // Schedule scope.
    setOvIsActive(ex?.schedule?.isActive ?? data.isActive);
    setOvDisplayName(ex?.schedule?.displayName ?? data.displayName ?? '');
    setOvOccurrencesAhead(
      ex?.schedule?.occurrencesAhead != null ? String(ex.schedule.occurrencesAhead) : '',
    );
    setOvDisplayDescription(ex?.schedule?.displayDescription ?? data.displayDescription ?? '');
    const maskDays = ex?.schedule?.weekDays
      ? parseMaskToDays(ex.schedule.weekDays)
      : data.dayWindows.map((d) => d.dayOfWeek);
    setOvWeekDays(maskDays);
    // The base has per-day cutoffs; the override has ONE shared pair.
    // Seed the shared pair from the override if set, otherwise from
    // the first enabled base day (falling back to today's default).
    const firstDay = data.dayWindows[0] ?? null;
    setOvCutoffDay(ex?.schedule?.cutoffDay ?? firstDay?.cutoffDay ?? null);
    setOvCutoffTime(ex?.schedule?.cutoffTime ?? firstDay?.cutoffTime ?? '');
    // Collection scope. Seed from override row first; if the override
    // has no value for a field, use the base's equivalent so the input
    // shows what the client would resolve to today.
    setOvCollSpeedId(ex?.collection?.speedId ?? data.pickupRatingSpeed ?? null);
    setOvCollZoneGroupId(ex?.collection?.zoneGroupId ?? data.pickupPostcodeGroupId ?? null);
    setOvCollPickupTimeMode(ex?.collection?.pickupTimeMode ?? '');
    setOvCollPickupWindowStart(ex?.collection?.pickupWindowStart ?? '');
    setOvCollPickupWindowEnd(ex?.collection?.pickupWindowEnd ?? '');
    // Delivery scope.
    setOvDelSpeedId(ex?.delivery?.speedId ?? data.speedId ?? null);
    setOvDelZoneGroupId(ex?.delivery?.zoneGroupId ?? data.postcodeGroupId ?? null);
    setOvSeeded(true);
  }, [isOverride, overrideMode, data, ovExisting, ovListQuery.isLoading, ovListQuery.isFetching, ovSeeded]);

  // Postcode add/remove now owned by PostcodeLookupInput; the parent
  // only receives the final ids via onPostcodeIdsChange.
  const togglePolygon = (id: number) =>
    setFormPolygonIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].sort((a, b) => a - b));

  // Walk the leg chain to pull the flat fields the backend upsert
  // needs. Same rules as NewScheduleModal.derived. Extracted to
  // `deriveFromLegs` so the seed useEffect can run the identical
  // derivation on the seeded legs and cache the initial output for
  // F7 dirty-detection.
  const derived = useMemo(() => deriveFromLegs(formLegs, formDays), [formLegs, formDays]);

  // F7 (Steve 2026-09-20): compare current derived output against the
  // seeded canonical strings so we can send `null` on unchanged
  // collections. seededXJson is set inside the seed useEffect; before
  // the first seed lands, both flags stay false so the empty payload
  // never wins.
  const currentZonesJson = useMemo(() => JSON.stringify(derived.zones), [derived.zones]);
  const currentLinehaulsJson = useMemo(
    () => JSON.stringify(derived.linehauls.map(canonicalLinehaul)),
    [derived.linehauls],
  );
  const zonesDirty = seededZonesJson !== null && seededZonesJson !== currentZonesJson;
  const linehaulsDirty = seededLinehaulsJson !== null && seededLinehaulsJson !== currentLinehaulsJson;

  const saveMut = useMutation({
    mutationFn: (body: ScheduleGroupUpsertBody) =>
      body.scheduleId != null && body.scheduleId > 0
        ? schedulesV2Service.update(body.scheduleId, body)
        : schedulesV2Service.create(body),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: schedulesV2Keys.listAll(tenantId) });
      if (data?.scheduleId != null) {
        qc.invalidateQueries({ queryKey: schedulesV2Keys.detail(tenantId, data.scheduleId) });
      }
      // The save worked either way. When the schedule could not be
      // collapsed onto one row the backend says why, and closing the modal
      // here would throw that away: the operator would see a successful
      // save and no hint that the occurrences field is still unavailable,
      // or that two of their days disagree. So stay open and show it.
      if (saved?.convertRefusalReasons) {
        setConvertNotice(saved.convertRefusalReasons);
        return;
      }
      onClose();
    },
    onError: (e: Error) => setSaveError(e.message),
  });

  // Override-mode save: PUT the delta rather than upserting the base.
  // Body is computed by comparing current override state against the
  // base seeded values; matching fields ship as `null` (removes that
  // column from the delta row) and differing fields ship the operator's
  // value. Empty scope blocks ship as `null` so the whole scope row is
  // dropped.
  const ovSaveMut = useMutation({
    mutationFn: (body: ScheduleOverridePutBody) =>
      schedulesV2Service.putOverride(scheduleId!, overrideMode!.clientId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: schedulesV2Keys.listAll(tenantId) });
      qc.invalidateQueries({ queryKey: schedulesV2Keys.detailAll(tenantId) });
      qc.invalidateQueries({ queryKey: schedulesV2Keys.overridesAll(tenantId) });
      toast.show('Client override saved.', 'success');
      onClose();
    },
    onError: (e: Error) => {
      setSaveError(e.message);
      toast.show(`Save failed: ${e.message}`, 'error');
    },
  });

  // Build the override PUT body from current ov* state vs the base
  // seeded values. Each field ships as `null` when it equals base
  // (client falls back to base); otherwise ships the operator's value.
  // Empty-string / 0 / null in the operator's UI collapse into a
  // single "no override" nullish read via nzOrNull() so the "cleared"
  // input state and the "never touched" input state both resolve to
  // inherit-from-base.
  const buildOverridePutBody = (): ScheduleOverridePutBody => {
    if (!data || !overrideMode) {
      return { schedule: null, collection: null, delivery: null };
    }
    // Schedule scope.
    const baseWeekDays = data.dayWindows.map((d) => d.dayOfWeek);
    const weekDaysDiffers = !arraysEqual(ovWeekDays, baseWeekDays);
    const baseFirstDay = data.dayWindows[0] ?? null;
    const cutoffDayDiffers = ovCutoffDay !== (baseFirstDay?.cutoffDay ?? null);
    const cutoffTimeDiffers =
      (nzOrNull(ovCutoffTime) ?? null) !== (nzOrNull(baseFirstDay?.cutoffTime ?? null) ?? null);
    const isActiveDiffers = ovIsActive !== null && ovIsActive !== data.isActive;
    const displayNameDiffers = (nzOrNull(ovDisplayName) ?? null) !== (nzOrNull(data.displayName) ?? null);
    const displayDescDiffers =
      (nzOrNull(ovDisplayDescription) ?? null) !== (nzOrNull(data.displayDescription) ?? null);
    const scheduleScope: ScheduleScopeOverride = {
      cutoffDay: cutoffDayDiffers ? ovCutoffDay : null,
      cutoffTime: cutoffTimeDiffers ? nzOrNull(ovCutoffTime) : null,
      weekDays: weekDaysDiffers ? daysToMask(ovWeekDays) : null,
      isActive: isActiveDiffers ? ovIsActive : null,
      displayName: displayNameDiffers ? nzOrNull(ovDisplayName) : null,
      displayDescription: displayDescDiffers ? nzOrNull(ovDisplayDescription) : null,
      // Carried through unchanged, NOT diffed against the base.
      //
      // This panel has no input for occurrences ahead: it works by
      // comparing the client's value against the base schedule's, and the
      // schedule's own N lives on tblBulkRunScheduleDetail, which this app
      // does not read yet. The per-client value is edited in this same
      // modal in override mode, by the field below.
      //
      // Sending null would NOT mean "leave it alone". The PUT replaces the
      // client's delta rows wholesale (ScheduleOverrideService removes the
      // existing rows before inserting), and null means "clear this field",
      // so a null here would wipe whatever the other editor, or the
      // 20261009179000 seed, had set. Round-tripping the loaded value is
      // what keeps this panel from silently undoing that.
      // Blank clears the client's own number so it inherits the schedule
      // again, which is what a null on this field means to the API.
      occurrencesAhead: ovOccurrencesAhead.trim() === ''
        ? null
        : Number.parseInt(ovOccurrencesAhead, 10),
    };
    const scheduleHasValues =
      scheduleScope.cutoffDay != null
      || scheduleScope.cutoffTime != null
      || scheduleScope.weekDays != null
      || scheduleScope.isActive != null
      || scheduleScope.displayName != null
      || scheduleScope.displayDescription != null
      || scheduleScope.occurrencesAhead != null;
    // Collection scope.
    const collSpeedDiffers = ovCollSpeedId !== (data.pickupRatingSpeed ?? null);
    const collZoneDiffers = ovCollZoneGroupId !== (data.pickupPostcodeGroupId ?? null);
    // Pickup-time-mode / windows are new override-only fields (no base
    // schedule columns to compare to). Ship non-empty values; empty
    // means "inherit from base".
    const collTimeModeVal = nzOrNull(ovCollPickupTimeMode);
    const collWindowStartVal = nzOrNull(ovCollPickupWindowStart);
    const collWindowEndVal = nzOrNull(ovCollPickupWindowEnd);
    const collectionScope: LegScopeOverride = {
      speedId: collSpeedDiffers ? ovCollSpeedId : null,
      zoneGroupId: collZoneDiffers ? ovCollZoneGroupId : null,
      pickupTimeMode: collTimeModeVal,
      pickupWindowStart: collWindowStartVal,
      pickupWindowEnd: collWindowEndVal,
      // Preserve the existing override's additionalItemChargingLogic
      // (there is no UI for it yet); null when there was none.
      additionalItemChargingLogic: ovExisting?.collection?.additionalItemChargingLogic ?? null,
    };
    const collectionHasValues =
      collectionScope.speedId != null
      || collectionScope.zoneGroupId != null
      || collectionScope.pickupTimeMode != null
      || collectionScope.pickupWindowStart != null
      || collectionScope.pickupWindowEnd != null
      || collectionScope.additionalItemChargingLogic != null;
    // Delivery scope.
    const delSpeedDiffers = ovDelSpeedId !== (data.speedId ?? null);
    const delZoneDiffers = ovDelZoneGroupId !== (data.postcodeGroupId ?? null);
    const deliveryScope: LegScopeOverride = {
      speedId: delSpeedDiffers ? ovDelSpeedId : null,
      zoneGroupId: delZoneDiffers ? ovDelZoneGroupId : null,
      pickupTimeMode: null,
      pickupWindowStart: null,
      pickupWindowEnd: null,
      additionalItemChargingLogic: null,
    };
    const deliveryHasValues = deliveryScope.speedId != null || deliveryScope.zoneGroupId != null;
    return {
      schedule: scheduleHasValues ? scheduleScope : null,
      collection: collectionHasValues ? collectionScope : null,
      delivery: deliveryHasValues ? deliveryScope : null,
    };
  };

  const submit = () => {
    if (!data) return;
    // Override-mode save routes to the delta PUT and skips the base
    // upsert validations entirely (name / region / days apply to the
    // base schedule; overrides layer on top).
    if (isOverride && overrideMode) {
      setSaveError(null);
      ovSaveMut.mutate(buildOverridePutBody());
      return;
    }
    if (!formName.trim()) { setSaveError('Name is required.'); return; }
    if (!derived.regionId || derived.regionId <= 0) {
      setSaveError('Add a Delivery leg with a region to set the destination.'); return;
    }
    const enabledDays = formDays.filter((d) => d.enabled);
    if (enabledDays.length === 0) { setSaveError('Enable at least one operating day.'); return; }
    // Spec 6.1 rule 3, operator-facing half. The backend refuses this too;
    // catching it here names the fix in the operator's own terms instead of
    // surfacing a server error after a round trip. legacyClientId counts as
    // configured, same as the server-side test, so a pre-junction per-client
    // schedule stays saveable.
    if (!formIsDefault && data.clientIds.length === 0 && data.legacyClientId == null) {
      setSaveError(
        'Configure at least one client on the Clients tab, or choose "All clients".',
      );
      return;
    }
    setSaveError(null);

    const body: ScheduleGroupUpsertBody = {
      scheduleId: data.scheduleId,
      name: formName.trim(),
      description: formDescription.trim() || null,
      // F13: empty display name/description are sent as NULL so the
      // backend can distinguish "operator cleared it" from "operator
      // never touched it".
      displayName: formDisplayName.trim() || null,
      displayDescription: formDisplayDescription.trim() || null,
      // F21: header-level bookable flag.
      isActive: formIsActive,
      // Spec 6.1: the "Who can book this schedule" radio pair. An explicit
      // boolean every save, not omit-to-leave-alone: the operator can see
      // which one is selected, so the save should mean it.
      isDefault: formIsDefault,
      // Blank means leave it alone. Only applies once the schedule has
      // collapsed, because the value lives on the detail row; the backend
      // ignores it on an old-shape schedule rather than failing, and the
      // did-not-collapse notice is what tells the operator why.
      occurrencesAhead: formOccurrencesAhead.trim() === ''
        ? null
        : Number.parseInt(formOccurrencesAhead, 10),
      regionId: derived.regionId,
      pickupDepotId: derived.pickupDepotId,
      speedId: derived.speedId,
      parentSpeedId: formParentSpeedId,
      autoBook: formAutoBook,
      // Derived from the chain, not a loose checkbox (spec 2.3).
      bookPickup: derived.bookPickup,
      originType: derived.originType,
      originRegionId: derived.originRegionId,
      // The Collection card owns these only when there IS a collection leg.
      // 115 day rows on urgent-prod have a PickupPostcodeGroupId with
      // BookPickup = 0; without this guard, saving one of those through the
      // rebuilt card would clear it. Null pickupZones means "leave alone",
      // the same contract Zones has.
      applyPickupCutoff: formApplyPickupCutoff,
      pickupCutoff: formApplyPickupCutoff ? formPickupCutoff : null,
      postcodeGroupId: derived.postcodeGroupId,
      pickupPostcodeGroupId: derived.hasCollection
        ? derived.pickupPostcodeGroupId
        : formPickupPostcodeGroupId,
      pickupZones: derived.hasCollection
        ? derived.pickupZones.map((z) => ({ zone: z, active: true }))
        : null,
      pickupRatingSpeed: derived.pickupRatingSpeed,
      storageState: derived.storageState,
      deliveryState: formDeliveryState,
      pickupBoxDiscount: formPickupBoxDiscount,
      dropOffLocationId: formDropOffLocationId,
      // F11 Phase C (Steve 2026-09-24): absolute per-day cutoff pair
       // (cutoffDay + cutoffTime). Replaces the integer cutoffHours field.
       // The backend derives a legacy CutoffHours on write so downstream
       // consumers that still read the old column keep working.
      dayWindows: formDays
        .map((d, i) => ({
          id: d.id, dayOfWeek: i + 1,
          startTime: d.startTime, endTime: d.endTime,
          cutoffDay: d.cutoffDay, cutoffTime: d.cutoffTime,
        }))
        .filter((_d, i) => formDays[i].enabled),
      // F7 (Steve 2026-09-20): send null when the operator did not
      // touch zones/linehauls so the backend null-guard preserves the
      // existing BulkZoneSchedule / TblBulkScheduleLinehaul rows.
      // Sending [] would wipe them; sending [...] with the seeded set
      // would over-write with the seeded shape (mostly a no-op, but
      // triggers change tracking on every unrelated save). Null is
      // the cleanest signal.
      zones: zonesDirty
        ? derived.zones.map((z) => ({ zone: z, active: true }))
        : null,
      linehauls: linehaulsDirty ? derived.linehauls : null,
      // Client link rows are managed via the Clients tab attach/detach
      // endpoints, not upsert. Preserve the current set so the backend
      // does not clear links on an unrelated route/days save.
      clientIds: [...data.clientIds],
      clientCodes: [...data.clientCodes],
      postcodeIds: [...formPostcodeIds],
      polygonIds: [...formPolygonIds],
    };
    saveMut.mutate(body);
  };

  const baseName = data ? (data.name ?? `Schedule #${data.scheduleId}`) : 'Schedule';
  // Header line 1 uses the same base scheduleId for both slots because
  // the Steve F1 override model has no separate override header row
  // (unlike the aspirational mockup, which presumes an independent
  // override id). The two slots stay in the copy so operators can spot
  // if that ever changes in a future model iteration.
  const title = isOverride && data
    ? `Schedule #${data.scheduleId} - override of #${data.scheduleId} - ${baseName}`
    : baseName;

  // Save button gating differs by mode.
  //  - Base mode: existing dirty-state check (form vs seed).
  //  - Override mode: always enabled once data loads. The delta body
  //    itself may be empty (all-null), which means "no delta" and the
  //    backend will clear any existing override row for this client
  //    (semantically equivalent to Delete). Operators expect Save to
  //    persist that intent even without a "change", so no dirty gate.
  const savePending = isOverride ? ovSaveMut.isPending : saveMut.isPending;
  // 1 to 60, the same range the CHECK on the column enforces. Was 1 to 14
  // under decision D2 until Steve raised it on 2026-10-14. Blank is valid
  // and means inherit, so only a typed value is checked.
  const ovOccurrencesError = (() => {
    const t = ovOccurrencesAhead.trim();
    if (t === '') return null;
    const v = Number.parseInt(t, 10);
    return Number.isNaN(v) || v < 1 || v > 60
      ? 'Enter a number from 1 to 60, or leave blank to inherit.'
      : null;
  })();

  const saveDisabled = isOverride
    ? !data || ovSaveMut.isPending || !ovSeeded || ovOccurrencesError != null
    : !data || saveMut.isPending || !isDirty || occurrencesAheadError != null;
  const saveTitle = isOverride
    ? !data
      ? 'Loading schedule...'
      : ovOccurrencesError != null
        ? ovOccurrencesError
        : 'Save this client override.'
    : !data
      ? 'Loading schedule...'
      : occurrencesAheadError != null
        ? occurrencesAheadError
        : !isDirty
          ? 'No changes to save.'
          : 'Save changes.';

  return (
    <>
    <Modal
      open={scheduleId != null}
      onClose={onClose}
      title={title}
      size="6xl"
      loading={query.isLoading || savePending}
      loadingMessage={savePending ? 'Saving...' : 'Loading schedule detail...'}
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          {saveError && (
            <span className="text-xs text-error mr-auto">{saveError}</span>
          )}
          {!saveError && convertNotice && (
            <span
              className="text-xs text-amber-600 mr-auto"
              data-testid="schedule-convert-notice"
            >
              Saved. This schedule still runs on one row per day:
              {' '}{convertNotice}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded border border-border hover:bg-surface-light"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saveDisabled}
            title={saveTitle}
            className="px-4 py-2 text-sm rounded bg-brand-cyan text-brand-dark font-medium disabled:bg-brand-cyan/40 disabled:text-brand-dark/60 disabled:cursor-not-allowed"
            data-testid={isOverride ? 'override-modal-save' : 'schedule-modal-save'}
          >
            Save
          </button>
        </div>
      }
    >
      {query.isError && (
        <div className="text-sm text-error py-8 text-center">
          Failed to load schedule: {(query.error as Error).message}
        </div>
      )}

      {data && (
        <>
          <div className="mb-4 flex items-center gap-3">
            <span className="text-xs text-text-muted">Schedule #{data.scheduleId}</span>
            {isOverride && (
              <span
                className="text-xs bg-warning-bg/40 text-warning border border-warning/30 px-2 py-0.5 rounded font-semibold uppercase tracking-wide"
                data-testid="override-badge"
              >
                Override
              </span>
            )}
            {data.legacyClientCode && (
              <span className="text-xs bg-warning-bg text-warning px-2 py-0.5 rounded">
                Legacy per-client: {data.legacyClientCode}
              </span>
            )}
          </div>

          {isOverride && overrideMode && (
            // Orange info banner spanning the full width per the mockup.
            // Copy differs based on whether the client already has an
            // override delta or is being configured for the first time
            // ("no fields differ yet - set any override field below").
            <div
              className="mb-4 rounded border border-warning/30 bg-warning-bg/40 text-warning px-3 py-2 text-xs"
              data-testid="override-info-banner"
            >
              <span className="font-semibold">Editing client override</span>
              {' - '}
              <span className="font-semibold">{overrideMode.clientName}</span>
              {' - based on '}
              <span className="font-medium">{baseName}</span>{' #'}
              <span className="font-mono">{data.scheduleId}</span>
              {'. '}
              {overrideMode.deltaLabels.length > 0
                ? (
                  <>
                    Structure is locked; only the override fields differ:{' '}
                    <span className="font-medium">{overrideMode.deltaLabels.join('; ')}</span>.
                  </>
                )
                : (
                  <>
                    Structure is locked; no fields differ yet - set any override field below.
                  </>
                )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 mb-4">
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-text-muted">Name</span>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                disabled={isOverride}
                title={isOverride ? 'Structure field - locked in override mode.' : undefined}
                className={`mt-1 w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40 ${
                  isOverride ? 'bg-surface-light text-text-muted cursor-not-allowed' : ''
                }`}
              />
            </label>
            <div className="flex flex-col gap-2 mt-6">
              {/* F21: Active flag - independent of Book immediately.
                  Active = schedule can be booked at all; Book immediately
                  = job creates now instead of staging.
                  In override mode this checkbox is bound to ovIsActive
                  (the delta value) instead of formIsActive. */}
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={isOverride ? (ovIsActive ?? data.isActive) : formIsActive}
                  onChange={(e) =>
                    isOverride ? setOvIsActive(e.target.checked) : setFormIsActive(e.target.checked)
                  }
                  className="accent-brand-cyan"
                  data-testid="schedule-is-active-checkbox"
                />
                <span className="text-sm">
                  Active
                  <span className="ml-2 text-xs text-text-muted">
                    {isOverride ? 'override this client\'s active state' : 'schedule is bookable at all'}
                  </span>
                </span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={formAutoBook}
                  onChange={(e) => setFormAutoBook(e.target.checked)}
                  disabled={isOverride}
                  title={isOverride ? 'Book immediately is not overridable per client.' : undefined}
                  className={`accent-brand-cyan ${isOverride ? 'cursor-not-allowed' : ''}`}
                />
                <span className="text-sm">
                  Book immediately
                  <span className="ml-2 text-xs text-text-muted">
                    {isOverride
                      ? 'locked - AutoBook is not an override column'
                      : 'job creates now instead of staging into bulk'}
                  </span>
                </span>
              </label>
            </div>
            <label className="col-span-2 block">
              <span className="text-xs uppercase tracking-wide text-text-muted">Description</span>
              <input
                type="text"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                disabled={isOverride}
                title={isOverride ? 'Structure field - locked in override mode.' : undefined}
                className={`mt-1 w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40 ${
                  isOverride ? 'bg-surface-light text-text-muted cursor-not-allowed' : ''
                }`}
              />
            </label>

            {/* F13: client-facing display copy shown on the booking /
                job pages. Empty values save as NULL (fall back to Name).
                In override mode this is an override column - bind to
                ovDisplayName / ovDisplayDescription. */}
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-text-muted">
                Display name
                <span className="ml-2 text-text-muted normal-case">
                  {isOverride ? '(override for this client)' : '(client-facing; blank = use Name)'}
                </span>
              </span>
              <input
                type="text"
                value={isOverride ? ovDisplayName : formDisplayName}
                onChange={(e) =>
                  isOverride ? setOvDisplayName(e.target.value) : setFormDisplayName(e.target.value)
                }
                className="mt-1 w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
                placeholder="Next Business Day"
                data-testid="schedule-display-name-input"
              />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-text-muted">
                Display description
                <span className="ml-2 text-text-muted normal-case">
                  {isOverride ? '(override for this client)' : '(client-facing subtitle)'}
                </span>
              </span>
              <input
                type="text"
                value={isOverride ? ovDisplayDescription : formDisplayDescription}
                onChange={(e) =>
                  isOverride
                    ? setOvDisplayDescription(e.target.value)
                    : setFormDisplayDescription(e.target.value)
                }
                className="mt-1 w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
                placeholder="Order by 3pm, delivered next business day"
                data-testid="schedule-display-description-input"
              />
            </label>
            {/* Occurrences ahead. Only meaningful on a collapsed schedule,
                because the value lives on its detail row, so an old-shape
                schedule gets the explanation instead of an input it cannot
                save. */}
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-text-muted">
                Occurrences ahead
                <span className="ml-2 text-text-muted normal-case">
                  (upcoming runs the booking page offers)
                </span>
              </span>
              {data.isCollapsed ? (
                <>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={formOccurrencesAhead}
                    onChange={(e) => setFormOccurrencesAhead(e.target.value)}
                    disabled={isOverride}
                    className="mt-1 w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40 disabled:bg-surface-muted"
                    placeholder={String(formDays.filter((d) => d.enabled).length || 1)}
                    data-testid="schedule-occurrences-ahead-input"
                  />
                  <span
                    className={`mt-1 block text-xs ${occurrencesAheadError ? 'text-rose-600' : 'text-text-muted'}`}
                    data-testid="schedule-occurrences-ahead-help"
                  >
                    {occurrencesAheadError
                      ?? (isOverride
                        /* Said "set per-client values in the client override
                           editor" until 2026-10-13, naming a component
                           retired on 2026-09-25: override mode IS the
                           override editor now. A per-client value for this
                           field is not wired yet, and saying so is better
                           than sending the operator somewhere that does not
                           exist. */
                        /* Said a per-client value was not editable yet until
                           the override field below landed in the same release.
                           It is editable now, so point at it rather than deny
                           it exists. */
                        ? "This is the schedule's own number. Set this client's below."
                        : 'Blank uses one week of runs, which is the number of days ticked.')}
                  </span>
                  {/* F25: a schedule-level change does not reach a client that
                      holds its own number, and the function resolves the
                      client first. On #1173 HARBT that made a correct edit
                      look like a broken field: the booking page kept offering
                      four dates because the client had a seeded override of
                      four. Say so here rather than let it be discovered. */}
                  {!isOverride && clientsOverridingOccurrences > 0 && (
                    <span
                      className="mt-1 block text-xs text-warning"
                      data-testid="schedule-occurrences-override-count"
                    >
                      {clientsOverridingOccurrences === 1
                        ? '1 client overrides this, so a change here will not reach them.'
                        : `${clientsOverridingOccurrences} clients override this, so a change here will not reach them.`}
                      {' '}Their numbers are on the Clients tab.
                    </span>
                  )}
                </>
              ) : (
                <span
                  className="mt-1 block text-xs text-text-muted"
                  data-testid="schedule-occurrences-ahead-unavailable"
                >
                  Available once this schedule runs on one row. Save it to
                  collapse; if it cannot, the reason is shown on save.
                </span>
              )}
              {/* What the number actually means, in dates, for BOTH shapes.
                  A bare "3" does not say whether that is this week or next,
                  and the mask, the cut-off and the holiday calendar all move
                  the answer. An old-shape schedule has no field to edit but
                  the question is just as fair about it, and the server
                  answers it the same way. Tracks the box rather than the
                  saved value, so the effect of an edit shows before saving. */}
              {!occurrencesAheadError && (
                <div className="mt-1.5" data-testid="schedule-occurrences-preview">
                  {occurrencesQuery.isLoading ? (
                    <span className="text-xs text-text-muted">Working out the dates...</span>
                  ) : occurrencesQuery.isError ? (
                    <span className="text-xs text-text-muted">
                      Could not work out the dates just now.
                    </span>
                  ) : (occurrencesQuery.data?.length ?? 0) === 0 ? (
                    <span className="text-xs text-text-muted">
                      No runs in the next 60 days. Every date is either a holiday or
                      already past its cut-off.
                    </span>
                  ) : (
                    <>
                      <span className="text-xs text-text-muted">
                        {/* Keyed on scheduleId and the schedule's own number, so
                            in override mode these are the schedule's dates, not
                            this client's. Whether it should follow the override
                            is open with Steve; until then it says which it is. */}
                        {/* F23: the list is only true as at a moment, and the
                            moment is the TENANT's, not the browser's. Saying
                            which is the point: the defect was the server
                            testing the cutoff against its own clock, and an
                            operator in another timezone cannot tell the
                            difference without this. */}
                        {isOverride ? 'Next runs offered (schedule default)' : 'Next runs offered'}
                        {occurrencesQuery.data![0]?.asAt
                          ? `, as the booking page will offer them at ${occurrencesQuery.data![0].asAt}:`
                          : ':'}
                      </span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {occurrencesQuery.data!.map((o) => (
                          <span
                            key={o.date}
                            title={`Order by ${o.cutoffAt}`}
                            className="px-1.5 py-0.5 rounded text-[11px] bg-surface-light border border-border text-text-secondary whitespace-nowrap"
                          >
                            {formatOccurrence(o.date)}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </label>
            {/* Per-client occurrences ahead. Override mode only: this is the
                client's own number, and the schedule's own belongs with the
                schedule. It was built into ClientOverrideEditor.tsx first,
                which had been retired as an entry point three weeks earlier
                and rendered nowhere, so the field shipped invisible. It
                lives here now because override mode IS the override editor. */}
            {isOverride && (
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-text-muted">
                  Occurrences ahead
                  <span className="ml-2 text-text-muted normal-case">
                    (override for this client)
                  </span>
                </span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={ovOccurrencesAhead}
                  onChange={(e) => setOvOccurrencesAhead(e.target.value)}
                  placeholder="Inherit"
                  className="mt-1 w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
                  data-testid="override-occurrences-ahead"
                />
                <span
                  className={`mt-1 block text-xs ${ovOccurrencesError ? 'text-rose-600' : 'text-text-muted'}`}
                  data-testid="override-occurrences-ahead-help"
                >
                  {ovOccurrencesError
                    ?? 'How many upcoming runs the booking page offers this client. Blank inherits the schedule.'}
                </span>
              </label>
            )}
          </div>

          <nav
            className="flex gap-6 -mb-px border-b border-border mb-4"
            aria-label="Schedule detail tabs"
          >
            <TabButton active={tab === 'clients'} onClick={() => setTab('clients')}>
              Clients
            </TabButton>
            <TabButton active={tab === 'route'} onClick={() => setTab('route')}>
              Route
            </TabButton>
            <TabButton active={tab === 'days'} onClick={() => setTab('days')}>
              Operating days
            </TabButton>
            <TabButton active={tab === 'coverage'} onClick={() => setTab('coverage')}>
              Coverage
            </TabButton>
            <TabButton active={tab === 'roster'} onClick={() => setTab('roster')}>
              Roster
            </TabButton>
          </nav>

          {tab === 'clients' && (
            <ClientsTab
              data={data}
              onAttachClients={onAttachClients}
              onOpenSchedule={onOpenSchedule}
              onOpenOverride={onOpenOverride}
              overrideMode={overrideMode}
              isDefault={formIsDefault}
              onIsDefaultChange={setFormIsDefault}
            />
          )}
          {tab === 'route' && (
            <RouteTab
              data={data}
              legs={formLegs}
              onLegsChange={setFormLegs}
              lookups={lookups}
              readOnly={isOverride}
              overrideMode={isOverride ? {
                ovCollSpeedId, setOvCollSpeedId,
                ovCollZoneGroupId, setOvCollZoneGroupId,
                ovCollPickupTimeMode, setOvCollPickupTimeMode,
                ovCollPickupWindowStart, setOvCollPickupWindowStart,
                ovCollPickupWindowEnd, setOvCollPickupWindowEnd,
                ovDelSpeedId, setOvDelSpeedId,
                ovDelZoneGroupId, setOvDelZoneGroupId,
              } : null}
              advanced={{
                parentSpeedId: formParentSpeedId, onParentSpeedIdChange: setFormParentSpeedId,
                deliveryState: formDeliveryState, onDeliveryStateChange: setFormDeliveryState,
                pickupBoxDiscount: formPickupBoxDiscount, onPickupBoxDiscountChange: setFormPickupBoxDiscount,
                dropOffLocationId: formDropOffLocationId, onDropOffLocationIdChange: setFormDropOffLocationId,
                pickupPostcodeGroupId: formPickupPostcodeGroupId, onPickupPostcodeGroupIdChange: setFormPickupPostcodeGroupId,
                applyPickupCutoff: formApplyPickupCutoff, onApplyPickupCutoffChange: setFormApplyPickupCutoff,
                pickupCutoff: formPickupCutoff, onPickupCutoffChange: setFormPickupCutoff,
                pickupDepotId: derived.pickupDepotId,
                bookPickupDerived: derived.bookPickup,
              }}
            />
          )}
          {tab === 'days' && (
            <DaysTab
              days={formDays}
              onChange={setFormDays}
              scheduleId={data.scheduleId}
              readOnly={isOverride}
              overrideMode={isOverride ? {
                ovWeekDays, setOvWeekDays,
                ovCutoffDay, setOvCutoffDay,
                ovCutoffTime, setOvCutoffTime,
              } : null}
            />
          )}
          {tab === 'coverage' && (
            <div className={isOverride ? 'pointer-events-none opacity-60' : undefined}>
              <CoverageTab
                postcodeIds={formPostcodeIds}
                onPostcodeIdsChange={setFormPostcodeIds}
                polygonIds={formPolygonIds}
                onTogglePolygon={togglePolygon}
                polygons={polygonsQuery.data ?? []}
                polygonsError={polygonsQuery.error ? (polygonsQuery.error as Error).message : null}
                polygonsLoading={polygonsQuery.isLoading}
                // destinationDepotId here MUST be a depot id (used by the
                // /territory/postcodesForSchedule resolver for zone-derived
                // zip polygons). derived.regionId is a REGION id, not a
                // depot - on US tenants the two differ and the zone layer
                // silently returned wrong/empty data. Until we plumb a
                // proper delivery-depot id through, prefer pickupDepotId
                // (which IS a depot fk); null when both are absent. Audit
                // CRITICAL #5 in the 2026-09-17 review.
                destinationDepotId={derived.pickupDepotId ?? null}
                activeZones={derived.zones}
                isUsTenant={auth.isUsTenant}
                googleMapsKey={auth.googleMapsKey}
                scheduleKey={data.scheduleId}
              />
            </div>
          )}
          {tab === 'roster' && (
            <div className={isOverride ? 'pointer-events-none opacity-60' : undefined}>
              <RosterTab data={data} />
            </div>
          )}
        </>
      )}
    </Modal>
    </>
  );
}

// ─── Tabs ───────────────────────────────────────────────────────────

interface ClientsTabProps {
  data: ScheduleGroup;
  onAttachClients: (scheduleId: number) => void;
  onOpenSchedule: (scheduleId: number) => void;
  /** Open THIS modal in override-edit mode for the named client.
   *  Kevin 2026-09-25: replaces the retired ClientOverrideEditor popup;
   *  both "Edit override" and "Configure override" now converge here. */
  onOpenOverride: (scheduleId: number, client: OverrideEditContext) => void;
  /** When set, this ClientsTab is being rendered inside an override-edit
   *  session. Renders a stripped view: only the override client, no
   *  radios, no attach button, no client-overrides list. */
  overrideMode: OverrideEditContext | null;
  /** Spec 6.1 rule 5. The "Who can book this schedule" radio pair now
   *  edits the parent's form state and ships on Save, instead of showing a
   *  disabled reading derived from how many clients were configured. */
  isDefault: boolean;
  onIsDefaultChange: (next: boolean) => void;
}

function ClientsTab({
  data, onAttachClients, onOpenSchedule, onOpenOverride, overrideMode,
  isDefault, onIsDefaultChange,
}: ClientsTabProps) {
  const qc = useQueryClient();
  const auth = useAuth();
  const tenantId = auth.currentTenantId ?? 0;
  const toast = useToast();
  // 6.1: isDefault arrives as a prop from the parent's form state. It used
  // to be derived here as "legacyClientId == null && clientIds.length === 0",
  // which is the bug: configuring a client on a default schedule flipped the
  // radio pair to "Specific clients" although the header still said every
  // client could book it, and nothing the operator clicked could change the
  // header either way.
  const detachMut = useMutation({
    mutationFn: (clientId: number) =>
      schedulesV2Service.detachClient(data.scheduleId, clientId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: schedulesV2Keys.listAll(tenantId) });
      qc.invalidateQueries({ queryKey: schedulesV2Keys.detail(tenantId, data.scheduleId) });
    },
    onError: (e: Error) => {
      // Audit finding: this mutation previously swallowed errors silently.
      toast.show(`Detach failed: ${e.message}`, 'error');
    },
  });

  // F25: the Remove-override button was lost with the dead
  // ClientOverrideEditor on 2026-09-25 and schedulesV2Service.deleteOverride
  // has had no caller since, so a per-client override could be created and
  // seen but never removed from this screen. That is half of why #1173 HARBT
  // looked like the schedule-level field did not work: the client held a
  // seeded override of 4, the field edits the detail row, and there was no
  // way to clear the override that was winning.
  const removeOverrideMut = useMutation({
    mutationFn: (clientId: number) =>
      schedulesV2Service.deleteOverride(data.scheduleId, clientId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: schedulesV2Keys.overrides(tenantId, data.scheduleId) });
      qc.invalidateQueries({ queryKey: schedulesV2Keys.detail(tenantId, data.scheduleId) });
      // The booking page's dates change the moment the override goes, and
      // the preview is the thing the operator is looking at while they do
      // this, so it has to be refetched rather than left stale.
      qc.invalidateQueries({ queryKey: ['schedules-v2-occurrences', tenantId, data.scheduleId] });
      toast.show('Override removed. This client now follows the schedule.', 'success');
    },
    onError: (e: Error) => {
      toast.show(`Could not remove the override: ${e.message}`, 'error');
    },
  });

  // Overrides pointing at this base schedule (Steve's mockup section
  // "CLIENT OVERRIDES - same route, different values"). Lists override
  // headers with the client each owns; clicking an override navigates
  // the modal to that schedule via the ?edit=<id> deep-link pattern.
  const overridesQuery = useQuery({
    queryKey: schedulesV2Keys.overrides(tenantId, data.scheduleId),
    queryFn: () => schedulesV2Service.listOverrides(data.scheduleId),
    staleTime: 30_000,
  });
  const overrides = overridesQuery.data ?? [];

  // Kevin 2026-09-25: derive per-client delta labels from the override's
  // scope blocks. The "differs on:" hint in the base-mode row is the
  // authoritative source, so we reuse it verbatim here and pass it into
  // the override-edit modal so the info banner text is consistent
  // regardless of which entry path the operator took.
  const deltaLabelsFor = (o: ScheduleOverride): string[] => {
    const labels: string[] = [];
    if (o.schedule) labels.push('schedule');
    if (o.collection) labels.push('collection');
    if (o.delivery) labels.push('delivery');
    return labels;
  };
  const handleOpenOverride = (
    clientId: number,
    clientCode: string,
    clientName: string,
    existing: ScheduleOverride | null,
  ) => {
    onOpenOverride(data.scheduleId, {
      clientId,
      clientCode,
      clientName,
      // "Configure override" case (no existing delta): empty array -
      // the modal renders "no fields differ yet - set any override
      // field below" instead of the delta-labels sentence.
      deltaLabels: existing ? deltaLabelsFor(existing) : [],
    });
  };

  // Override-mode render: strip the layout down to a single "Attached
  // clients" section with the one override client. No radios, no
  // client-overrides list, no attach button, no per-client action
  // buttons - this modal IS the override edit.
  if (overrideMode) {
    return (
      <div className="grid grid-cols-1">
        <section>
          <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
            Attached client
            <span className="text-xs text-text-muted font-normal">
              this override applies to
            </span>
          </h3>
          <ul className="space-y-1" data-testid="override-attached-client">
            <li
              className="flex items-center justify-between text-sm px-3 py-2 border border-border rounded"
            >
              <span className="flex-1 flex items-center gap-2">
                <span className="font-medium text-text-primary">{overrideMode.clientName}</span>
                <span className="text-text-muted">·</span>
                <span className="text-text-secondary">{overrideMode.clientCode}</span>
                <span className="text-text-muted">·</span>
                <span className="text-xs text-text-muted font-mono">{overrideMode.clientId}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning-bg text-warning font-semibold uppercase tracking-wide">
                  override
                </span>
              </span>
            </li>
          </ul>
          <p className="mt-3 text-xs text-text-muted italic">
            Only fields backed by tblBulkRunScheduleOverride columns are
            editable in this modal. Structure fields stay locked.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <section>
        <h3 className="text-sm font-semibold text-text-primary mb-3">
          Who can book this schedule
        </h3>
        <div className="space-y-2">
          <RadioRow
            checked={isDefault}
            onSelect={() => onIsDefaultChange(true)}
            label="All clients"
            hint={'Every client can book this schedule. Clients configured '
              + 'below get their own settings and are ranked first for them, '
              + 'which changes what they see rather than who is allowed.'}
            testId="who-can-book-all-clients"
          />
          <RadioRow
            checked={!isDefault}
            onSelect={() => onIsDefaultChange(false)}
            label="Specific clients"
            hint={'Only the clients configured below can book it. At least one '
              + 'is required: a schedule that is neither for all clients nor '
              + 'configured for anybody cannot be booked at all.'}
            testId="who-can-book-specific-clients"
          />
        </div>
        <p className="mt-2 text-xs text-text-muted">
          Takes effect on Save, with the rest of the schedule.
        </p>

        {/* Client overrides section per Steve F1 (2026-09-20). Deltas
            live in tblBulkRunScheduleOverride; the base schedule is
            never cloned. One card per client with at least one delta
            row. */}
        <div className="mt-6 pt-4 border-t border-border">
          <h3 className="text-sm font-semibold text-text-primary mb-1 flex items-center gap-2">
            Client overrides
            <span className="text-xs text-text-muted font-normal">
              same route, different values
            </span>
          </h3>
          {overridesQuery.isLoading && (
            <p className="text-xs text-text-muted italic mt-2">Loading overrides...</p>
          )}
          {!overridesQuery.isLoading && overrides.length === 0 && (
            <p className="text-xs text-text-muted italic mt-2">
              No client differs from this schedule yet.
            </p>
          )}
          {overrides.length > 0 && (
            <ul className="mt-2 space-y-1" data-testid="client-overrides-list">
              {overrides.map((o) => {
                const scopeChips: string[] = [];
                if (o.schedule) scopeChips.push('schedule');
                if (o.collection) scopeChips.push('collection');
                if (o.delivery) scopeChips.push('delivery');
                return (
                  <li
                    key={o.clientId}
                    className="flex items-center gap-3 text-sm px-3 py-2 border border-border rounded"
                    data-testid={`client-override-row-${o.clientId}`}
                  >
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-warning-bg text-warning text-[10px] font-semibold">
                      O
                    </span>
                    <span className="font-medium text-text-primary">
                      {o.clientCode ?? `Client #${o.clientId}`}
                    </span>
                    <span className="text-xs text-text-muted">
                      differs on: {scopeChips.join(', ')}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleOpenOverride(
                          o.clientId,
                          o.clientCode ?? `#${o.clientId}`,
                          o.clientName ?? o.clientCode ?? `Client #${o.clientId}`,
                          o,
                        )
                      }
                      className="ml-auto text-xs text-brand-cyan hover:underline"
                      data-testid={`client-override-edit-${o.clientId}`}
                    >
                      Edit
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-xs text-text-muted">
            An override records only the fields this client differs on. The base schedule
            stays untouched and the client keeps booking it.
          </p>
          {/* "Create override" is per-client. Rendered inline on each
              attached client row below (see Attached clients column).
              Left button removed by Steve F1 (2026-09-22). */}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
          Configured clients
          <span className="text-xs text-text-muted font-normal">
            {data.clientCodes.length} configured
          </span>
        </h3>
        {/* Spec 6.1 rule 2: a link row means "this schedule is configured for
            this client", which is not the same as "only this client may book
            it". The old copy read "No clients attached. This is a default
            schedule.", which stated the consequence backwards: whether the
            schedule is a default is the setting above, and an empty list says
            nothing about it. */}
        {data.clientCodes.length === 0 && data.legacyClientCode == null && (
          <p className="text-xs text-text-muted italic">
            {isDefault
              ? 'No client is configured on this schedule. Every client books it as it stands.'
              : 'No client is configured yet. This schedule cannot be booked until one is, or until you choose "All clients" above.'}
          </p>
        )}
        {data.legacyClientCode && (
          <div className="mb-2 text-xs px-3 py-2 border border-warning/40 bg-warning-bg/40 rounded">
            Legacy per-client group. Client <strong>{data.legacyClientCode}</strong> owns this
            row via the pre-junction ClientId column; migration to a link row happens on next
            save.
          </div>
        )}
        <ul className="space-y-1">
          {data.clientCodes.map((code, i) => {
            const linkedUtc = data.clientLinkedUtcs?.[i] ?? null;
            const sinceLabel = linkedUtc ? formatSinceDate(linkedUtc) : null;
            const clientId = data.clientIds[i];
            const name = data.clientNames?.[i] ?? null;
            const existingOverride = overrides.find((o) => o.clientId === clientId) ?? null;
            return (
              <li
                key={`${code}-${i}`}
                className="flex items-center justify-between text-sm px-3 py-2 border border-border rounded"
              >
                <span className="flex-1 flex items-center gap-2">
                  {name && (
                    <span className="font-medium text-text-primary">{name}</span>
                  )}
                  {name && <span className="text-text-muted">·</span>}
                  <span className={name ? 'text-text-secondary' : 'font-medium text-text-primary'}>{code}</span>
                  <span className="text-text-muted">·</span>
                  <span className="text-xs text-text-muted font-mono">{clientId ?? '?'}</span>
                  {existingOverride && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning-bg text-warning font-semibold uppercase tracking-wide">
                      override
                    </span>
                  )}
                  {/* F25: the effective occurrences for THIS client and where
                      the number comes from. Invisible until now, which made a
                      correct schedule-level value look broken: on #1173 HARBT
                      the booking page offered four dates while the schedule
                      said five, because the client held a seeded override of
                      four and the function resolves the client first. */}
                  {(() => {
                    const ovN = existingOverride?.schedule?.occurrencesAhead ?? null;
                    const schedN = data.occurrencesAhead;
                    if (ovN != null) {
                      return (
                        <span
                          className="text-xs text-warning"
                          title="This client's own number. It wins over the schedule's."
                          data-testid={`client-occurrences-${clientId}`}
                        >
                          · occurrences: override {ovN}
                        </span>
                      );
                    }
                    return (
                      <span
                        className="text-xs text-text-muted"
                        title="This client follows the schedule's number."
                        data-testid={`client-occurrences-${clientId}`}
                      >
                        · occurrences: schedule{' '}
                        {schedN ?? (data.dayWindows.length || 1)}
                        {schedN == null && ' (one week)'}
                      </span>
                    );
                  })()}
                </span>
                {sinceLabel && (
                  <span className="text-xs text-text-muted mr-3">since {sinceLabel}</span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (clientId == null) return;
                    handleOpenOverride(
                      clientId,
                      code,
                      name ?? code,
                      existingOverride,
                    );
                  }}
                  disabled={clientId == null}
                  className="text-xs text-brand-cyan hover:underline mr-3 disabled:opacity-40"
                  title={existingOverride ? 'Edit this client\'s override' : 'Configure an override for this client'}
                  data-testid={`configure-override-${clientId}`}
                >
                  {existingOverride ? 'Edit override' : 'Configure override'}
                </button>
                {existingOverride && (
                  <button
                    type="button"
                    onClick={() => {
                      if (clientId) removeOverrideMut.mutate(clientId);
                    }}
                    disabled={removeOverrideMut.isPending}
                    className="text-xs text-warning hover:underline mr-3 disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Delete this client's override so it follows the schedule again. The client stays attached."
                    data-testid={`remove-override-${clientId}`}
                  >
                    {removeOverrideMut.isPending ? 'Removing...' : 'Remove override'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (clientId) detachMut.mutate(clientId);
                  }}
                  disabled={detachMut.isPending}
                  className="text-xs text-error hover:text-error-dark hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Detach this client from the schedule."
                >
                  {detachMut.isPending ? 'Removing...' : 'Remove'}
                </button>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          onClick={() => onAttachClients(data.scheduleId)}
          className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded border border-border hover:bg-surface-light text-text-primary"
          title="Configure this schedule for one or more clients"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
            <path d="M18 4v6M15 7h6" />
          </svg>
          Configure for client
        </button>
      </section>
    </div>
  );
}

function formatSinceDate(iso: string): string {
  // Prefer YYYY-MM-DD from the ISO timestamp - matches Steve's mockup.
  // Fall back to the raw string if the parse fails so we don't crash.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface RouteTabProps {
  data: ScheduleGroup;
  legs: Leg[];
  onLegsChange: (legs: Leg[]) => void;
  lookups: {
    depots: { id: number; name: string }[];
    speeds: { id: number; name: string }[];
    postcodeGroups: { id: number; name: string; depotId: number | null }[];
    storageStates: { id: number; label: string }[];
    deliveryStates: { id: number; label: string }[];
    pickupBoxDiscounts: { id: number; label: string }[];
    dropOffLocations: { id: number; name: string; depotId: number }[];
    linehaulRuns: { id: number; runName: string; fromDepotId: number | null; toDepotId: number | null }[];
    zoneNumbers: number[];
  };
  advanced: {
    parentSpeedId: number | null;
    onParentSpeedIdChange: (v: number | null) => void;
    deliveryState: number | null;
    onDeliveryStateChange: (v: number | null) => void;
    pickupBoxDiscount: number | null;
    onPickupBoxDiscountChange: (v: number | null) => void;
    dropOffLocationId: number | null;
    onDropOffLocationIdChange: (v: number | null) => void;
    pickupPostcodeGroupId: number | null;
    onPickupPostcodeGroupIdChange: (v: number | null) => void;
    /** Read-only mirror of the derived BookPickup, shown so the Advanced
     *  tab still tells the truth about what will be saved. */
    bookPickupDerived: boolean;
    applyPickupCutoff: boolean;
    onApplyPickupCutoffChange: (v: boolean) => void;
    pickupCutoff: number | null;
    onPickupCutoffChange: (v: number | null) => void;
    pickupDepotId: number | null;
  };
  /** Structural read-only. In override mode the ChainBuilder locks the
   *  whole route + Advanced block is disabled, and the "Override values"
   *  panel renders below for the collection + delivery leg-scope deltas. */
  readOnly?: boolean;
  overrideMode?: {
    ovCollSpeedId: number | null;
    setOvCollSpeedId: (v: number | null) => void;
    ovCollZoneGroupId: number | null;
    setOvCollZoneGroupId: (v: number | null) => void;
    ovCollPickupTimeMode: string;
    setOvCollPickupTimeMode: (v: string) => void;
    ovCollPickupWindowStart: string;
    setOvCollPickupWindowStart: (v: string) => void;
    ovCollPickupWindowEnd: string;
    setOvCollPickupWindowEnd: (v: string) => void;
    ovDelSpeedId: number | null;
    setOvDelSpeedId: (v: number | null) => void;
    ovDelZoneGroupId: number | null;
    setOvDelZoneGroupId: (v: number | null) => void;
  } | null;
}

function RouteTab({ data, legs, onLegsChange, lookups, advanced, readOnly = false, overrideMode = null }: RouteTabProps) {
  const [advOpen, setAdvOpen] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Route</h3>
        <span className="text-xs text-text-muted italic">
          {readOnly
            ? 'Structure is locked - edit the override values below'
            : 'Dane\'s vertical leg builder - edit inline; Save persists via /api/schedules'}
        </span>
      </div>
      {/* Reads the LIVE chain, not data.originType: the warning should appear
          the moment the operator switches the Depot leg to Client address,
          not only after a save. */}
      <ClientGeocodeWarning
        clients={data?.clientsMissingGeocode ?? []}
        isClientOrigin={
          (legs.find((l) => l.type === 'depot') as DepotLeg | undefined)?.clientAddress === true
        }
      />
      <div className={readOnly ? 'pointer-events-none opacity-60' : undefined}>
        <ChainBuilder
          legs={legs}
          onChange={onLegsChange}
          lookups={lookups}
          readOnly={readOnly}
          pickupBoxDiscount={advanced.pickupBoxDiscount}
          onPickupBoxDiscountChange={advanced.onPickupBoxDiscountChange}
          dropOffLocationId={advanced.dropOffLocationId}
          onDropOffLocationIdChange={advanced.onDropOffLocationIdChange}
        />
      </div>

      {overrideMode && (
        <section className="pt-4 border-t border-border space-y-3" data-testid="override-route-deltas">
          <div className="flex items-center gap-2">
            <h4 className="text-xs uppercase tracking-wide text-text-muted font-semibold">
              Override values
            </h4>
            <span className="text-[11px] text-text-muted italic">
              only these leg-scope fields are per-client overridable
            </span>
          </div>

          {/* Collection scope. Five columns: Speed, Zone group,
              Pickup time mode, Pickup window start, Pickup window end. */}
          <div className="border border-border rounded p-3 bg-surface-light">
            <div className="text-[10px] uppercase tracking-wide text-text-muted font-semibold mb-2">
              Collection
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs">
                Speed
                <select
                  value={overrideMode.ovCollSpeedId ?? ''}
                  onChange={(e) => overrideMode.setOvCollSpeedId(e.target.value ? Number(e.target.value) : null)}
                  className="mt-1 w-full px-2 py-1 border border-border rounded"
                  data-testid="override-collection-speed"
                >
                  <option value="">- inherit -</option>
                  {lookups.speeds.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                </select>
              </label>
              <label className="block text-xs">
                Zone group
                <select
                  value={overrideMode.ovCollZoneGroupId ?? ''}
                  onChange={(e) => overrideMode.setOvCollZoneGroupId(e.target.value ? Number(e.target.value) : null)}
                  className="mt-1 w-full px-2 py-1 border border-border rounded"
                  data-testid="override-collection-zone-group"
                >
                  <option value="">- inherit -</option>
                  {lookups.postcodeGroups.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
                </select>
              </label>
              <label className="block text-xs">
                Pickup time mode
                <select
                  value={overrideMode.ovCollPickupTimeMode}
                  onChange={(e) => overrideMode.setOvCollPickupTimeMode(e.target.value)}
                  className="mt-1 w-full px-2 py-1 border border-border rounded"
                  data-testid="override-collection-pickup-time-mode"
                >
                  <option value="">- inherit -</option>
                  <option value="window">Window</option>
                  <option value="fixed">Fixed</option>
                  <option value="on_demand">On demand</option>
                </select>
              </label>
              <div />
              <label className="block text-xs">
                Pickup window start
                <input
                  type="time"
                  value={overrideMode.ovCollPickupWindowStart}
                  onChange={(e) => overrideMode.setOvCollPickupWindowStart(e.target.value)}
                  className="mt-1 w-full px-2 py-1 border border-border rounded"
                  data-testid="override-collection-pickup-window-start"
                />
              </label>
              <label className="block text-xs">
                Pickup window end
                <input
                  type="time"
                  value={overrideMode.ovCollPickupWindowEnd}
                  onChange={(e) => overrideMode.setOvCollPickupWindowEnd(e.target.value)}
                  className="mt-1 w-full px-2 py-1 border border-border rounded"
                  data-testid="override-collection-pickup-window-end"
                />
              </label>
            </div>
          </div>

          {/* Delivery scope. Two columns: Speed, Zone group. */}
          <div className="border border-border rounded p-3 bg-surface-light">
            <div className="text-[10px] uppercase tracking-wide text-text-muted font-semibold mb-2">
              Delivery
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs">
                Speed
                <select
                  value={overrideMode.ovDelSpeedId ?? ''}
                  onChange={(e) => overrideMode.setOvDelSpeedId(e.target.value ? Number(e.target.value) : null)}
                  className="mt-1 w-full px-2 py-1 border border-border rounded"
                  data-testid="override-delivery-speed"
                >
                  <option value="">- inherit -</option>
                  {lookups.speeds.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                </select>
              </label>
              <label className="block text-xs">
                Zone group
                <select
                  value={overrideMode.ovDelZoneGroupId ?? ''}
                  onChange={(e) => overrideMode.setOvDelZoneGroupId(e.target.value ? Number(e.target.value) : null)}
                  className="mt-1 w-full px-2 py-1 border border-border rounded"
                  data-testid="override-delivery-zone-group"
                >
                  <option value="">- inherit -</option>
                  {lookups.postcodeGroups.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
                </select>
              </label>
            </div>
          </div>
        </section>
      )}


      <section className={`pt-4 border-t border-border ${readOnly ? 'pointer-events-none opacity-60' : ''}`}>
        <button
          type="button"
          onClick={() => setAdvOpen((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 rounded border border-border hover:bg-surface-light text-xs uppercase tracking-wide text-text-muted"
        >
          <span>Advanced (schedule speed, cutoffs, delivery state, drop-off, collection group)</span>
          <span>{advOpen ? '−' : '+'}</span>
        </button>
        {advOpen && (
          <div className="mt-3 grid grid-cols-2 gap-3 border border-border rounded p-3 bg-surface-light">
            <label className="block text-xs">
              Schedule speed (parent)
              <select
                value={advanced.parentSpeedId ?? ''}
                onChange={(e) => advanced.onParentSpeedIdChange(e.target.value ? Number(e.target.value) : null)}
                className="mt-1 w-full px-2 py-1 border border-border rounded"
              >
                <option value="">- inherit -</option>
                {lookups.speeds.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
              </select>
            </label>
            <label className="block text-xs">
              Delivery state
              <select
                value={advanced.deliveryState ?? ''}
                onChange={(e) => advanced.onDeliveryStateChange(e.target.value ? Number(e.target.value) : null)}
                className="mt-1 w-full px-2 py-1 border border-border rounded"
              >
                <option value="">- default -</option>
                {lookups.deliveryStates.map((s) => (<option key={s.id} value={s.id}>{s.label}</option>))}
              </select>
            </label>
            {/* F22. The select moved to the Collection card, where whoever
                sets up a collection actually looks. A trace stays here
                because this panel is where people have been finding it,
                and a field that silently vanishes reads as a regression. */}
            <div className="block text-xs" data-testid="advanced-drop-off-moved">
              Drop-off location (schedule)
              <p className="mt-1 text-text-muted">
                Set on the Collection card.
                {advanced.dropOffLocationId != null && (
                  <>
                    {' '}Currently{' '}
                    <span className="text-text-primary">
                      {lookups.dropOffLocations.find((d) => d.id === advanced.dropOffLocationId)?.name
                        ?? `#${advanced.dropOffLocationId}`}
                    </span>.
                  </>
                )}
              </p>
            </div>
            <label className="block text-xs">
              Collection zone group
              <select
                value={advanced.pickupPostcodeGroupId ?? ''}
                onChange={(e) => advanced.onPickupPostcodeGroupIdChange(e.target.value ? Number(e.target.value) : null)}
                className="mt-1 w-full px-2 py-1 border border-border rounded"
              >
                <option value="">- default pickup group -</option>
                {lookups.postcodeGroups
                  .filter((g) => !advanced.pickupDepotId || g.depotId === advanced.pickupDepotId)
                  .map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
              </select>
            </label>
            <label className="col-span-2 flex items-center gap-2 text-xs opacity-60">
              <input type="checkbox" checked={advanced.bookPickupDerived} disabled className="accent-brand-cyan" />
              Book collection job (derived: set by adding a Collection leg to the route)
            </label>
            <label className="col-span-2 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={advanced.applyPickupCutoff}
                onChange={(e) => advanced.onApplyPickupCutoffChange(e.target.checked)}
                className="accent-brand-cyan"
              />
              Apply pickup cutoff (courier must arrive by N hours before delivery)
            </label>
            {advanced.applyPickupCutoff && (
              <label className="block text-xs">
                Pickup cutoff (hours)
                <input
                  type="number"
                  min={0}
                  value={advanced.pickupCutoff ?? ''}
                  onChange={(e) => advanced.onPickupCutoffChange(e.target.value === '' ? null : Number(e.target.value))}
                  className="mt-1 w-full px-2 py-1 border border-border rounded"
                />
              </label>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

interface CoverageTabProps {
  postcodeIds: number[];
  /** Full-list handler for postcodeIds. Replaces the old
   *  input/add/remove trio since PostcodeLookupInput owns its own
   *  text state internally. */
  onPostcodeIdsChange: (next: number[]) => void;
  polygonIds: number[];
  onTogglePolygon: (id: number) => void;
  polygons: BulkPolygon[];
  polygonsError: string | null;
  polygonsLoading: boolean;
  /** Depot id used by the /territory/postcodesForSchedule resolver for
   *  the zone-derived postcode overlay. MUST be a depot id (not a
   *  region id) - passing a region here on US tenants silently returns
   *  the wrong zip set. */
  destinationDepotId: number | null;
  /** Zone numbers active on the schedule. Postcodes in these zones
   *  render as blue-outlined ZIP polygons on the map. */
  activeZones: number[];
  isUsTenant: boolean;
  googleMapsKey: string | null;
  /** Passed through as React `key` to the inner map so navigating from
   *  schedule A to B (via override-open) forces a fresh map instance
   *  and the auto-fit runs against the new schedule's polygons. */
  scheduleKey: number;
}

function CoverageTab({
  postcodeIds, onPostcodeIdsChange,
  polygonIds, onTogglePolygon, polygons, polygonsError, polygonsLoading,
  destinationDepotId, activeZones, isUsTenant, googleMapsKey, scheduleKey,
}: CoverageTabProps) {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-xs uppercase tracking-wider font-semibold text-text-muted mb-2">
          Postcodes
        </h3>
        {/* Ticket 296 / pricing spec 6.3, M2. This copy said the postcodes
            "render on the map", which was true and was the whole problem: for
            a speed that is not zone-rated the availability function never
            consulted the zones at all, so the Coverage tab was a picture
            rather than a gate and Hyper's two-hour service could be booked to
            Silverdale, Pukekohe and Piha. It is a gate for every speed now,
            so the tab has to say so. */}
        <p className="text-xs text-text-muted mb-3">
          Individual postcodes bound to this schedule (on top of the postcode group
          dropdown above). Resolver union: schedule covers a postcode if it's in the
          bound group OR in this list.
        </p>
        <p className="text-xs text-text-muted mb-3">
          <strong>Active zones and bound postcodes limit where this schedule can be
          booked, for every speed</strong>, not only zone-rated ones. A schedule with
          no active zones and no bound postcodes stays open to its whole depot area.
        </p>
        <PostcodeLookupInput
          selected={postcodeIds}
          onChange={onPostcodeIdsChange}
          enabled={true}
        />
      </section>

      <section className="pt-4 border-t border-border">
        <h3 className="text-sm font-semibold text-text-primary mb-2">
          Coverage polygons
        </h3>
        <p className="text-xs text-text-muted mb-2">
          Bind coverage polygons to this schedule. Click on the map to bind or unbind,
          or use the checkbox list on the right. Draw a new polygon inline, or open the
          full toolkit in{' '}
          <a
            href="/polygon-builder"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-cyan underline"
          >
            Polygon Builder
          </a>
          .
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-3">
          <div>
            {polygonsLoading && (
              <div className="p-3 text-xs text-text-muted italic border border-border rounded-lg">
                Loading polygons...
              </div>
            )}
            {polygonsError && !polygonsLoading && (
              <div className="p-3 text-xs text-error border border-error/30 rounded-lg">
                Failed to load polygons: {polygonsError}
              </div>
            )}
            {!polygonsLoading && !polygonsError && (
              <ScheduleCoverageMap
                key={scheduleKey}
                polygons={polygons}
                selectedIds={polygonIds}
                onToggle={onTogglePolygon}
                boundPostcodes={postcodeIds}
                activeZones={activeZones}
                destinationDepotId={destinationDepotId}
                isUsTenant={isUsTenant}
                googleMapsKey={googleMapsKey}
              />
            )}
          </div>
          <div className="max-h-[360px] overflow-y-auto rounded-lg border border-border">
            {polygons?.length === 0 && (
              <div className="p-3 text-xs text-text-muted italic">
                No polygons defined yet. Draw one in Polygon Builder.
              </div>
            )}
            {polygons?.map((p) => {
              const checked = polygonIds.includes(p.polygonId);
              return (
                <label
                  key={p.polygonId}
                  className={`flex items-center gap-2 px-2 py-1 border-b border-border-light last:border-b-0 cursor-pointer hover:bg-surface-light ${
                    checked ? 'bg-brand-cyan/10' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onTogglePolygon(p.polygonId)}
                    className="accent-brand-cyan"
                  />
                  <span className="text-xs font-medium flex-1">{p.name}</span>
                  <span className="text-[10px] text-text-muted">
                    {p.attachedRouteCount} route{p.attachedRouteCount === 1 ? '' : 's'}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

interface DaysTabProps {
  days: DayForm[];
  onChange: (days: DayForm[]) => void;
  scheduleId: number;
  /** Structural read-only. Locks per-day window + cutoff inputs; the
   *  day-toggle checkbox stays interactive because the day set itself
   *  is a per-client overridable value. */
  readOnly?: boolean;
  /** Override-mode payload: day toggles write to ovWeekDays instead of
   *  formDays; an override cutoff pair panel renders below the grid. */
  overrideMode?: {
    ovWeekDays: number[];
    setOvWeekDays: (v: number[]) => void;
    ovCutoffDay: number | null;
    setOvCutoffDay: (v: number | null) => void;
    ovCutoffTime: string;
    setOvCutoffTime: (v: string) => void;
  } | null;
}

function DaysTab({ days, onChange, scheduleId, readOnly = false, overrideMode = null }: DaysTabProps) {
  // F11 Phase C: when the operator enables a day, seed cutoffDay to the
  // day's own dayOfWeek so the default is a same-day cutoff. Leaves an
  // existing pick untouched.
  //
  // Override mode branch: the day-toggle click updates the shared
  // ovWeekDays set instead of the per-day formDays.enabled bits. The
  // per-day cutoff pickers stay disabled; the operator edits ONE shared
  // cutoff pair below the grid.
  const toggle = (i: number) => {
    if (overrideMode) {
      const dayN = i + 1;
      const already = overrideMode.ovWeekDays.includes(dayN);
      const next = already
        ? overrideMode.ovWeekDays.filter((n) => n !== dayN)
        : [...overrideMode.ovWeekDays, dayN].sort((a, b) => a - b);
      overrideMode.setOvWeekDays(next);
      return;
    }
    onChange(days.map((d, idx) =>
      idx === i
        ? {
            ...d,
            enabled: !d.enabled,
            cutoffDay: !d.enabled && d.cutoffDay == null ? i + 1 : d.cutoffDay,
          }
        : d));
  };
  const patch = (i: number, p: Partial<DayForm>) =>
    onChange(days.map((d, idx) => (idx === i ? { ...d, ...p } : d)));

  const isDayEnabled = (i: number): boolean => {
    if (overrideMode) return overrideMode.ovWeekDays.includes(i + 1);
    return days[i]?.enabled === true;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Operating days</h3>
        <span className="text-xs text-text-muted italic">
          {overrideMode
            ? 'toggle days to override which days this client can book; window + per-day cut-off are locked'
            : 'cut-off is the exact day + time bookings close for this day\'s collection'}
        </span>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {[1, 2, 3, 4, 5, 6, 7].map((n) => {
          const i = n - 1;
          const d = days[i];
          const dayEnabled = isDayEnabled(i);
          // In override mode the per-day window + cutoff inputs render
          // ONLY on days that are ENABLED IN THE BASE (d.enabled) so the
          // operator sees the base context; they're always disabled. A
          // day the base doesn't run stays as a plain checkbox row.
          const showBaseDetails = overrideMode ? d.enabled : dayEnabled;
          return (
            <div
              key={n}
              className={`border rounded p-2 text-center ${
                dayEnabled ? 'border-brand-cyan bg-brand-cyan/5' : 'border-border bg-surface-light'
              }`}
            >
              <label className="flex items-center gap-1 text-xs font-medium justify-center">
                <input
                  type="checkbox"
                  checked={dayEnabled}
                  onChange={() => toggle(i)}
                  className="accent-brand-cyan"
                  data-testid={`days-tab-toggle-${n}`}
                />
                {DAY_NAMES[n]}
              </label>
              {showBaseDetails && (
                <div className="mt-1 space-y-1">
                  <span className="block text-[10px] uppercase tracking-wide text-text-muted mt-1">Window</span>
                  <input
                    type="time"
                    value={d.startTime}
                    onChange={(e) => patch(i, { startTime: e.target.value })}
                    disabled={readOnly}
                    className={`w-full text-xs border border-border rounded px-1 ${readOnly ? 'bg-surface-light cursor-not-allowed' : ''}`}
                  />
                  <input
                    type="time"
                    value={d.endTime}
                    onChange={(e) => patch(i, { endTime: e.target.value })}
                    disabled={readOnly}
                    className={`w-full text-xs border border-border rounded px-1 ${readOnly ? 'bg-surface-light cursor-not-allowed' : ''}`}
                  />
                  {/* F11 Phase C (2026-09-24): absolute cutoff pair.
                      Labelled + matched to the Window inputs' shape so
                      operators know they're editing the cut-off day+time,
                      not a second window pair. In override mode these are
                      locked - one shared override pair renders below the
                      grid. */}
                  <span className="block text-[10px] uppercase tracking-wide text-text-muted mt-1">Cut-off</span>
                  <select
                    value={d.cutoffDay ?? ''}
                    onChange={(e) => patch(i, {
                      cutoffDay: e.target.value === '' ? null : Number(e.target.value),
                    })}
                    disabled={readOnly}
                    className={`w-full text-xs border border-border rounded px-1 ${readOnly ? 'bg-surface-light cursor-not-allowed' : ''}`}
                    title="Cut-off day"
                  >
                    <option value="">- day -</option>
                    {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                      <option key={n} value={n}>{DAY_NAMES[n]}</option>
                    ))}
                  </select>
                  <input
                    type="time"
                    value={d.cutoffTime ?? ''}
                    onChange={(e) => patch(i, {
                      cutoffTime: e.target.value === '' ? null : e.target.value,
                    })}
                    disabled={readOnly}
                    className={`w-full text-xs border border-border rounded px-1 ${readOnly ? 'bg-surface-light cursor-not-allowed' : ''}`}
                    title="Cut-off time"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {overrideMode && (
        <section className="pt-4 border-t border-border" data-testid="override-cutoff-panel">
          <div className="flex items-center gap-2 mb-2">
            <h4 className="text-xs uppercase tracking-wide text-text-muted font-semibold">
              Override cut-off
            </h4>
            <span className="text-[11px] text-text-muted italic">
              one shared pair applies to every enabled day for this client
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 border border-border rounded p-3 bg-surface-light">
            <label className="block text-xs">
              Cut-off day
              <select
                value={overrideMode.ovCutoffDay ?? ''}
                onChange={(e) => overrideMode.setOvCutoffDay(e.target.value === '' ? null : Number(e.target.value))}
                className="mt-1 w-full px-2 py-1 border border-border rounded"
                data-testid="override-cutoff-day"
              >
                <option value="">- inherit -</option>
                {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <option key={n} value={n}>{DAY_NAMES[n]}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs">
              Cut-off time
              <input
                type="time"
                value={overrideMode.ovCutoffTime}
                onChange={(e) => overrideMode.setOvCutoffTime(e.target.value)}
                className="mt-1 w-full px-2 py-1 border border-border rounded"
                data-testid="override-cutoff-time"
              />
            </label>
          </div>
        </section>
      )}
      <p className="text-xs text-text-muted italic">
        Each enabled day is one tblBulkRunSchedule row carrying ScheduleId #{scheduleId}.
      </p>
    </div>
  );
}

// Weekly pill labels in ISO order Mon..Sun. Route roster uses
// dayOfWeek 0-6 (Sun=0, Mon=1, ..., Sat=6); linehaul roster uses 1-7
// (Mon=1, ..., Sun=7). Both surfaces normalize into a 7-slot Mon-Sun
// array via the helpers below so the strip renders consistently.
const WEEK_PILLS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

function buildRouteWeek(entries: RouteRosterEntry[] | undefined): (RouteRosterEntry | null)[] {
  const week: (RouteRosterEntry | null)[] = [null, null, null, null, null, null, null];
  if (!entries) return week;
  for (const e of entries) {
    if (e.rosterDate != null) continue; // date overrides don't belong on the weekly strip
    if (e.dayOfWeek == null || !e.isActive) continue;
    // Route roster: dayOfWeek 0=Sun, 1=Mon, ..., 6=Sat. Convert to
    // Mon=0..Sun=6 by (n + 6) % 7.
    const idx = (e.dayOfWeek + 6) % 7;
    week[idx] = e;
  }
  return week;
}

function buildLinehaulWeek(row: LinehaulRosterRow | undefined): (LinehaulRosterRow['cells'][number] | null)[] {
  const week: (LinehaulRosterRow['cells'][number] | null)[] = [null, null, null, null, null, null, null];
  if (!row) return week;
  for (const c of row.cells) {
    if (c.dayOfWeek < 1 || c.dayOfWeek > 7) continue;
    // Linehaul roster: dayOfWeek 1=Mon..7=Sun. Convert to Mon=0..Sun=6.
    week[c.dayOfWeek - 1] = c;
  }
  return week;
}

function WeeklyStrip({
  cells,
  colour,
  defaultText,
}: {
  cells: (string | null)[];
  colour: 'blue' | 'orange';
  defaultText: string;
}) {
  const activeBg = colour === 'blue'
    ? 'bg-blue-50 border-blue-300 text-blue-800'
    : 'bg-orange-50 border-orange-300 text-orange-800';
  return (
    <div className="mt-3 grid grid-cols-7 gap-1 text-[10px]">
      {WEEK_PILLS.map((label, i) => {
        const name = cells[i];
        return (
          <div
            key={i}
            className={`border rounded px-1 py-1 text-center ${
              name ? activeBg : 'bg-surface-light border-border text-text-muted'
            }`}
            title={name ?? defaultText}
          >
            <div className="uppercase tracking-wide text-[9px] opacity-70">{label}</div>
            <div className="mt-0.5 truncate font-medium">
              {name ?? '-'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Steve's Roster tab redesign (screenshot 2026-09-16). Two sections:
 *  Recurring Routes bound to this schedule, each with a per-day
 *  courier assignment strip fetched from the route roster endpoint;
 *  and Linehaul Legs on the schedule, each augmented with details
 *  from /recurring-linehaul-runs + a per-day carrier strip from
 *  /recurring-linehaul-rosters. */
function RosterTab({ data }: { data: ScheduleGroup }) {
  // ─── Recurring routes bound to this schedule ────────────────────────
  const routesQuery = useQuery({
    queryKey: ['schedules-v2-recurring-routes-for-schedule', data.scheduleId],
    queryFn: () => recurringRouteService.list().then((r) => r.response),
    staleTime: 30_000,
  });
  const boundRoutes = useMemo<RecurringRoute[]>(
    () => (routesQuery.data ?? []).filter((r) =>
      r.schedules.some((s) => s.scheduleId === data.scheduleId),
    ),
    [routesQuery.data, data.scheduleId],
  );
  // Parallel-fetch each bound route's roster so the weekly courier
  // strip on every card is populated.
  const routeRosterQueries = useQueries({
    queries: boundRoutes.map((r) => ({
      queryKey: ['route-roster', r.routeId],
      queryFn: () => recurringRouteService.getRoster(r.routeId).then((res) => res.response),
      staleTime: 60_000,
    })),
  });

  // ─── Linehaul runs + roster grid ────────────────────────────────────
  const linehaulRunsQuery = useQuery({
    queryKey: ['linehauls-list'],
    queryFn: () => linehaulService.list(),
    staleTime: 60_000,
    enabled: data.linehauls.length > 0,
  });
  const linehaulRosterQuery = useQuery({
    queryKey: ['linehauls-roster-grid'],
    queryFn: () => linehaulService.rosterGrid(),
    staleTime: 60_000,
    enabled: data.linehauls.length > 0,
  });
  const runsById = useMemo(() => {
    const map = new Map<number, TenantLinehaulRun>();
    for (const run of linehaulRunsQuery.data ?? []) map.set(run.id, run);
    return map;
  }, [linehaulRunsQuery.data]);
  const rosterByRunId = useMemo(() => {
    const map = new Map<number, LinehaulRosterRow>();
    for (const row of linehaulRosterQuery.data?.rows ?? []) map.set(row.runId, row);
    return map;
  }, [linehaulRosterQuery.data]);

  return (
    <div className="space-y-6">
      <div className="rounded border border-brand-cyan/30 bg-brand-cyan/5 px-3 py-2 text-xs text-text-secondary">
        <span className="font-semibold text-text-primary">Roster.</span>{' '}
        The schedule owns the time window, days and cut-off. Recurring routes own the
        pickup / delivery geography and who runs it; a middle-mile run owns the trunk
        leg and its <span className="font-medium">master job</span>, the one booking
        a linehaul driver picks up so every item on the run is marked picked up
        together. All of it is read from the Recurring Routes tables and edited there.
      </div>

      {/* ─── Section 1: Recurring routes bound to this schedule ─── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Recurring routes bound to this schedule
          </h3>
          {routesQuery.data && (
            <span className="text-xs text-text-muted">
              {boundRoutes.length} route{boundRoutes.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {routesQuery.isLoading && (
          <div className="text-xs text-text-muted italic">Loading routes...</div>
        )}
        {routesQuery.isError && (
          <div className="text-xs text-error italic">
            Failed to load routes: {(routesQuery.error as Error).message}
          </div>
        )}
        {!routesQuery.isLoading && boundRoutes.length === 0 && (
          <div className="border border-border rounded p-4 text-center text-xs text-text-muted">
            No recurring routes bound to this schedule.
          </div>
        )}

        <div className="space-y-2">
          {boundRoutes.map((r, idx) => {
            const rosterEntries = routeRosterQueries[idx]?.data;
            const week = buildRouteWeek(rosterEntries).map(
              (e) => e ? e.targetName : null,
            );
            const zipCount = r.zipcodes.length;
            const sharedCount = r.schedules.length;
            return (
              <div key={r.routeId} className="border border-border rounded p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-text-primary">
                        {r.name}
                      </span>
                      {r.area && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface-light border border-border text-text-secondary">
                          {r.area}
                        </span>
                      )}
                      {!r.active && (
                        <span className="text-[10px] text-warning uppercase">inactive</span>
                      )}
                    </div>
                    {sharedCount > 1 && (
                      <div className="mt-1">
                        <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-brand-cyan/15 text-brand-cyan font-medium">
                          shared by {sharedCount} schedules
                        </span>
                      </div>
                    )}
                  </div>
                  <a
                    href={`/recurring-routes?edit=${r.routeId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-brand-cyan hover:underline flex items-center gap-1 shrink-0"
                    title="Open the Route Roster in a new tab"
                  >
                    Roster
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                </div>

                <div className="mt-2 text-xs text-text-muted flex items-center gap-3 flex-wrap">
                  <span>
                    <span className="text-text-primary font-medium">{zipCount}</span> zips
                  </span>
                  <span>
                    <span className="text-text-primary font-medium">{r.mappedStopsCount}</span> mapped stops
                  </span>
                  <span>
                    Default:{' '}
                    <span className="text-text-primary">{r.defaultTargetName || 'unassigned'}</span>
                  </span>
                  {r.defaultTargetType != null && (
                    <TargetTypeChip type={r.defaultTargetType} />
                  )}
                </div>

                <WeeklyStrip
                  cells={week}
                  colour="blue"
                  defaultText={`Use default (${r.defaultTargetName || 'unassigned'})`}
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── Section 2: Linehaul legs ─── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Linehaul legs
          </h3>
          <span className="text-xs text-text-muted">
            {data.linehauls.length} run{data.linehauls.length === 1 ? '' : 's'}
          </span>
        </div>

        {data.linehauls.length === 0 && (
          <div className="border border-border rounded p-4 text-center text-xs text-text-muted">
            No linehaul legs bound to this schedule.
          </div>
        )}

        <div className="space-y-2">
          {data.linehauls.map((lh) => {
            const run = lh.linehaulRunId != null ? runsById.get(lh.linehaulRunId) : undefined;
            const rosterRow = lh.linehaulRunId != null ? rosterByRunId.get(lh.linehaulRunId) : undefined;
            const week = buildLinehaulWeek(rosterRow).map(
              (c) => c ? (c.targetName ?? c.courierName) : null,
            );
            const isFlight = run?.mode === LinehaulMode.Flight;
            const legName = lh.name ?? run?.runName ?? `Linehaul run ${lh.linehaulRunId ?? '?'}`;
            return (
              <div
                key={lh.id}
                className={`border rounded p-3 ${
                  lh.active === false ? 'border-border bg-surface-light' : 'border-border'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-text-primary">
                        {legName}
                      </span>
                      {lh.linehaulRunId != null && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-50 border border-purple-200 text-purple-800">
                          Middle mile · run {lh.linehaulRunId}
                        </span>
                      )}
                      {isFlight && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-800">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
                          </svg>
                          Flight
                        </span>
                      )}
                      {lh.active === false && (
                        <span className="text-[10px] text-warning uppercase">inactive</span>
                      )}
                    </div>
                    {run && (
                      <div className="mt-1 text-xs text-text-secondary">
                        {run.fromDepotName} → {run.toDepotName}
                      </div>
                    )}
                  </div>
                  <a
                    href={`/recurring-routes?linehaul=${lh.linehaulRunId ?? ''}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-brand-cyan hover:underline flex items-center gap-1 shrink-0"
                    title="Open the Linehaul Roster in a new tab"
                  >
                    Roster
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                </div>

                <div className="mt-2 text-xs text-text-muted flex items-center gap-3 flex-wrap">
                  {run?.despatchTime && (
                    <span>Despatch {run.despatchTime}</span>
                  )}
                  {run?.startTime && (
                    <span>· depart {run.startTime}</span>
                  )}
                  {(run?.despatchTime || run?.startTime) && (run?.defaultTargetName || lh.speedName != null || (run?.usedBySchedulesCount ?? 0) > 0) && (
                    <span className="text-text-muted/60">·</span>
                  )}
                  {run?.defaultTargetName && (
                    <>
                      <span>
                        Default:{' '}
                        <span className="text-text-primary">{run.defaultTargetName}</span>
                      </span>
                      {run.defaultTargetType != null && (
                        <TargetTypeChip type={run.defaultTargetType} />
                      )}
                    </>
                  )}
                  <span>
                    Speed:{' '}
                    <span className="text-text-primary">
                      {lh.speedName ?? 'Use schedule default'}
                    </span>
                  </span>
                  {run && run.usedBySchedulesCount > 0 && (
                    <span>
                      Used by <span className="text-text-primary font-medium">{run.usedBySchedulesCount}</span>{' '}
                      schedule{run.usedBySchedulesCount === 1 ? '' : 's'}
                    </span>
                  )}
                </div>

                {run?.masterBookingLabel ? (
                  <div className="mt-1 text-xs text-text-muted flex items-center gap-3 flex-wrap">
                    <span>
                      Master job{' '}
                      <span className="font-mono text-brand-cyan">{run.masterBookingLabel}</span>
                    </span>
                    {run.mappedStopsCount > 0 && (
                      <span>
                        · <span className="text-text-primary font-medium">{run.mappedStopsCount}</span> items linked
                      </span>
                    )}
                  </div>
                ) : (
                  run && (
                    <div
                      className="mt-1 text-xs text-error flex items-center gap-2"
                      title="Without a master job the driver sees every item as its own job."
                    >
                      <span className="w-2 h-2 rounded-full bg-error inline-block" />
                      <span className="font-medium">No master job set</span>
                    </div>
                  )
                )}

                <WeeklyStrip
                  cells={week}
                  colour="orange"
                  defaultText={`Use default (${run?.defaultTargetName ?? 'unassigned'})`}
                />
              </div>
            );
          })}
        </div>
      </section>

      <p className="text-xs text-text-muted italic max-w-3xl">
        Binding today is one schedule per route (Routes.ScheduleId). Routes shown as
        "shared by n schedules" illustrate the multi-binding proposal of 2026-08-03;
        the effective window is the tightest across the bound schedules.
      </p>
    </div>
  );
}

function TargetTypeChip({ type }: { type: number | string | null }) {
  // Two shapes cohabit: RecurringRoute + RouteRosterEntry carry a
  // numeric type (1 = Courier, 2 = Agent, 3 = NetworkPartner);
  // TenantLinehaulRun carries the string enum ('Courier' | 'Agent' |
  // 'NetworkPartner'). Normalize both to a single label so the chip
  // renders consistently regardless of source.
  const label = typeof type === 'number'
    ? (type === 1 ? 'Courier' : type === 2 ? 'Agent' : type === 3 ? 'NP' : null)
    : type === 'Courier' ? 'Courier'
    : type === 'Agent' ? 'Agent'
    : type === 'NetworkPartner' ? 'NP'
    : null;
  if (label == null) return null;
  const cls = label === 'Courier'
    ? 'bg-green-100 text-green-800'
    : label === 'Agent'
      ? 'bg-blue-100 text-blue-800'
      : 'bg-purple-100 text-purple-800';
  return (
    <span className={`text-[9px] px-1 py-0.5 rounded uppercase font-semibold ${cls}`}>
      {label}
    </span>
  );
}

// ─── Bits ────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'text-text-primary border-brand-cyan'
          : 'text-text-secondary border-transparent hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  );
}

/** Spec 6.1 rule 5. `onSelect` omitted keeps the old read-only rendering,
 *  which override mode still wants: an override cannot change who can book
 *  the base schedule. */
function RadioRow({
  checked,
  label,
  hint,
  onSelect,
  testId,
}: {
  checked: boolean;
  label: string;
  hint: string;
  onSelect?: () => void;
  testId?: string;
}) {
  const editable = onSelect != null;
  return (
    <label
      className={`block px-4 py-3 border rounded ${
        editable ? 'cursor-pointer hover:bg-surface-light' : 'cursor-not-allowed'
      } ${checked ? 'border-brand-cyan bg-brand-cyan/5' : 'border-border'}`}
    >
      <div className="flex items-center gap-2">
        <input
          type="radio"
          checked={checked}
          onChange={editable ? () => onSelect!() : undefined}
          readOnly={!editable}
          disabled={!editable}
          className="accent-brand-cyan"
          data-testid={testId}
        />
        <span className="text-sm font-medium text-text-primary">{label}</span>
      </div>
      <div className="text-xs text-text-muted ml-6 mt-0.5">{hint}</div>
    </label>
  );
}

const LEG_STYLE: Record<
  'collection' | 'depot' | 'linehaul' | 'delivery',
  { tag: string; bg: string; border: string }
> = {
  collection: { tag: 'COLLECTION', bg: 'bg-blue-50', border: 'border-blue-300' },
  depot:      { tag: 'DEPOT',      bg: 'bg-slate-100', border: 'border-slate-300' },
  linehaul:   { tag: 'LINEHAUL',   bg: 'bg-orange-50', border: 'border-orange-300' },
  delivery:   { tag: 'DELIVERY',   bg: 'bg-green-50', border: 'border-green-300' },
};

function LegCard({
  type,
  title,
  subtitle,
}: {
  type: 'collection' | 'depot' | 'linehaul' | 'delivery';
  title: string;
  subtitle: string;
}) {
  const s = LEG_STYLE[type];
  return (
    <div className={`border ${s.border} ${s.bg} rounded p-3 flex items-center gap-4`}>
      <span
        className={`text-[10px] font-semibold tracking-wide px-2 py-1 rounded text-text-primary ${s.bg} border ${s.border}`}
      >
        {s.tag}
      </span>
      <div className="flex-1">
        <div className="text-sm font-medium text-text-primary">{title}</div>
        <div className="text-xs text-text-muted">{subtitle}</div>
      </div>
    </div>
  );
}

function ProdRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="text-text-primary">{value}</dd>
    </>
  );
}

function temperatureLabel(v: number | null | undefined): string | null {
  if (v == null) return null;
  return v === 1 ? 'Frozen' : v === 2 ? 'Chilled' : v === 3 ? 'Ambient' : `#${v}`;
}

/**
 * Warns when a client-origin schedule is linked to clients whose site has no
 * coordinates (schedule-origin spec 4.5). Those runs would start at whatever
 * the booking happened to carry rather than the client's warehouse, and the
 * Bulk Import path refuses the batch outright.
 *
 * Warns, never blocks: the booking path still works from the per-booking
 * address, so this is a "your runs will start in the wrong place" caution,
 * not a validation error.
 *
 * This is the surface Steve asked for the geocode action to hang off. It is
 * two-step by design: the first click previews the candidate, a second
 * confirms the write, so nobody overwrites a client's coordinates on one
 * unseen lookup.
 */
function ClientGeocodeWarning({
  clients,
  isClientOrigin,
}: {
  clients: Array<{ clientId: number; clientName: string }>;
  isClientOrigin: boolean;
}) {
  const [preview, setPreview] = useState<Record<number, ClientGeocodeResult>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [done, setDone] = useState<Record<number, string>>({});
  const [error, setError] = useState<Record<number, string>>({});
  // Address override, shown only after a lookup fails. Many client records
  // hold a street line with no suburb or city ("Unit 6 - 50-56 Acheron
  // Drive"), which HERE cannot resolve; without this the operator hits a
  // dead end on the one screen that told them to fix it.
  const [override, setOverride] = useState<Record<number, string>>({});

  if (!isClientOrigin || clients.length === 0) return null;

  const run = async (clientId: number, confirm: boolean) => {
    setBusy(clientId);
    setError((e) => ({ ...e, [clientId]: '' }));
    try {
      const typed = override[clientId]?.trim();
      const res = await clientsService.geocodeSite(clientId, {
        confirm,
        address: typed ? typed : null,
      });
      if (res.written) {
        setDone((d) => ({ ...d, [clientId]: res.message }));
        setPreview((p) => {
          const next = { ...p };
          delete next[clientId];
          return next;
        });
      } else if (res.latitude == null) {
        setError((e) => ({ ...e, [clientId]: res.message }));
      } else {
        setPreview((p) => ({ ...p, [clientId]: res }));
      }
    } catch (err) {
      setError((e) => ({
        ...e,
        [clientId]: err instanceof Error ? err.message : 'Geocode failed.',
      }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mb-3 rounded-lg border border-warning/40 bg-warning-bg/40 px-3 py-2">
      <div className="text-xs font-semibold text-text-primary">
        {clients.length === 1 ? 'A linked client has' : `${clients.length} linked clients have`}
        {' '}no geocoded site address
      </div>
      <p className="text-[11px] text-text-muted mt-0.5">
        This schedule starts at the client&apos;s address, so runs will not start in the
        right place until the site is geocoded. Bookings still work; a routed Bulk
        Import on this schedule will be refused.
      </p>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {clients.map((c) => {
          const p = preview[c.clientId];
          return (
            <div key={c.clientId} className="text-[11px]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-text-primary">{c.clientName}</span>
                {done[c.clientId] ? (
                  <span className="text-success">{done[c.clientId]}</span>
                ) : (
                  <button
                    type="button"
                    disabled={busy === c.clientId}
                    onClick={() => void run(c.clientId, false)}
                    className="px-2 py-0.5 rounded border border-border text-text-muted hover:text-text-primary disabled:opacity-40"
                  >
                    {busy === c.clientId ? 'Looking up...' : p ? 'Look up again' : 'Geocode site address'}
                  </button>
                )}
              </div>
              {p && (
                <div className="mt-0.5 ml-1 flex items-center gap-2 flex-wrap">
                  <span className="text-text-muted">
                    {p.formattedAddress} ({p.latitude}, {p.longitude})
                  </span>
                  <button
                    type="button"
                    disabled={busy === c.clientId}
                    onClick={() => void run(c.clientId, true)}
                    className="px-2 py-0.5 rounded bg-brand-cyan text-white disabled:opacity-40"
                  >
                    Save these coordinates
                  </button>
                </div>
              )}
              {error[c.clientId] && (
                <div className="mt-0.5 ml-1">
                  <div className="text-error">{error[c.clientId]}</div>
                  {/* The stored address could not be resolved. Let the
                      operator supply a fuller one rather than sending them
                      to another app to fix the client record first. The
                      typed value is used for the lookup only; what gets
                      saved is still just the coordinates. */}
                  <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <input
                      type="text"
                      value={override[c.clientId] ?? ''}
                      onChange={(e) =>
                        setOverride((o) => ({ ...o, [c.clientId]: e.target.value }))}
                      placeholder="Try a fuller address, e.g. add the suburb and city"
                      className="px-1.5 py-0.5 border border-border rounded text-[11px] w-80"
                    />
                    <button
                      type="button"
                      disabled={busy === c.clientId || !(override[c.clientId] ?? '').trim()}
                      onClick={() => void run(c.clientId, false)}
                      className="px-2 py-0.5 rounded border border-border text-text-muted hover:text-text-primary disabled:opacity-40"
                    >
                      Try this address
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
