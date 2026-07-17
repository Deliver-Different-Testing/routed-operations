import { useEffect, useMemo, useRef, useState } from 'react';
import type { BulkJob } from '../../types';
import { Modal } from '../common/Modal';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../common/Button';

interface Props {
  open: boolean;
  job: BulkJob | null;
  onClose: () => void;
  onSave: (jobId: number, address: 'ToAddress' | 'FromAddress', lat: string, lng: string, postCode: string) => Promise<void>;
}

/**
 * GPS coordinate repair modal. Direct port of the legacy #gpsForm flow, but
 * running on Google Maps instead of HERE for parity with the cockpit map.
 * Steps:
 *   1. Operator chooses which leg to fix (pickup or delivery)
 *   2. Types an address in the search box, or accepts the auto-populated
 *      current address
 *   3. Google Geocoder returns lat/lng + postal component, shown on the map
 *   4. Draggable marker + map right-click let the operator nudge the pin
 *   5. Save calls PATCH /api/jobs/{id}/gps with the resolved coordinates
 *
 * The postal-code extraction pulls the first `postal_code` address component
 * and forwards it as a string; backend `ParsePostCode` strips ZIP+4 suffixes
 * and non-digit noise before storing as int on tblBulkJob.
 */
export function FixGpsModal({ open, job, onClose, onSave }: Props) {
  const user = useAuth();
  const apiKey = user.googleMapsKey;
  const google = typeof window !== 'undefined' ? (window as any).google : undefined;

  const [leg, setLeg] = useState<'ToAddress' | 'FromAddress'>('ToAddress');
  const [query, setQuery] = useState('');
  const [candidate, setCandidate] = useState<{ lat: number; lng: number; label: string; postCode: string } | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const geocoderRef = useRef<any>(null);

  const currentAddress = useMemo(() => {
    if (!job) return '';
    return leg === 'ToAddress'
      ? [job.toAddress, job.toSuburb, job.toPostCode].filter(Boolean).join(', ')
      : [job.fromAddress, job.fromSuburb, job.fromPostCode].filter(Boolean).join(', ');
  }, [job, leg]);

  useEffect(() => {
    if (open) {
      setQuery(currentAddress);
      setCandidate(null);
      setError(null);
    }
  }, [open, currentAddress]);

  // Wait for the async-loaded SDK, same pattern as GoogleMap.tsx.
  useEffect(() => {
    if (!open || !apiKey) return;
    if (google && google.maps) { setReady(true); return; }
    const started = Date.now();
    const t = setInterval(() => {
      const g = (window as any).google;
      if (g && g.maps) { setReady(true); clearInterval(t); }
      else if (Date.now() - started > 20000) { clearInterval(t); }
    }, 200);
    return () => clearInterval(t);
  }, [open, apiKey, google]);

  // Init preview map once the SDK is ready. Right-click on the map moves the
  // candidate pin (legacy gpsForm behaviour).
  useEffect(() => {
    if (!open || !ready || !mapContainerRef.current || mapRef.current) return;
    const g = (window as any).google;
    if (!g?.maps) return;

    const map = new g.maps.Map(mapContainerRef.current, {
      center: { lat: 37.7749, lng: -122.4194 },
      zoom: 3,
      mapTypeId: g.maps.MapTypeId.ROADMAP,
      gestureHandling: 'greedy',
      disableDefaultUI: false,
      clickableIcons: false,
      styles: [
        { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
      ],
    });
    mapRef.current = map;
    geocoderRef.current = new g.maps.Geocoder();

    map.addListener('rightclick', (e: any) => {
      if (!e?.latLng) return;
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      // Reverse-geocode the click to pull a postal code + label. Falls back
      // to the raw coords if the geocoder returns nothing.
      geocoderRef.current?.geocode({ location: { lat, lng } }, (results: any, status: string) => {
        if (status === 'OK' && results?.[0]) {
          const item = results[0];
          setCandidate({
            lat, lng,
            label: item.formatted_address ?? 'Custom pin',
            postCode: extractPostCode(item),
          });
        } else {
          setCandidate((prev) => ({
            lat, lng,
            label: prev?.label ?? 'Custom pin',
            postCode: prev?.postCode ?? '',
          }));
        }
      });
    });

    return () => {
      // Google Maps doesn't expose a dispose; just drop the refs so a fresh
      // instance is built on the next open.
      if (markerRef.current) { markerRef.current.setMap(null); markerRef.current = null; }
      mapRef.current = null;
      geocoderRef.current = null;
    };
  }, [open, ready]);

  // Update preview marker whenever we get a candidate. Draggable so operators
  // can nudge the pin by hand - dragend calls setCandidate with the new coord.
  useEffect(() => {
    const g = (window as any).google;
    if (!mapRef.current || !g?.maps) return;
    if (markerRef.current) {
      markerRef.current.setMap(null);
      markerRef.current = null;
    }
    if (candidate) {
      const marker = new g.maps.Marker({
        position: { lat: candidate.lat, lng: candidate.lng },
        map: mapRef.current,
        draggable: true,
        title: candidate.label,
      });

      marker.addListener('dragend', (e: any) => {
        if (!e?.latLng) return;
        const lat = e.latLng.lat();
        const lng = e.latLng.lng();
        // Reverse-geocode so the postcode field updates as the marker moves.
        geocoderRef.current?.geocode({ location: { lat, lng } }, (results: any, status: string) => {
          if (status === 'OK' && results?.[0]) {
            const item = results[0];
            setCandidate({
              lat, lng,
              label: item.formatted_address ?? candidate.label,
              postCode: extractPostCode(item),
            });
          } else {
            setCandidate((prev) => prev ? { ...prev, lat, lng } : prev);
          }
        });
      });

      markerRef.current = marker;
      mapRef.current.setCenter({ lat: candidate.lat, lng: candidate.lng });
      mapRef.current.setZoom(15);
    }
  }, [candidate]);

  const doSearch = () => {
    if (!query.trim() || !geocoderRef.current) return;
    setSearching(true);
    setError(null);
    geocoderRef.current.geocode({ address: query }, (results: any, status: string) => {
      setSearching(false);
      if (status !== 'OK' || !results?.[0]) {
        setError('No results found. Try a more specific address.');
        return;
      }
      const item = results[0];
      const loc = item.geometry.location;
      setCandidate({
        lat: loc.lat(),
        lng: loc.lng(),
        label: item.formatted_address ?? query,
        postCode: extractPostCode(item),
      });
    });
  };

  const copyGeocodedAddress = () => {
    if (candidate?.label) {
      const parts = candidate.label.split(',');
      const trimmed = parts.length > 1 ? parts.slice(1).join(',').trim() : candidate.label;
      setQuery(trimmed);
    }
  };

  const commit = async () => {
    if (!job || !candidate) return;
    setSaving(true);
    try {
      await onSave(
        job.bulkJobId,
        leg,
        candidate.lat.toString(),
        candidate.lng.toString(),
        candidate.postCode
      );
      onClose();
    } catch (e) {
      setError((e as Error).message ?? 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  if (!job) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Fix GPS - ${job.jobNumber}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose}>Cancel</Button>
          <Button
            variant="secondary"
            data-primary="true"
            onClick={commit}
            disabled={!candidate || saving}
          >
            {saving ? 'Saving...' : `Apply to ${leg === 'ToAddress' ? 'delivery' : 'pickup'}`}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        {/* Segmented radio pair matches BuildConfigModal PillRadio style so the
            Delivery/Pickup toggle uses the same cyan-selected pattern as the
            rest of the cockpit. */}
        <div className="inline-flex border border-border rounded-lg overflow-hidden whitespace-nowrap">
          {(['ToAddress', 'FromAddress'] as const).map((k) => (
            <label
              key={k}
              className={`px-3 py-1.5 cursor-pointer text-sm transition-all ${
                leg === k
                  ? 'bg-brand-cyan text-brand-dark font-medium'
                  : 'bg-surface-white text-text-secondary hover:bg-surface-cream'
              }`}
            >
              <input
                type="radio"
                name="leg"
                checked={leg === k}
                onChange={() => setLeg(k)}
                className="sr-only"
              />
              {k === 'ToAddress' ? 'Delivery' : 'Pickup'}
            </label>
          ))}
        </div>

        <div>
          <label className="block text-text-secondary text-xs mb-1">Address search</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') doSearch(); }}
              className="flex-1 border border-border rounded px-2 py-1"
              placeholder="Street, city, state"
            />
            <Button
              variant="primary"
              onClick={doSearch}
              disabled={searching || !ready}
            >
              {searching ? 'Searching...' : 'Search'}
            </Button>
          </div>
          {error && <div className="mt-2 text-error text-xs">{error}</div>}
          {!apiKey && (
            <div className="mt-2 text-error text-xs">
              Google Maps API key is not set (GoogleMapsKey env var).
            </div>
          )}
        </div>

        <div>
          <div
            ref={mapContainerRef}
            className="h-64 w-full bg-surface-cream border border-border-light rounded"
          />
        </div>

        {candidate && (
          <div className="p-2 bg-brand-cyan/10 border border-brand-cyan/30 rounded text-xs">
            <div><strong>Found:</strong> {candidate.label}</div>
            <div><strong>Coordinates:</strong> {candidate.lat.toFixed(6)}, {candidate.lng.toFixed(6)}</div>
            {candidate.postCode && <div><strong>Postcode:</strong> {candidate.postCode}</div>}
            <button
              type="button"
              onClick={copyGeocodedAddress}
              className="mt-1 text-brand-purple hover:underline"
            >
              Copy this address back to the search box
            </button>
          </div>
        )}

        <div className="text-xs text-text-muted">
          Current on file: <em>{currentAddress || '(none)'}</em>
        </div>
        <div className="text-[10px] text-text-muted italic">
          Tip: drag the pin, or right-click the map to drop the pin somewhere else.
        </div>
      </div>
    </Modal>
  );
}

/**
 * Pull the first `postal_code` component out of a Google Geocoder result. US
 * ZIP+4 shows up as "02138-4137" - forward it as-is; backend strips the +4.
 */
function extractPostCode(result: any): string {
  const comp = (result?.address_components ?? []).find((c: any) =>
    Array.isArray(c.types) && c.types.includes('postal_code'));
  return comp?.short_name ?? comp?.long_name ?? '';
}
