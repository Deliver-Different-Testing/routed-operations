import { useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { StatusBadge } from '../common/StatusBadge';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { depotLabel, postcodeGroupLabel } from '../../lib/tenantLabels';
import {
  territoryService,
  postcodeGroupScope,
  type PostcodeGroupDetail,
} from '../../services/territoryService';

/** Which side of a schedule's coverage the list is showing. */
export type ScheduleSide = 'all' | 'delivery' | 'pickup';

interface Props {
  groupId: number;
  onClose: () => void;
  /** Open the small identity editor (name / depot / client code). */
  onEdit: () => void;
  /** Open the polygon binding modal for this group. */
  onBindPolygons: () => void;
  /** Which side to show on open. Set when the operator clicked the
   *  Delivery or Pickup count on the list, so the list they land on is
   *  the one whose number they clicked (Steve, 22 Oct). */
  initialSide?: ScheduleSide;
}

/**
 * Postcode / zip group detail.
 *
 * Reads as "what points at this group", because nothing on the group row
 * itself gives it force: no stored procedure reads its ClientId or
 * DepotId, and the scoping those two columns imply is applied in the
 * service layer. What makes a group matter is its members, the schedules
 * that reference it, and the polygons bound to it.
 *
 * The member list is tenant-dependent (BulkZonePostcode on NZ, ZoneZip on
 * US) but the server hands back one shape, so nothing here branches.
 */
export function PostcodeGroupDetailModal({
  groupId, onClose, onEdit, onBindPolygons, initialSide = 'all',
}: Props) {
  const toast = useToast();
  const user = useAuth();
  const groupSingular = postcodeGroupLabel(user.isUsTenant, false);
  const depotSingular = depotLabel(user.isUsTenant, false);
  const memberWord = user.isUsTenant ? 'zip' : 'postcode';

  const [detail, setDetail] = useState<PostcodeGroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [side, setSide] = useState<ScheduleSide>(initialSide);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await territoryService.postcodeGroupDetail(groupId);
        if (alive) setDetail(res.response);
      } catch (e) {
        if (alive) toast.show((e as Error).message, 'error');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [groupId]);

  const g = detail?.group ?? null;
  const scope = postcodeGroupScope(g);
  const totalSchedules = detail?.schedules.length ?? 0;
  const orphaned = !loading && detail != null
    && totalSchedules === 0 && detail.polygons.length === 0;

  // The list has to agree with the number that was clicked, so the filter
  // is on the same flags the counts are derived from rather than on a
  // separate query.
  const shownSchedules = (detail?.schedules ?? []).filter((s) =>
    side === 'all' || (side === 'delivery' ? s.usedForDelivery : s.usedForPickup));

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={g?.name ? `${groupSingular}: ${g.name}` : groupSingular}
      size="4xl"
      loading={loading}
      loadingMessage="Loading group..."
      footer={
        <div className="flex justify-between gap-2">
          <div className="flex gap-2">
            <Button variant="neutral" onClick={onEdit}>Edit details</Button>
            <Button variant="neutral" onClick={onBindPolygons}>Bind polygons</Button>
          </div>
          <Button variant="secondary" data-primary="true" onClick={onClose}>Close</Button>
        </div>
      }
    >
      {g && (
        <div className="space-y-5">
          {/* Identity strip. Scope first, because it is the thing an
              operator most often gets wrong about a group. */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {scope === 'client' ? (
              <StatusBadge label={`Client: ${g.clientCode ?? `#${g.clientId}`}`} kind="info" />
            ) : (
              <StatusBadge label="Default (every client)" kind="default" />
            )}
            <span className="text-text-muted">
              {depotSingular}: <span className="text-text-primary">{g.depotName ?? 'any'}</span>
            </span>
            <span className="text-text-muted">·</span>
            <span className="text-text-muted">Group #{g.id}</span>
          </div>

          <p className="text-[11px] text-text-muted">
            {scope === 'client'
              ? `Only ${g.clientCode ?? 'this client'} is offered schedules through this group. The restriction is applied by the application, not by the database.`
              : 'Every client may be offered schedules through this group.'}
            {g.depotName == null
              && ` No ${depotSingular.toLowerCase()} is set, so the group applies to every ${depotSingular.toLowerCase()}.`}
          </p>

          {orphaned && (
            <div className="rounded border border-warning/40 bg-warning-bg/30 px-3 py-2 text-xs text-text-primary">
              No schedule references this group and no polygon is bound to it.
              It holds {g.postcodeCount} {memberWord}{g.postcodeCount === 1 ? '' : 's'} that
              currently {g.postcodeCount === 1 ? 'affects' : 'affect'} nothing.
            </div>
          )}

          {/* Counts. Delivery and pickup are deliberately separate: a
              pickup-only group reads as unused when they are summed.
              Each of the two is a button that filters the list below to
              that side, so the number and the list always agree. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label={`${memberWord[0].toUpperCase()}${memberWord.slice(1)}s`} value={g.postcodeCount} />
            <Stat label="Zones" value={g.zoneCount} />
            <Stat
              label="Delivery schedules"
              value={g.deliveryScheduleCount}
              active={side === 'delivery'}
              onClick={() => setSide(side === 'delivery' ? 'all' : 'delivery')}
            />
            <Stat
              label="Pickup schedules"
              value={g.pickupScheduleCount}
              active={side === 'pickup'}
              onClick={() => setSide(side === 'pickup' ? 'all' : 'pickup')}
            />
          </div>

          {/* Zones */}
          <section>
            <h4 className="text-sm font-semibold text-text-primary mb-1">
              Zones <span className="font-normal text-text-muted">- {detail.zones.length}</span>
            </h4>
            {detail.zones.length === 0 ? (
              <p className="text-xs text-text-muted italic">
                No {memberWord}s in this group yet. Add them on the Zones tab.
              </p>
            ) : (
              <div className="max-h-56 overflow-y-auto border border-border rounded">
                <table className="w-full text-xs">
                  <thead className="bg-surface-cream sticky top-0">
                    <tr className="text-left text-text-muted">
                      <th className="px-3 py-1.5 font-semibold">Zone</th>
                      <th className="px-3 py-1.5 font-semibold">Label</th>
                      <th className="px-3 py-1.5 font-semibold text-right">{memberWord}s</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.zones.map((z) => (
                      <tr key={z.zone} className="border-t border-border-light">
                        <td className="px-3 py-1.5 font-medium text-text-primary">{z.zone}</td>
                        <td className="px-3 py-1.5 text-text-secondary">
                          {z.label ?? <span className="italic text-text-muted">unnamed</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right text-text-primary">{z.memberCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Schedules */}
          <section>
            <div className="flex items-center justify-between gap-2 mb-1">
              <h4 className="text-sm font-semibold text-text-primary">
                {side === 'delivery' ? 'Delivery schedules'
                  : side === 'pickup' ? 'Pickup schedules'
                  : 'Schedules using this group'}
                <span className="font-normal text-text-muted"> - {shownSchedules.length}</span>
              </h4>
              <div className="flex gap-1 text-[11px]">
                {(['all', 'delivery', 'pickup'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSide(s)}
                    className={`px-2 py-0.5 rounded-full border ${
                      side === s
                        ? 'border-brand-cyan bg-brand-cyan/15 text-text-primary font-medium'
                        : 'border-border text-text-muted hover:bg-surface-light'
                    }`}
                  >
                    {s === 'all' ? 'Both sides' : s === 'delivery' ? 'Delivery' : 'Pickup'}
                  </button>
                ))}
              </div>
            </div>
            {shownSchedules.length === 0 ? (
              <p className="text-xs text-text-muted italic">
                {totalSchedules === 0
                  ? 'No schedule references this group on either side.'
                  : `No schedule uses this group for ${side === 'delivery' ? 'delivery' : 'pickup'}.`}
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto border border-border rounded">
                <table className="w-full text-xs">
                  <thead className="bg-surface-cream sticky top-0">
                    <tr className="text-left text-text-muted">
                      <th className="px-3 py-1.5 font-semibold">Schedule</th>
                      <th className="px-3 py-1.5 font-semibold">Used for</th>
                      <th className="px-3 py-1.5 font-semibold text-right">Day rows</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownSchedules.map((s) => (
                      <tr key={s.scheduleId} className="border-t border-border-light">
                        <td className="px-3 py-1.5">
                          <span className="font-medium text-text-primary">{s.name}</span>
                          <span className="text-text-muted ml-1">#{s.scheduleId}</span>
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="flex gap-1">
                            {s.usedForDelivery && <StatusBadge label="Delivery" kind="success" />}
                            {s.usedForPickup && <StatusBadge label="Pickup" kind="info" />}
                          </div>
                        </td>
                        <td className="px-3 py-1.5 text-right text-text-primary">{s.dayCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Polygons */}
          <section>
            <h4 className="text-sm font-semibold text-text-primary mb-1">
              Polygons bound <span className="font-normal text-text-muted">- {detail.polygons.length}</span>
            </h4>
            {detail.polygons.length === 0 ? (
              <p className="text-xs text-text-muted italic">
                None bound. Polygon coverage is only consulted when a {memberWord} resolves
                to no zone, and only while polygon zone resolution is switched on.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {detail.polygons.map((p) => (
                  <span
                    key={p.polygonId}
                    className="px-2 py-0.5 rounded-full border border-border bg-surface-light text-xs text-text-primary"
                  >
                    {p.name}
                  </span>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, active, onClick }: {
  label: string;
  value: number;
  /** Highlighted because the list below is filtered to this side. */
  active?: boolean;
  /** When set the card is a button that filters the schedules list. */
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="text-[11px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className="text-lg font-semibold text-text-primary">{value}</div>
    </>
  );
  if (!onClick) {
    return <div className="border border-border rounded px-3 py-2">{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`text-left border rounded px-3 py-2 transition-colors ${
        active
          ? 'border-brand-cyan bg-brand-cyan/10'
          : 'border-border hover:bg-surface-light'
      }`}
    >
      {body}
    </button>
  );
}
