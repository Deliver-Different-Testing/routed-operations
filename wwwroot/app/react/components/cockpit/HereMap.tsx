import { useEffect, useRef } from 'react';
import type { BulkJob, Run } from '../../types';
import { Panel } from '../common/Panel';
import { useAuth } from '../../context/AuthContext';
import type { MapContextTarget } from './MapContextMenu';

interface Props {
  jobs: BulkJob[];
  selectedRun: Run | null;
  onPinClick?: (jobId: number) => void;
  onPinContextMenu?: (target: MapContextTarget) => void;
}

interface Pin {
  lat: number;
  lng: number;
  label: string;
  kind: 'pickup' | 'delivery' | 'selected' | 'sequenced';
  sequence?: number;
  bulkJobId: number;
  jobNumber: string | null;
  runId: number | null;
}

/**
 * HERE Maps SDK integration. Renders pickup + delivery pins for the currently
 * filtered jobs, with click + right-click event handlers that surface the
 * underlying job to the parent CockpitPage. When a run is selected, its jobs
 * are shown with sequence numbers and a polyline.
 *
 * Falls back to a diagnostic placeholder when the SDK isn't loaded (offline
 * dev) or the API key isn't configured.
 */
export function HereMap({ jobs, selectedRun, onPinClick, onPinContextMenu }: Props) {
  const user = useAuth();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const groupRef = useRef<any>(null);
  const platformRef = useRef<any>(null);

  const apiKey = user.hereMapsApiKey;
  const H = typeof window !== 'undefined' ? window.H : undefined;

  useEffect(() => {
    if (!apiKey || !H || !mapContainerRef.current || mapRef.current) return;
    try {
      const platform = new H.service.Platform({ apikey: apiKey });
      const defaultLayers = platform.createDefaultLayers();
      const map = new H.Map(
        mapContainerRef.current,
        defaultLayers.vector.normal.map,
        {
          center: { lat: 37.7749, lng: -122.4194 },
          zoom: 4,
          pixelRatio: window.devicePixelRatio || 1,
        }
      );
      new H.mapevents.Behavior(new H.mapevents.MapEvents(map));
      H.ui.UI.createDefault(map, defaultLayers);
      const group = new H.map.Group();
      map.addObject(group);
      groupRef.current = group;
      mapRef.current = map;
      platformRef.current = platform;

      const observer = new ResizeObserver(() => map.getViewPort().resize());
      observer.observe(mapContainerRef.current);
      return () => {
        observer.disconnect();
        map.dispose();
        mapRef.current = null;
      };
    } catch (e) {
      console.error('HERE Maps init failed', e);
    }
  }, [apiKey, H]);

  useEffect(() => {
    if (!mapRef.current || !groupRef.current || !H) return;
    const group = groupRef.current;
    group.removeAll();

    const pins = buildPins(jobs, selectedRun);
    if (pins.length === 0) return;

    pins.forEach((p) => {
      const svg = pinSvg(p);
      const icon = new H.map.Icon(svg, { size: { w: 32, h: 40 }, anchor: { x: 16, y: 40 } });
      const marker = new H.map.Marker({ lat: p.lat, lng: p.lng }, { icon });
      // Attach the pin data to the marker so click / contextmenu handlers can read it.
      marker.setData(p);
      group.addObject(marker);
    });

    // Left-click on a marker: select the underlying job.
    const tapHandler = (evt: any) => {
      const target = evt.target;
      if (target && target.getData) {
        const p = target.getData() as Pin | undefined;
        if (p && onPinClick) onPinClick(p.bulkJobId);
      }
    };

    // Right-click on a marker: open the context menu at the mouse pointer.
    const contextHandler = (evt: any) => {
      const target = evt.target;
      if (target && target.getData && onPinContextMenu) {
        const p = target.getData() as Pin | undefined;
        if (!p) return;
        // originalEvent is the browser MouseEvent; pull clientX/clientY off it.
        const orig = evt.originalEvent ?? {};
        onPinContextMenu({
          bulkJobId: p.bulkJobId,
          jobNumber: p.jobNumber,
          kind: p.kind === 'sequenced' ? 'delivery' : (p.kind === 'pickup' ? 'pickup' : 'delivery'),
          runId: p.runId,
          clientX: orig.clientX ?? 0,
          clientY: orig.clientY ?? 0,
        });
      }
    };

    group.addEventListener('tap', tapHandler);
    group.addEventListener('contextmenu', contextHandler);

    if (selectedRun) {
      const seqPins = pins
        .filter((p) => p.kind === 'sequenced' && p.sequence != null)
        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
      if (seqPins.length > 1) {
        const line = new H.geo.LineString();
        seqPins.forEach((p) => line.pushPoint({ lat: p.lat, lng: p.lng }));
        const polyline = new H.map.Polyline(line, {
          style: { strokeColor: '#606DB4', lineWidth: 4 },
        });
        group.addObject(polyline);
      }
    }

    try {
      mapRef.current.getViewModel().setLookAtData({ bounds: group.getBoundingBox() });
    } catch { /* no bounds */ }

    return () => {
      // Remove listeners on re-render so we don't stack duplicates.
      group.removeEventListener('tap', tapHandler);
      group.removeEventListener('contextmenu', contextHandler);
    };
  }, [jobs, selectedRun, H, onPinClick, onPinContextMenu]);

  if (!apiKey || !H) {
    const reason = !apiKey
      ? 'HERE Maps API key is not set (HeremapApiKey env var).'
      : 'HERE Maps SDK failed to load (check CSP / network).';
    return (
      <Panel title="Map">
        <div className="h-full w-full grid place-items-center bg-surface-cream">
          <div className="text-center text-text-muted">
            <div className="text-sm">HERE Maps unavailable</div>
            <div className="mt-2 text-xs">{reason}</div>
            <div className="mt-2 text-xs">
              {selectedRun ? `Would render run "${selectedRun.name}"` : `${jobs.length} jobs to plot`}
            </div>
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title={selectedRun ? `Map - Run: ${selectedRun.name}` : `Map - ${jobs.length} jobs`}>
      <div ref={mapContainerRef} className="h-full w-full" />
    </Panel>
  );
}

function buildPins(jobs: BulkJob[], selectedRun: Run | null): Pin[] {
  const out: Pin[] = [];
  const inRun = selectedRun ? new Set(selectedRun.jobs.map((j) => j.bulkJobId)) : null;
  const sequenceByJobId = new Map<number, number>();
  if (selectedRun) {
    selectedRun.jobs.forEach((rj, idx) => {
      sequenceByJobId.set(rj.bulkJobId, rj.builderIndex ?? idx + 1);
    });
  }

  jobs.forEach((j) => {
    const pickLat = parseCoord(j.pickUpLatitude);
    const pickLng = parseCoord(j.pickUpLongitude);
    const dropLat = parseCoord(j.deliveryLatitude);
    const dropLng = parseCoord(j.deliveryLongitude);
    const label = j.jobNumber ?? String(j.bulkJobId);

    if (pickLat != null && pickLng != null) {
      out.push({
        lat: pickLat, lng: pickLng,
        label: `Pickup - ${label}`,
        kind: 'pickup',
        bulkJobId: j.bulkJobId, jobNumber: j.jobNumber, runId: j.bulkRunId,
      });
    }
    if (dropLat != null && dropLng != null) {
      const kind: Pin['kind'] = inRun && inRun.has(j.bulkJobId) ? 'sequenced' : 'delivery';
      out.push({
        lat: dropLat, lng: dropLng,
        label: `${kind === 'sequenced' ? 'Stop ' + sequenceByJobId.get(j.bulkJobId) + ' - ' : ''}${label}`,
        kind,
        sequence: kind === 'sequenced' ? sequenceByJobId.get(j.bulkJobId) : undefined,
        bulkJobId: j.bulkJobId, jobNumber: j.jobNumber, runId: j.bulkRunId,
      });
    }
  });

  return out;
}

function parseCoord(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

function pinSvg(p: Pin): string {
  const fill = p.kind === 'pickup'
    ? '#43C7F4'
    : p.kind === 'sequenced'
    ? '#F2994A'
    : p.kind === 'selected'
    ? '#606DB4'
    : '#EF4444';
  const text = p.kind === 'sequenced' && p.sequence != null ? String(p.sequence) : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 40" width="32" height="40">
    <path d="M16 0 C7 0 0 7 0 16 c0 12 16 24 16 24 s16-12 16-24 c0-9-7-16-16-16 z" fill="${fill}" stroke="#14152D" stroke-width="1.5"/>
    <circle cx="16" cy="16" r="8" fill="#fff"/>
    <text x="16" y="20" font-family="sans-serif" font-size="10" font-weight="700" text-anchor="middle" fill="#14152D">${text}</text>
  </svg>`;
}
