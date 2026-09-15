import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../common/Modal';
import { scheduleService, type ScheduleGroupUpsertBody } from '../../services/scheduleService';
import { ClientMultiPicker } from './ClientMultiPicker';
import { ChainBuilder, type Leg } from './ChainBuilder';

// New Schedule modal - covers Steve's mockup "New Schedule" creator.
// Uses ChainBuilder (this session's MVP of Dane's visual leg builder)
// for the Delivery Route card; walks the leg chain to derive the flat
// fields backend UpsertAsync expects (pickupDepotId + regionId +
// speedId + linehauls).
//
// Fields:
//   - Name (required)
//   - Description (optional)
//   - Active toggle (autoBook proxy - schedule.autoBook mirrors it)
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
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(true);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [days, setDays] = useState<DayForm[]>(
    // Mon-Fri enabled by default per Steve's mockup
    [1, 2, 3, 4, 5, 6, 7].map((n) => ({ ...DEFAULT_DAY, enabled: n <= 5 })),
  );
  const [clientMode, setClientMode] = useState<'all' | 'specific'>('all');
  const [clientIds, setClientIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const lookupsQuery = useQuery({
    queryKey: ['schedules-v2-lookups'],
    queryFn: () => scheduleService.lookups().then((r) => r.response),
    staleTime: 5 * 60_000,
    enabled: open,
  });

  const createMut = useMutation({
    mutationFn: (body: ScheduleGroupUpsertBody) => scheduleService.upsert(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules-v2-list'] });
      resetAndClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const resetAndClose = () => {
    setName('');
    setDescription('');
    setActive(true);
    setLegs([]);
    setDays([1, 2, 3, 4, 5, 6, 7].map((n) => ({ ...DEFAULT_DAY, enabled: n <= 5 })));
    setClientMode('all');
    setClientIds([]);
    setError(null);
    onClose();
  };

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
          name: null,
          active: true,
          amount: leg.amount,
          amountPercentage: leg.amountPercentage,
          fromDepotId: leg.fromDepotId,
          toDepotId: leg.toDepotId,
          minutes: leg.transitMinutes || null,
          linehaulRunId: leg.linehaulRunId,
          insertToBulk: leg.insertToBulk,
          applyDiscount: leg.applyDiscount,
          applyAddOnPercentage: leg.applyAddOnPercentage,
          weekDay: days.map((d) => (d.enabled ? 1 : 0)),
          departureAdvanceDays: leg.dayOffset,
          fromClientAddress: null,
          dropOffLocationId: null,
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
      regionId: derived.regionId,
      pickupDepotId: derived.pickupDepotId,
      speedId: derived.speedId,
      parentSpeedId: null,
      autoBook: active,
      bookPickup: null,
      applyPickupCutoff: null,
      pickupCutoff: null,
      postcodeGroupId: derived.postcodeGroupId,
      pickupPostcodeGroupId: null,
      pickupRatingSpeed: derived.pickupRatingSpeed,
      storageState: derived.storageState,
      deliveryState: null,
      pickupBoxDiscount: null,
      dropOffLocationId: null,
      dayWindows: days.map((d, i) => ({
        id: null,
        dayOfWeek: i + 1,
        startTime: d.startTime,
        endTime: d.endTime,
        cutoffHours: d.cutoffHours,
      })).filter((_d, i) => days[i].enabled),
      zones: derived.zones.map((z) => ({ zone: z, active: true })),
      linehauls: derived.linehauls,
      clientIds: clientMode === 'specific' ? clientIds : [],
      clientCodes: [],
      postcodeIds: [],
      polygonIds: [],
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
        <label className="flex items-center gap-3 mt-6">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="accent-brand-cyan"
          />
          <span className="text-sm">Active (auto-book on)</span>
        </label>

        <label className="col-span-2 block">
          <span className="text-xs uppercase tracking-wide text-text-muted">Description</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
            placeholder="Book by 3 pm. Next business day service to Christchurch."
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
              }}
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
