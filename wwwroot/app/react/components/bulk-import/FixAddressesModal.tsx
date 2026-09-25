import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { tenantMapCentre } from '../../lib/mapDefaults';
import {
  addressService,
  type AddressDto,
  type GeocodeAddressDto,
} from '../../services/addressService';
import type { WizardAction, WizardState } from './wizardState';

interface Props {
  open: boolean;
  state: WizardState;
  dispatch: (action: WizardAction) => void;
  onBack: () => void;
  onNext: () => void;
  onCancel: () => void;
}

interface FlaggedAddress {
  rowIndex: number;
  address: AddressDto;
  latitude: string | null;
  longitude: string | null;
  // 'to' = destination (default). 'from' = pickup origin. On-demand
  // batches especially need accurate pickup coords for dispatch.
  direction: 'to' | 'from';
}

/**
 * FixAddressesModal - Step 4. Sends the destination addresses to
 * /address/geocode; anything that comes back without a lat/lng is flagged
 * and rendered with a Google Maps pane so the operator can drag the marker
 * or type a corrected address. Uses @vis.gl/react-google-maps to embed the
 * map; the Google Maps JS API key is read off window.__APP_USER__.
 *
 * The map + places-autocomplete widgets are dynamically loaded so a build
 * that does not include the package at runtime still type-checks. In that
 * case the modal degrades to a lat/lng text input.
 */
export function FixAddressesModal({ open, state, dispatch, onBack, onNext, onCancel }: Props) {
  const auth = useAuth();
  const toast = useToast();
  const isUs = auth.isUsTenant || state.client?.isUsTenant || false;

  const [geocodedTo, setGeocodedTo] = useState<GeocodeAddressDto[]>([]);
  const [geocodedFrom, setGeocodedFrom] = useState<GeocodeAddressDto[]>([]);
  const [loading, setLoading] = useState(false);
  // Selection is now (rowIndex, direction) so an on-demand batch can flag
  // both the pickup and delivery on the same row.
  const [selected, setSelected] = useState<{ rowIndex: number; direction: 'to' | 'from' } | null>(null);
  const [searchAddress, setSearchAddress] = useState('');

  // Build the destination address list from the parsed data + current mapping.
  const toAddresses = useMemo(() => {
    if (!state.parsed) return [] as AddressDto[];
    const m = state.mapping;
    return state.parsed.rows.map((row) => ({
      address: (row[m.toAddress] ?? '').toString(),
      suburb: (row[m.toSuburb] ?? '').toString(),
      postCode: (row[m.toPostCode] ?? '').toString(),
      city: (row[m.toCity] ?? '').toString(),
      state: (row[m.toState] ?? '').toString(),
      zipCode: (row[m.toZipCode] ?? '').toString(),
    }));
  }, [state.mapping, state.parsed]);

  // Build the origin (pickup) address list too. Only meaningful when the
  // fromAddress column is mapped OR the batch is on-demand (needs pickup
  // coords). Blank fromAddress rows short-circuit the geocode call.
  const fromAddresses = useMemo(() => {
    if (!state.parsed) return [] as AddressDto[];
    const m = state.mapping;
    // If the operator hasn't mapped fromAddress, don't try to geocode.
    if (!m.fromAddress) return [];
    return state.parsed.rows.map((row) => ({
      address: (row[m.fromAddress] ?? '').toString(),
      suburb: (row[m.fromSuburb] ?? '').toString(),
      postCode: (row[m.fromPostCode] ?? '').toString(),
      city: (row[m.fromCity] ?? '').toString(),
      state: (row[m.fromState] ?? '').toString(),
      zipCode: (row[m.fromZipCode] ?? '').toString(),
    }));
  }, [state.mapping, state.parsed]);

  useEffect(() => {
    if (!open) return;
    if (toAddresses.length === 0 && fromAddresses.length === 0) {
      setGeocodedTo([]);
      setGeocodedFrom([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [toRes, fromRes] = await Promise.all([
          toAddresses.length > 0
            ? addressService.geocode({ addresses: toAddresses })
            : Promise.resolve({ response: { addresses: [] } }),
          fromAddresses.length > 0
            ? addressService.geocode({ addresses: fromAddresses })
            : Promise.resolve({ response: { addresses: [] } }),
        ]);
        if (cancelled) return;
        const toGeo = toRes.response.addresses ?? [];
        const fromGeo = fromRes.response.addresses ?? [];
        setGeocodedTo(toGeo);
        setGeocodedFrom(fromGeo);

        // Auto-write geocoded coords + HERE zip/postcode suggestions back
        // into wizard state so buildJobs picks them up on submit. Legacy
        // homeControl.js:sortByDepot (2985+) does the same: every
        // successfully-geocoded row gets its lat/lng written back onto the
        // job, and any HERE-corrected zip/postcode overrides the operator's
        // typo. Without this, rows that the FixAddresses step "resolves"
        // silently still ship to /import with null coords / bad zips and
        // fail rating downstream.
        const isUs = auth.isUsTenant || state.client?.isUsTenant || false;
        for (let i = 0; i < toGeo.length; i++) {
          const g = toGeo[i];
          const lat = g.latitude ? Number(g.latitude) : NaN;
          const lng = g.longitude ? Number(g.longitude) : NaN;
          if (Number.isFinite(lat) && Number.isFinite(lng) && !state.fixedAddresses[i]) {
            dispatch({
              type: 'SET_FIXED_ADDRESS',
              rowIndex: i,
              coords: { lat, lng },
            });
          }
          if (isUs && g.suggestedZipCode && g.zipCode && g.suggestedZipCode !== g.zipCode) {
            dispatch({
              type: 'SET_FIXED_ZIP',
              badZip: g.zipCode,
              corrected: g.suggestedZipCode,
            });
          }
          if (!isUs && g.suggestedPostCode && g.suburb) {
            const key = `${g.suburb.toLowerCase()}|${g.postCode ?? ''}`;
            if (!state.fixedZips[key]) {
              dispatch({
                type: 'SET_FIXED_ZIP',
                badZip: key,
                corrected: g.suburb,
              });
            }
          }
        }
        for (let i = 0; i < fromGeo.length; i++) {
          const g = fromGeo[i];
          const lat = g.latitude ? Number(g.latitude) : NaN;
          const lng = g.longitude ? Number(g.longitude) : NaN;
          if (Number.isFinite(lat) && Number.isFinite(lng) && !state.fixedFromAddresses[i]) {
            dispatch({
              type: 'SET_FIXED_FROM_ADDRESS',
              rowIndex: i,
              coords: { lat, lng },
            });
          }
        }
      } catch (e) {
        if (!cancelled) toast.show(`Geocode failed: ${(e as Error).message}`, 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, toAddresses, fromAddresses]);

  const flagged: FlaggedAddress[] = useMemo(() => {
    const list: FlaggedAddress[] = [];
    for (let i = 0; i < geocodedTo.length; i++) {
      const g = geocodedTo[i];
      const fixed = state.fixedAddresses[i];
      const lat = fixed ? String(fixed.lat) : g.latitude;
      const lng = fixed ? String(fixed.lng) : g.longitude;
      if (!lat || !lng) {
        list.push({ rowIndex: i, address: g, latitude: lat, longitude: lng, direction: 'to' });
      }
    }
    for (let i = 0; i < geocodedFrom.length; i++) {
      const g = geocodedFrom[i];
      const fixed = state.fixedFromAddresses[i];
      const lat = fixed ? String(fixed.lat) : g.latitude;
      const lng = fixed ? String(fixed.lng) : g.longitude;
      // Skip rows where fromAddress column is empty in the source - no pin
      // to fix.
      if ((g.address ?? '').trim().length === 0) continue;
      if (!lat || !lng) {
        list.push({ rowIndex: i, address: g, latitude: lat, longitude: lng, direction: 'from' });
      }
    }
    return list;
  }, [geocodedTo, geocodedFrom, state.fixedAddresses, state.fixedFromAddresses]);

  const active =
    selected != null
      ? flagged.find((f) => f.rowIndex === selected.rowIndex && f.direction === selected.direction)
      : null;

  const googleMapsKey =
    (typeof window !== 'undefined' && window.__APP_USER__?.googleMapsKey) || null;

  function saveCoords(lat: number, lng: number) {
    if (!selected) return;
    if (selected.direction === 'from') {
      dispatch({
        type: 'SET_FIXED_FROM_ADDRESS',
        rowIndex: selected.rowIndex,
        coords: { lat, lng },
      });
    } else {
      dispatch({
        type: 'SET_FIXED_ADDRESS',
        rowIndex: selected.rowIndex,
        coords: { lat, lng },
      });
    }
    toast.show('Location updated.', 'success');
  }

  function formatAddress(a: FlaggedAddress) {
    if (isUs) {
      const parts = [a.address.address, a.address.city, a.address.state, a.address.zipCode].filter(
        Boolean
      );
      return parts.join(', ');
    }
    const parts = [a.address.address, a.address.suburb || a.address.city, a.address.postCode].filter(
      Boolean
    );
    return parts.join(', ');
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Fix Addresses"
      loading={loading}
      loadingMessage="Geocoding destination addresses. This may take a moment for large batches."
      footer={
        <div className="flex justify-between items-center">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button variant="neutral" onClick={onBack}>
              Back
            </Button>
            <Button variant="primary" onClick={onNext}>
              Next
            </Button>
          </div>
        </div>
      }
    >
      <div className="max-h-[70vh] overflow-y-auto">
        {loading && (
          <p className="text-xs text-text-muted text-center py-3">Geocoding addresses...</p>
        )}
        {!loading && flagged.length === 0 && (
          <div className="text-sm text-success bg-success/10 border border-success/30 rounded px-3 py-2 text-center">
            Addresses seems OK.
          </div>
        )}
        {!loading && flagged.length > 0 && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-2">
              <p className="text-xs text-text-secondary mb-1">
                {flagged.length} flagged address{flagged.length === 1 ? '' : 'es'}. Click one to
                edit.
              </p>
              {flagged.map((f) => {
                const fixed =
                  f.direction === 'from'
                    ? state.fixedFromAddresses[f.rowIndex]
                    : state.fixedAddresses[f.rowIndex];
                const isSelected =
                  selected?.rowIndex === f.rowIndex && selected.direction === f.direction;
                const dirLabel = f.direction === 'from' ? 'Pickup' : 'Delivery';
                return (
                  <button
                    key={`${f.direction}-${f.rowIndex}`}
                    type="button"
                    onClick={() => {
                      setSelected({ rowIndex: f.rowIndex, direction: f.direction });
                      setSearchAddress(formatAddress(f));
                    }}
                    className={`block w-full text-left text-xs border rounded px-2 py-1.5 ${
                      isSelected
                        ? 'border-brand-cyan bg-brand-cyan/10'
                        : fixed
                          ? 'border-success/50 bg-success/5'
                          : 'border-error/50 bg-error/5'
                    }`}
                  >
                    <span className="inline-block mr-1.5 px-1.5 py-0.5 text-[10px] rounded bg-surface-cream text-text-secondary uppercase tracking-wide">
                      {dirLabel}
                    </span>
                    {formatAddress(f)}
                  </button>
                );
              })}
            </div>
            <div className="space-y-2">
              {active ? (
                <>
                  <label className="block text-xs font-medium text-text-secondary">
                    Search Address
                  </label>
                  <PlacesAutocompleteInput
                    apiKey={googleMapsKey}
                    value={searchAddress}
                    onChange={setSearchAddress}
                    isUsTenant={isUs}
                    onPlaceSelected={(place) => {
                      setSearchAddress(place.formatted);
                      saveCoords(place.lat, place.lng);
                    }}
                    placeholder="Type a corrected address..."
                  />
                  <MapPane
                    apiKey={googleMapsKey}
                    isUsTenant={isUs}
                    lat={active.latitude ? Number(active.latitude) : null}
                    lng={active.longitude ? Number(active.longitude) : null}
                    address={searchAddress}
                    onMove={saveCoords}
                  />
                  <p className="text-[11px] text-text-muted">
                    Pick a suggestion, right-click the map, or drag the marker to update the pin.
                    Coordinates save automatically.
                  </p>
                </>
              ) : (
                <div className="border border-dashed border-border rounded p-6 text-center text-xs text-text-muted h-full flex items-center justify-center">
                  Select a flagged address to fix.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

interface MapPaneProps {
  apiKey: string | null;
  isUsTenant: boolean;
  lat: number | null;
  lng: number | null;
  address: string;
  onMove: (lat: number, lng: number) => void;
}

/**
 * MapPane - dynamically imports @vis.gl/react-google-maps so the module
 * only loads when the modal actually renders a flagged address. Falls back
 * to a lat/lng input pair when the API key or the package is missing.
 */
function MapPane({ apiKey, isUsTenant, lat, lng, address, onMove }: MapPaneProps) {
  const [MapModule, setMapModule] = useState<any | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [manualLat, setManualLat] = useState(lat != null ? String(lat) : '');
  const [manualLng, setManualLng] = useState(lng != null ? String(lng) : '');

  useEffect(() => {
    setManualLat(lat != null ? String(lat) : '');
    setManualLng(lng != null ? String(lng) : '');
  }, [lat, lng]);

  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;
    // Dynamic import so the ~85 KB @vis.gl/react-google-maps bundle only
    // loads when the operator actually hits Step 4 with flagged addresses.
    // Vite emits it as a separate chunk (app-[name].js in the dist folder).
    (async () => {
      try {
        const mod = await import('@vis.gl/react-google-maps');
        if (!cancelled) setMapModule(mod);
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  const canRenderMap = !!apiKey && !!MapModule && !loadError;

  if (!canRenderMap) {
    return (
      <div className="border border-border rounded p-3 space-y-2 bg-surface-cream">
        <p className="text-[11px] text-warning">
          {apiKey
            ? 'Map failed to load. Enter coordinates manually.'
            : 'Google Maps API key not configured. Enter coordinates manually.'}
        </p>
        <label className="block text-xs">
          Latitude
          <input
            type="text"
            value={manualLat}
            onChange={(e) => setManualLat(e.target.value)}
            className="w-full mt-0.5 text-xs border border-border rounded px-2 py-1"
          />
        </label>
        <label className="block text-xs">
          Longitude
          <input
            type="text"
            value={manualLng}
            onChange={(e) => setManualLng(e.target.value)}
            className="w-full mt-0.5 text-xs border border-border rounded px-2 py-1"
          />
        </label>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            const la = Number(manualLat);
            const ln = Number(manualLng);
            if (!Number.isFinite(la) || !Number.isFinite(ln)) return;
            onMove(la, ln);
          }}
        >
          Save Coordinates
        </Button>
      </div>
    );
  }

  const { APIProvider, Map, AdvancedMarker } = MapModule;
  const fallback = tenantMapCentre(isUsTenant);
  const centre = { lat: lat ?? fallback.lat, lng: lng ?? fallback.lng };
  return (
    <div className="h-64 rounded overflow-hidden border border-border">
      <APIProvider apiKey={apiKey}>
        <Map
          mapId="bulk-import-fix-address"
          defaultCenter={centre}
          defaultZoom={14}
          gestureHandling="greedy"
          onClick={(e: any) => {
            if (e?.detail?.latLng) {
              onMove(e.detail.latLng.lat, e.detail.latLng.lng);
            }
          }}
        >
          {lat != null && lng != null && (
            <AdvancedMarker
              position={{ lat, lng }}
              draggable
              onDragEnd={(e: any) => {
                const p = e?.latLng;
                if (!p) return;
                const la = typeof p.lat === 'function' ? p.lat() : p.lat;
                const ln = typeof p.lng === 'function' ? p.lng() : p.lng;
                onMove(la, ln);
              }}
            />
          )}
        </Map>
      </APIProvider>
      {address && (
        <div className="px-2 py-1 text-[10px] text-text-muted truncate">Searching: {address}</div>
      )}
    </div>
  );
}

interface PlaceHit {
  formatted: string;
  lat: number;
  lng: number;
}

interface PlacesAutocompleteInputProps {
  apiKey: string | null;
  value: string;
  onChange: (v: string) => void;
  isUsTenant: boolean;
  onPlaceSelected: (place: PlaceHit) => void;
  placeholder?: string;
}

/**
 * PlacesAutocompleteInput - dropdown-driven address search using Google
 * Places AutocompleteService + PlacesService. Mirrors the legacy
 * `ng-map-autocomplete` widget: 300 ms debounce, 5 suggestions, country
 * restriction by tenant. Falls back to a plain input when the API key is
 * missing or the module fails to load.
 *
 * Uses the browser-embedded google.maps global rather than a React hook so
 * we can keep the module in the same lazy-loaded bundle as the Map itself.
 */
function PlacesAutocompleteInput({
  apiKey,
  value,
  onChange,
  isUsTenant,
  onPlaceSelected,
  placeholder,
}: PlacesAutocompleteInputProps) {
  const [suggestions, setSuggestions] = useState<
    Array<{ description: string; place_id: string }>
  >([]);
  const [open, setOpen] = useState(false);
  const [placesReady, setPlacesReady] = useState(false);
  const autoSvc = useRef<any>(null);
  const placesSvc = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Lazy-load the Places library once the input renders. Uses window.google
  // if already loaded by the Map's APIProvider; otherwise pulls a fresh
  // script tag from Google.
  useEffect(() => {
    if (!apiKey || placesReady) return;
    let cancelled = false;
    const load = async () => {
      // If google.maps is already present (Map component initialised it)
      // just wait for the places library to be importable.
      const w = window as any;
      if (w.google?.maps?.places) {
        setPlacesReady(true);
        return;
      }
      // Otherwise inject the loader. Places is included in the standard
      // Maps JS API script when libraries=places is set.
      const existing = document.querySelector(`script[data-places-loader="1"]`);
      if (existing) {
        // Poll for readiness (script already loading).
        const wait = () => {
          if (cancelled) return;
          if ((window as any).google?.maps?.places) setPlacesReady(true);
          else window.setTimeout(wait, 100);
        };
        wait();
        return;
      }
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&loading=async`;
      script.async = true;
      script.defer = true;
      script.setAttribute('data-places-loader', '1');
      script.onload = () => {
        if (!cancelled) setPlacesReady(true);
      };
      document.head.appendChild(script);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [apiKey, placesReady]);

  useEffect(() => {
    if (!placesReady) return;
    const g = (window as any).google;
    if (!g?.maps?.places) return;
    autoSvc.current = new g.maps.places.AutocompleteService();
    // PlacesService needs an attachment DOM node - a hidden div works.
    const hidden = document.createElement('div');
    placesSvc.current = new g.maps.places.PlacesService(hidden);
  }, [placesReady]);

  // Debounced predictions.
  useEffect(() => {
    const q = value.trim();
    if (!placesReady || q.length < 3 || !autoSvc.current) {
      setSuggestions([]);
      return;
    }
    const handle = window.setTimeout(() => {
      autoSvc.current.getPlacePredictions(
        {
          input: q,
          componentRestrictions: { country: isUsTenant ? 'us' : 'nz' },
        },
        (results: any[] | null) => {
          setSuggestions(
            (results ?? []).slice(0, 5).map((r) => ({
              description: r.description,
              place_id: r.place_id,
            }))
          );
        }
      );
    }, 300);
    return () => window.clearTimeout(handle);
  }, [value, isUsTenant, placesReady]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const pick = (placeId: string, description: string) => {
    if (!placesSvc.current) return;
    placesSvc.current.getDetails(
      { placeId, fields: ['geometry', 'formatted_address'] },
      (res: any) => {
        if (!res?.geometry?.location) return;
        const loc = res.geometry.location;
        const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
        const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
        onPlaceSelected({
          formatted: res.formatted_address ?? description,
          lat,
          lng,
        });
        setOpen(false);
        setSuggestions([]);
      }
    );
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={value}
        placeholder={placeholder ?? 'Type a corrected address...'}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="w-full text-sm border border-border rounded px-2 py-1.5"
      />
      {open && suggestions.length > 0 && (
        <ul
          className="absolute z-30 mt-1 w-full bg-surface-white border border-border rounded shadow-lg max-h-56 overflow-auto"
          role="listbox"
        >
          {suggestions.map((s) => (
            <li
              key={s.place_id}
              role="option"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s.place_id, s.description);
              }}
              className="px-3 py-2 text-xs cursor-pointer hover:bg-brand-cyan/10"
            >
              {s.description}
            </li>
          ))}
        </ul>
      )}
      {!apiKey && (
        <p className="text-[10px] text-warning mt-1">
          Places search unavailable (no Google Maps key configured).
        </p>
      )}
    </div>
  );
}
