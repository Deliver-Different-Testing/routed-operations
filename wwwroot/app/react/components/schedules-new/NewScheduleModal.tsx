import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../common/Modal';
import { scheduleService, type ScheduleGroupUpsertBody } from '../../services/scheduleService';
import { schedulesV2Service } from '../../services/schedulesV2Service';
import { bulkPolygonService } from '../../services/bulkPolygonService';
import { ClientMultiPicker } from './ClientMultiPicker';
import { ChainBuilder, type Leg } from './ChainBuilder';
import { ScheduleCoverageMap } from '../schedules/ScheduleCoverageMap';
import { useAuth } from '../../context/AuthContext';
import { schedulesV2Keys } from '../../hooks/queries/useSchedulesV2';
import { PostcodeLookupInput } from './PostcodeLookupInput';

// New Schedule modal - covers Steve's mockup "New Schedule" creator.
// Uses ChainBuilder (this session's MVP of Dane's visual leg builder)
// for the Delivery Route card; walks the leg chain to derive the flat
// fields backend UpsertAsync expects (pickupDepotId + regionId +
// speedId + linehauls).
//
// Fields:
//   - Name (required)
//   - Description (optional)
//   - Book-immediately toggle (writes schedule.autoBook - controls
//     whether the job creates now vs stages into bulk)
//   - Origin depot (pickup) - optional; empty = "Client address"
//   - Destination region - required
//   - Delivery speed - optional
//   - Operating days pills (M-Sun) with per-day window + cutoff
//   - Clients: All or Specific with multi-picker
//
// Backend: reuses the existing PUT /api/schedules upsert path
// (ScheduleGroupUpsertBody). Backend UpsertAsync accepts an empty
// scheduleId as "create" and stamps a fresh header.

interface Props {
  open: boolean;
  onClose: () => void;
}

const DAYS = [
  { n: 1, label: 'Mon' },
  { n: 2, label: 'Tue' },
  { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' },
  { n: 5, label: 'Fri' },
  { n: 6, label: 'Sat' },
  { n: 7, label: 'Sun' },
];

interface DayForm {
  enabled: boolean;
  startTime: string;
  endTime: string;
  cutoffHours: number;
}

const DEFAULT_DAY: DayForm = {
  enabled: false,
  startTime: '08:00',
  endTime: '17:00',
  cutoffHours: 2,
};

export function NewScheduleModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const auth = useAuth();
  const tenantId = auth.currentTenantId ?? 0;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [autoBook, setAutoBook] = useState(false);
  // F21 (Steve 2026-09-20): header-level bookable flag. Defaults to true
  // on create so new schedules are immediately bookable; independent of
  // AutoBook (which is off by default because staging into bulk is the
  // safer default for a brand-new schedule).
  const [isActive, setIsActive] = useState(true);
  // F13: client-facing display copy. Empty strings are saved as NULL so
  // the backend can distinguish "cleared" from "unset".
  const [displayName, setDisplayName] = useState('');
  const [displayDescription, setDisplayDescription] = useState('');
  // Booking mode per Steve's brief §2 Creating-a-schedule item 1:
  //   "booking mode radio Fixed Time / Window"
  // Fixed Time = single despatch time (drivers pick up at the same
  // clock time every operating day); Window = a start/end range the
  // customer can book anywhere in. Backend does not yet gate on this,
  // so this is a UI hint stored on the day-row descriptions for now.
  const [bookingMode, setBookingMode] = useState<'window' | 'fixed'>('window');
  const [legs, setLegs] = useState<Leg[]>([]);
  const [days, setDays] = useState<DayForm[]>(
    // Mon-Fri enabled by default per Steve's mockup
    [1, 2, 3, 4, 5, 6, 7].map((n) => ({ ...DEFAULT_DAY, enabled: n <= 5 })),
  );
  const [clientMode, setClientMode] = useState<'all' | 'specific'>('all');
  const [clientIds, setClientIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Tier 1 advanced fields - schedule-level pickup + delivery + rating
  // extras that legacy /schedules exposes. Kept collapsed by default
  // because Steve's mockup keeps the modal simple; operators who need
  // these open Advanced.
  const [parentSpeedId, setParentSpeedId] = useState<number | null>(null);
  const [deliveryState, setDeliveryState] = useState<number | null>(null);
  const [pickupBoxDiscount, setPickupBoxDiscount] = useState<number | null>(null);
  const [dropOffLocationId, setDropOffLocationId] = useState<number | null>(null);
  const [applyPickupCutoff, setApplyPickupCutoff] = useState(false);
  const [pickupCutoff, setPickupCutoff] = useState<number | null>(null);
  const [bookPickup, setBookPickup] = useState(false);
  // Tier 2 - Collection zone group + individual postcodes + coverage
  // polygons. Legacy /schedules has all three; parity requires them.
  const [pickupPostcodeGroupId, setPickupPostcodeGroupId] = useState<number | null>(null);
  const [postcodeIds, setPostcodeIds] = useState<number[]>([]);
  const [polygonIds, setPolygonIds] = useState<number[]>([]);

  // Coverage polygons - lazily fetched on modal open. Cached across
  // subsequent opens via React Query's default 5min stale time.
  const polygonsQuery = useQuery({
    queryKey: schedulesV2Keys.bulkPolygons(tenantId),
    queryFn: () => bulkPolygonService.list().then((r) => r.response),
    staleTime: 5 * 60_000,
    enabled: open,
  });

  const lookupsQuery = useQuery({
    queryKey: schedulesV2Keys.lookups(tenantId),
    queryFn: () => scheduleService.lookups().then((r) => r.response),
    staleTime: 5 * 60_000,
    enabled: open,
  });

  const createMut = useMutation({
    mutationFn: (body: ScheduleGroupUpsertBody) => schedulesV2Service.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: schedulesV2Keys.listAll(tenantId) });
      resetAndClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const resetAndClose = () => {
    setName('');
    setDescription('');
    setAutoBook(false);
    setIsActive(true);
    setDisplayName('');
    setDisplayDescription('');
    setBookingMode('window');
    setLegs([]);
    setDays([1, 2, 3, 4, 5, 6, 7].map((n) => ({ ...DEFAULT_DAY, enabled: n <= 5 })));
    setClientMode('all');
    setClientIds([]);
    setError(null);
    setAdvancedOpen(false);
    setParentSpeedId(null);
    setDeliveryState(null);
    setPickupBoxDiscount(null);
    setDropOffLocationId(null);
    setApplyPickupCutoff(false);
    setPickupCutoff(null);
    setBookPickup(false);
    setPickupPostcodeGroupId(null);
    setPostcodeIds([]);
    setPolygonIds([]);
    onClose();
  };

  const togglePolygon = (id: number) =>
    setPolygonIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].sort((a, b) => a - b));

  const toggleDay = (i: number) => {
    setDays((prev) => prev.map((d, idx) => idx === i ? { ...d, enabled: !d.enabled } : d));
  };
  const patchDay = (i: number, patch: Partial<DayForm>) => {
    setDays((prev) => prev.map((d, idx) => idx === i ? { ...d, ...patch } : d));
  };

  // Walk the leg chain to pull the flat fields the backend upsert
  // needs. Collection sets pickupDepotId + pickupRatingSpeed;
  // Delivery sets regionId + postcodeGroupId + speedId; Depot
  // sets storageState. Linehaul legs append to the linehauls array.
  const derived = useMemo(() => {
    let pickupDepotId: number | null = null;
    let pickupRatingSpeed: number | null = null;
    let regionId = 0;
    let speedId: number | null = null;
    let postcodeGroupId: number | null = null;
    let storageState: number | null = null;
    const linehauls: Array<{
      name: string | null; active: boolean | null; amount: number | null;
      amountPercentage: number | null; fromDepotId: number | null;
      toDepotId: number | null; minutes: number | null; linehaulRunId: number | null;
      insertToBulk: boolean | null; applyDiscount: boolean | null;
      applyAddOnPercentage: boolean | null; weekDay: number[];
      departureAdvanceDays: number | null; fromClientAddress: boolean | null;
      dropOffLocationId: number | null; speedId: number | null;
    }> = [];
    const zones: number[] = [];
    for (const leg of legs) {
      if (leg.type === 'collection') {
        pickupDepotId = leg.pickupSource === 'depot' ? leg.pickupDepotId : null;
        pickupRatingSpeed = leg.speedId;
      } else if (leg.type === 'depot') {
        storageState = leg.storageState;
      } else if (leg.type === 'linehaul') {
        linehauls.push({
          name: leg.name,
          active: leg.active,
          amount: leg.amount,
          amountPercentage: leg.amountPercentage,
          fromDepotId: leg.fromDepotId,
          toDepotId: leg.toDepotId,
          minutes: leg.transitMinutes || null,
          linehaulRunId: leg.linehaulRunId,
          insertToBulk: leg.insertToBulk,
          applyDiscount: leg.applyDiscount,
          applyAddOnPercentage: leg.applyAddOnPercentage,
          // Per-leg override wins; falls back to the schedule's overall
          // day mask so a legacy operator experience still works.
          weekDay: leg.weekDay ?? days.map((d) => (d.enabled ? 1 : 0)),
          departureAdvanceDays: leg.dayOffset,
          fromClientAddress: leg.fromClientAddress,
          dropOffLocationId: leg.dropOffLocationId,
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
  }, [legs, days]);

  const submit = () => {
    if (!name.trim()) { setError('Name is required.'); return; }
    if (!derived.regionId || derived.regionId <= 0) {
      setError('Add a Delivery leg with a region to set the destination.'); return;
    }
    const enabled = days.filter((d) => d.enabled);
    if (enabled.length === 0) { setError('Enable at least one operating day.'); return; }
    if (clientMode === 'specific' && clientIds.length === 0) {
      setError('Pick at least one client, or switch to "All clients".'); return;
    }
    setError(null);

    const body: ScheduleGroupUpsertBody = {
      scheduleId: null,   // create
      name: name.trim(),
      description: description.trim() || null,
      // F13: send NULL when the operator leaves the display fields
      // blank so the backend can distinguish "cleared" from "unset".
      displayName: displayName.trim() || null,
      displayDescription: displayDescription.trim() || null,
      // F21: header-level bookable flag.
      isActive: isActive,
      regionId: derived.regionId,
      pickupDepotId: derived.pickupDepotId,
      speedId: derived.speedId,
      parentSpeedId: parentSpeedId,
      autoBook: autoBook,
      bookPickup: bookPickup,
      applyPickupCutoff: applyPickupCutoff,
      pickupCutoff: applyPickupCutoff ? pickupCutoff : null,
      postcodeGroupId: derived.postcodeGroupId,
      pickupPostcodeGroupId: pickupPostcodeGroupId,
      pickupRatingSpeed: derived.pickupRatingSpeed,
      storageState: derived.storageState,
      deliveryState: deliveryState,
      pickupBoxDiscount: pickupBoxDiscount,
      dropOffLocationId: dropOffLocationId,
      // F8 (Steve 2026-09-20): per-day CutoffHours. Each enabled day
       // carries its own d.cutoffHours; DayWindowDto flows this through
       // to tblBulkRunSchedule per-row without flattening. Audit found
       // 452 NZ schedules had disagreeing per-day cutoffs that the old
       // read+write path silently flattened; this frontend never
       // introduced that path (seedDaysFromDto reads per-day, submit
       // writes per-day).
      dayWindows: days.map((d, i) => ({
        id: null,
        dayOfWeek: i + 1,
        startTime: d.startTime,
        endTime: d.endTime,
        cutoffHours: d.cutoffHours,
      })).filter((_d, i) => days[i].enabled),
      // F7 (Steve 2026-09-20): send null when the operator did not
      // populate zones/linehauls, so the backend's null-guard preserves
      // any existing rows (moot on create since there are none, but
      // keeps the send-shape consistent with ScheduleDetailModal for
      // the backend contract).
      zones: derived.zones.length > 0
        ? derived.zones.map((z) => ({ zone: z, active: true }))
        : null,
      linehauls: derived.linehauls.length > 0 ? derived.linehauls : null,
      // "Specific" mode uses the id-based fallback: `clientCodes: null`
      // tells the backend to consult `clientIds`. "All" mode sends an
      // explicit empty `clientCodes: []` which reads as "no link rows"
      // and produces a default (all-clients) schedule.
      clientIds: clientMode === 'specific' ? clientIds : [],
      clientCodes: clientMode === 'specific' ? null : [],
      postcodeIds: [...postcodeIds],
      polygonIds: [...polygonIds],
    };
    createMut.mutate(body);
  };

  return (
    <Modal
      open={open}
      onClose={resetAndClose}
      title="New Schedule"
      size="4xl"
      loading={createMut.isPending}
      loadingMessage="Creating schedule..."
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={resetAndClose}
            className="px-4 py-2 text-sm rounded border border-border hover:bg-surface-light"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={createMut.isPending}
            className="px-4 py-2 text-sm rounded bg-brand-cyan text-brand-dark font-medium disabled:bg-brand-cyan/40 disabled:text-brand-dark/60 disabled:cursor-not-allowed"
          >
            Create schedule
          </button>
        </div>
      }
    >
      {error && (
        <div className="mb-3 text-xs text-error border border-error/30 bg-error-bg/40 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-text-muted">Name</span>
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
            placeholder="AKL > CHCH Pre 10am Medical"
          />
        </label>
        <div className="flex flex-col gap-2 mt-6">
          {/* F21: Active flag - independent of Book immediately. Active
              gates whether the schedule can be booked at all; Book
              immediately gates book-now vs stage-into-bulk. Defaults:
              active=true (bookable), autoBook=false (stages by default). */}
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="accent-brand-cyan"
              data-testid="new-schedule-is-active-checkbox"
            />
            <span className="text-sm">
              Active
              <span className="ml-2 text-xs text-text-muted">
                schedule is bookable at all
              </span>
            </span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={autoBook}
              onChange={(e) => setAutoBook(e.target.checked)}
              className="accent-brand-cyan"
            />
            <span className="text-sm">
              Book immediately
              <span className="ml-2 text-xs text-text-muted">
                job creates now instead of staging into bulk
              </span>
            </span>
          </label>
        </div>

        <fieldset className="col-span-2 flex items-center gap-4 mt-2">
          <legend className="text-xs uppercase tracking-wide text-text-muted mr-2">Booking mode</legend>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="radio"
              name="booking-mode"
              value="fixed"
              checked={bookingMode === 'fixed'}
              onChange={() => setBookingMode('fixed')}
              className="accent-brand-cyan"
            />
            <span>Fixed Time</span>
            <span className="text-[10px] text-text-muted">single despatch time</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="radio"
              name="booking-mode"
              value="window"
              checked={bookingMode === 'window'}
              onChange={() => setBookingMode('window')}
              className="accent-brand-cyan"
            />
            <span>Window</span>
            <span className="text-[10px] text-text-muted">book anywhere in start/end range</span>
          </label>
        </fieldset>

        <label className="col-span-2 block">
          <span className="text-xs uppercase tracking-wide text-text-muted">
            Description
            <span className="text-text-muted normal-case ml-2">
              ({description.length}/500)
            </span>
          </span>
          <textarea
            value={description}
            maxLength={500}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40 h-16 resize-y"
            placeholder="Book by 3 pm. Next business day service to Christchurch."
          />
        </label>

        {/* F13: client-facing display copy shown on the booking / job
            pages. Blank -> NULL on save (falls back to Name). */}
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-text-muted">
            Display name
            <span className="ml-2 text-text-muted normal-case">
              (client-facing; blank = use Name)
            </span>
          </span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
            placeholder="Next Business Day"
            data-testid="new-schedule-display-name-input"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-text-muted">
            Display description
            <span className="ml-2 text-text-muted normal-case">
              (client-facing subtitle)
            </span>
          </span>
          <input
            type="text"
            value={displayDescription}
            onChange={(e) => setDisplayDescription(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
            placeholder="Order by 3pm, delivered next business day"
            data-testid="new-schedule-display-description-input"
          />
        </label>

        <div className="col-span-2">
          <span className="text-xs uppercase tracking-wide text-text-muted">Delivery route</span>
          <div className="mt-1">
            <ChainBuilder
              legs={legs}
              onChange={setLegs}
              lookups={{
                depots: lookupsQuery.data?.depots ?? [],
                speeds: lookupsQuery.data?.speeds ?? [],
                postcodeGroups: (lookupsQuery.data?.postcodeGroups ?? []).map((g) => ({ id: g.id, name: g.name })),
                storageStates: lookupsQuery.data?.storageStates ?? [],
                linehaulRuns: (lookupsQuery.data?.linehaulRuns ?? []).map((r) => ({
                  id: r.id, runName: r.runName, fromDepotId: r.fromDepotId, toDepotId: r.toDepotId,
                })),
                zoneNumbers: lookupsQuery.data?.zoneNumbers ?? [],
                dropOffLocations: lookupsQuery.data?.dropOffLocations ?? [],
                pickupBoxDiscounts: lookupsQuery.data?.pickupBoxDiscounts ?? [],
              }}
              pickupBoxDiscount={pickupBoxDiscount}
              onPickupBoxDiscountChange={setPickupBoxDiscount}
            />
          </div>
        </div>

        <div className="col-span-2 block">
          <span className="text-xs uppercase tracking-wide text-text-muted">Operating days + cut-off</span>
          <div className="mt-1 grid grid-cols-7 gap-2">
            {days.map((d, i) => (
              <div
                key={DAYS[i].n}
                className={`border rounded p-2 text-center ${
                  d.enabled ? 'border-brand-cyan bg-brand-cyan/5' : 'border-border bg-surface-light'
                }`}
              >
                <label className="flex items-center gap-1 text-xs font-medium justify-center">
                  <input
                    type="checkbox"
                    checked={d.enabled}
                    onChange={() => toggleDay(i)}
                    className="accent-brand-cyan"
                  />
                  {DAYS[i].label}
                </label>
                {d.enabled && (
                  <div className="mt-1 space-y-1">
                    <input
                      type="time"
                      value={d.startTime}
                      onChange={(e) => patchDay(i, { startTime: e.target.value })}
                      className="w-full text-xs border border-border rounded px-1"
                    />
                    <input
                      type="time"
                      value={d.endTime}
                      onChange={(e) => patchDay(i, { endTime: e.target.value })}
                      className="w-full text-xs border border-border rounded px-1"
                    />
                    <div className="flex items-center gap-1 text-xs">
                      <input
                        type="number"
                        min={0}
                        value={d.cutoffHours}
                        onChange={(e) => patchDay(i, { cutoffHours: Number(e.target.value) })}
                        className="w-12 border border-border rounded px-1"
                      />
                      <span>h</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="col-span-2 block">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 rounded border border-border hover:bg-surface-light text-xs uppercase tracking-wide text-text-muted"
          >
            <span>Advanced (schedule speed, cutoffs, delivery state, drop-off, collection group)</span>
            <span>{advancedOpen ? '−' : '+'}</span>
          </button>
          {advancedOpen && (
            <div className="mt-3 grid grid-cols-2 gap-3 border border-border rounded p-3 bg-surface-light">
              <label className="block text-xs">
                Schedule speed (parent)
                <select
                  value={parentSpeedId ?? ''}
                  onChange={(e) => setParentSpeedId(e.target.value ? Number(e.target.value) : null)}
                  className="mt-1 w-full px-2 py-1 border border-border rounded"
                >
                  <option value="">- inherit -</option>
                  {(lookupsQuery.data?.speeds ?? []).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs">
                Delivery state
                <select
                  value={deliveryState ?? ''}
                  onChange={(e) => setDeliveryState(e.target.value ? Number(e.target.value) : null)}
                  className="mt-1 w-full px-2 py-1 border border-border rounded"
                >
                  <option value="">- default -</option>
                  {(lookupsQuery.data?.deliveryStates ?? []).map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs">
                Drop-off location (schedule)
                <select
                  value={dropOffLocationId ?? ''}
                  onChange={(e) => setDropOffLocationId(e.target.value ? Number(e.target.value) : null)}
                  className="mt-1 w-full px-2 py-1 border border-border rounded"
                >
                  <option value="">- default -</option>
                  {(lookupsQuery.data?.dropOffLocations ?? [])
                    .filter((d) => !derived.pickupDepotId || d.depotId === derived.pickupDepotId)
                    .map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                </select>
              </label>
              <label className="block text-xs">
                Collection zone group
                <select
                  value={pickupPostcodeGroupId ?? ''}
                  onChange={(e) => setPickupPostcodeGroupId(e.target.value ? Number(e.target.value) : null)}
                  className="mt-1 w-full px-2 py-1 border border-border rounded"
                >
                  <option value="">- default pickup group -</option>
                  {(lookupsQuery.data?.postcodeGroups ?? [])
                    .filter((g) => !derived.pickupDepotId || g.depotId === derived.pickupDepotId)
                    .map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                </select>
              </label>
              <label className="col-span-2 flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={bookPickup}
                  onChange={(e) => setBookPickup(e.target.checked)}
                  className="accent-brand-cyan"
                />
                Book collection job (creates a separate collection job at booking time)
              </label>
              <label className="col-span-2 flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={applyPickupCutoff}
                  onChange={(e) => setApplyPickupCutoff(e.target.checked)}
                  className="accent-brand-cyan"
                />
                Apply pickup cutoff (courier must arrive by N hours before delivery)
              </label>
              {applyPickupCutoff && (
                <label className="block text-xs">
                  Pickup cutoff (hours)
                  <input
                    type="number"
                    min={0}
                    value={pickupCutoff ?? ''}
                    onChange={(e) => setPickupCutoff(e.target.value === '' ? null : Number(e.target.value))}
                    className="mt-1 w-full px-2 py-1 border border-border rounded"
                    placeholder="e.g. 4"
                  />
                </label>
              )}
            </div>
          )}
        </div>

        <div className="col-span-2 block">
          <span className="text-xs uppercase tracking-wide text-text-muted">
            Individual postcodes
            <span className="text-text-muted normal-case ml-2">
              (on top of the delivery zone group)
            </span>
          </span>
          <div className="mt-1">
            <PostcodeLookupInput
              selected={postcodeIds}
              onChange={setPostcodeIds}
              enabled={open}
            />
          </div>
        </div>

        <div className="col-span-2 block">
          <span className="text-xs uppercase tracking-wide text-text-muted">
            Coverage polygons
            <span className="text-text-muted normal-case ml-2">
              (bind polygons drawn in Polygon Builder; click the map or the list)
            </span>
          </span>
          <div className="mt-1 grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-3">
            <div>
              {polygonsQuery.isLoading && (
                <div className="p-3 text-xs text-text-muted italic border border-border rounded-lg">
                  Loading polygons...
                </div>
              )}
              {polygonsQuery.isError && !polygonsQuery.isLoading && (
                <div className="p-3 text-xs text-error border border-error/30 rounded-lg">
                  Failed to load polygons: {(polygonsQuery.error as Error).message}
                </div>
              )}
              {!polygonsQuery.isLoading && !polygonsQuery.isError && (
                <ScheduleCoverageMap
                  polygons={polygonsQuery.data ?? []}
                  selectedIds={polygonIds}
                  onToggle={togglePolygon}
                  boundPostcodes={postcodeIds}
                  activeZones={derived.zones}
                  // MUST be a depot id (not a region id). Same fix as
                  // ScheduleDetailModal - see audit CRITICAL #5 in the
                  // 2026-09-17 review.
                  destinationDepotId={derived.pickupDepotId ?? null}
                  isUsTenant={auth.isUsTenant}
                  googleMapsKey={auth.googleMapsKey}
                />
              )}
            </div>
            <div className="max-h-[360px] overflow-y-auto border border-border rounded">
              {polygonsQuery.data?.length === 0 && (
                <div className="p-3 text-xs text-text-muted italic">
                  No polygons defined yet. Draw one in Polygon Builder.
                </div>
              )}
              {polygonsQuery.data?.map((p) => {
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
                      onChange={() => togglePolygon(p.polygonId)}
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
        </div>

        <div className="col-span-2 block">
          <span className="text-xs uppercase tracking-wide text-text-muted">Clients</span>
          <div className="mt-1 space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={clientMode === 'all'}
                onChange={() => setClientMode('all')}
                className="accent-brand-cyan"
              />
              All clients (default)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={clientMode === 'specific'}
                onChange={() => setClientMode('specific')}
                className="accent-brand-cyan"
              />
              Specific clients
            </label>
            {clientMode === 'specific' && (
              <div className="pl-6">
                <ClientMultiPicker
                  selected={clientIds}
                  onChange={setClientIds}
                  placeholder="Pick clients..."
                  triggerWidth="w-full"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="mt-4 text-xs text-text-muted italic">
        Save picks up the first Collection leg's pickup depot, every Linehaul
        leg (with its per-leg speed override + amount + add-on % + charging
        flags), and the Delivery leg's region + speed + zone group + zones.
      </p>
    </Modal>
  );
}
