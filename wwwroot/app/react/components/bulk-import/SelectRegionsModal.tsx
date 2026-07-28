import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useAuth } from '../../context/AuthContext';
import { addressService } from '../../services/addressService';
import type { DepotBucket, WizardAction, WizardState } from './wizardState';

/**
 * Extract the 5-digit base ZIP from a raw value. Handles ZIP+4 ("02110-1234"),
 * numeric zips ("2110" pads to "02110"), and returns "" for empty/invalid.
 * Mirrors legacy `zipBase()` behaviour so the coverage-only bucket lookup
 * matches BulkImportHyper's polygon set.
 */
function zipBase(zip: string | null | undefined): string {
  if (!zip) return '';
  const digits = String(zip).replace(/[^0-9]/g, '');
  if (!digits) return '';
  return digits.slice(0, 5).padStart(5, '0');
}

/**
 * Normalise an NZ postcode into the canonical 4-digit form used by the
 * depot reference list. Excel silently strips leading zeros so a row
 * like "612" (Devonport) needs padding to "0612" before it can match a
 * depot. Legacy `homeControl.js:4225-4227` does the same:
 *   `parseInt(value).toString().padStart(4, "0")`
 */
function nzPostCode(pc: string | null | undefined): string {
  if (!pc) return '';
  const trimmed = String(pc).trim();
  if (trimmed.length === 0) return '';
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (!digits) return '';
  return digits.padStart(4, '0');
}

interface Props {
  open: boolean;
  state: WizardState;
  dispatch: (action: WizardAction) => void;
  onBack: () => void;
  onNext: () => void;
  onCancel: () => void;
}

/**
 * SelectRegionsModal - Step 5. Renders one checkbox per REAL depot (NZ) or
 * region (US) fetched from addressService. Buckets rows from the parsed
 * import by their `toPostCode` (NZ) or `toZipCode` (US), and stores the
 * resulting DepotBucket[] on wizard state so the downstream per-depot
 * iteration in NewImportWizard.fireImport can loop through them.
 *
 * The two special buckets from BulkImportHyper (`id === 0` unmatched,
 * `id === -1` US coverage-only) are surfaced as banners; unmatched cannot
 * be selected, coverage-only is informational.
 *
 * Mirrors homeControl.js:sortByDepot (BulkImportHyper 2985-3175).
 */
export function SelectRegionsModal({ open, state, dispatch, onBack, onNext, onCancel }: Props) {
  const auth = useAuth();
  const isUs = auth.isUsTenant || state.client?.isUsTenant || false;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // depotLookup: postcode/zip -> { depotId, depotName }. Built once per
  // fetch, then used to bucket every parsed row.
  const [depotLookup, setDepotLookup] = useState<
    Record<string, { depotId: number; depotName: string }>
  >({});
  const [depotList, setDepotList] = useState<Array<{ id: number; name: string }>>([]);
  // US only: set of ZIP prefixes (5-digit base) that are covered by any
  // zip polygon. Legacy homeControl.js:3105-3110 uses this to create the
  // "-1" coverage-only bucket - rows here fall back to rate-by-distance.
  const [coveredZipBases, setCoveredZipBases] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open || !state.parsed) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        if (isUs) {
          // Fetch both in parallel: assigned locations (real depot buckets)
          // + polygon coverage (coverage-only bucket).
          const [locRes, polyRes] = await Promise.all([
            addressService.getLocationsZipCodes(),
            addressService.getZipPolygons().catch(() => null),
          ]);
          if (cancelled) return;
          const lookup: Record<string, { depotId: number; depotName: string }> = {};
          const list: Array<{ id: number; name: string }> = [];
          for (const loc of locRes.response.locations ?? []) {
            list.push({ id: loc.id, name: loc.name });
            for (const zip of loc.zipCodes ?? []) {
              lookup[zipBase(zip)] = {
                depotId: loc.id,
                depotName: loc.name,
              };
            }
          }
          setDepotLookup(lookup);
          setDepotList(list);
          const covered = new Set<string>();
          if (polyRes) {
            for (const zone of polyRes.response.zones ?? []) {
              for (const zip of zone.zips ?? []) {
                covered.add(zipBase(zip));
              }
            }
          }
          setCoveredZipBases(covered);
        } else {
          const { response } = await addressService.getDepots();
          if (cancelled) return;
          const lookup: Record<string, { depotId: number; depotName: string }> = {};
          const list: Array<{ id: number; name: string }> = [];
          for (const dep of response.depots ?? []) {
            list.push({ id: dep.id, name: dep.name });
            for (const pc of dep.postcodes ?? []) {
              // Zero-pad to 4 digits so "612" matches "0612" (Auckland
              // North Shore). Excel silently strips leading zeros on
              // upload; server-side postcode reference is canonical.
              const key = nzPostCode(pc);
              if (key) {
                lookup[key] = {
                  depotId: dep.id,
                  depotName: dep.name,
                };
              }
            }
          }
          setDepotLookup(lookup);
          setDepotList(list);
          setCoveredZipBases(new Set());
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message || 'Failed to load depots.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, isUs, state.parsed]);

  // Bucket parsed rows into depots. Unmatched postcodes go into depotId=0
  // "Unmatched" bucket. Row lookup uses the mapped `toPostCode` (NZ) or
  // `toZipCode` (US) column.
  const buckets: DepotBucket[] = useMemo(() => {
    if (!state.parsed) return [];
    const key = isUs ? state.mapping.toZipCode : state.mapping.toPostCode;
    if (!key) return [];
    const byId = new Map<number, DepotBucket>();
    const unmatched: DepotBucket = { depotId: 0, depotName: 'Unmatched', jobIndexes: [] };
    // US -1 = "Valid ZIP - Rate By Distance": covered by polygon but not
    // assigned to a real location. Legacy homeControl.js:3099-3110 creates
    // this synthetic bucket so operators can still ship those rows with
    // km-rated pricing.
    const coverageOnly: DepotBucket = {
      depotId: -1,
      depotName: 'Valid ZIP - Rate By Distance',
      jobIndexes: [],
    };
    for (let i = 0; i < state.parsed.rows.length; i++) {
      const raw = String(state.parsed.rows[i][key] ?? '').trim();
      const lookupKey = isUs ? zipBase(raw) : nzPostCode(raw);
      const hit = depotLookup[lookupKey];
      if (hit) {
        let b = byId.get(hit.depotId);
        if (!b) {
          b = { depotId: hit.depotId, depotName: hit.depotName, jobIndexes: [] };
          byId.set(hit.depotId, b);
        }
        b.jobIndexes.push(i);
        continue;
      }
      // US only: bucket into coverage-only when polygon covers the base zip.
      if (isUs && lookupKey && coveredZipBases.has(lookupKey)) {
        coverageOnly.jobIndexes.push(i);
        continue;
      }
      unmatched.jobIndexes.push(i);
    }
    // Legacy homeControl.js:sortByDepot only surfaces depots that actually
    // received rows - empty ones would just be clutter. Sort by name.
    const list = Array.from(byId.values()).sort((a, b) =>
      a.depotName.localeCompare(b.depotName)
    );
    if (isUs && coverageOnly.jobIndexes.length > 0) list.push(coverageOnly);
    if (unmatched.jobIndexes.length > 0) list.push(unmatched);
    return list;
  }, [state.parsed, state.mapping, isUs, depotLookup, coveredZipBases]);

  // Persist buckets onto wizard state so downstream picker + fireImport
  // can iterate them. Pre-tick real depots (id > 0) AND the coverage-only
  // bucket (id === -1) so US operators do not silently drop rate-by-distance
  // rows. Unmatched (id === 0) stays unticked because it needs review.
  //
  // Keying the effect on a signature of the depot IDs (not just length) is
  // deliberate: the buckets list often mutates from [Unmatched(10 jobs)]
  // (before the depot lookup arrives) to [Auckland(10 jobs)] (after) - both
  // length 1 - so a length-only dep would skip the re-fire and Auckland
  // would never auto-tick. Legacy pre-selects every non-Unmatched bucket
  // by default; matching that behaviour here.
  const bucketSignature = buckets.map((b) => `${b.depotId}:${b.jobIndexes.length}`).join(',');
  useEffect(() => {
    if (!open) return;
    dispatch({ type: 'SET_DEPOTS', depots: buckets });
    dispatch({ type: 'SET_CURRENT_DEPOT', index: 0 });
    const next = new Set(state.selectedRegions);
    for (const b of buckets) {
      if (b.jobIndexes.length === 0) continue;
      if (b.depotId > 0 || b.depotId === -1) {
        next.add(String(b.depotId));
      }
    }
    dispatch({ type: 'SET_SELECTED_REGIONS', regions: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bucketSignature]);

  const totalRows = state.parsed?.rows.length ?? 0;
  const selectedCount = buckets
    .filter((b) => b.depotId !== 0 && state.selectedRegions.has(String(b.depotId)))
    .reduce((sum, b) => sum + b.jobIndexes.length, 0);

  const nextDisabled = selectedCount === 0;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={isUs ? 'Select Regions' : 'Select Depots'}
      size="xl"
      loading={loading}
      loadingMessage={isUs ? 'Loading regions and coverage data...' : 'Loading depots...'}
      footer={
        <div className="flex justify-between items-center">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button variant="neutral" onClick={onBack}>
              Back
            </Button>
            <Button variant="primary" onClick={onNext} disabled={nextDisabled}>
              Next
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {loading && (
          <p className="text-xs text-text-muted text-center py-3">
            Loading {isUs ? 'regions' : 'depots'}...
          </p>
        )}
        {error && (
          <div className="border border-error/40 bg-error/5 rounded p-3 text-xs text-error">
            {error}
          </div>
        )}
        {!loading && !error && buckets.length === 0 && (
          <p className="text-xs text-text-muted text-center py-3">
            No {isUs ? 'regions' : 'depots'} to display.
          </p>
        )}
        {!loading && !error && buckets.length > 0 && (
          <>
            <div className="text-xs text-text-secondary">
              {selectedCount} of {totalRows} rows selected across{' '}
              {buckets.filter((b) => b.depotId !== 0 && state.selectedRegions.has(String(b.depotId))).length}{' '}
              {isUs ? 'regions' : 'depots'}.
            </div>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {buckets.map((b) => {
                const isUnmatched = b.depotId === 0;
                const key = String(b.depotId);
                const checked = state.selectedRegions.has(key);
                const disabled = isUnmatched;
                const borderClass = isUnmatched
                  ? 'border-warning/50 bg-warning/5'
                  : 'border-brand-cyan/40 bg-brand-cyan/5';
                // Matches legacy "(0 of N jobs imported)" format. The "0"
                // is the count already imported (fresh at this step);
                // updates after the per-depot loop lands rows.
                const bucketSize = b.jobIndexes.length;
                return (
                  <div key={key} className={`border ${borderClass} rounded p-3`}>
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => dispatch({ type: 'TOGGLE_REGION', region: key })}
                        disabled={disabled}
                      />
                      {b.depotName} ( 0 of {bucketSize} jobs imported )
                    </label>
                    {isUnmatched && (
                      <p className="text-[11px] text-warning mt-1 pl-6">
                        These rows have {isUs ? 'zip codes' : 'postcodes'} that do not match any{' '}
                        {isUs ? 'region' : 'depot'} and cannot be imported. Fix the source data
                        and re-upload.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
