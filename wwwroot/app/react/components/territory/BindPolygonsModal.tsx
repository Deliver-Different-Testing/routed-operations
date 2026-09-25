import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useToast } from '../../context/ToastContext';
import { bulkPolygonService, type BulkPolygon } from '../../services/bulkPolygonService';
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
 * Bind existing coverage polygons to a US ZoneName or a PostcodeGroup.
 * Preserves the polygon's OTHER-axis binding on toggle (previously
 * silently cleared it; the fix reads ZoneNameId / PostcodeGroupId
 * from the polygon list response and passes the untouched field back
 * through the bind call).
 *
 * Drawing new polygons still happens in Polygon Builder; operators
 * bind them here.
 */
export function BindPolygonsModal({ open, onClose, target }: Props) {
  const toast = useToast();
  const [polygons, setPolygons] = useState<BulkPolygon[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      try {
        const res = await bulkPolygonService.list();
        setPolygons(res.response ?? []);
      } catch (e) { toast.show((e as Error).message, 'error'); }
      finally { setLoading(false); }
    })();
  }, [open, toast]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return polygons;
    return polygons.filter((p) => (p.name ?? '').toLowerCase().includes(needle));
  }, [polygons, q]);

  const isBoundToTarget = (p: BulkPolygon): boolean => {
    if (target.kind === 'zoneName') return p.zoneNameId === target.id;
    return p.postcodeGroupId === target.id;
  };

  const toggleBind = async (polygon: BulkPolygon, shouldBeBound: boolean) => {
    setSaving(polygon.polygonId);
    try {
      // Preserve the OTHER-axis binding. This is the fix for the
      // previous bug where saving a zoneName binding would silently
      // clear an existing postcodeGroup binding (and vice versa).
      const nextZoneNameId = target.kind === 'zoneName'
        ? (shouldBeBound ? target.id : null)
        : polygon.zoneNameId; // preserve
      const nextPostcodeGroupId = target.kind === 'postcodeGroup'
        ? (shouldBeBound ? target.id : null)
        : polygon.postcodeGroupId; // preserve

      const res = await territoryService.bindPolygon(polygon.polygonId, {
        zoneNameId: nextZoneNameId,
        postcodeGroupId: nextPostcodeGroupId,
      });
      // Merge the fresh binding state back into the local list so the
      // checkbox + any "also bound to X" chip re-renders correctly.
      setPolygons((prev) => prev.map((p) => p.polygonId === polygon.polygonId
        ? { ...p, zoneNameId: res.response.zoneNameId, postcodeGroupId: res.response.postcodeGroupId }
        : p));
      toast.show(shouldBeBound ? 'Polygon bound' : 'Polygon unbound', 'success');
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setSaving(null); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Bind polygons to ${target.label}`}
      size="2xl"
      footer={
        <div className="flex justify-end">
          <Button variant="neutral" onClick={onClose}>Close</Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search polygons..."
          className="w-full border border-border rounded-lg px-3 py-1.5 text-xs bg-surface-white focus:outline-none focus:ring-1 focus:ring-brand-cyan"
        />
        <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-white">
          {loading && <div className="p-6 text-center text-xs text-text-muted italic">Loading...</div>}
          {!loading && filtered.length === 0 && (
            <div className="p-6 text-center text-xs text-text-muted italic">No polygons.</div>
          )}
          {filtered.map((p) => {
            const bound = isBoundToTarget(p);
            const busy = saving === p.polygonId;
            // Show a chip when the polygon is ALSO bound to the other
            // axis so the operator understands they're not clearing
            // that binding.
            const otherAxisChip = target.kind === 'zoneName' && p.postcodeGroupId != null
              ? `also bound to postcode group ${p.postcodeGroupId}`
              : target.kind === 'postcodeGroup' && p.zoneNameId != null
                ? `also bound to zone ${p.zoneNameId}`
                : null;
            return (
              <label
                key={p.polygonId}
                className="flex items-center gap-3 px-3 py-2 border-b border-border-light last:border-b-0 hover:bg-surface-cream cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={bound}
                  disabled={busy}
                  onChange={(e) => toggleBind(p, e.target.checked)}
                />
                <span className="text-sm font-medium text-text-primary flex-1">{p.name}</span>
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
              </label>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
