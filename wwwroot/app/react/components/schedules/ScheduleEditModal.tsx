import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import {
  scheduleService,
  type ScheduleGroup,
  type ScheduleLookups,
  type ScheduleGroupUpsertBody,
  type DayWindow,
} from '../../services/scheduleService';
import { bulkPolygonService, type BulkPolygon } from '../../services/bulkPolygonService';
import { depotLabel, postcodeGroupLabel, postcodeLabel, postcodePluralLabel } from '../../lib/tenantLabels';
import { ClientMultiPicker } from './ClientMultiPicker';
import { ScheduleCoverageMap } from './ScheduleCoverageMap';
import { LinehaulRunModal } from './LinehaulRunModal';
import type { LinehaulRunLookup } from '../../services/scheduleService';

// ─── constants ─────────────────────────────────────────────────────────────

const DAY_LABELS_LONG = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
type LinehaulDraft = ScheduleGroupUpsertBody['linehauls'][number];

const emptyLinehaul = (): LinehaulDraft => ({
  name: '', active: true, amount: 0, amountPercentage: 0,
  fromDepotId: null, toDepotId: null, minutes: null, linehaulRunId: null,
  insertToBulk: true, applyDiscount: false, applyAddOnPercentage: false,
  weekDay: [0, 0, 0, 0, 0, 0, 0],
  departureAdvanceDays: null, fromClientAddress: false, dropOffLocationId: null,
  speedId: null,
});

// ─── props ─────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  /** null = create a new group; otherwise editing this group. */
  group: ScheduleGroup | null;
  lookups: ScheduleLookups | null;
  onSaved: (row: ScheduleGroup) => void;
}

/**
 * Full-body schedule GROUP edit modal. A group is (Name, ClientId?)
 * identity holding N day-windows plus template fields shared across
 * days. Field parity with legacy schedulesView.html, but rearranged
 * for the new grouped model.
 *
 * Sections (top to bottom):
 *   * Schedule       - name, speeds, collection/destination depots, active zones
 *   * Collection     - pickup group / speed / drop-off / storage / delivery / discount
 *   * Active Days & Window - 7-row table (one per weekday) with per-day
 *                            Start / End / Cutoff. Unticking = delete on save
 *   * Clients        - multi-select of clients this group applies to
 *   * Postcodes      - individual postcodes bound to this group (on top of the
 *                      postcode-group dropdown default)
 *   * Coverage Polygons - polygons bound to this group
 *   * Linehaul Legs  - unchanged from before
 *   * Delivery       - delivery speed + delivery-zones postcode group
 *   * Notes          - description + auto-book
 */
export function ScheduleEditModal({ open, onClose, group, lookups, onSaved }: Props) {
  const toast = useToast();
  const user = useAuth();
  const isUs = user.isUsTenant;
  // Tenant-aware labels. Modal has several depot / group / postcode
  // references - all switch between NZ (Depot / Postcode Group /
  // Postcode) and US (Location / Zip Group / Zip).
  const depotSingular = depotLabel(isUs, false);
  const groupSingular = postcodeGroupLabel(isUs, false);
  const postcodePlural = postcodePluralLabel(isUs);
  const postcodeSingular = postcodeLabel(isUs, true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ScheduleGroupUpsertBody>(() => toForm(null));
  const isNew = group === null;

  // Available polygons for the coverage picker. Fetched lazily on first
  // open; the modal caches the result so re-opening doesn't refetch.
  const [polygons, setPolygons] = useState<BulkPolygon[] | null>(null);

  // Local mirror of lookups.linehaulRuns so the nested LinehaulRunModal
  // can mutate it (add / update / delete) without a full lookups refetch.
  // Reset when lookups reloads (schedule editor re-opens with fresh lookups).
  const [linehaulRuns, setLinehaulRuns] = useState<LinehaulRunLookup[]>(lookups?.linehaulRuns ?? []);
  useEffect(() => { setLinehaulRuns(lookups?.linehaulRuns ?? []); }, [lookups?.linehaulRuns]);
  const [runModalOpen, setRunModalOpen] = useState(false);

  useEffect(() => {
    setForm(toForm(group));
  }, [group, open]);

  useEffect(() => {
    if (!open || polygons !== null) return;
    (async () => {
      try {
        const res = await bulkPolygonService.list();
        setPolygons(res.response ?? []);
      } catch (e) { toast.show((e as Error).message, 'error'); }
    })();
  }, [open, polygons, toast]);

  const zoneNumbers = lookups?.zoneNumbers ?? [];
  const zoneActive = useMemo(() => {
    const map = new Map<number, boolean>();
    for (const z of form.zones) map.set(z.zone, z.active ?? false);
    return map;
  }, [form.zones]);

  const toggleZone = (zone: number, active: boolean) => {
    setForm((f) => {
      const others = f.zones.filter((z) => z.zone !== zone);
      return { ...f, zones: [...others, { zone, active }] };
    });
  };

  // ─── day-window helpers ────────────────────────────────────────────
  const dayWindowsByDay = useMemo(() => {
    const map = new Map<number, ScheduleGroupUpsertBody['dayWindows'][number]>();
    for (const w of form.dayWindows) map.set(w.dayOfWeek, w);
    return map;
  }, [form.dayWindows]);

  const setDayActive = (dayOfWeek: number, active: boolean) => {
    setForm((f) => {
      if (!active) {
        return { ...f, dayWindows: f.dayWindows.filter((w) => w.dayOfWeek !== dayOfWeek) };
      }
      if (f.dayWindows.some((w) => w.dayOfWeek === dayOfWeek)) return f;
      return {
        ...f,
        dayWindows: [...f.dayWindows, {
          id: null, dayOfWeek, startTime: '08:00', endTime: '17:00', cutoffHours: 0,
        }].sort((a, b) => a.dayOfWeek - b.dayOfWeek),
      };
    });
  };

  const updateDayWindow = (dayOfWeek: number, patch: Partial<DayWindow>) => {
    setForm((f) => ({
      ...f,
      dayWindows: f.dayWindows.map((w) => w.dayOfWeek === dayOfWeek ? { ...w, ...patch } : w),
    }));
  };

  // ─── junction helpers (clients / postcodes / polygons) ─────────────
  // Clients are toggled by CODE (operator-facing). The backend accepts
  // clientCodes on the upsert body and resolves them to ids server-side.
  const toggleClient = (code: string) => setForm((f) => {
    const has = f.clientCodes.includes(code);
    return {
      ...f,
      clientCodes: has ? f.clientCodes.filter((x) => x !== code) : [...f.clientCodes, code].sort(),
    };
  });
  const togglePolygon = (id: number) => setForm((f) => ({
    ...f,
    polygonIds: f.polygonIds.includes(id) ? f.polygonIds.filter((x) => x !== id) : [...f.polygonIds, id].sort((a, b) => a - b),
  }));
  const removePostcode = (p: number) => setForm((f) => ({
    ...f, postcodeIds: f.postcodeIds.filter((x) => x !== p),
  }));
  const [postcodeInput, setPostcodeInput] = useState('');
  const addPostcode = () => {
    const p = Number(postcodeInput.trim());
    if (!Number.isFinite(p) || p <= 0) return;
    setForm((f) => ({
      ...f,
      postcodeIds: f.postcodeIds.includes(p) ? f.postcodeIds : [...f.postcodeIds, p].sort((a, b) => a - b),
    }));
    setPostcodeInput('');
  };

  // Client picker uses ClientMultiPicker (server-side search) - the
  // legacy client-side filter over lookups.clients missed any client
  // whose code fell past the 500-row alphabetical cap.

  // ─── linehaul helpers ──────────────────────────────────────────────
  const addLinehaul = () => setForm((f) => ({ ...f, linehauls: [...f.linehauls, emptyLinehaul()] }));
  const removeLinehaul = (i: number) =>
    setForm((f) => ({ ...f, linehauls: f.linehauls.filter((_, idx) => idx !== i) }));
  const updateLinehaul = (i: number, patch: Partial<LinehaulDraft>) =>
    setForm((f) => ({
      ...f,
      linehauls: f.linehauls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await scheduleService.upsert(form);
      onSaved(res.response);
      toast.show(isNew ? 'Schedule created' : 'Schedule updated', 'success');
      onClose();
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setSaving(false); }
  };

  if (!open) return null;

  const depots = lookups?.depots ?? [];
  const speeds = lookups?.speeds ?? [];
  const dropOffs = lookups?.dropOffLocations ?? [];
  const postcodeGroups = lookups?.postcodeGroups ?? [];
  const storageStates = lookups?.storageStates ?? [];
  const deliveryStates = lookups?.deliveryStates ?? [];
  const pickupBoxDiscounts = lookups?.pickupBoxDiscounts ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="6xl"
      title={isNew ? 'New schedule' : `Edit "${group?.name ?? ''}"`}
      loading={saving}
      loadingMessage={isNew ? 'Creating schedule...' : 'Saving schedule...'}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="secondary" data-primary="true" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : (isNew ? 'Create' : 'Save')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">

        {/* ─── Schedule identity ────────────────────────────────────── */}
        <Section title="Schedule">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            <Field label="Name" required>
              <input className={INPUT_CLASS} value={form.name} autoFocus
                placeholder="e.g. AKL > WRG Regional Run"
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </Field>
            <Field label="Schedule Speed (optional)">
              <select className={INPUT_CLASS} value={form.parentSpeedId ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, parentSpeedId: e.target.value ? Number(e.target.value) : null }))}>
                <option value="">Choose a speed...</option>
                {speeds.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label={`Collection ${depotSingular}`}>
              <select className={INPUT_CLASS} value={form.pickupDepotId ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, pickupDepotId: e.target.value ? Number(e.target.value) : null }))}>
                <option value="">Collect from Client Address</option>
                {depots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label={`Destination ${depotSingular}`} required>
              <select className={INPUT_CLASS} value={form.regionId || ''}
                onChange={(e) => setForm((f) => ({ ...f, regionId: Number(e.target.value) }))}>
                <option value="">Choose a {depotSingular.toLowerCase()}...</option>
                {depots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Active Zones">
            <div className="flex flex-wrap gap-2">
              {zoneNumbers.length === 0 && (
                <span className="text-[11px] text-text-muted italic">No zones defined for this tenant.</span>
              )}
              {zoneNumbers.map((zone) => {
                const checked = zoneActive.get(zone) ?? false;
                return (
                  <label key={zone}
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium cursor-pointer border ${
                      checked ? 'bg-brand-cyan/15 text-brand-cyan border-brand-cyan/30'
                              : 'bg-surface-cream text-text-muted border-border'}`}>
                    <input type="checkbox" className="w-3 h-3" checked={checked}
                      onChange={(e) => toggleZone(zone, e.target.checked)} />
                    Zone {zone}
                  </label>
                );
              })}
            </div>
          </Field>
        </Section>

        {/* ─── Collection ───────────────────────────────────────────── */}
        <Section title="Collection">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            <Field label="Book Collection Job">
              <label className="inline-flex items-center gap-2 text-sm py-1.5">
                <input type="checkbox" checked={form.bookPickup ?? false}
                  onChange={(e) => setForm((f) => ({ ...f, bookPickup: e.target.checked }))} />
                Enabled
              </label>
            </Field>
            <Field label={`Collection ${groupSingular}`}>
              <select className={INPUT_CLASS} value={form.pickupPostcodeGroupId ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, pickupPostcodeGroupId: e.target.value ? Number(e.target.value) : null }))}>
                <option value="">Default Pickup {groupSingular}</option>
                {postcodeGroups
                  .filter((g) => !form.pickupDepotId || g.depotId === form.pickupDepotId)
                  .map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </Field>
            <Field label="Collection Speed">
              <select className={INPUT_CLASS} value={form.pickupRatingSpeed ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, pickupRatingSpeed: e.target.value ? Number(e.target.value) : null }))}>
                <option value="">Choose...</option>
                {speeds.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Drop-off Location">
              <select className={INPUT_CLASS} value={form.dropOffLocationId ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, dropOffLocationId: e.target.value ? Number(e.target.value) : null }))}>
                <option value="">Choose...</option>
                {dropOffs
                  .filter((d) => !form.pickupDepotId || d.depotId === form.pickupDepotId)
                  .map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            <Field label="Apply Pickup Cutoff">
              <label className="inline-flex items-center gap-2 text-sm py-1.5">
                <input type="checkbox" checked={form.applyPickupCutoff ?? false}
                  onChange={(e) => setForm((f) => ({ ...f, applyPickupCutoff: e.target.checked }))} />
                Enabled
              </label>
            </Field>
            <Field label="Pickup Minutes">
              <input type="number" className={INPUT_CLASS} value={form.pickupCutoff ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, pickupCutoff: e.target.value ? Number(e.target.value) : null }))} />
            </Field>
            <Field label="Storage State">
              <select className={INPUT_CLASS} value={form.storageState ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, storageState: e.target.value ? Number(e.target.value) : null }))}>
                <option value="">Choose...</option>
                {storageStates.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Delivery State">
              <select className={INPUT_CLASS} value={form.deliveryState ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, deliveryState: e.target.value ? Number(e.target.value) : null }))}>
                <option value="">Choose...</option>
                {deliveryStates.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            <Field label="Collection Box Discount">
              <select className={INPUT_CLASS} value={form.pickupBoxDiscount ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, pickupBoxDiscount: e.target.value ? Number(e.target.value) : null }))}>
                <option value="">Choose...</option>
                {pickupBoxDiscounts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </Field>
          </div>
        </Section>

        {/* ─── Active Days & Window (per-day times) ─────────────────── */}
        <Section title="Active Days & Window">
          <div className="text-[11px] text-text-muted mb-2">
            Each active day carries its own start time, end time, and cutoff.
            Untick a day to remove that window on save.
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-cream border-b border-border">
                <tr className="text-left text-[11px] font-semibold text-text-muted">
                  <th className="px-2 py-1.5 w-16">Active</th>
                  <th className="px-2 py-1.5 w-20">Day</th>
                  <th className="px-2 py-1.5">Start Time</th>
                  <th className="px-2 py-1.5">End Time</th>
                  <th className="px-2 py-1.5">Cutoff Hours</th>
                </tr>
              </thead>
              <tbody>
                {DAY_LABELS_LONG.map((label, i) => {
                  const dayOfWeek = i + 1; // 1=Mon..7=Sun
                  const window = dayWindowsByDay.get(dayOfWeek);
                  const active = !!window;
                  return (
                    <tr key={dayOfWeek} className={`border-b border-border-light last:border-b-0 ${active ? '' : 'bg-surface-cream/40'}`}>
                      <td className="px-2 py-1.5">
                        <input type="checkbox" checked={active}
                          onChange={(e) => setDayActive(dayOfWeek, e.target.checked)} />
                      </td>
                      <td className="px-2 py-1.5 font-medium">{label}</td>
                      <td className="px-2 py-1.5">
                        <input type="time" className={INPUT_CLASS} value={window?.startTime ?? ''}
                          disabled={!active}
                          onChange={(e) => updateDayWindow(dayOfWeek, { startTime: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="time" className={INPUT_CLASS} value={window?.endTime ?? ''}
                          disabled={!active}
                          onChange={(e) => updateDayWindow(dayOfWeek, { endTime: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" className={INPUT_CLASS} value={window?.cutoffHours ?? ''}
                          disabled={!active}
                          onChange={(e) => updateDayWindow(dayOfWeek, { cutoffHours: Number(e.target.value) })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ─── Clients (multi-select, server-side search) ───────────── */}
        <Section title="Clients">
          <div className="text-[11px] text-text-muted mb-2">
            Which clients this schedule applies to. Empty = default schedule (applies to any client without a client-specific override).
            Type to search - matches on client code OR name.
          </div>
          <ClientMultiPicker
            selectedCodes={new Set(form.clientCodes)}
            onToggle={toggleClient}
            initialList={lookups?.clients}
          />
        </Section>

        {/* ─── Individual postcode / zip bindings ───────────────────── */}
        <Section title={postcodePlural}>
          <div className="text-[11px] text-text-muted mb-2">
            Individual {postcodePlural.toLowerCase()} bound to this schedule (on top of the {groupSingular.toLowerCase()} dropdown above). Resolver union: schedule covers a {postcodeSingular.toLowerCase()} if it's in the bound group OR in this list.
          </div>
          <div className="flex items-center gap-2 mb-2">
            <input
              type="number"
              value={postcodeInput}
              onChange={(e) => setPostcodeInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addPostcode())}
              placeholder={`Add ${postcodeSingular.toLowerCase()}...`}
              className={INPUT_CLASS + ' w-40'}
            />
            <Button variant="neutral" size="sm" onClick={addPostcode}>Add</Button>
          </div>
          {form.postcodeIds.length === 0 && (
            <div className="text-[11px] text-text-muted italic">
              No individual {postcodePlural.toLowerCase()} bound.
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {form.postcodeIds.map((p) => (
              <span key={p} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-brand-cyan/15 text-brand-cyan font-mono">
                {String(p).padStart(4, '0')}
                <button type="button" className="ml-1 hover:opacity-70" onClick={() => removePostcode(p)}>x</button>
              </span>
            ))}
          </div>
        </Section>

        {/* ─── Coverage Polygons (map + picker) ─────────────────────── */}
        <Section title="Coverage Polygons">
          <div className="text-[11px] text-text-muted mb-2">
            Bind coverage polygons to this schedule. Click on the map to bind or unbind, or use the checkbox list on the right. Draw a new polygon inline, or open the full toolkit in <a href="/polygon-builder" target="_blank" rel="noopener noreferrer" className="text-brand-cyan underline">Polygon Builder</a>.
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-3">
            <div>
              {polygons === null ? (
                <div className="p-3 text-[11px] text-text-muted italic border border-border rounded-lg">Loading polygons...</div>
              ) : (
                <ScheduleCoverageMap
                  polygons={polygons}
                  selectedIds={form.polygonIds}
                  onToggle={togglePolygon}
                  boundPostcodes={form.postcodeIds}
                  activeZones={form.zones.filter((z) => z.active === true).map((z) => z.zone)}
                  destinationDepotId={form.regionId || null}
                  isUsTenant={isUs}
                  googleMapsKey={user.googleMapsKey}
                />
              )}
            </div>
            <div className="max-h-[360px] overflow-y-auto rounded-lg border border-border bg-white">
              {polygons?.length === 0 && (
                <div className="p-3 text-[11px] text-text-muted italic">No polygons available.</div>
              )}
              {polygons?.map((p) => {
                const checked = form.polygonIds.includes(p.polygonId);
                return (
                  <label key={p.polygonId}
                    className={`flex items-center gap-2 px-2 py-1 border-b border-border-light last:border-b-0 cursor-pointer hover:bg-surface-cream ${checked ? 'bg-brand-cyan/10' : ''}`}>
                    <input type="checkbox" className="w-3.5 h-3.5" checked={checked}
                      onChange={() => togglePolygon(p.polygonId)} />
                    <span className="text-xs font-medium flex-1">{p.name}</span>
                    <span className="text-[10px] text-text-muted">{p.attachedRouteCount} route{p.attachedRouteCount === 1 ? '' : 's'}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </Section>

        {/* ─── Linehauls ────────────────────────────────────────────── */}
        <Section
          title="Linehaul Legs"
          right={<Button variant="neutral" size="sm" onClick={addLinehaul}>+ Add Leg</Button>}
        >
          {form.linehauls.length === 0 && (
            <div className="text-[11px] text-text-muted italic">No linehaul legs configured.</div>
          )}
          {form.linehauls.map((l, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface-cream/40 p-3 mb-2 space-y-2">
              <div className="grid grid-cols-1 lg:grid-cols-6 gap-2 items-end">
                <Field label="Name" required>
                  <input className={INPUT_CLASS} value={l.name ?? ''}
                    onChange={(e) => updateLinehaul(i, { name: e.target.value })} />
                </Field>
                <Field label="Active">
                  <label className="inline-flex items-center gap-2 text-sm py-1.5">
                    <input type="checkbox" checked={l.active ?? false}
                      onChange={(e) => updateLinehaul(i, { active: e.target.checked })} />
                  </label>
                </Field>
                <Field label="Amount">
                  <input type="number" className={INPUT_CLASS} value={l.amount ?? ''}
                    onChange={(e) => updateLinehaul(i, { amount: e.target.value ? Number(e.target.value) : null })} />
                </Field>
                <Field label="Amount %">
                  <input type="number" step="0.01" className={INPUT_CLASS} value={l.amountPercentage ?? ''}
                    onChange={(e) => updateLinehaul(i, { amountPercentage: e.target.value ? Number(e.target.value) : null })} />
                </Field>
                <Field label="Minutes">
                  <input type="number" className={INPUT_CLASS} value={l.minutes ?? ''}
                    onChange={(e) => updateLinehaul(i, { minutes: e.target.value ? Number(e.target.value) : null })} />
                </Field>
                <div className="flex justify-end">
                  <Button variant="danger" size="sm" onClick={() => removeLinehaul(i)}>Remove</Button>
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-2">
                <Field label="From Depot">
                  <select className={INPUT_CLASS} value={l.fromDepotId ?? ''}
                    disabled={l.fromClientAddress === true}
                    onChange={(e) => updateLinehaul(i, { fromDepotId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">From Depot *</option>
                    {depots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </Field>
                <Field label="To Depot">
                  <select className={INPUT_CLASS} value={l.toDepotId ?? ''}
                    onChange={(e) => updateLinehaul(i, { toDepotId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">To Depot *</option>
                    {depots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </Field>
                <Field
                  label="Run"
                  rightAdornment={
                    <button
                      type="button"
                      className="text-[10px] text-brand-cyan hover:underline inline-flex items-center gap-0.5"
                      onClick={() => setRunModalOpen(true)}
                      title="Manage linehaul runs"
                    >
                      Edit
                    </button>
                  }
                >
                  <select className={INPUT_CLASS} value={l.linehaulRunId ?? ''}
                    onChange={(e) => updateLinehaul(i, { linehaulRunId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">Choose a Run</option>
                    {linehaulRuns.map((r) => <option key={r.id} value={r.id}>{r.runName}</option>)}
                  </select>
                </Field>
                <Field label="Drop-off Location">
                  <select className={INPUT_CLASS} value={l.dropOffLocationId ?? ''}
                    onChange={(e) => updateLinehaul(i, { dropOffLocationId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">Choose...</option>
                    {dropOffs.filter((d) => !l.toDepotId || d.depotId === l.toDepotId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </Field>
              </div>
              <div>
                <div className="text-[11px] font-semibold text-text-muted mb-1">Active Linehaul Days</div>
                <div className="flex flex-wrap gap-1.5">
                  {DAY_LABELS_LONG.map((day, di) => {
                    const on = l.weekDay[di] === 1;
                    return (
                      <label key={day}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium cursor-pointer border ${
                          on ? 'bg-brand-cyan/15 text-brand-cyan border-brand-cyan/30'
                             : 'bg-white text-text-muted border-border'}`}>
                        <input type="checkbox" className="w-3 h-3" checked={on}
                          onChange={(e) => {
                            const wd = [...l.weekDay];
                            wd[di] = e.target.checked ? 1 : 0;
                            updateLinehaul(i, { weekDay: wd });
                          }} />
                        {day}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
                <Field label="Departure Advance Days">
                  <input type="number" className={INPUT_CLASS} value={l.departureAdvanceDays ?? ''}
                    onChange={(e) => updateLinehaul(i, { departureAdvanceDays: e.target.value ? Number(e.target.value) : null })} />
                </Field>
                <label className="inline-flex items-center gap-2 text-xs mt-6">
                  <input type="checkbox" checked={l.fromClientAddress ?? false}
                    onChange={(e) => updateLinehaul(i, { fromClientAddress: e.target.checked })} />
                  Book From Client Address
                </label>
                <label className="inline-flex items-center gap-2 text-xs mt-6">
                  <input type="checkbox" checked={l.insertToBulk ?? false}
                    onChange={(e) => updateLinehaul(i, { insertToBulk: e.target.checked })} />
                  Insert To Bulk
                </label>
                <div className="flex flex-col gap-1 mt-4">
                  <label className="inline-flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={l.applyDiscount ?? false}
                      onChange={(e) => updateLinehaul(i, { applyDiscount: e.target.checked })} />
                    Apply Discount
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={l.applyAddOnPercentage ?? false}
                      onChange={(e) => updateLinehaul(i, { applyAddOnPercentage: e.target.checked })} />
                    Apply Add-on %
                  </label>
                </div>
              </div>
            </div>
          ))}
        </Section>

        {/* ─── Delivery ─────────────────────────────────────────────── */}
        <Section title="Delivery">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Field label="Delivery Speed">
              <select className={INPUT_CLASS} value={form.speedId ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, speedId: e.target.value ? Number(e.target.value) : null }))}>
                <option value="">Choose a speed...</option>
                {speeds.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label={`Delivery Zones (${groupSingular})`}>
              <select className={INPUT_CLASS} value={form.postcodeGroupId ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, postcodeGroupId: e.target.value ? Number(e.target.value) : null }))}>
                <option value="">Default {groupSingular}</option>
                {postcodeGroups
                  .filter((g) => !form.regionId || g.depotId === form.regionId)
                  .map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </Field>
          </div>
        </Section>

        {/* ─── Notes + Auto Book ────────────────────────────────────── */}
        <Section title="Notes">
          <Field label="Description">
            <textarea className={INPUT_CLASS + ' h-16'} value={form.description ?? ''} maxLength={500}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
          <label className="inline-flex items-center gap-2 text-sm mt-2">
            <input type="checkbox" checked={form.autoBook ?? false}
              onChange={(e) => setForm((f) => ({ ...f, autoBook: e.target.checked }))} />
            Auto Book
          </label>
        </Section>
      </div>

      {/* Nested Linehaul Runs manager, opened from the "Edit" chip next to
          the Run dropdown in each linehaul leg. Parity with the legacy
          .linehaulRun-modal in ClientManager schedulesView.html. */}
      <LinehaulRunModal
        open={runModalOpen}
        onClose={() => setRunModalOpen(false)}
        runs={linehaulRuns}
        depots={depots}
        couriers={lookups?.couriers ?? []}
        onRunsChanged={setLinehaulRuns}
      />
    </Modal>
  );
}

// ─── shared bits ────────────────────────────────────────────────────────

const INPUT_CLASS =
  'w-full border border-border rounded-lg px-2 py-1.5 text-sm bg-surface-white focus:outline-none focus:ring-1 focus:ring-brand-cyan disabled:opacity-50 disabled:bg-surface-cream';

function Field({ label, required, children, rightAdornment }: {
  label: string; required?: boolean; children: React.ReactNode; rightAdornment?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <div className="text-[11px] font-semibold text-text-muted">
          {label}{required && <span className="text-red-600"> *</span>}
        </div>
        {rightAdornment}
      </div>
      {children}
    </div>
  );
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-white p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wide">{title}</h4>
        {right}
      </div>
      {children}
    </section>
  );
}

function toForm(g: ScheduleGroup | null): ScheduleGroupUpsertBody {
  if (!g) {
    return {
      scheduleId: null,
      name: '', description: '', regionId: 0, pickupDepotId: null,
      speedId: null, parentSpeedId: null,
      autoBook: false, bookPickup: false, applyPickupCutoff: false, pickupCutoff: null,
      postcodeGroupId: null, pickupPostcodeGroupId: null, pickupRatingSpeed: null,
      storageState: null, deliveryState: null, pickupBoxDiscount: null,
      dropOffLocationId: null,
      dayWindows: [], zones: [], linehauls: [],
      clientIds: [], clientCodes: [], postcodeIds: [], polygonIds: [],
    };
  }
  return {
    scheduleId: g.scheduleId,
    name: g.name ?? '',
    description: g.description,
    regionId: g.regionId,
    pickupDepotId: g.pickupDepotId,
    speedId: g.speedId,
    parentSpeedId: g.parentSpeedId,
    autoBook: g.autoBook,
    bookPickup: g.bookPickup,
    applyPickupCutoff: g.applyPickupCutoff,
    pickupCutoff: g.pickupCutoff,
    postcodeGroupId: g.postcodeGroupId,
    pickupPostcodeGroupId: g.pickupPostcodeGroupId,
    pickupRatingSpeed: g.pickupRatingSpeed,
    storageState: g.storageState,
    deliveryState: g.deliveryState,
    pickupBoxDiscount: g.pickupBoxDiscount,
    dropOffLocationId: g.dropOffLocationId,
    dayWindows: g.dayWindows.map((w) => ({
      id: w.id, dayOfWeek: w.dayOfWeek, startTime: w.startTime, endTime: w.endTime, cutoffHours: w.cutoffHours,
    })),
    zones: g.zones.map((z) => ({ zone: z.zone, active: z.active })),
    linehauls: g.linehauls.map((l) => ({
      name: l.name, active: l.active, amount: l.amount, amountPercentage: l.amountPercentage,
      fromDepotId: l.fromDepotId, toDepotId: l.toDepotId, minutes: l.minutes,
      linehaulRunId: l.linehaulRunId, insertToBulk: l.insertToBulk,
      applyDiscount: l.applyDiscount, applyAddOnPercentage: l.applyAddOnPercentage,
      weekDay: l.weekDay, departureAdvanceDays: l.departureAdvanceDays,
      fromClientAddress: l.fromClientAddress, dropOffLocationId: l.dropOffLocationId,
      speedId: l.speedId,
    })),
    // On write we prefer clientCodes (operator-facing). Ids kept for
    // internal consistency but the picker toggles by code.
    clientIds: [...g.clientIds],
    clientCodes: [...g.clientCodes],
    postcodeIds: [...g.postcodeIds],
    polygonIds: [...g.polygonIds],
  };
}
