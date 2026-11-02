/// <reference types="google.maps" />
import { useEffect, useMemo, useState } from 'react';
import { APIProvider, Map as GoogleMap, useMap } from '@vis.gl/react-google-maps';
import { useToast } from '../../context/ToastContext';
import { territoryService, type ZoneMap } from '../../services/territoryService';
import { parseWktPolygon, type LatLng } from '../../lib/wktPolygon';

/** One colour per zone, reused round the ring past ten zones. Chosen so
 *  neighbouring zone numbers are not neighbouring hues, because adjacent
 *  zones are what sit next to each other on a map. */
const ZONE_COLOURS = [
  '#2563eb', '#f97316', '#16a34a', '#db2777', '#7c3aed',
  '#0891b2', '#ca8a04', '#dc2626', '#4d7c0f', '#9333ea',
];

export function zoneColour(zone: number): string {
  return ZONE_COLOURS[Math.abs(zone) % ZONE_COLOURS.length];
}

interface Props {
  postcodeGroupId: number;
  /** Zone the operator is hovering in the zones table, highlighted here. */
  highlightZone?: number | null;
  memberWord: string;
}

/**
 * Map beside a zone group (spec 11.8): the group's postcodes shaded by zone,
 * the home depot pinned, and the hovered zone brought forward.
 *
 * Built on Google, not HERE. HERE is backend geocoding and routing only, so a
 * spec line saying "HERE panel" still means a Google map (Kevin, 20 Oct).
 *
 * Boundaries come from dbo.ZipPolygon, which holds NZ postcode outlines as
 * well as US zips (Steve, 21 Oct), so one panel serves both tenants. Codes
 * with no outline on file are named under the map rather than silently
 * missing from it.
 */
export function ZoneGroupMapPanel({ postcodeGroupId, highlightZone, memberWord }: Props) {
  const toast = useToast();
  const [data, setData] = useState<ZoneMap | null>(null);
  const [loading, setLoading] = useState(false);
  const apiKey = (typeof window !== 'undefined' && window.__APP_USER__?.googleMapsKey) || null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await territoryService.zoneMap(postcodeGroupId);
        if (!cancelled) setData(res.response);
      } catch (e) {
        if (!cancelled) { toast.show((e as Error).message, 'error'); setData(null); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [postcodeGroupId, toast]);

  /** Parsed rings, grouped so each zone can be drawn and highlighted. */
  const rings = useMemo(() => {
    const out: { zone: number; code: string; path: LatLng[] }[] = [];
    for (const s of data?.shapes ?? []) {
      const path = parseWktPolygon(s.wkt);
      if (path && path.length > 2) out.push({ zone: s.zone, code: s.code, path });
    }
    return out;
  }, [data]);

  const centre = useMemo(() => {
    if (data?.depotLatitude != null && data?.depotLongitude != null) {
      return { lat: Number(data.depotLatitude), lng: Number(data.depotLongitude) };
    }
    const points = rings.flatMap((r) => r.path);
    if (points.length === 0) return null;
    return {
      lat: points.reduce((a, p) => a + p.lat, 0) / points.length,
      lng: points.reduce((a, p) => a + p.lng, 0) / points.length,
    };
  }, [data, rings]);

  const zonesOnMap = useMemo(
    () => [...new Set(rings.map((r) => r.zone))].sort((a, b) => a - b),
    [rings]);

  if (loading) {
    return <p className="text-xs text-text-muted italic">Loading map...</p>;
  }
  if (!data) return null;

  const nothingToDraw = rings.length === 0;

  return (
    <div className="space-y-2" data-testid="zone-map-panel">
      {!apiKey && (
        <p className="text-[11px] text-brand-orange">
          No Google Maps key is configured for this environment, so the outlines cannot be
          drawn. The zone list beside it is unaffected.
        </p>
      )}
      {nothingToDraw ? (
        <p className="text-[11px] text-text-muted italic" data-testid="zone-map-empty">
          {data.shapes.length === 0 && data.codesWithNoShape.length === 0
            ? `This group has no ${memberWord}s yet, so there is nothing to draw.`
            : `None of this group's ${memberWord}s has a boundary on file, so the map is empty. The boundaries load with the yearly Census refresh.`}
        </p>
      ) : apiKey && centre ? (
        <div className="h-72 rounded-xl overflow-hidden border border-border">
          <APIProvider apiKey={apiKey}>
            <GoogleMap
              defaultCenter={centre}
              defaultZoom={9}
              gestureHandling="greedy"
              mapId="zone-group-map"
              style={{ width: '100%', height: '100%' }}
            >
              <ZoneOverlay
                rings={rings}
                highlightZone={highlightZone ?? null}
                depot={data.depotLatitude != null && data.depotLongitude != null
                  ? { lat: Number(data.depotLatitude), lng: Number(data.depotLongitude),
                      title: data.depotName ?? 'Depot' }
                  : null}
              />
            </GoogleMap>
          </APIProvider>
        </div>
      ) : (
        <div className="h-72 rounded-xl border border-dashed border-border flex items-center justify-center">
          <p className="text-[11px] text-text-muted italic">
            {rings.length} outline{rings.length === 1 ? '' : 's'} ready to draw once the map loads.
          </p>
        </div>
      )}

      {zonesOnMap.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {zonesOnMap.map((z) => (
            <span
              key={z}
              data-testid={`zone-map-legend-${z}`}
              className={`inline-flex items-center gap-1 text-[10px] ${
                highlightZone != null && highlightZone !== z ? 'opacity-40' : ''
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: zoneColour(z) }} />
              Zone {z}
            </span>
          ))}
        </div>
      )}

      {data.codesWithNoShape.length > 0 && (
        <p className="text-[11px] text-text-muted" data-testid="zone-map-missing">
          {data.codesWithNoShape.length} {memberWord}
          {data.codesWithNoShape.length === 1 ? '' : 's'} not drawn, with no boundary on file:{' '}
          <span className="font-mono">{data.codesWithNoShape.slice(0, 12).join(', ')}</span>
          {data.codesWithNoShape.length > 12 && ` and ${data.codesWithNoShape.length - 12} more`}.
        </p>
      )}
    </div>
  );
}

/**
 * Draws the outlines and the depot pin straight onto the map instance.
 *
 * Done with the raw Maps API rather than the library's own Polygon and Marker
 * components on purpose: this version of @vis.gl/react-google-maps does not
 * export a Polygon at all, and its Marker is the deprecated one. Going through
 * useMap keeps the component tree to the pieces the library does export, which
 * is also what stops the "Invalid hook call" the lazily-imported build threw.
 */
function ZoneOverlay({ rings, highlightZone, depot }: {
  rings: { zone: number; code: string; path: LatLng[] }[];
  highlightZone: number | null;
  depot: { lat: number; lng: number; title: string } | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || typeof google === 'undefined') return;

    const shapes = rings.map((r) => {
      const dimmed = highlightZone != null && highlightZone !== r.zone;
      const colour = zoneColour(r.zone);
      return new google.maps.Polygon({
        paths: r.path,
        strokeColor: colour,
        strokeOpacity: dimmed ? 0.3 : 0.9,
        strokeWeight: dimmed ? 1 : 2,
        fillColor: colour,
        fillOpacity: dimmed ? 0.08 : 0.3,
        map,
        clickable: false,
      });
    });

    const pin = depot
      ? new google.maps.Marker({
          position: { lat: depot.lat, lng: depot.lng },
          title: depot.title,
          map,
        })
      : null;

    // Fit to what is drawn, so a group whose depot sits outside its own
    // postcodes still shows every zone rather than centring on the pin.
    if (shapes.length > 0) {
      const bounds = new google.maps.LatLngBounds();
      for (const r of rings) for (const p of r.path) bounds.extend(p);
      if (depot) bounds.extend({ lat: depot.lat, lng: depot.lng });
      map.fitBounds(bounds);
    }

    return () => {
      for (const s of shapes) s.setMap(null);
      pin?.setMap(null);
    };
  }, [map, rings, highlightZone, depot]);

  return null;
}
