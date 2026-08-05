import { useEffect, useMemo, useState } from 'react';
import { zoneService, type RatingZoneDepot } from '../../services/zoneService';
import { useToast } from '../../context/ToastContext';
import { postcodeLabel } from '../../lib/tenantLabels';
import { Button } from '../common/Button';

/** Depot-level label helper. Each depot carries its own countryCode so we
 *  can render US and NZ tenants side-by-side (rare but supported) with
 *  the right wording per row. Lowercase output for use in count phrases
 *  like "29 zips" / "24 postcodes"; capitalize at the call site if needed. */
function zipTermForDepot(countryCode: string, count: number): string {
  const isUs = countryCode?.toUpperCase() === 'US';
  const base = postcodeLabel(isUs, true).toLowerCase();
  return count === 1 ? base : `${base}s`;
}

interface ZonesDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Handler for the "Show on map" button on each zone card. Given a list
   *  of zip strings + a human context label, the parent Polygon Builder
   *  resolves them to ZipPolygon shapes and highlights them on the map. */
  onShowZipsOnMap?: (zips: string[], contextLabel: string) => void;
  /** Prefetched zones payload from the parent. When present, the drawer
   *  opens instantly with data already in hand and skips the internal
   *  fetch entirely. Refresh button still hits the network on demand.
   *  Passing `null` means "parent tried to prefetch but the request
   *  hasn't landed yet" - drawer will fall back to its own on-open fetch.
   *  Passing `undefined` means the parent isn't managing prefetch at all
   *  (preserves the original standalone behaviour for other callers). */
  prefetchedDepots?: RatingZoneDepot[] | null;
}

/**
 * Right-side slide-in drawer surfacing the tenant's rating geography for
 * the Polygon Builder. Depot -> postcode group (with optional US zone
 * name) -> zone number -> postcodes/ZIPs. Read-only, no edits (spec:
 * POLYGON-BUILDER-VIEW-ZONES-NZ-US-HANDOVER-2026-07-30).
 *
 * Fetches lazily on first open; keeps the fetched payload cached in
 * component state so re-opens don't hit the network again. Refresh button
 * clears the cache + refetches.
 *
 * Search filters client-side across depot name / group name / zone name /
 * zone number / postcode/ZIP simultaneously - fine because the largest
 * observed payload is ~4.5k rows and comes over gzipped as ~200KB.
 */
export function ZonesDrawer({ open, onClose, onShowZipsOnMap, prefetchedDepots }: ZonesDrawerProps) {
  const toast = useToast();
  // Seed from the prefetched payload if the parent supplied one. The parent
  // fires this fetch in the background right after the page settles, so
  // by the time the operator clicks "View Zones" the drawer opens with
  // data already in hand instead of showing a "Fetching…" state.
  const [depots, setDepots] = useState<RatingZoneDepot[] | null>(
    prefetchedDepots ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  // Absorb the prefetched payload if it arrives after the drawer has
  // already mounted with null (i.e. the operator clicks View Zones before
  // the background fetch completes). Once we have local state, ignore
  // subsequent parent updates - the internal state is the source of
  // truth after that (Refresh button lives here).
  useEffect(() => {
    if (prefetchedDepots && depots === null) setDepots(prefetchedDepots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefetchedDepots]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await zoneService.getRatingZones();
      setDepots(res.response ?? []);
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Fetch on first open if nothing was prefetched. Subsequent opens read
  // from the cached state.
  useEffect(() => {
    if (open && depots === null && !loading) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filtered = useMemo(() => {
    if (!depots) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return depots;
    // Match at the postcode/zone/group/depot/zoneName level - keep any depot
    // that has at least one downstream match; prune out non-matching groups
    // and zones inside it so the drawer shows exactly what matched.
    return depots
      .map((d) => {
        const depotMatches = d.depotName.toLowerCase().includes(needle);
        const groups = d.groups
          .map((g) => {
            const groupMatches =
              g.groupName.toLowerCase().includes(needle) ||
              (g.zoneName?.toLowerCase().includes(needle) ?? false);
            const zones = g.zones
              .map((z) => {
                const zoneMatches = String(z.zone).includes(needle);
                const postcodes = z.postcodes.filter((p) =>
                  p.toLowerCase().includes(needle),
                );
                if (depotMatches || groupMatches || zoneMatches) return z;
                if (postcodes.length > 0) return { ...z, postcodes };
                return null;
              })
              .filter((z): z is NonNullable<typeof z> => z !== null);
            if (depotMatches || groupMatches) return { ...g, zones };
            if (zones.length > 0) return { ...g, zones };
            return null;
          })
          .filter((g): g is NonNullable<typeof g> => g !== null);
        if (depotMatches) return { ...d, groups };
        if (groups.length > 0) return { ...d, groups };
        return null;
      })
      .filter((d): d is RatingZoneDepot => d !== null);
  }, [depots, search]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40"
      role="dialog"
      aria-label="Rating postcodes / ZIPs"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-brand-dark/30"
        onClick={onClose}
        data-zones-drawer-backdrop="true"
      />
      {/* Panel */}
      <div
        className="absolute top-0 right-0 h-full w-96 bg-surface-white border-l border-border shadow-lg flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-light shrink-0">
          <div>
            <div className="text-sm font-semibold text-text-primary">
              Rating postcodes / ZIPs
            </div>
            <div className="text-[10px] text-text-muted">
              Live rating postcode / ZIP mappings from Client Manager for this tenant.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary"
            aria-label="Close"
          >
            X
          </button>
        </div>

        <div className="px-3 py-2 border-b border-border-light shrink-0 space-y-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search depot, group, zone, ZIP or postcode…"
            className="w-full border border-border rounded px-2 py-1 text-xs bg-surface-white text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-cyan/30 focus:border-brand-cyan"
          />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-muted">
              {depots === null
                ? 'Loading…'
                : `${filtered.length} depot${filtered.length === 1 ? '' : 's'} shown / ${depots.length} total`}
            </span>
            <div className="flex-1" />
            <Button variant="neutral" size="sm" onClick={load} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {depots === null && loading && (
            <div className="text-center text-text-muted italic text-xs py-6">
              Fetching rating geography…
            </div>
          )}
          {depots !== null && depots.length === 0 && (
            <div className="text-center text-text-muted italic text-xs py-6">
              No rating geography configured for this tenant.
            </div>
          )}
          {depots !== null && depots.length > 0 && filtered.length === 0 && (
            <div className="text-center text-text-muted italic text-xs py-6">
              No matches for "{search}"
            </div>
          )}
          {filtered.map((d) => (
            <DepotCard key={d.depotId} depot={d} onShowZipsOnMap={onShowZipsOnMap} />
          ))}
        </div>
      </div>
    </div>
  );
}

function DepotCard({
  depot,
  onShowZipsOnMap,
}: {
  depot: RatingZoneDepot;
  onShowZipsOnMap?: (zips: string[], contextLabel: string) => void;
}) {
  return (
    <div className="border border-border-light rounded-lg bg-surface-cream">
      <div className="px-2 py-1.5 border-b border-border-light">
        <div className="flex items-center gap-2">
          <div className="text-xs font-semibold text-text-primary">
            {depot.depotName}
          </div>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-brand-cyan/15 text-brand-dark">
            {depot.countryCode}
          </span>
          <div className="flex-1" />
          <span className="text-[10px] text-text-muted">
            {depot.postcodeCount} {zipTermForDepot(depot.countryCode, depot.postcodeCount)}
          </span>
        </div>
      </div>
      <div className="p-2 space-y-2">
        {depot.groups.map((g) => {
          // Pick the best "primary label" for this group card. US tenants
          // usually don't populate ZoneZipGroupId so `groupName` falls back
          // to "(no group)"; ZoneName is the meaningful thing to show.
          // Rule:
          //   - if we have a zoneName (US path), promote it as the primary label
          //   - else if we have a real groupId, use groupName
          //   - else hide the label entirely and let the zone rows carry the info
          const hasRealGroup = g.groupId != null;
          const primaryLabel = g.zoneName ?? (hasRealGroup ? g.groupName : null);
          const secondaryLabel = g.zoneName && hasRealGroup ? g.groupName : null;
          return (
            <div
              key={`${g.groupId ?? 'ungrouped'}-${g.zoneName ?? ''}`}
              className="border border-border rounded bg-surface-white"
            >
              {primaryLabel && (
                <div className="px-2 py-1 border-b border-border-light">
                  <div className="text-[11px] font-medium text-text-primary">
                    {primaryLabel}
                  </div>
                  {secondaryLabel && (
                    <div className="text-[10px] text-text-muted">{secondaryLabel}</div>
                  )}
                  <div className="text-[9px] text-text-muted">
                    {g.postcodeCount} {zipTermForDepot(depot.countryCode, g.postcodeCount)}
                  </div>
                </div>
              )}
              <div className="p-1.5 space-y-1">
                {g.zones.map((z) => {
                  // Whole row is clickable when the parent wired
                  // onShowZipsOnMap. Click focuses the map on this zone's
                  // zips (replaces previous highlight + fitBounds). Text is
                  // still selectable via double-click-drag inside the browser.
                  const clickable = !!onShowZipsOnMap;
                  const contextLabel = `${depot.depotName}${primaryLabel ? ` -> ${primaryLabel}` : ''} -> Zone ${z.zone}`;
                  return (
                    <div
                      key={z.zone}
                      role={clickable ? 'button' : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      title={clickable
                        ? `Focus the ${z.postcodes.length} ${zipTermForDepot(depot.countryCode, z.postcodes.length)} in this zone on the map`
                        : undefined}
                      onClick={clickable
                        ? () => onShowZipsOnMap!(z.postcodes, contextLabel)
                        : undefined}
                      onKeyDown={clickable
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onShowZipsOnMap!(z.postcodes, contextLabel);
                            }
                          }
                        : undefined}
                      className={`flex items-start gap-1 text-[10px] rounded px-1 py-0.5 ${
                        clickable
                          ? 'cursor-pointer hover:bg-brand-cyan/10 focus:outline-none focus:ring-2 focus:ring-brand-cyan/40'
                          : ''
                      }`}
                    >
                      <div className="shrink-0 px-1.5 py-0.5 rounded bg-warning/15 text-brand-dark font-medium">
                        Zone {z.zone}
                      </div>
                      <div className="flex-1 text-text-secondary break-all">
                        {z.postcodes.join(', ')}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
