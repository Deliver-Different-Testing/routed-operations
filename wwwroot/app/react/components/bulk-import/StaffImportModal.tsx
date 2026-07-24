import { useEffect, useMemo, useReducer, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import StepWizard from '../common/StepWizard';
import FileUploadZone from '../import/FileUploadZone';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { tenantMapCentre } from '../../lib/mapDefaults';
import {
  bulkImportService,
  type FailedJobDto,
  type ParsedFile,
  type StaffImportResponse,
} from '../../services/bulkImportService';
import {
  addressService,
  type SuburbDto,
  type GeocodeAddressDto,
  type AddressDto,
} from '../../services/addressService';

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

// -----------------------------------------------------------------------------
// State machine. Mirrors BulkImportHyper homeControl.js:4673 - one `step`
// discriminator + a few collections. `submitting` guards the async fires so
// the Next / Import button can disable while a batch call is in flight.
// -----------------------------------------------------------------------------

type Step =
  | 'upload'
  | 'preview'
  | 'fixSuburbs'
  | 'fixAddresses'
  | 'confirm'
  | 'result';

interface FlaggedSuburb {
  name: string;
  postCode: string | null;
  replace: string | null;      // corrected suburb name
}

interface FlaggedAddress {
  address: string;
  suburb: string | null;
  postCode: string | null;
  latitude: string | null;
  longitude: string | null;
  isOrigin: boolean;
}

interface State {
  step: Step;
  file: File | null;
  parsed: ParsedFile | null;
  // Backend accepts the raw row dictionaries wholesale. We keep the mutable
  // copy so Fix Suburbs / Fix Addresses can stamp corrected values in place
  // (matches BulkImportHyper's approach of writing back onto job[key]).
  rows: Record<string, string>[];
  flaggedSuburbs: FlaggedSuburb[];
  flaggedAddresses: FlaggedAddress[];
  geocodeData: GeocodeAddressDto[];
  selectedFlaggedIdx: number | null;
  result: StaffImportResponse | null;
  submitting: boolean;
  error: string | null;
}

type Action =
  | { type: 'RESET' }
  | { type: 'SET_STEP'; step: Step }
  | { type: 'SET_FILE'; file: File | null }
  | { type: 'SET_PARSED'; parsed: ParsedFile }
  | { type: 'SET_FLAGGED_SUBURBS'; suburbs: FlaggedSuburb[] }
  | { type: 'SET_SUBURB_FIX'; name: string; replace: string }
  | { type: 'APPLY_SUBURB_FIXES' }
  | { type: 'SET_GEOCODE_RESULTS'; results: GeocodeAddressDto[] }
  | { type: 'SET_FLAGGED_ADDRESSES'; addresses: FlaggedAddress[] }
  | { type: 'SET_SELECTED_FLAGGED'; idx: number | null }
  | { type: 'SET_ADDRESS_COORDS'; idx: number; lat: number; lng: number }
  | { type: 'APPLY_GEOCODES' }
  | { type: 'START_SUBMIT' }
  | { type: 'SET_RESULT'; result: StaffImportResponse }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'END_SUBMIT' };

function initialState(): State {
  return {
    step: 'upload',
    file: null,
    parsed: null,
    rows: [],
    flaggedSuburbs: [],
    flaggedAddresses: [],
    geocodeData: [],
    selectedFlaggedIdx: null,
    result: null,
    submitting: false,
    error: null,
  };
}

// Case-insensitive column lookup used by every "get value from row" call.
// Mirrors homeControl.js:4803-4821 getStaffJobFieldValue.
function pickRowValue(
  row: Record<string, string>,
  candidates: string[]
): string | null {
  for (const c of candidates) {
    if (row[c] != null && row[c] !== '') return row[c];
  }
  // Case-insensitive fallback.
  const lowered = candidates.map((c) => c.toLowerCase());
  for (const key of Object.keys(row)) {
    if (lowered.includes(key.toLowerCase()) && row[key] != null && row[key] !== '') {
      return row[key];
    }
  }
  return null;
}

function findRowKey(row: Record<string, string>, candidates: string[]): string | null {
  const lowered = candidates.map((c) => c.toLowerCase());
  for (const key of Object.keys(row)) {
    if (lowered.includes(key.toLowerCase())) return key;
  }
  return null;
}

const FROM_SUBURB_KEYS = ['FromSuburb', 'From Suburb', 'fromsuburb'];
const TO_SUBURB_KEYS = ['ToSuburb', 'To Suburb', 'tosuburb'];
const FROM_POSTCODE_KEYS = ['FromPostCode', 'From PostCode', 'frompostcode'];
const TO_POSTCODE_KEYS = ['ToPostCode', 'To PostCode', 'topostcode'];
const FROM_ADDRESS_KEYS = ['FromAddress', 'From Address', 'fromaddress'];
const TO_ADDRESS_KEYS = ['ToAddress', 'To Address', 'toaddress'];
const FROM_LAT_KEYS = ['PickUpLatitude', 'Pickup Latitude', 'pickuplatitude', 'fromLat'];
const FROM_LNG_KEYS = ['PickUpLongitude', 'Pickup Longitude', 'pickuplongitude', 'fromLng'];
const TO_LAT_KEYS = ['DeliveryLatitude', 'Delivery Latitude', 'deliverylatitude', 'toLat'];
const TO_LNG_KEYS = ['DeliveryLongitude', 'Delivery Longitude', 'deliverylongitude', 'toLng'];

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'RESET':
      return initialState();
    case 'SET_STEP':
      return { ...state, step: action.step, error: null };
    case 'SET_FILE':
      return { ...state, file: action.file, error: null };
    case 'SET_PARSED':
      return { ...state, parsed: action.parsed, rows: action.parsed.rows.map((r) => ({ ...r })) };
    case 'SET_FLAGGED_SUBURBS':
      return { ...state, flaggedSuburbs: action.suburbs };
    case 'SET_SUBURB_FIX':
      return {
        ...state,
        flaggedSuburbs: state.flaggedSuburbs.map((f) =>
          f.name === action.name ? { ...f, replace: action.replace } : f
        ),
      };
    case 'APPLY_SUBURB_FIXES': {
      // Walk every row and overwrite the flagged suburb string in place.
      // Matches homeControl.js:4886-4913.
      const rows = state.rows.map((row) => {
        const next = { ...row };
        state.flaggedSuburbs.forEach((flagged) => {
          if (!flagged.replace) return;
          const fromKey = findRowKey(next, FROM_SUBURB_KEYS);
          if (fromKey && next[fromKey] && next[fromKey].toLowerCase() === flagged.name.toLowerCase()) {
            next[fromKey] = flagged.replace;
          }
          const toKey = findRowKey(next, TO_SUBURB_KEYS);
          if (toKey && next[toKey] && next[toKey].toLowerCase() === flagged.name.toLowerCase()) {
            next[toKey] = flagged.replace;
          }
        });
        return next;
      });
      return { ...state, rows };
    }
    case 'SET_GEOCODE_RESULTS':
      return { ...state, geocodeData: [...state.geocodeData, ...action.results] };
    case 'SET_FLAGGED_ADDRESSES':
      return { ...state, flaggedAddresses: action.addresses, selectedFlaggedIdx: action.addresses.length > 0 ? 0 : null };
    case 'SET_SELECTED_FLAGGED':
      return { ...state, selectedFlaggedIdx: action.idx };
    case 'SET_ADDRESS_COORDS': {
      const next = state.flaggedAddresses.map((f, i) =>
        i === action.idx ? { ...f, latitude: String(action.lat), longitude: String(action.lng) } : f
      );
      // Also push into geocodeData so applyGeocodes finds it.
      const fixed = next[action.idx];
      const geocodeData = [
        ...state.geocodeData,
        {
          address: fixed.address,
          suburb: fixed.suburb,
          postCode: fixed.postCode,
          city: null,
          state: null,
          zipCode: null,
          latitude: String(action.lat),
          longitude: String(action.lng),
          geoType: null,
        } as GeocodeAddressDto,
      ];
      return { ...state, flaggedAddresses: next, geocodeData };
    }
    case 'APPLY_GEOCODES': {
      // Stamp lat/lng back onto each row dict using pickup/delivery column
      // names the backend already accepts. Mirrors homeControl.js:5232-5268.
      const rows = state.rows.map((row) => {
        const next = { ...row };
        const fromAddress = pickRowValue(next, FROM_ADDRESS_KEYS);
        const fromSuburb = pickRowValue(next, FROM_SUBURB_KEYS);
        const toAddress = pickRowValue(next, TO_ADDRESS_KEYS);
        const toSuburb = pickRowValue(next, TO_SUBURB_KEYS);

        if (fromAddress) {
          const g = state.geocodeData.find(
            (r) =>
              r.address && r.address.toLowerCase() === fromAddress.toLowerCase() &&
              (!fromSuburb || (r.suburb && r.suburb.toLowerCase() === fromSuburb.toLowerCase()))
          );
          if (g && g.latitude && g.longitude) {
            next['PickUpLatitude'] = String(g.latitude);
            next['PickUpLongitude'] = String(g.longitude);
          }
        }
        if (toAddress) {
          const g = state.geocodeData.find(
            (r) =>
              r.address && r.address.toLowerCase() === toAddress.toLowerCase() &&
              (!toSuburb || (r.suburb && r.suburb.toLowerCase() === toSuburb.toLowerCase()))
          );
          if (g && g.latitude && g.longitude) {
            next['DeliveryLatitude'] = String(g.latitude);
            next['DeliveryLongitude'] = String(g.longitude);
          }
        }
        return next;
      });
      return { ...state, rows };
    }
    case 'START_SUBMIT':
      return { ...state, submitting: true, error: null };
    case 'SET_RESULT':
      return { ...state, result: action.result, submitting: false };
    case 'SET_ERROR':
      return { ...state, error: action.error, submitting: false };
    case 'END_SUBMIT':
      return { ...state, submitting: false };
    default:
      return state;
  }
}

// -----------------------------------------------------------------------------
// Utility - rewrite the SQL unique-key constraint error to something the
// operator can act on. Matches homeControl.js:5302-5304.
// -----------------------------------------------------------------------------

function friendlyError(msg: string | null | undefined): string {
  if (!msg) return '-';
  if (msg.includes('UNIQUE KEY constraint') && msg.includes('ucjbNumber')) {
    return 'Job number already exists in the system';
  }
  return msg;
}

// -----------------------------------------------------------------------------
// StaffImportModal - 5-step wizard for direct-insert staff jobs. Only
// rendered when isInternal && !isUsTenant (see BulkImport.tsx). Backend gate
// (Internal + CountryCode == 'NZ') enforces the same defensively.
//
// Steps: Upload -> Preview -> Fix Suburbs -> Fix Addresses -> Confirm.
// Result view sits under `step === 'result'`.
// -----------------------------------------------------------------------------

export function StaffImportModal({ open, onClose, onImported }: Props) {
  const toast = useToast();
  const auth = useAuth();
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [suburbs, setSuburbs] = useState<SuburbDto[]>([]);
  const [suburbsLoading, setSuburbsLoading] = useState(false);
  const [geocoding, setGeocoding] = useState(false);

  const rowCount = state.rows.length;

  function handleClose() {
    dispatch({ type: 'RESET' });
    setSuburbs([]);
    onClose();
  }

  async function handleParse() {
    if (!state.file) return;
    dispatch({ type: 'START_SUBMIT' });
    try {
      const { response } = await bulkImportService.uploadFile(state.file);
      const headers = response.headers ?? [];
      // Mirror homeControl.js:4779-4786 - ClientID or ClientCode column
      // must be present. Case-insensitive; also accepts Client_ID.
      const hasClientId = headers.some((h) => {
        const l = h.toLowerCase();
        return l === 'clientid' || l === 'client_id' || l === 'clientcode';
      });
      if (!hasClientId) {
        dispatch({
          type: 'SET_ERROR',
          error: 'Staff Import requires ClientID or ClientCode column per row.',
        });
        return;
      }
      if (response.rows.length === 0) {
        dispatch({ type: 'SET_ERROR', error: 'No data rows found in the uploaded file.' });
        return;
      }
      dispatch({ type: 'SET_PARSED', parsed: response });
      dispatch({ type: 'SET_STEP', step: 'preview' });
    } catch (e) {
      dispatch({ type: 'SET_ERROR', error: `Parse failed: ${(e as Error).message}` });
    } finally {
      dispatch({ type: 'END_SUBMIT' });
    }
  }

  // Load the suburbs reference list once we enter Fix Suburbs.
  useEffect(() => {
    if (!open) return;
    if (state.step !== 'fixSuburbs') return;
    if (suburbs.length > 0) return;
    let cancelled = false;
    (async () => {
      setSuburbsLoading(true);
      try {
        const { response } = await addressService.getSuburbs();
        if (!cancelled) setSuburbs(response.suburbs ?? []);
      } catch (e) {
        if (!cancelled) toast.show(`Failed to load suburbs: ${(e as Error).message}`, 'error');
      } finally {
        if (!cancelled) setSuburbsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, state.step, suburbs.length, toast]);

  // When suburbs land and we are on step 3, compute the flagged list.
  useEffect(() => {
    if (state.step !== 'fixSuburbs') return;
    if (suburbsLoading) return;
    if (state.flaggedSuburbs.length > 0) return;
    const knownSet = new Set(
      suburbs.map((s) => (s.name ?? '').trim().toLowerCase()).filter((n) => n.length > 0)
    );
    // If the reference list is empty (misconfigured tenant) treat every
    // suburb as fine rather than force-block the operator.
    if (knownSet.size === 0) return;
    const seen = new Set<string>();
    const flagged: FlaggedSuburb[] = [];
    state.rows.forEach((row) => {
      const from = pickRowValue(row, FROM_SUBURB_KEYS);
      const to = pickRowValue(row, TO_SUBURB_KEYS);
      const fromPc = pickRowValue(row, FROM_POSTCODE_KEYS);
      const toPc = pickRowValue(row, TO_POSTCODE_KEYS);
      const consider = [
        { name: from, postCode: fromPc },
        { name: to, postCode: toPc },
      ];
      consider.forEach((s) => {
        if (!s.name) return;
        const key = `${s.name.toLowerCase()}|${(s.postCode ?? '').toLowerCase()}`;
        if (seen.has(key)) return;
        seen.add(key);
        if (!knownSet.has(s.name.trim().toLowerCase())) {
          flagged.push({ name: s.name, postCode: s.postCode, replace: null });
        }
      });
    });
    if (flagged.length > 0) {
      dispatch({ type: 'SET_FLAGGED_SUBURBS', suburbs: flagged });
    }
  }, [state.step, state.rows, state.flaggedSuburbs.length, suburbs, suburbsLoading]);

  // Fix Addresses: batch-geocode when we land on step 4.
  useEffect(() => {
    if (!open) return;
    if (state.step !== 'fixAddresses') return;
    if (state.geocodeData.length > 0) return;
    if (state.rows.length === 0) return;

    // Build the unique from + to address list (only for rows missing lat/lng).
    const seen = new Set<string>();
    const addresses: AddressDto[] = [];
    state.rows.forEach((row) => {
      const fromAddress = pickRowValue(row, FROM_ADDRESS_KEYS);
      const fromSuburb = pickRowValue(row, FROM_SUBURB_KEYS);
      const fromPostCode = pickRowValue(row, FROM_POSTCODE_KEYS);
      const fromLat = pickRowValue(row, FROM_LAT_KEYS);
      const fromLng = pickRowValue(row, FROM_LNG_KEYS);
      if (fromAddress && (!fromLat || !fromLng)) {
        const key = `${fromAddress}|${fromSuburb ?? ''}|${fromPostCode ?? ''}`.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          addresses.push({ address: fromAddress, suburb: fromSuburb, postCode: fromPostCode });
        }
      }
      const toAddress = pickRowValue(row, TO_ADDRESS_KEYS);
      const toSuburb = pickRowValue(row, TO_SUBURB_KEYS);
      const toPostCode = pickRowValue(row, TO_POSTCODE_KEYS);
      const toLat = pickRowValue(row, TO_LAT_KEYS);
      const toLng = pickRowValue(row, TO_LNG_KEYS);
      if (toAddress && (!toLat || !toLng)) {
        const key = `${toAddress}|${toSuburb ?? ''}|${toPostCode ?? ''}`.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          addresses.push({ address: toAddress, suburb: toSuburb, postCode: toPostCode });
        }
      }
    });

    if (addresses.length === 0) {
      // Nothing to geocode; no flags either.
      dispatch({ type: 'SET_FLAGGED_ADDRESSES', addresses: [] });
      return;
    }

    let cancelled = false;
    (async () => {
      setGeocoding(true);
      try {
        const { response } = await addressService.geocode({ addresses });
        if (cancelled) return;
        const results = response.addresses ?? [];
        dispatch({ type: 'SET_GEOCODE_RESULTS', results });
        // Flag anything that came back without lat/lng.
        const flags: FlaggedAddress[] = [];
        addresses.forEach((a) => {
          const found = results.find(
            (r) =>
              r.address && a.address && r.address.toLowerCase() === a.address.toLowerCase() &&
              (!a.suburb || (r.suburb && r.suburb.toLowerCase() === a.suburb.toLowerCase()))
          );
          if (!found || !found.latitude || !found.longitude) {
            flags.push({
              address: a.address,
              suburb: a.suburb ?? null,
              postCode: a.postCode ?? null,
              latitude: found?.latitude ?? null,
              longitude: found?.longitude ?? null,
              isOrigin: false,
            });
          }
        });
        dispatch({ type: 'SET_FLAGGED_ADDRESSES', addresses: flags });
      } catch (e) {
        if (!cancelled) toast.show(`Geocode failed: ${(e as Error).message}`, 'error');
      } finally {
        if (!cancelled) setGeocoding(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, state.step, state.rows, state.geocodeData.length, toast]);

  const suburbsUnfixed = useMemo(
    () => state.flaggedSuburbs.filter((f) => !f.replace).length,
    [state.flaggedSuburbs]
  );

  const addressesUnfixed = useMemo(
    () => state.flaggedAddresses.filter((f) => !f.latitude || !f.longitude).length,
    [state.flaggedAddresses]
  );

  async function fireImport() {
    dispatch({ type: 'START_SUBMIT' });
    try {
      // Apply geocoded coordinates to a fresh copy of the rows before
      // submitting. The reducer's APPLY_GEOCODES exists for state parity /
      // debugging but we recompute here so the payload is guaranteed to see
      // the latest geocodeData without a re-render round-trip.
      const rowsWithCoords = state.rows.map((row) => {
        const next = { ...row };
        const fromAddress = pickRowValue(next, FROM_ADDRESS_KEYS);
        const fromSuburb = pickRowValue(next, FROM_SUBURB_KEYS);
        const toAddress = pickRowValue(next, TO_ADDRESS_KEYS);
        const toSuburb = pickRowValue(next, TO_SUBURB_KEYS);
        if (fromAddress) {
          const g = state.geocodeData.find(
            (r) =>
              r.address && r.address.toLowerCase() === fromAddress.toLowerCase() &&
              (!fromSuburb || (r.suburb && r.suburb.toLowerCase() === fromSuburb.toLowerCase()))
          );
          if (g && g.latitude && g.longitude) {
            next['PickUpLatitude'] = String(g.latitude);
            next['PickUpLongitude'] = String(g.longitude);
          }
        }
        if (toAddress) {
          const g = state.geocodeData.find(
            (r) =>
              r.address && r.address.toLowerCase() === toAddress.toLowerCase() &&
              (!toSuburb || (r.suburb && r.suburb.toLowerCase() === toSuburb.toLowerCase()))
          );
          if (g && g.latitude && g.longitude) {
            next['DeliveryLatitude'] = String(g.latitude);
            next['DeliveryLongitude'] = String(g.longitude);
          }
        }
        return next;
      });

      const { response } = await bulkImportService.staffImport(
        rowsWithCoords as unknown as Array<Record<string, unknown>>
      );
      dispatch({ type: 'SET_RESULT', result: response });
      dispatch({ type: 'SET_STEP', step: 'result' });
      const msg = response.messages?.[0]?.message;
      if (response.success) {
        toast.show(msg ?? `Imported ${response.successCount} jobs.`, 'success');
        onImported();
      } else {
        toast.show(msg ?? 'Staff import completed with errors.', 'warning');
      }
    } catch (e) {
      dispatch({ type: 'SET_ERROR', error: `Staff import failed: ${(e as Error).message}` });
    } finally {
      dispatch({ type: 'END_SUBMIT' });
    }
  }

  // Step wizard mapping. `result` reuses the confirm step slot in the strip.
  const stepLabels = ['Upload', 'Preview', 'Fix Suburbs', 'Fix Addresses', 'Confirm'];
  const stepIndex: Record<Step, number> = {
    upload: 1,
    preview: 2,
    fixSuburbs: 3,
    fixAddresses: 4,
    confirm: 5,
    result: 5,
  };

  const previewHeaders = state.parsed?.headers ?? [];
  const previewRows = state.rows.slice(0, 50);

  // Detect legacy field names so we can hint at how they map on the server.
  const legacyFields = useMemo(() => {
    const legacy = ['DeliveryDate', 'ContactName', 'CompanyName', 'Items', 'Email', 'Mobile', 'RemoteScreen', 'fromLat', 'fromLng', 'toLat', 'toLng'];
    return previewHeaders.filter((h) => legacy.some((l) => l.toLowerCase() === h.toLowerCase()));
  }, [previewHeaders]);

  const activeFlagged =
    state.selectedFlaggedIdx != null ? state.flaggedAddresses[state.selectedFlaggedIdx] : null;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Staff Import - Direct to Live Table"
      size="4xl"
      footer={renderFooter()}
    >
      <div className="space-y-3">
        <StepWizard steps={stepLabels} current={stepIndex[state.step]} />

        {state.error && (
          <div className="p-2 bg-error/10 border border-error/30 rounded text-xs text-error">
            {state.error}
          </div>
        )}

        {state.step === 'upload' && renderUpload()}
        {state.step === 'preview' && renderPreview()}
        {state.step === 'fixSuburbs' && renderFixSuburbs()}
        {state.step === 'fixAddresses' && renderFixAddresses()}
        {state.step === 'confirm' && renderConfirm()}
        {state.step === 'result' && renderResult()}
      </div>
    </Modal>
  );

  // ---------------------------------------------------------------------------
  // View renderers. Kept as inner functions so they close over dispatch /
  // state without extra prop plumbing (five short views, one modal).
  // ---------------------------------------------------------------------------

  function renderUpload() {
    return (
      <div className="space-y-2">
        <div className="p-2 bg-warning/10 border border-warning/30 rounded text-xs text-text-primary">
          <strong>Staff Import Mode:</strong> This wizard reads data from the
          spreadsheet and inserts directly into the live job table (tucJob).
          Each row must contain a <code>ClientID</code> or{' '}
          <code>ClientCode</code> column. Job number auto-generates when
          blank or set to <code>AUTOGENERATE</code>.
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">
            Import File
          </label>
          <FileUploadZone
            onFileSelected={(f) => dispatch({ type: 'SET_FILE', file: f })}
            fileName={state.file?.name ?? null}
            fileSize={state.file?.size ?? null}
            isLoading={state.submitting}
            disabled={state.submitting}
          />
        </div>
      </div>
    );
  }

  function renderPreview() {
    return (
      <div className="space-y-2">
        <p className="text-xs text-text-secondary">
          Parsed {rowCount} row{rowCount === 1 ? '' : 's'}. Showing first{' '}
          {previewRows.length}.
        </p>
        {legacyFields.length > 0 && (
          <div className="p-2 bg-brand-cyan/10 border border-brand-cyan/30 rounded text-[11px] text-text-primary">
            <strong>Legacy field names detected:</strong> {legacyFields.join(', ')}. These
            will be mapped on the server (e.g. <code>DeliveryDate</code> -&gt;{' '}
            <code>BookDate</code>, <code>ContactName</code> -&gt; <code>FromContact</code>).
          </div>
        )}
        <div className="overflow-auto border border-border rounded max-h-[420px]">
          <table className="w-full text-[11px]">
            <thead className="bg-surface-cream text-text-secondary sticky top-0">
              <tr>
                {previewHeaders.map((h) => (
                  <th key={h} className="text-left px-2 py-1 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((r, i) => (
                <tr key={i} className="border-t border-border-light">
                  {previewHeaders.map((h) => (
                    <td key={h} className="px-2 py-1 whitespace-nowrap">
                      {String(r[h] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderFixSuburbs() {
    return (
      <div className="max-h-[60vh] overflow-y-auto">
        {suburbsLoading && (
          <p className="text-xs text-text-muted text-center py-3">
            Loading suburbs reference list...
          </p>
        )}
        {!suburbsLoading && state.flaggedSuburbs.length === 0 && (
          <div className="text-sm text-success bg-success/10 border border-success/30 rounded px-3 py-2 text-center">
            Suburbs seems OK.
          </div>
        )}
        {!suburbsLoading && state.flaggedSuburbs.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-text-muted">
              The following suburbs were not found in the reference list. Pick a valid
              replacement for each - all rows containing the flagged value will be updated.
            </p>
            {state.flaggedSuburbs.map((flagged) => (
              <div key={flagged.name} className="grid grid-cols-2 gap-3 items-center">
                <div className="border border-warning/40 bg-warning/5 rounded px-2 py-1.5 text-sm text-text-primary">
                  {flagged.name}
                  {flagged.postCode && (
                    <span className="text-text-muted ml-1">({flagged.postCode})</span>
                  )}
                </div>
                <select
                  value={flagged.replace ?? ''}
                  onChange={(e) =>
                    dispatch({
                      type: 'SET_SUBURB_FIX',
                      name: flagged.name,
                      replace: e.target.value,
                    })
                  }
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-surface-white"
                >
                  <option value="">Choose Suburb...</option>
                  {suburbs.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                      {s.postCode ? ` (${s.postCode})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderFixAddresses() {
    return (
      <div className="max-h-[70vh] overflow-y-auto">
        {geocoding && (
          <p className="text-xs text-text-muted text-center py-3">Geocoding addresses...</p>
        )}
        {!geocoding && state.flaggedAddresses.length === 0 && (
          <div className="text-sm text-success bg-success/10 border border-success/30 rounded px-3 py-2 text-center">
            Addresses seems OK.
          </div>
        )}
        {!geocoding && addressesUnfixed > 0 && (
          <div className="text-xs text-warning bg-warning/10 border border-warning/30 rounded px-3 py-2 mb-2">
            {addressesUnfixed} address{addressesUnfixed === 1 ? '' : 'es'} still without
            coordinates. You may proceed - the row will be inserted with empty coordinates
            and can be geocoded later.
          </div>
        )}
        {!geocoding && state.flaggedAddresses.length > 0 && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-2">
              <p className="text-xs text-text-secondary mb-1">
                {state.flaggedAddresses.length} flagged address
                {state.flaggedAddresses.length === 1 ? '' : 'es'}. Click one to edit.
              </p>
              {state.flaggedAddresses.map((f, i) => {
                const fixed = f.latitude && f.longitude;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => dispatch({ type: 'SET_SELECTED_FLAGGED', idx: i })}
                    className={`block w-full text-left text-xs border rounded px-2 py-1.5 ${
                      state.selectedFlaggedIdx === i
                        ? 'border-brand-cyan bg-brand-cyan/10'
                        : fixed
                          ? 'border-success/50 bg-success/5'
                          : 'border-error/50 bg-error/5'
                    }`}
                  >
                    {[f.address, f.suburb, f.postCode].filter(Boolean).join(', ')}
                  </button>
                );
              })}
            </div>
            <div className="space-y-2">
              {activeFlagged ? (
                <StaffAddressEditor
                  address={activeFlagged}
                  isUsTenant={auth.isUsTenant || false}
                  googleMapsKey={
                    (typeof window !== 'undefined' && window.__APP_USER__?.googleMapsKey) || null
                  }
                  onSave={(lat, lng) => {
                    if (state.selectedFlaggedIdx == null) return;
                    dispatch({
                      type: 'SET_ADDRESS_COORDS',
                      idx: state.selectedFlaggedIdx,
                      lat,
                      lng,
                    });
                    toast.show('Location updated.', 'success');
                  }}
                />
              ) : (
                <div className="border border-dashed border-border rounded p-6 text-center text-xs text-text-muted h-full flex items-center justify-center">
                  Select a flagged address to fix.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderConfirm() {
    return (
      <div className="space-y-3">
        <div className="p-3 bg-warning/10 border border-warning/30 rounded text-sm text-text-primary">
          <strong>Confirm Staff Import.</strong> {rowCount} row{rowCount === 1 ? '' : 's'} will
          be imported directly into the live job table (<code>tucJob</code>). This bypasses
          the normal wizard validation and cannot be undone. Are you sure you want to proceed?
        </div>
        <ul className="text-xs text-text-secondary list-disc pl-5">
          <li>Total rows: {rowCount}</li>
          <li>
            Suburb corrections applied:{' '}
            {state.flaggedSuburbs.filter((f) => f.replace).length}
          </li>
          <li>
            Address coordinates fixed:{' '}
            {state.flaggedAddresses.filter((f) => f.latitude && f.longitude).length} of{' '}
            {state.flaggedAddresses.length}
          </li>
        </ul>
      </div>
    );
  }

  function renderResult() {
    const r = state.result;
    if (!r) return null;
    return (
      <div className="space-y-2">
        <div
          className={`p-2 rounded text-xs ${
            r.failedCount === 0
              ? 'bg-success/10 border border-success/30 text-success'
              : 'bg-warning/10 border border-warning/30 text-text-primary'
          }`}
        >
          <strong>Import complete.</strong> {r.successCount} succeeded, {r.failedCount} failed.
        </div>
        {r.failedJobs.length > 0 && (
          <div className="overflow-auto border border-border rounded max-h-72">
            <table className="w-full text-[11px]">
              <thead className="bg-surface-cream text-text-secondary sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1">Row</th>
                  <th className="text-left px-2 py-1">Job Number</th>
                  <th className="text-left px-2 py-1">Error</th>
                </tr>
              </thead>
              <tbody>
                {r.failedJobs.map((fj: FailedJobDto, i: number) => (
                  <tr key={i} className="border-t border-border-light">
                    <td className="px-2 py-1">{fj.rowNumber}</td>
                    <td className="px-2 py-1">{fj.jobNumber ?? '-'}</td>
                    <td className="px-2 py-1 text-error">{friendlyError(fj.error)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  function renderFooter() {
    // Distinct footer per step: Back / Cancel + step-specific primary action.
    if (state.step === 'upload') {
      return (
        <div className="flex justify-between items-center">
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleParse}
            disabled={!state.file || state.submitting}
          >
            {state.submitting ? 'Parsing...' : 'Parse File'}
          </Button>
        </div>
      );
    }
    if (state.step === 'preview') {
      return (
        <div className="flex justify-between items-center">
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button variant="neutral" onClick={() => dispatch({ type: 'SET_STEP', step: 'upload' })}>
              Back
            </Button>
            <Button variant="primary" onClick={() => dispatch({ type: 'SET_STEP', step: 'fixSuburbs' })}>
              Next
            </Button>
          </div>
        </div>
      );
    }
    if (state.step === 'fixSuburbs') {
      return (
        <div className="flex justify-between items-center">
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button variant="neutral" onClick={() => dispatch({ type: 'SET_STEP', step: 'preview' })}>
              Back
            </Button>
            <Button
              variant="primary"
              disabled={suburbsUnfixed > 0}
              onClick={() => {
                if (suburbsUnfixed === 0) {
                  dispatch({ type: 'APPLY_SUBURB_FIXES' });
                  dispatch({ type: 'SET_STEP', step: 'fixAddresses' });
                }
              }}
            >
              {suburbsUnfixed > 0 ? `Fix ${suburbsUnfixed} remaining` : 'Next'}
            </Button>
          </div>
        </div>
      );
    }
    if (state.step === 'fixAddresses') {
      return (
        <div className="flex justify-between items-center">
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button variant="neutral" onClick={() => dispatch({ type: 'SET_STEP', step: 'fixSuburbs' })}>
              Back
            </Button>
            <Button variant="primary" onClick={() => dispatch({ type: 'SET_STEP', step: 'confirm' })}>
              Next
            </Button>
          </div>
        </div>
      );
    }
    if (state.step === 'confirm') {
      return (
        <div className="flex justify-between items-center">
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button variant="neutral" onClick={() => dispatch({ type: 'SET_STEP', step: 'fixAddresses' })}>
              Back
            </Button>
            <Button
              variant="warning"
              onClick={fireImport}
              disabled={state.submitting || rowCount === 0}
            >
              {state.submitting ? 'Importing...' : `Import ${rowCount} Jobs`}
            </Button>
          </div>
        </div>
      );
    }
    // Result footer.
    return (
      <div className="flex justify-end">
        <Button variant="primary" onClick={handleClose}>
          Close
        </Button>
      </div>
    );
  }
}

// -----------------------------------------------------------------------------
// StaffAddressEditor - simplified per-address coordinate editor. Uses the
// same Google Maps pane pattern as FixAddressesModal.tsx (dynamic import so
// the map bundle only loads when needed), degrading to a lat/lng input pair
// when the key or package are absent.
//
// Design call: rather than porting the AngularJS ng-map + Places widgets
// wholesale, we reuse the vis.gl/react-google-maps click-and-drag flow that
// FixAddressesModal already ships. Feature parity with Hyper is close
// enough - operator can click the map or drag the marker to place a pin;
// autocomplete search remains a manual lat/lng entry fallback.
// -----------------------------------------------------------------------------

interface EditorProps {
  address: FlaggedAddress;
  isUsTenant: boolean;
  googleMapsKey: string | null;
  onSave: (lat: number, lng: number) => void;
}

function StaffAddressEditor({ address, isUsTenant, googleMapsKey, onSave }: EditorProps) {
  const [MapModule, setMapModule] = useState<any | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [manualLat, setManualLat] = useState(address.latitude ?? '');
  const [manualLng, setManualLng] = useState(address.longitude ?? '');

  useEffect(() => {
    setManualLat(address.latitude ?? '');
    setManualLng(address.longitude ?? '');
  }, [address]);

  useEffect(() => {
    if (!googleMapsKey) return;
    let cancelled = false;
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
  }, [googleMapsKey]);

  const canRenderMap = !!googleMapsKey && !!MapModule && !loadError;

  if (!canRenderMap) {
    return (
      <div className="border border-border rounded p-3 space-y-2 bg-surface-cream">
        <p className="text-[11px] text-warning">
          {googleMapsKey
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
            onSave(la, ln);
          }}
        >
          Save Coordinates
        </Button>
      </div>
    );
  }

  const { APIProvider, Map, AdvancedMarker } = MapModule;
  const fallback = tenantMapCentre(isUsTenant);
  const lat = address.latitude ? Number(address.latitude) : null;
  const lng = address.longitude ? Number(address.longitude) : null;
  const centre = { lat: lat ?? fallback.lat, lng: lng ?? fallback.lng };
  return (
    <div className="h-64 rounded overflow-hidden border border-border">
      <APIProvider apiKey={googleMapsKey}>
        <Map
          mapId="staff-import-fix-address"
          defaultCenter={centre}
          defaultZoom={14}
          gestureHandling="greedy"
          onClick={(e: any) => {
            if (e?.detail?.latLng) {
              onSave(e.detail.latLng.lat, e.detail.latLng.lng);
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
                onSave(la, ln);
              }}
            />
          )}
        </Map>
      </APIProvider>
    </div>
  );
}

