import { useEffect, useMemo, useRef, useState } from 'react';
import type { BulkJob } from '../../types';
import { Modal } from '../common/Modal';
import { useAuth } from '../../context/AuthContext';

interface Props {
  open: boolean;
  job: BulkJob | null;
  onClose: () => void;
  onSave: (jobId: number, address: 'ToAddress' | 'FromAddress', lat: string, lng: string, postCode: string) => Promise<void>;
}

/**
 * GPS coordinate repair modal. Direct port of the legacy #gpsForm flow:
 *   1. Operator chooses which leg to fix (pickup or delivery)
 *   2. Types an address in the search box, or accepts the auto-populated
 *      current address
 *   3. HERE geocoder returns lat/lng, we show them on the map preview
 *   4. Save calls PATCH /api/jobs/{id}/gps with the resolved coordinates
 *
 * The address search uses HERE Maps `geocode` REST endpoint via the same
 * SDK loaded in Views/Home/Index.cshtml so we don't have to add a new
 * backend proxy.
 */
export function FixGpsModal({ open, job, onClose, onSave }: Props) {
  const user = useAuth();
  const H = typeof window !== 'undefined' ? window.H : undefined;
  const apiKey = user.hereMapsApiKey;

  const [leg, setLeg] = useState<'ToAddress' | 'FromAddress'>('ToAddress');
  const [query, setQuery] = useState('');
  const [candidate, setCandidate] = useState<{ lat: number; lng: number; label: string; postCode: string } | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

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

  // Init preview map once the modal opens.
  useEffect(() => {
    if (!open || !H || !apiKey || !mapContainerRef.current || mapRef.current) return;
    const platform = new H.service.Platform({ apikey: apiKey });
    const layers = platform.createDefaultLayers();
    const map = new H.Map(mapContainerRef.current, layers.vector.normal.map, {
      center: { lat: 37.7749, lng: -122.4194 },
      zoom: 3,
      pixelRatio: window.devicePixelRatio || 1,
    });
    new H.mapevents.Behavior(new H.mapevents.MapEvents(map));
    mapRef.current = map;
    return () => {
      map.dispose();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [open, H, apiKey]);

  // Update preview marker whenever we get a candidate.
  useEffect(() => {
    if (!mapRef.current || !H) return;
    if (markerRef.current) {
      mapRef.current.removeObject(markerRef.current);
      markerRef.current = null;
    }
    if (candidate) {
      const marker = new H.map.Marker({ lat: candidate.lat, lng: candidate.lng });
      mapRef.current.addObject(marker);
      markerRef.current = marker;
      mapRef.current.setCenter({ lat: candidate.lat, lng: candidate.lng });
      mapRef.current.setZoom(15);
    }
  }, [candidate, H]);

  const doSearch = async () => {
    if (!query.trim() || !apiKey || !H) return;
    setSearching(true);
    setError(null);
    try {
      const platform = new H.service.Platform({ apikey: apiKey });
      const geocoder = platform.getSearchService();
      const result: any = await new Promise((resolve, reject) => {
        geocoder.geocode({ q: query }, resolve, reject);
      });
      const item = result?.items?.[0];
      if (!item) {
        setError('No results found. Try a more specific address.');
        return;
      }
      setCandidate({
        lat: item.position.lat,
        lng: item.position.lng,
        label: item.address?.label ?? item.title ?? query,
        postCode: item.address?.postalCode ?? '',
      });
    } catch (e) {
      setError((e as Error).message ?? 'Geocode failed.');
    } finally {
      setSearching(false);
    }
  };

  const copyGeocodedAddress = () => {
    if (candidate?.label) {
      // Legacy behaviour: strip the leading label part (before the first
      // comma) and use the street-address portion.
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
          <button type="button" onClick={onClose} className="px-3 py-1 text-sm border border-border rounded">
            Cancel
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={!candidate || saving}
            className="px-3 py-1 text-sm bg-brand-purple text-white rounded disabled:opacity-50"
          >
            {saving ? 'Saving...' : `Apply to ${leg === 'ToAddress' ? 'delivery' : 'pickup'}`}
          </button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="flex gap-2">
          {(['ToAddress', 'FromAddress'] as const).map((k) => (
            <label
              key={k}
              className={`px-3 py-1 border rounded cursor-pointer ${
                leg === k ? 'bg-brand-cyan text-brand-dark border-brand-cyan' : 'border-border'
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
            <button
              type="button"
              onClick={doSearch}
              disabled={searching}
              className="px-3 py-1 bg-brand-cyan text-brand-dark rounded font-medium disabled:opacity-50"
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
          </div>
          {error && <div className="mt-2 text-error text-xs">{error}</div>}
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
      </div>
    </Modal>
  );
}
