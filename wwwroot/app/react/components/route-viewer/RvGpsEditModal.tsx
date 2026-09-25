import { useEffect, useRef, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useAuth } from '../../context/AuthContext';
import { tenantMapCentre } from '../../lib/mapDefaults';
import { routeViewerService, type BulkJob } from '../../services/routeViewerService';
import { useToast } from '../../context/ToastContext';

// Route Viewer GPS coordinate repair modal. Shows a Google Maps
// surface with a draggable marker over the currently-selected leg's
// coordinates; operator drags to correct + Save fires POST
// /api/runviewer/jobs/gps. Address + suburb + postcode are editable
// text inputs (no HERE forward geocode wire-up in this MVP - Tier 2
// integrates the same geocode path FixGpsModal uses in the Route
// Builder cockpit).

interface Props {
  job: BulkJob;
  leg: 'pickup' | 'delivery';
  onClose: () => void;
  onSaved: () => void;
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export function RvGpsEditModal({ job, leg, onClose, onSaved }: Props) {
  const user = useAuth();
  const toast = useToast();
  const apiKey = user.googleMapsKey;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialLat = leg === 'pickup' ? num(job.pickUpLatitude) : num(job.toLat ?? job.deliveryLatitude);
  const initialLng = leg === 'pickup' ? num(job.pickUpLongitude) : num(job.toLng ?? job.deliveryLongitude);
  const [lat, setLat] = useState<number | null>(initialLat);
  const [lng, setLng] = useState<number | null>(initialLng);
  const [address, setAddress] = useState<string>(leg === 'pickup' ? (job.fromAddress ?? '') : (job.toAddress ?? ''));
  const [suburb, setSuburb] = useState<string>(leg === 'pickup' ? (job.fromSuburb ?? '') : (job.toSuburb ?? ''));
  const [postCode, setPostCode] = useState<string>(String(leg === 'pickup' ? (job.fromPostCode ?? '') : (job.toPostCode ?? '')));

  // Wait for Google Maps SDK.
  useEffect(() => {
    if (!apiKey) return;
    const g = (window as any).google;
    if (g?.maps) { setMapReady(true); return; }
    const started = Date.now();
    const t = setInterval(() => {
      const g2 = (window as any).google;
      if (g2?.maps) { setMapReady(true); clearInterval(t); }
      else if (Date.now() - started > 20_000) clearInterval(t);
    }, 200);
    return () => clearInterval(t);
  }, [apiKey]);

  // Init map + draggable marker.
  useEffect(() => {
    if (!mapReady || !containerRef.current || mapRef.current) return;
    const g = (window as any).google;
    const centre = lat != null && lng != null ? { lat, lng } : tenantMapCentre(user.isUsTenant);
    const map = new g.maps.Map(containerRef.current, {
      center: centre,
      zoom: lat != null ? 15 : 5,
      mapTypeId: g.maps.MapTypeId.ROADMAP,
      gestureHandling: 'greedy',
    });
    mapRef.current = map;
    const marker = new g.maps.Marker({
      position: centre,
      map,
      draggable: true,
      title: 'Drag to correct GPS',
    });
    marker.addListener('dragend', (e: any) => {
      setLat(e.latLng.lat());
      setLng(e.latLng.lng());
    });
    map.addListener('rightclick', (e: any) => {
      marker.setPosition(e.latLng);
      setLat(e.latLng.lat());
      setLng(e.latLng.lng());
    });
    markerRef.current = marker;
  }, [mapReady, user.isUsTenant, lat, lng]);

  // Keep the marker + map in sync when lat/lng change via input edit.
  useEffect(() => {
    if (!markerRef.current || !mapRef.current) return;
    if (lat == null || lng == null) return;
    const pos = { lat, lng };
    markerRef.current.setPosition(pos);
    mapRef.current.setCenter(pos);
  }, [lat, lng]);

  const save = async () => {
    if (lat == null || lng == null) {
      setError('Pick a lat/lng before saving.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const postCodeNum = parseInt(postCode, 10);
      await routeViewerService.updateJobGps({
        bulkJobId: job.bulkJobId,
        leg,
        address,
        suburb,
        postCode: Number.isFinite(postCodeNum) ? postCodeNum : null,
        latitude: lat,
        longitude: lng,
      });
      toast.show('GPS updated', 'success');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Update GPS - ${leg === 'pickup' ? 'Pickup' : 'Delivery'} - Job ${job.jobNumber ?? job.bulkJobId}`}
      size="4xl"
      loading={saving}
      loadingMessage="Saving..."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving || lat == null || lng == null}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      }
    >
      {!apiKey && (
        <div className="mb-2 text-xs text-error">
          Google Maps API key not configured for this tenant.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm mb-2">
        <Field label="Address" value={address} onChange={setAddress} className="md:col-span-3" />
        <Field label="Suburb" value={suburb} onChange={setSuburb} />
        <Field label="Post code" value={postCode} onChange={setPostCode} />
        <div className="flex items-center text-text-muted text-xs">
          <span>Drag marker or right-click map to update lat/lng</span>
        </div>
        <Field label="Latitude" value={lat != null ? lat.toString() : ''} onChange={(v) => setLat(parseFloat(v) || null)} />
        <Field label="Longitude" value={lng != null ? lng.toString() : ''} onChange={(v) => setLng(parseFloat(v) || null)} />
      </div>

      <div ref={containerRef} className="w-full border border-border rounded" style={{ height: 420 }} />

      {error && <div className="mt-2 text-xs text-error">{error}</div>}
    </Modal>
  );
}

function Field({
  label, value, onChange, className,
}: {
  label: string; value: string; onChange: (v: string) => void; className?: string;
}) {
  return (
    <label className={`flex flex-col gap-0.5 ${className ?? ''}`}>
      <span className="text-xs text-text-muted">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-border rounded px-2 py-1 text-sm"
      />
    </label>
  );
}
