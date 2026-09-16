import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../common/Modal';
import { useSchedulesV2Detail } from '../../hooks/queries/useSchedulesV2';
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
import { bulkPolygonService } from '../../services/bulkPolygonService';
import { ChainBuilder, type Leg } from './ChainBuilder';
import { CreateOverrideModal } from './CreateOverrideModal';

// Edit modal for the Schedules NEW page (Steve's 2026-09-08 brief
// section 2). 4 tabs: Clients / Route / Operating days / Roster.
// Name + Description + Active + Route + Operating days are editable
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
  cutoffHours: number;
}

const EMPTY_DAY: Omit<DayForm, 'enabled'> = {
  id: null,
  startTime: '08:00',
  endTime: '17:00',
  cutoffHours: 2,
};

function seedDaysFromDto(dtoDays: ScheduleGroup['dayWindows']): DayForm[] {
  const byDay = new Map(dtoDays.map((d) => [d.dayOfWeek, d]));
  return [1, 2, 3, 4, 5, 6, 7].map((n) => {
    const d = byDay.get(n);
    return d
      ? { id: d.id, enabled: true, startTime: d.startTime, endTime: d.endTime, cutoffHours: d.cutoffHours }
      : { ...EMPTY_DAY, enabled: false };
  });
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
}

export function ScheduleDetailModal({ scheduleId, onClose, onAttachClients, onOpenSchedule }: Props) {
  const [tab, setTab] = useState<ModalTab>('clients');
  const query = useSchedulesV2Detail(scheduleId);
  const data = query.data;
  const qc = useQueryClient();

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formActive, setFormActive] = useState(true);
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
  const [formPostcodeInput, setFormPostcodeInput] = useState('');
  const [formPolygonIds, setFormPolygonIds] = useState<number[]>([]);
  // Snapshot of the seeded form state for dirty-state tracking.
  // A no-op Save on a legacy per-client schedule would still trigger
  // the "migration to a link row happens on next save" side effect,
  // so we gate Save on the form actually differing from the seed.
  const [initialSnapshot, setInitialSnapshot] = useState<string>('');

  const currentSnapshot = useMemo(
    () => JSON.stringify({
      name: formName, description: formDescription, active: formActive,
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
    [formName, formDescription, formActive, formLegs, formDays,
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
    const seedActive = data.autoBook ?? true;
    const seedLegs = seedLegsFromDto(data);
    const seedDays = seedDaysFromDto(data.dayWindows);
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
    setFormActive(seedActive);
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
    setInitialSnapshot(JSON.stringify({
      name: seedName, description: seedDescription, active: seedActive,
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
    }
  }, [scheduleId]);

  const lookupsQuery = useQuery({
    queryKey: ['schedules-v2-lookups'],
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
    queryKey: ['bulk-polygons'],
    queryFn: () => bulkPolygonService.list().then((r) => r.response),
    staleTime: 5 * 60_000,
    enabled: scheduleId != null,
  });

  const addPostcode = () => {
    const p = Number(formPostcodeInput.trim());
    // Clamp to a sane int range - NZ postcodes are 4 digits, US ZIPs
    // are 5. Anything > 99999 either overflows the backend INT column
    // or is a typo; reject client-side rather than surface a 500.
    if (!Number.isFinite(p) || p <= 0 || p > 99999) return;
    setFormPostcodeIds((prev) => prev.includes(p) ? prev : [...prev, p].sort((a, b) => a - b));
    setFormPostcodeInput('');
  };
  const removePostcode = (p: number) => setFormPostcodeIds((prev) => prev.filter((x) => x !== p));
  const togglePolygon = (id: number) =>
    setFormPolygonIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].sort((a, b) => a - b));

  // Walk the leg chain to pull the flat fields the backend upsert
  // needs. Same rules as NewScheduleModal.derived.
  const derived = useMemo(() => {
    let pickupDepotId: number | null = null;
    let pickupRatingSpeed: number | null = null;
    let regionId = 0;
    let speedId: number | null = null;
    let postcodeGroupId: number | null = null;
    let storageState: number | null = null;
    const linehauls: ScheduleGroupUpsertBody['linehauls'] = [];
    const zones: number[] = [];
    for (const leg of formLegs) {
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
          weekDay: leg.weekDay ?? formDays.map((d) => (d.enabled ? 1 : 0)),
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
  }, [formLegs, formDays]);

  const saveMut = useMutation({
    mutationFn: (body: ScheduleGroupUpsertBody) =>
      body.scheduleId != null && body.scheduleId > 0
        ? schedulesV2Service.update(body.scheduleId, body)
        : schedulesV2Service.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules-v2-list'] });
      qc.invalidateQueries({ queryKey: ['schedules-v2-detail', data?.scheduleId] });
      onClose();
    },
    onError: (e: Error) => setSaveError(e.message),
  });

  const submit = () => {
    if (!data) return;
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
      regionId: derived.regionId,
      pickupDepotId: derived.pickupDepotId,
      speedId: derived.speedId,
      parentSpeedId: formParentSpeedId,
      autoBook: formActive,
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
      dayWindows: formDays
        .map((d, i) => ({
          id: d.id, dayOfWeek: i + 1,
          startTime: d.startTime, endTime: d.endTime, cutoffHours: d.cutoffHours,
        }))
        .filter((_d, i) => formDays[i].enabled),
      zones: derived.zones.map((z) => ({ zone: z, active: true })),
      linehauls: derived.linehauls,
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

  const title = data
    ? data.name ?? `Schedule #${data.scheduleId}`
    : 'Schedule';

  return (
    <Modal
      open={scheduleId != null}
      onClose={onClose}
      title={title}
      size="6xl"
      loading={query.isLoading || saveMut.isPending}
      loadingMessage={saveMut.isPending ? 'Saving schedule...' : 'Loading schedule detail...'}
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
            Close
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!data || saveMut.isPending || !isDirty}
            title={
              !data
                ? 'Loading schedule...'
                : !isDirty
                  ? 'No changes to save.'
                  : 'Save changes.'
            }
            className="px-4 py-2 text-sm rounded bg-brand-cyan text-brand-dark font-medium disabled:bg-brand-cyan/40 disabled:text-brand-dark/60 disabled:cursor-not-allowed"
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
            {data.legacyClientCode && (
              <span className="text-xs bg-warning-bg text-warning px-2 py-0.5 rounded">
                Legacy per-client: {data.legacyClientCode}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-text-muted">Name</span>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
              />
            </label>
            <label className="flex items-center gap-3 mt-6">
              <input
                type="checkbox"
                checked={formActive}
                onChange={(e) => setFormActive(e.target.checked)}
                className="accent-brand-cyan"
              />
              <span className="text-sm">Active (auto-book on)</span>
            </label>
            <label className="col-span-2 block">
              <span className="text-xs uppercase tracking-wide text-text-muted">Description</span>
              <input
                type="text"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
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
            />
          )}
          {tab === 'route' && (
            <RouteTab
              data={data}
              legs={formLegs}
              onLegsChange={setFormLegs}
              lookups={lookups}
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
          {tab === 'days' && <DaysTab days={formDays} onChange={setFormDays} scheduleId={data.scheduleId} />}
          {tab === 'coverage' && (
            <CoverageTab
              postcodeIds={formPostcodeIds}
              postcodeInput={formPostcodeInput}
              onPostcodeInputChange={setFormPostcodeInput}
              onAddPostcode={addPostcode}
              onRemovePostcode={removePostcode}
              polygonIds={formPolygonIds}
              onTogglePolygon={togglePolygon}
              polygons={polygonsQuery.data ?? null}
              polygonsError={polygonsQuery.error ? (polygonsQuery.error as Error).message : null}
              polygonsLoading={polygonsQuery.isLoading}
            />
          )}
          {tab === 'roster' && <RosterTab data={data} />}
        </>
      )}
    </Modal>
  );
}

// ─── Tabs ───────────────────────────────────────────────────────────

interface ClientsTabProps {
  data: ScheduleGroup;
  onAttachClients: (scheduleId: number) => void;
  onOpenSchedule: (scheduleId: number) => void;
}

function ClientsTab({ data, onAttachClients, onOpenSchedule }: ClientsTabProps) {
  const qc = useQueryClient();
  const isDefault = data.legacyClientId == null && data.clientIds.length === 0;
  const [showCreateOverride, setShowCreateOverride] = useState(false);
  const detachMut = useMutation({
    mutationFn: (clientId: number) =>
      schedulesV2Service.detachClient(data.scheduleId, clientId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules-v2-list'] });
      qc.invalidateQueries({ queryKey: ['schedules-v2-detail', data.scheduleId] });
    },
  });

  // Overrides pointing at this base schedule (Steve's mockup section
  // "CLIENT OVERRIDES - same route, different values"). Lists override
  // headers with the client each owns; clicking an override navigates
  // the modal to that schedule via the ?edit=<id> deep-link pattern.
  const overridesQuery = useQuery({
    queryKey: ['schedules-v2-overrides', data.scheduleId],
    queryFn: () => schedulesV2Service.listOverrides(data.scheduleId),
    staleTime: 30_000,
  });
  const overrides = overridesQuery.data ?? [];

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

        {/* Client overrides section per Steve's mockup - lives on the
            left column under the radio picker. */}
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
              No client overrides for this schedule.
            </p>
          )}
          {overrides.length > 0 && (
            <ul className="mt-2 space-y-1">
              {overrides.map((o) => (
                <li
                  key={o.scheduleId}
                  className="flex items-center gap-3 text-sm px-3 py-2 border border-border rounded"
                >
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-warning-bg text-warning text-[10px] font-semibold">
                    O
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenSchedule(o.scheduleId)}
                    className="text-xs font-mono text-brand-cyan hover:underline"
                    title="Open the override schedule"
                  >
                    #{o.scheduleId}
                  </button>
                  <span className="font-medium text-text-primary">{o.clientCode}</span>
                  <span className="text-xs text-text-muted ml-auto italic">
                    override of #{data.scheduleId}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-text-muted">
            An override is a new schedule with <span className="font-mono">BaseScheduleId = #{data.scheduleId}</span>.
            The client's link row moves from this schedule to the override, so it is never on both.
          </p>
          <button
            type="button"
            onClick={() => setShowCreateOverride(true)}
            disabled={isDefault}
            title={isDefault
              ? 'Overrides derive from a specific-client schedule. Attach a client first.'
              : 'Create a new schedule based on this one for a single client.'}
            className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded border border-border hover:bg-surface-light text-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Create override for a client...
          </button>
        </div>
      </section>
      <CreateOverrideModal
        baseScheduleId={showCreateOverride ? data.scheduleId : null}
        baseName={data.name}
        attachedClientIds={data.clientIds}
        onCreated={(newId) => {
          setShowCreateOverride(false);
          onOpenSchedule(newId);
        }}
        onClose={() => setShowCreateOverride(false)}
      />

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
                </span>
                {sinceLabel && (
                  <span className="text-xs text-text-muted mr-3">since {sinceLabel}</span>
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
}

function RouteTab({ data, legs, onLegsChange, lookups, advanced }: RouteTabProps) {
  const [advOpen, setAdvOpen] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Route</h3>
        <span className="text-xs text-text-muted italic">
          Dane's vertical leg builder - edit inline; Save persists via /api/schedules
        </span>
      </div>
      <ChainBuilder legs={legs} onChange={onLegsChange} lookups={lookups} />

      <section className="pt-4 border-t border-border">
        <button
          type="button"
          onClick={() => setAdvOpen((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 rounded border border-border hover:bg-surface-light text-xs uppercase tracking-wide text-text-muted"
        >
          <span>Advanced (schedule speed, cutoffs, delivery state, box discount, drop-off, collection group)</span>
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
              Collection box discount
              <select
                value={advanced.pickupBoxDiscount ?? ''}
                onChange={(e) => advanced.onPickupBoxDiscountChange(e.target.value ? Number(e.target.value) : null)}
                className="mt-1 w-full px-2 py-1 border border-border rounded"
              >
                <option value="">- none -</option>
                {lookups.pickupBoxDiscounts.map((s) => (<option key={s.id} value={s.id}>{s.label}</option>))}
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
  postcodeInput: string;
  onPostcodeInputChange: (v: string) => void;
  onAddPostcode: () => void;
  onRemovePostcode: (p: number) => void;
  polygonIds: number[];
  onTogglePolygon: (id: number) => void;
  polygons: { polygonId: number; name: string; attachedRouteCount: number }[] | null;
  polygonsError: string | null;
  polygonsLoading: boolean;
}

function CoverageTab({
  postcodeIds, postcodeInput, onPostcodeInputChange, onAddPostcode, onRemovePostcode,
  polygonIds, onTogglePolygon, polygons, polygonsError, polygonsLoading,
}: CoverageTabProps) {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold text-text-primary mb-2">
          Individual postcodes
        </h3>
        <p className="text-xs text-text-muted mb-2">
          Bound on top of the delivery zone group. Resolver union: schedule covers a postcode
          if it's in the bound group OR in this list.
        </p>
        <div className="flex items-center gap-2 mb-2">
          <input
            type="number"
            value={postcodeInput}
            onChange={(e) => onPostcodeInputChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAddPostcode(); } }}
            placeholder="e.g. 8011"
            className="w-32 px-2 py-1 text-sm border border-border rounded"
          />
          <button
            type="button"
            onClick={onAddPostcode}
            className="px-3 py-1 text-xs rounded border border-border hover:bg-surface-light"
          >
            Add
          </button>
          <span className="text-xs text-text-muted">
            {postcodeIds.length === 0 ? 'None bound.' : `${postcodeIds.length} bound.`}
          </span>
        </div>
        {postcodeIds.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {postcodeIds.map((p) => (
              <span
                key={p}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-brand-cyan/15 text-brand-cyan font-mono"
              >
                {String(p).padStart(4, '0')}
                <button
                  type="button"
                  onClick={() => onRemovePostcode(p)}
                  className="ml-1 hover:opacity-70"
                  title="Remove"
                >
                  x
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="pt-4 border-t border-border">
        <h3 className="text-sm font-semibold text-text-primary mb-2">
          Coverage polygons
        </h3>
        <p className="text-xs text-text-muted mb-2">
          Bind polygons drawn in Polygon Builder. Ticking a polygon here binds it to this
          schedule; the operator sees the polygon as covering this schedule's territory.
        </p>
        <div className="max-h-72 overflow-y-auto border border-border rounded">
          {polygonsLoading && (
            <div className="p-3 text-xs text-text-muted italic">Loading polygons...</div>
          )}
          {polygonsError && (
            <div className="p-3 text-xs text-error">
              Failed to load polygons: {polygonsError}
            </div>
          )}
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
      </section>
    </div>
  );
}

interface DaysTabProps {
  days: DayForm[];
  onChange: (days: DayForm[]) => void;
  scheduleId: number;
}

function DaysTab({ days, onChange, scheduleId }: DaysTabProps) {
  const toggle = (i: number) =>
    onChange(days.map((d, idx) => (idx === i ? { ...d, enabled: !d.enabled } : d)));
  const patch = (i: number, p: Partial<DayForm>) =>
    onChange(days.map((d, idx) => (idx === i ? { ...d, ...p } : d)));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Operating days</h3>
        <span className="text-xs text-text-muted italic">
          cut-off is per day, hours before the window
        </span>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {[1, 2, 3, 4, 5, 6, 7].map((n) => {
          const i = n - 1;
          const d = days[i];
          return (
            <div
              key={n}
              className={`border rounded p-2 text-center ${
                d.enabled ? 'border-brand-cyan bg-brand-cyan/5' : 'border-border bg-surface-light'
              }`}
            >
              <label className="flex items-center gap-1 text-xs font-medium justify-center">
                <input
                  type="checkbox"
                  checked={d.enabled}
                  onChange={() => toggle(i)}
                  className="accent-brand-cyan"
                />
                {DAY_NAMES[n]}
              </label>
              {d.enabled && (
                <div className="mt-1 space-y-1">
                  <input
                    type="time"
                    value={d.startTime}
                    onChange={(e) => patch(i, { startTime: e.target.value })}
                    className="w-full text-xs border border-border rounded px-1"
                  />
                  <input
                    type="time"
                    value={d.endTime}
                    onChange={(e) => patch(i, { endTime: e.target.value })}
                    className="w-full text-xs border border-border rounded px-1"
                  />
                  <div className="flex items-center gap-1 text-xs">
                    <input
                      type="number"
                      min={0}
                      value={d.cutoffHours}
                      onChange={(e) => patch(i, { cutoffHours: Number(e.target.value) })}
                      className="w-12 border border-border rounded px-1"
                    />
                    <span>h</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
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
              {name ?? '—'}
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
