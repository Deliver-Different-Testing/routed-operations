import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useToast } from '../../context/ToastContext';
import { bulkPolygonService, type BulkPolygon, type PolygonAppCode } from '../../services/bulkPolygonService';
import { polygonsForApp } from '../../lib/polygonAppFilter';
import { territoryService } from '../../services/territoryService';

type Target =
  | { kind: 'zoneName'; id: number; label: string }
  | { kind: 'postcodeGroup'; id: number; label: string };

interface Props {
  open: boolean;
  onClose: () => void;
  target: Target;
}

/**
 * Attach existing coverage shapes to a ZoneName (US, or the rating zones of
 * NZ/AU) or to a zone of a postcode group. Drawing new shapes still happens in Polygon Builder; operators attach
 * them here.
 *
 * The two axes are not the same shape of thing and the UI says so.
 *
 *  * A US ZoneName binding is one column on the shape, so it is a checkbox and
 *    a shape can carry only one.
 *  * Group membership is a row per (group, shape) carrying the zone number it
 *    joined, so it is a zone dropdown. The same shape can be Zone 4 in
 *    Auckland's group and Zone 2 in a client's group at once, which is why
 *    picking a zone here never removes it from another group.
 *
 * The zone list is the group's own zones, matching how Polygon Builder places
 * a shape. The server refuses a zone that would overlap a shape already in a
 * different zone of the same group and names it, and that wording is shown
 * verbatim rather than being reworded here.
 *
 * Perimeter spec 4.5: the list is filtered by app. A zone group's zones are
 * the Schedules axis (SCHEDULES, Q3); a ZoneName is zone rating
 * (ZONE_RATING). A shape already bound to this target is listed whatever its
 * tags (Q2) and stays listed for the life of the modal, so unbinding it does
 * not make the row vanish. Binding a shape tags it on the server (Q1).
 */
export function BindPolygonsModal({ open, onClose, target }: Props) {
  const toast = useToast();
  const [polygons, setPolygons] = useState<BulkPolygon[]>([]);
  const [zones, setZones] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [q, setQ] = useState('');
  // Shapes seen bound to this target since the modal opened (Q2).
  const [keepIds, setKeepIds] = useState<Set<number>>(new Set());
  const app: PolygonAppCode = target.kind === 'zoneName' ? 'ZONE_RATING' : 'SCHEDULES';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await bulkPolygonService.list();
      const rows = res.response ?? [];
      setPolygons(rows);
      const bound = rows.filter((p) => target.kind === 'zoneName'
        ? p.zoneNameId === target.id
        : (p.zoneMemberships ?? []).some((m) => m.postcodeGroupId === target.id));
      if (bound.length > 0) {
        setKeepIds((prev) => new Set([...prev, ...bound.map((p) => p.polygonId)]));
      }
      if (target.kind === 'postcodeGroup') {
        const detail = await territoryService.postcodeGroupDetail(target.id);
        setZones((detail.response.zones ?? []).map((z) => z.zone));
      }
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setLoading(false); }
  }, [target, toast]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  const filtered = useMemo(() => {
    const forApp = polygonsForApp(polygons, app, keepIds);
    const needle = q.trim().toLowerCase();
    if (!needle) return forApp;
    return forApp.filter((p) => (p.name ?? '').toLowerCase().includes(needle));
  }, [polygons, app, keepIds, q]);

  /** The membership row this shape has in the target group, if any. */
  const membershipFor = (p: BulkPolygon) =>
    target.kind === 'postcodeGroup'
      ? (p.zoneMemberships ?? []).find((m) => m.postcodeGroupId === target.id) ?? null
      : null;

  const toggleZoneNameBind = async (polygon: BulkPolygon, shouldBeBound: boolean) => {
    setSaving(polygon.polygonId);
    try {
      const res = await territoryService.bindPolygon(polygon.polygonId, {
        zoneNameId: shouldBeBound ? target.id : null,
      });
      setPolygons((prev) => prev.map((p) => p.polygonId === polygon.polygonId
        ? { ...p, zoneNameId: res.response.zoneNameId }
        : p));
      if (shouldBeBound) setKeepIds((prev) => new Set(prev).add(polygon.polygonId));
      toast.show(shouldBeBound ? 'Polygon bound' : 'Polygon unbound', 'success');
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setSaving(null); }
  };

  const setZone = async (polygon: BulkPolygon, zone: number | null) => {
    if (target.kind !== 'postcodeGroup') return;
    const existing = membershipFor(polygon);
    setSaving(polygon.polygonId);
    try {
      if (zone == null) {
        if (existing) {
          await bulkPolygonService.removeFromZone(existing.id);
          toast.show(`"${polygon.name}" removed from ${target.label}`, 'success');
        }
      } else {
        await bulkPolygonService.addToZone(polygon.polygonId, target.id, zone);
        toast.show(`"${polygon.name}" is now zone ${zone} of ${target.label}`, 'success');
      }
      // Re-read rather than patch locally: the server may have moved the shape
      // between zones of this group, and the overlap rule means a refused
      // change must not leave the dropdown showing the value that failed.
      await load();
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setSaving(null); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={target.kind === 'postcodeGroup'
        ? `Polygons in ${target.label}`
        : `Bind polygons to ${target.label}`}
      size="2xl"
      footer={
        <div className="flex justify-end">
          <Button variant="neutral" onClick={onClose}>Close</Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        {target.kind === 'postcodeGroup' && (
          <p className="text-xs text-text-muted">
            Pick which zone of this group each shape belongs to. A shape can be in a
            different zone of another group at the same time, so choosing a zone here
            does not take it out of anywhere else.
          </p>
        )}
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search polygons..."
          data-testid="bind-polygon-search"
          className="w-full border border-border rounded-lg px-3 py-1.5 text-xs bg-surface-white focus:outline-none focus:ring-1 focus:ring-brand-cyan"
        />
        {target.kind === 'postcodeGroup' && !loading && zones.length === 0 && (
          <p className="text-xs text-brand-orange">
            This group has no zones yet. Add postcodes to a zone first, then a shape
            has somewhere to join.
          </p>
        )}
        <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-white">
          {loading && <div className="p-6 text-center text-xs text-text-muted italic">Loading...</div>}
          {!loading && filtered.length === 0 && (
            <div className="p-6 text-center text-xs text-text-muted italic">
              No polygons available to {app === 'ZONE_RATING' ? 'Zone rating' : 'Schedules'}.
            </div>
          )}
          {filtered.map((p) => {
            const busy = saving === p.polygonId;
            const membership = membershipFor(p);
            // Where else this shape already sits, so picking a zone here reads
            // as adding rather than moving.
            const elsewhere = target.kind === 'postcodeGroup'
              ? (p.zoneMemberships ?? []).filter((m) => m.postcodeGroupId !== target.id)
              : [];
            const otherAxisChip = target.kind === 'zoneName' && (p.zoneMemberships ?? []).length > 0
              ? `in ${(p.zoneMemberships ?? []).length} zone group${(p.zoneMemberships ?? []).length === 1 ? '' : 's'}`
              : target.kind === 'postcodeGroup' && p.zoneNameId != null
                ? `also bound to zone ${p.zoneNameId}`
                : null;
            return (
              <div
                key={p.polygonId}
                data-testid={`bind-polygon-row-${p.polygonId}`}
                className="flex items-center gap-3 px-3 py-2 border-b border-border-light last:border-b-0 hover:bg-surface-cream"
              >
                {target.kind === 'zoneName' ? (
                  <input
                    type="checkbox"
                    checked={p.zoneNameId === target.id}
                    disabled={busy}
                    aria-label={`Bind ${p.name}`}
                    onChange={(e) => toggleZoneNameBind(p, e.target.checked)}
                  />
                ) : (
                  <select
                    value={membership?.zone ?? ''}
                    disabled={busy || zones.length === 0}
                    aria-label={`Zone for ${p.name}`}
                    data-testid={`bind-polygon-zone-${p.polygonId}`}
                    onChange={(e) => setZone(p, e.target.value ? Number(e.target.value) : null)}
                    className="text-xs border border-border rounded px-1.5 py-1 bg-surface-white disabled:opacity-40"
                  >
                    <option value="">Not in this group</option>
                    {zones.map((z) => <option key={z} value={z}>Zone {z}</option>)}
                  </select>
                )}
                <span className="text-sm font-medium text-text-primary flex-1">{p.name}</span>
                {elsewhere.length > 0 && (
                  <span
                    className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-brand-cyan/15 text-brand-cyan whitespace-nowrap"
                    title={elsewhere.map((m) => `${m.postcodeGroupName}: zone ${m.zone}`).join(', ')}>
                    also in {elsewhere.length} other group{elsewhere.length === 1 ? '' : 's'}
                  </span>
                )}
                {otherAxisChip && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-brand-orange/15 text-brand-orange whitespace-nowrap">
                    {otherAxisChip}
                  </span>
                )}
                {p.attachedScheduleNames.length > 0 && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-brand-purple/15 text-brand-purple whitespace-nowrap"
                    title={p.attachedScheduleNames.join(', ')}>
                    {p.attachedScheduleNames.length} schedule{p.attachedScheduleNames.length === 1 ? '' : 's'}
                  </span>
                )}
                <span className="text-[11px] text-text-muted">
                  {p.attachedRouteCount} route{p.attachedRouteCount === 1 ? '' : 's'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
