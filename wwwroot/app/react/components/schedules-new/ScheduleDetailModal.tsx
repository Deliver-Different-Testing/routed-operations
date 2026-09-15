import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../common/Modal';
import { useSchedulesV2Detail } from '../../hooks/queries/useSchedulesV2';
import { schedulesV2Service } from '../../services/schedulesV2Service';
import { scheduleService, type ScheduleGroup, type ScheduleGroupUpsertBody } from '../../services/scheduleService';
import { recurringRouteService } from '../../services/recurringRouteService';
import { ChainBuilder, type Leg } from './ChainBuilder';

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

type ModalTab = 'clients' | 'route' | 'days' | 'roster';

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
}

export function ScheduleDetailModal({ scheduleId, onClose }: Props) {
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
  // Snapshot of the seeded form state for dirty-state tracking.
  // A no-op Save on a legacy per-client schedule would still trigger
  // the "migration to a link row happens on next save" side effect,
  // so we gate Save on the form actually differing from the seed.
  const [initialSnapshot, setInitialSnapshot] = useState<string>('');

  const currentSnapshot = useMemo(
    () => JSON.stringify({
      name: formName, description: formDescription, active: formActive,
      legs: formLegs, days: formDays,
    }),
    [formName, formDescription, formActive, formLegs, formDays],
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
    setFormName(seedName);
    setFormDescription(seedDescription);
    setFormActive(seedActive);
    setFormLegs(seedLegs);
    setFormDays(seedDays);
    setSaveError(null);
    setSeededForId(data.scheduleId);
    setInitialSnapshot(JSON.stringify({
      name: seedName, description: seedDescription, active: seedActive,
      legs: seedLegs, days: seedDays,
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
      postcodeGroups: (lookupsQuery.data?.postcodeGroups ?? []).map((g) => ({ id: g.id, name: g.name })),
      storageStates: lookupsQuery.data?.storageStates ?? [],
      linehaulRuns: (lookupsQuery.data?.linehaulRuns ?? []).map((r) => ({
        id: r.id, runName: r.runName, fromDepotId: r.fromDepotId, toDepotId: r.toDepotId,
      })),
      zoneNumbers: lookupsQuery.data?.zoneNumbers ?? [],
    }),
    [lookupsQuery.data],
  );

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
          name: null, active: true,
          amount: leg.amount, amountPercentage: leg.amountPercentage,
          fromDepotId: leg.fromDepotId, toDepotId: leg.toDepotId,
          minutes: leg.transitMinutes || null,
          linehaulRunId: leg.linehaulRunId,
          insertToBulk: leg.insertToBulk, applyDiscount: leg.applyDiscount,
          applyAddOnPercentage: leg.applyAddOnPercentage,
          weekDay: formDays.map((d) => (d.enabled ? 1 : 0)),
          departureAdvanceDays: leg.dayOffset,
          fromClientAddress: null, dropOffLocationId: null,
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
    mutationFn: (body: ScheduleGroupUpsertBody) => scheduleService.upsert(body),
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
      parentSpeedId: data.parentSpeedId ?? null,
      autoBook: formActive,
      bookPickup: data.bookPickup ?? null,
      applyPickupCutoff: data.applyPickupCutoff ?? null,
      pickupCutoff: data.pickupCutoff ?? null,
      postcodeGroupId: derived.postcodeGroupId,
      pickupPostcodeGroupId: data.pickupPostcodeGroupId ?? null,
      pickupRatingSpeed: derived.pickupRatingSpeed,
      storageState: derived.storageState,
      deliveryState: data.deliveryState ?? null,
      pickupBoxDiscount: data.pickupBoxDiscount ?? null,
      dropOffLocationId: data.dropOffLocationId ?? null,
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
      postcodeIds: [...data.postcodeIds],
      polygonIds: [...data.polygonIds],
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
            <TabButton active={tab === 'roster'} onClick={() => setTab('roster')}>
              Roster
            </TabButton>
          </nav>

          {tab === 'clients' && <ClientsTab data={data} />}
          {tab === 'route' && (
            <RouteTab data={data} legs={formLegs} onLegsChange={setFormLegs} lookups={lookups} />
          )}
          {tab === 'days' && <DaysTab days={formDays} onChange={setFormDays} scheduleId={data.scheduleId} />}
          {tab === 'roster' && <RosterTab data={data} />}
        </>
      )}
    </Modal>
  );
}

// ─── Tabs ───────────────────────────────────────────────────────────

function ClientsTab({ data }: { data: ScheduleGroup }) {
  const qc = useQueryClient();
  const isDefault = data.legacyClientId == null && data.clientIds.length === 0;
  const detachMut = useMutation({
    mutationFn: (clientId: number) =>
      schedulesV2Service.detachClient(data.scheduleId, clientId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules-v2-list'] });
      qc.invalidateQueries({ queryKey: ['schedules-v2-detail', data.scheduleId] });
    },
  });
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
          {data.clientCodes.map((code, i) => (
            <li
              key={`${code}-${i}`}
              className="flex items-center justify-between text-sm px-3 py-2 border border-border rounded"
            >
              <span>
                <span className="font-medium text-text-primary">{code}</span>
                <span className="text-xs text-text-muted ml-2">
                  #{data.clientIds[i] ?? '?'}
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  const clientId = data.clientIds[i];
                  if (clientId) detachMut.mutate(clientId);
                }}
                disabled={detachMut.isPending}
                className="text-xs text-error hover:text-error-dark hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                title="Detach this client from the schedule."
              >
                {detachMut.isPending ? 'Removing...' : 'Remove'}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-text-muted italic">
          To attach clients, use the row action icon on the Schedules list.
        </p>
      </section>
    </div>
  );
}

interface RouteTabProps {
  data: ScheduleGroup;
  legs: Leg[];
  onLegsChange: (legs: Leg[]) => void;
  lookups: {
    depots: { id: number; name: string }[];
    speeds: { id: number; name: string }[];
    postcodeGroups: { id: number; name: string }[];
    storageStates: { id: number; label: string }[];
    linehaulRuns: { id: number; runName: string; fromDepotId: number | null; toDepotId: number | null }[];
    zoneNumbers: number[];
  };
}

function RouteTab({ data, legs, onLegsChange, lookups }: RouteTabProps) {
  const hasSecondaryFields =
    data.deliveryState != null || (data.applyPickupCutoff && data.pickupCutoff != null);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Route</h3>
        <span className="text-xs text-text-muted italic">
          Dane's vertical leg builder - edit inline; Save persists via /api/schedules
        </span>
      </div>
      <ChainBuilder legs={legs} onChange={onLegsChange} lookups={lookups} />

      {hasSecondaryFields && (
        <section className="pt-6 border-t border-border">
          <h4 className="text-xs uppercase tracking-wide text-text-muted mb-3">
            Other fields (not editable here)
          </h4>
          <dl className="grid grid-cols-2 gap-y-2 gap-x-8 text-sm">
            {data.deliveryState != null && (
              <ProdRow label="Delivery state" value={temperatureLabel(data.deliveryState) ?? '-'} />
            )}
            {data.applyPickupCutoff && data.pickupCutoff != null && (
              <ProdRow label="Pickup cutoff" value={`${data.pickupCutoff}h`} />
            )}
          </dl>
        </section>
      )}
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

function RosterTab({ data }: { data: ScheduleGroup }) {
  // Sum up weekly runs so the summary row shows total dispatches per
  // week. lh.weekDay is a 7-entry array of 1/0 (Mon-Sun) per Steve's
  // section 2 semantics.
  const activeLegs = data.linehauls.filter((l) => l.active !== false);
  const totalWeeklyDispatches = activeLegs.reduce((sum, l) => {
    return sum + (l.weekDay ?? []).reduce((n, v) => n + (v ? 1 : 0), 0);
  }, 0);

  const routesQuery = useQuery({
    queryKey: ['schedules-v2-recurring-routes-for-schedule', data.scheduleId],
    queryFn: () => recurringRouteService.list().then((r) => r.response),
    staleTime: 30_000,
  });
  const boundRoutes = (routesQuery.data ?? []).filter((r) =>
    r.schedules.some((s) => s.scheduleId === data.scheduleId),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Roster</h3>
        <span className="text-xs text-text-muted italic">
          Recurring routes + linehaul legs bound to this schedule
        </span>
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs uppercase tracking-wide text-text-muted">
            Recurring routes
          </h4>
          {routesQuery.data && (
            <span className="text-xs text-text-muted">
              {boundRoutes.length} bound
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
        {boundRoutes.length > 0 && (
          <div className="space-y-2">
            {boundRoutes.map((r) => {
              const ref = r.schedules.find((s) => s.scheduleId === data.scheduleId);
              return (
                <div key={r.routeId} className="border border-border rounded p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 flex-1">
                      <div className="text-sm font-medium text-text-primary flex items-center gap-2">
                        <span className="w-2 h-2 rounded-sm bg-blue-500 inline-block" />
                        {r.name}
                        {!r.active && (
                          <span className="text-xs text-warning">(inactive)</span>
                        )}
                      </div>
                      <div className="text-xs text-text-muted">
                        Area <span className="text-text-primary">{r.area || '-'}</span>
                        {' · '}
                        Target{' '}
                        <span className="text-text-primary">
                          {r.defaultTargetName || 'unassigned'}
                        </span>
                        {ref?.window && <> · window {ref.window}</>}
                      </div>
                    </div>
                    <div className="text-xs text-right space-y-0.5">
                      <div>
                        <span className="text-text-primary font-medium">
                          {r.bookingCount}
                        </span>{' '}
                        <span className="text-text-muted">bookings</span>
                      </div>
                      <div>
                        <span className="text-text-primary font-medium">
                          {r.mappedStopsCount}
                        </span>{' '}
                        <span className="text-text-muted">stops</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="border-t border-border pt-4">
        <h4 className="text-xs uppercase tracking-wide text-text-muted mb-2">
          Linehaul legs
        </h4>
      </div>

      {activeLegs.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-text-muted border-b border-border pb-3">
          <span>
            <strong className="text-text-primary">{activeLegs.length}</strong>{' '}
            active leg{activeLegs.length === 1 ? '' : 's'}
          </span>
          <span>
            <strong className="text-text-primary">{totalWeeklyDispatches}</strong>{' '}
            weekly dispatch{totalWeeklyDispatches === 1 ? '' : 'es'}
          </span>
        </div>
      )}

      {data.linehauls.length === 0 ? (
        <div className="border border-border rounded p-6 text-center text-sm text-text-muted">
          No linehaul legs bound to this schedule.
        </div>
      ) : (
        <div className="space-y-2">
          {data.linehauls.map((lh) => (
            <div
              key={lh.id}
              className={`border rounded p-4 ${
                lh.active === false ? 'border-border bg-surface-light' : 'border-border'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="space-y-1 flex-1">
                  <div className="text-sm font-medium text-text-primary flex items-center gap-2">
                    <span className="w-2 h-2 rounded-sm bg-orange-500 inline-block" />
                    {lh.name ?? `Linehaul run ${lh.linehaulRunId ?? '?'}`}
                    {lh.active === false && (
                      <span className="text-xs text-warning">(inactive)</span>
                    )}
                  </div>
                  <div className="text-xs text-text-muted">
                    Run <span className="font-mono">#{lh.linehaulRunId ?? '?'}</span>{' '}
                    · depart offset {lh.departureAdvanceDays ?? 0}d
                    {lh.minutes != null && (
                      <> · transit {Math.floor(lh.minutes / 60)}h{lh.minutes % 60 > 0 ? ` ${lh.minutes % 60}m` : ''}</>
                    )}
                  </div>
                </div>
                {(lh.amount != null || lh.amountPercentage != null) && (
                  <div className="text-xs text-right">
                    {lh.amount != null && <div className="text-text-primary">${lh.amount.toFixed(2)}</div>}
                    {lh.amountPercentage != null && lh.amountPercentage !== 0 && (
                      <div className="text-text-muted">{lh.amountPercentage}%</div>
                    )}
                  </div>
                )}
              </div>

              {/* Day-of-week strip. lh.weekDay is a 7-entry array of
                  1/0 (Mon..Sun) - render the active days as filled
                  pills so operators can spot uneven-week schedules. */}
              {lh.weekDay.length > 0 && (
                <div className="flex gap-1 mt-3 items-center text-[10px]">
                  <span className="text-text-muted uppercase tracking-wide mr-1">Days</span>
                  {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, i) => (
                    <span
                      key={i}
                      className={`w-5 h-5 rounded flex items-center justify-center font-semibold border ${
                        lh.weekDay[i] === 1
                          ? 'bg-orange-100 border-orange-300 text-orange-800'
                          : 'bg-surface-light border-border text-text-muted'
                      }`}
                    >
                      {label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-text-muted italic max-w-2xl">
        Recurring routes are joined via the /api/recurring-routes read path: any route with
        this schedule in its bound list shows up above. Linehaul legs come from the schedule
        itself via tblBulkScheduleLinehaul.
      </p>
    </div>
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
