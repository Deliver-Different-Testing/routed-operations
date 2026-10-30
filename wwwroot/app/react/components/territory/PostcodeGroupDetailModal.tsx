import { Fragment, useCallback, useEffect, useState } from 'react';
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
  type NzPostcodePasteResult,
} from '../../services/territoryService';

/** One bucket of a paste result. Renders nothing when the bucket is empty, so
 *  the breakdown only ever shows what actually happened. */
function PasteLine({ label, items, tone }: {
  label: string;
  items: string[];
  tone: 'ok' | 'muted' | 'warn';
}) {
  if (items.length === 0) return null;
  const colour = tone === 'ok' ? 'text-green-700'
    : tone === 'warn' ? 'text-amber-700'
    : 'text-text-muted';
  return (
    <p className={colour}>
      <span className="font-semibold">{label} ({items.length}):</span>{' '}
      <span className="font-mono">{items.join(', ')}</span>
    </p>
  );
}

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

  // Zone drawer state. A zone's codes are collapsed by default: a regional
  // group runs to hundreds and the point of the list is still "which zones".
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [showSuburbs, setShowSuburbs] = useState(true);
  const [pasteZone, setPasteZone] = useState<number | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [pasting, setPasting] = useState(false);
  const [pasteResult, setPasteResult] = useState<NzPostcodePasteResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await territoryService.postcodeGroupDetail(groupId);
      setDetail(res.response);
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [groupId]);

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

  const toggleZone = (zone: number) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(zone)) next.delete(zone); else next.add(zone);
    return next;
  });

  const openPaste = (zone: number) => {
    setPasteZone(zone);
    setPasteText('');
    setPasteResult(null);
    setExpanded((prev) => new Set(prev).add(zone));
  };

  const submitPaste = async () => {
    if (pasteZone == null || !pasteText.trim()) return;
    setPasting(true);
    try {
      const res = await territoryService.pasteNzPostcodes(groupId, pasteZone, {
        postcodes: [pasteText],
      });
      setPasteResult(res.response);
      setPasteText('');
      // Every outcome is shown in the breakdown below, so the toast only
      // carries the headline. A paste that added nothing is still a
      // successful call and must not read as a failure.
      const r = res.response;
      toast.show(
        r.added.length > 0
          ? `Added ${r.added.length} ${memberWord}${r.added.length === 1 ? '' : 's'} to zone ${pasteZone}.`
          : 'Nothing to add. See the breakdown.',
        r.added.length > 0 ? 'success' : 'info');
      await load();
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setPasting(false);
    }
  };

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

          {/* Zones. A zone row opens to show its codes (spec 3.2) and, on NZ,
              to paste more into it (spec 11.8). */}
          <section>
            <div className="flex items-center justify-between gap-2 mb-1">
              <h4 className="text-sm font-semibold text-text-primary">
                Zones <span className="font-normal text-text-muted">- {detail.zones.length}</span>
              </h4>
              {detail.zones.some((z) => z.members.length > 0) && (
                <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="pg-show-suburbs"
                    checked={showSuburbs}
                    onChange={(e) => setShowSuburbs(e.target.checked)}
                  />
                  Show suburb names
                </label>
              )}
            </div>
            {detail.zones.length === 0 ? (
              <p className="text-xs text-text-muted italic">
                No {memberWord}s in this group yet. Add them on the Zones tab.
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto border border-border rounded">
                <table className="w-full text-xs">
                  <thead className="bg-surface-cream sticky top-0">
                    <tr className="text-left text-text-muted">
                      <th className="px-3 py-1.5 font-semibold">Zone</th>
                      <th className="px-3 py-1.5 font-semibold">Label</th>
                      <th className="px-3 py-1.5 font-semibold text-right">{memberWord}s</th>
                      <th className="px-3 py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {detail.zones.map((z) => {
                      const open = expanded.has(z.zone);
                      return (
                        <Fragment key={z.zone}>
                          <tr className="border-t border-border-light">
                            <td className="px-3 py-1.5 font-medium text-text-primary">
                              <button
                                type="button"
                                data-testid={`pg-zone-toggle-${z.zone}`}
                                className="flex items-center gap-1 hover:underline"
                                onClick={() => toggleZone(z.zone)}
                                aria-expanded={open}
                              >
                                <span aria-hidden className="text-text-muted">{open ? '-' : '+'}</span>
                                {z.zone}
                              </button>
                            </td>
                            <td className="px-3 py-1.5 text-text-secondary">
                              {z.label ?? <span className="italic text-text-muted">unnamed</span>}
                            </td>
                            <td className="px-3 py-1.5 text-right text-text-primary">{z.memberCount}</td>
                            <td className="px-3 py-1.5 text-right">
                              {!user.isUsTenant && (
                                <button
                                  type="button"
                                  data-testid={`pg-paste-open-${z.zone}`}
                                  className="text-brand hover:underline"
                                  onClick={() => openPaste(z.zone)}
                                >
                                  + {memberWord}s
                                </button>
                              )}
                            </td>
                          </tr>

                          {open && (
                            <tr className="border-t border-border-light bg-surface-cream/40">
                              <td colSpan={4} className="px-3 py-2">
                                {z.members.length === 0 ? (
                                  <p className="text-xs text-text-muted italic">
                                    No {memberWord}s in this zone.
                                  </p>
                                ) : (
                                  <div
                                    className="flex flex-wrap gap-1"
                                    data-testid={`pg-zone-members-${z.zone}`}
                                  >
                                    {z.members.map((m) => (
                                      <span
                                        key={m.id}
                                        className="inline-flex items-baseline gap-1 rounded border border-border bg-surface px-1.5 py-0.5"
                                      >
                                        <span className="font-mono text-text-primary">{m.code}</span>
                                        {showSuburbs && m.suburb && (
                                          <span className="text-text-muted">{m.suburb}</span>
                                        )}
                                      </span>
                                    ))}
                                  </div>
                                )}

                                {pasteZone === z.zone && (
                                  <div className="mt-2 space-y-2" data-testid={`pg-paste-box-${z.zone}`}>
                                    <textarea
                                      className="w-full rounded border border-border px-2 py-1 text-xs font-mono"
                                      rows={3}
                                      value={pasteText}
                                      onChange={(e) => setPasteText(e.target.value)}
                                      placeholder={`Paste ${memberWord}s, separated by commas, spaces or new lines`}
                                      aria-label={`Paste ${memberWord}s into zone ${z.zone}`}
                                    />
                                    <div className="flex items-center gap-2">
                                      <Button
                                        size="sm"
                                        variant="primary"
                                        data-testid={`pg-paste-submit-${z.zone}`}
                                        disabled={pasting || !pasteText.trim()}
                                        onClick={submitPaste}
                                      >
                                        {pasting ? 'Adding...' : `Add to zone ${z.zone}`}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="neutral"
                                        onClick={() => { setPasteZone(null); setPasteResult(null); }}
                                      >
                                        Cancel
                                      </Button>
                                    </div>

                                    {pasteResult && (
                                      <div className="space-y-1 text-xs" data-testid="pg-paste-result">
                                        <PasteLine
                                          label="Added"
                                          tone="ok"
                                          items={pasteResult.added}
                                        />
                                        <PasteLine
                                          label="Already in this zone"
                                          tone="muted"
                                          items={pasteResult.alreadyInThisZone}
                                        />
                                        {pasteResult.skippedInOtherZone.length > 0 && (
                                          <p className="text-amber-700">
                                            <span className="font-semibold">
                                              Left where they are ({pasteResult.skippedInOtherZone.length}):
                                            </span>{' '}
                                            {pasteResult.skippedInOtherZone
                                              .map((s) => `${s.code} is in zone ${s.zone}`)
                                              .join(', ')}
                                            . A {memberWord} is never moved between zones of the same {groupSingular}
                                            , because that changes the rate every schedule ticking either zone charges.
                                          </p>
                                        )}
                                        <PasteLine
                                          label="Not recognised"
                                          tone="warn"
                                          items={pasteResult.ignored}
                                        />
                                      </div>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
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
