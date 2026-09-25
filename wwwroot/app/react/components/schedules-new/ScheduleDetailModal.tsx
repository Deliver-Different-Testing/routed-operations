import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../common/Modal';
import { schedulesV2Keys, useSchedulesV2Detail } from '../../hooks/queries/useSchedulesV2';
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
import { ChainBuilder, type Leg } from './ChainBuilder';
// Kevin 2026-09-25: `<ClientOverrideEditor>` popup is retired as an
// entry point (both nested-row click on the Schedules list and the
// Clients tab "Edit / Configure override" buttons now re-open this
// same modal in override-edit mode). The ClientOverrideEditor.tsx
// file is left on disk untouched; nothing imports or renders it.
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

// Edit modal for the Schedules NEW page (Steve's 2026-09-08 brief
// section 2). 4 tabs: Clients / Route / Operating days / Roster.
// Name + Description + Book-immediately + Route + Operating days are editable
// in place; Save PUTs a ScheduleGroupUpsertBody via
// scheduleService.upsert with the current scheduleId. Clients tab
// still uses the dedicated /api/v2 attach/detach endpoints so the
// audit trail on link rows carries "attach"/"detach" verbs; Roster
// tab is display-only (linehauls are edited on the Route tab as
// LINEHAUL legs; recurring routes are edited on the Recurring Routes
// page).

type ModalTab = 'clients' | 'route' | 'days' | 'coverage' | 'roster';

const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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
  let regionId = 0;
  let speedId: number | null = null;
  let postcodeGroupId: number | null = null;
  let storageState: number | null = null;
  const linehauls: LinehaulUpsertRow[] = [];
  const zones: number[] = [];
  for (const leg of legs) {
    if (leg.type === 'collection') {
      pickupDepotId = leg.pickupSource === 'depot' ? leg.pickupDepotId : null;
      pickupRatingSpeed = leg.speedId;
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
      });
    } else if (leg.type === 'delivery') {
      regionId = leg.regionId;
      speedId = leg.speedId;
      postcodeGroupId = leg.postcodeGroupId;
      for (const z of leg.zones) if (!zones.includes(z)) zones.push(z);
    }
  }
  zones.sort((a, b) => a - b);
  return { pickupDepotId, pickupRatingSpeed, regionId, speedId, postcodeGroupId, storageState, linehauls, zones };
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
  legs.push({
    type: 'collection',
    pickupSource: d.pickupDepotId ? 'depot' : 'client_address',
    pickupDepotId: d.pickupDepotId ?? null,
    speedId: d.pickupRatingSpeed ?? null,
  });
  if (d.pickupDepotName) {
    legs.push({ type: 'depot', depotId: d.pickupDepotId ?? null, storageState: d.storageState });
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
  // callback above). The ClientOverrideEditor.tsx file is left on disk
  // untouched; nothing renders it.

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formAutoBook, setFormAutoBook] = useState(true);
  // F21 (Steve 2026-09-20): header-level bookable flag. Separate from
  // AutoBook - IsActive gates whether the schedule can be booked at all;
  // AutoBook gates book-immediately vs stage. Default true so freshly
  // seeded schedules with no explicit value stay bookable.
  const [formIsActive, setFormIsActive] = useState(true);
  // F13 (Steve 2026-09-20): client-facing display copy. Empty string is
  // saved as NULL so the backend can distinguish "cleared" from "unset".
  const [formDisplayName, setFormDisplayName] = useState('');
  const [formDisplayDescription, setFormDisplayDescription] = useState('');
  const [formLegs, setFormLegs] = useState<Leg[]>([]);
  const [formDays, setFormDays] = useState<DayForm[]>(() => seedDaysFromDto([]));
  const [saveError, setSaveError] = useState<string | null>(null);
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
  const [formBookPickup, setFormBookPickup] = useState(false);
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
      displayName: formDisplayName, displayDescription: formDisplayDescription,
      legs: formLegs, days: formDays,
      pickupPostcodeGroupId: formPickupPostcodeGroupId,
      parentSpeedId: formParentSpeedId,
      deliveryState: formDeliveryState,
      pickupBoxDiscount: formPickupBoxDiscount,
      dropOffLocationId: formDropOffLocationId,
      applyPickupCutoff: formApplyPickupCutoff,
      pickupCutoff: formPickupCutoff,
      bookPickup: formBookPickup,
      postcodeIds: formPostcodeIds,
      polygonIds: formPolygonIds,
    }),
    [formName, formDescription, formAutoBook, formIsActive,
     formDisplayName, formDisplayDescription, formLegs, formDays,
     formPickupPostcodeGroupId, formParentSpeedId, formDeliveryState,
     formPickupBoxDiscount, formDropOffLocationId, formApplyPickupCutoff,
     formPickupCutoff, formBookPickup, formPostcodeIds, formPolygonIds],
  );
  const isDirty = initialSnapshot !== '' && currentSnapshot !== initialSnapshot;

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
    const seedBookPickup = data.bookPickup === true;
    const seedPostcodeIds = [...(data.postcodeIds ?? [])];
    const seedPolygonIds = [...(data.polygonIds ?? [])];
    setFormName(seedName);
    setFormDescription(seedDescription);
    setFormAutoBook(seedAutoBook);
    setFormIsActive(seedIsActive);
    setFormDisplayName(seedDisplayName);
    setFormDisplayDescription(seedDisplayDescription);
    setFormLegs(seedLegs);
    setFormDays(seedDays);
    setFormPickupPostcodeGroupId(seedPickupPostcodeGroupId);
    setFormParentSpeedId(seedParentSpeedId);
    setFormDeliveryState(seedDeliveryState);
    setFormPickupBoxDiscount(seedPickupBoxDiscount);
    setFormDropOffLocationId(seedDropOffLocationId);
    setFormApplyPickupCutoff(seedApplyPickupCutoff);
    setFormPickupCutoff(seedPickupCutoff);
    setFormBookPickup(seedBookPickup);
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
      displayName: seedDisplayName, displayDescription: seedDisplayDescription,
      legs: seedLegs, days: seedDays,
      pickupPostcodeGroupId: seedPickupPostcodeGroupId,
      parentSpeedId: seedParentSpeedId,
      deliveryState: seedDeliveryState,
      pickupBoxDiscount: seedPickupBoxDiscount,
      dropOffLocationId: seedDropOffLocationId,
      applyPickupCutoff: seedApplyPickupCutoff,
      pickupCutoff: seedPickupCutoff,
      bookPickup: seedBookPickup,
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
  const ovListQuery = useQuery({
    queryKey: schedulesV2Keys.overrides(tenantId, scheduleId ?? 0),
    queryFn: () => schedulesV2Service.listOverrides(scheduleId!),
    enabled: isOverride && scheduleId != null,
    staleTime: 30_000,
  });
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: schedulesV2Keys.listAll(tenantId) });
      if (data?.scheduleId != null) {
        qc.invalidateQueries({ queryKey: schedulesV2Keys.detail(tenantId, data.scheduleId) });
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
    };
    const scheduleHasValues =
      scheduleScope.cutoffDay != null
      || scheduleScope.cutoffTime != null
      || scheduleScope.weekDays != null
      || scheduleScope.isActive != null
      || scheduleScope.displayName != null
      || scheduleScope.displayDescription != null;
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
      regionId: derived.regionId,
      pickupDepotId: derived.pickupDepotId,
      speedId: derived.speedId,
      parentSpeedId: formParentSpeedId,
      autoBook: formAutoBook,
      bookPickup: formBookPickup,
      applyPickupCutoff: formApplyPickupCutoff,
      pickupCutoff: formApplyPickupCutoff ? formPickupCutoff : null,
      postcodeGroupId: derived.postcodeGroupId,
      pickupPostcodeGroupId: formPickupPostcodeGroupId,
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
  const saveDisabled = isOverride
    ? !data || ovSaveMut.isPending || !ovSeeded
    : !data || saveMut.isPending || !isDirty;
  const saveTitle = isOverride
    ? !data
      ? 'Loading schedule...'
      : 'Save this client override.'
    : !data
      ? 'Loading schedule...'
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
                bookPickup: formBookPickup, onBookPickupChange: setFormBookPickup,
                applyPickupCutoff: formApplyPickupCutoff, onApplyPickupCutoffChange: setFormApplyPickupCutoff,
                pickupCutoff: formPickupCutoff, onPickupCutoffChange: setFormPickupCutoff,
                pickupDepotId: derived.pickupDepotId,
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
}

function ClientsTab({ data, onAttachClients, onOpenSchedule, onOpenOverride, overrideMode }: ClientsTabProps) {
  const qc = useQueryClient();
  const auth = useAuth();
  const tenantId = auth.currentTenantId ?? 0;
  const toast = useToast();
  const isDefault = data.legacyClientId == null && data.clientIds.length === 0;
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
            label="All clients (default)"
            hint="Available to every client with no schedule of its own for this run. No link rows."
          />
          <RadioRow
            checked={!isDefault}
            label="Specific clients"
            hint="Only the clients attached below. Each is a row in the schedule/client link table."
          />
        </div>

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
            stays untouched and the client stays attached to it.
          </p>
          {/* "Create override" is per-client. Rendered inline on each
              attached client row below (see Attached clients column).
              Left button removed by Steve F1 (2026-09-22). */}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
          Attached clients
          <span className="text-xs text-text-muted font-normal">
            {data.clientCodes.length} linked
          </span>
        </h3>
        {data.clientCodes.length === 0 && data.legacyClientCode == null && (
          <p className="text-xs text-text-muted italic">
            No clients attached. This is a default schedule.
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
          title="Open the Attach Clients modal"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
            <path d="M18 4v6M15 7h6" />
          </svg>
          Attach clients
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
    bookPickup: boolean;
    onBookPickupChange: (v: boolean) => void;
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
      <div className={readOnly ? 'pointer-events-none opacity-60' : undefined}>
        <ChainBuilder
          legs={legs}
          onChange={onLegsChange}
          lookups={lookups}
          readOnly={readOnly}
          pickupBoxDiscount={advanced.pickupBoxDiscount}
          onPickupBoxDiscountChange={advanced.onPickupBoxDiscountChange}
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
            <label className="block text-xs">
              Drop-off location (schedule)
              <select
                value={advanced.dropOffLocationId ?? ''}
                onChange={(e) => advanced.onDropOffLocationIdChange(e.target.value ? Number(e.target.value) : null)}
                className="mt-1 w-full px-2 py-1 border border-border rounded"
              >
                <option value="">- default -</option>
                {lookups.dropOffLocations
                  .filter((d) => !advanced.pickupDepotId || d.depotId === advanced.pickupDepotId)
                  .map((d) => (<option key={d.id} value={d.id}>{d.name}</option>))}
              </select>
            </label>
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
            <label className="col-span-2 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={advanced.bookPickup}
                onChange={(e) => advanced.onBookPickupChange(e.target.checked)}
                className="accent-brand-cyan"
              />
              Book collection job (creates a separate collection job at booking time)
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
        <p className="text-xs text-text-muted mb-3">
          Individual postcodes bound to this schedule (on top of the postcode group
          dropdown above). Resolver union: schedule covers a postcode if it's in the
          bound group OR in this list.
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

function RadioRow({
  checked,
  label,
  hint,
}: {
  checked: boolean;
  label: string;
  hint: string;
}) {
  return (
    <label
      className={`block px-4 py-3 border rounded cursor-not-allowed ${
        checked ? 'border-brand-cyan bg-brand-cyan/5' : 'border-border'
      }`}
    >
      <div className="flex items-center gap-2">
        <input type="radio" checked={checked} readOnly disabled className="accent-brand-cyan" />
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
