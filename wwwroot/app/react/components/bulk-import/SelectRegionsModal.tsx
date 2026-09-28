import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useAuth } from '../../context/AuthContext';
import { addressService } from '../../services/addressService';
import {
  nextPendingDepotIndex,
  type DepotBucket,
  type WizardAction,
  type WizardState,
} from './wizardState';

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
 * be selected, coverage-only is informational. NZ routed depots the server
 * flags as having no schedules for this client (e.g. airline depots that
 * only exist for air-freight rating) render as a warning bucket that
 * cannot be ticked, so the operator can still see which rows are there.
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
    Record<string, { depotId: number; depotName: string; hasSchedules: boolean }>
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
          const lookup: Record<string, { depotId: number; depotName: string; hasSchedules: boolean }> = {};
          const list: Array<{ id: number; name: string }> = [];
          for (const loc of locRes.response.locations ?? []) {
            list.push({ id: loc.id, name: loc.name });
            for (const zip of loc.zipCodes ?? []) {
              lookup[zipBase(zip)] = {
                depotId: loc.id,
                depotName: loc.name,
                hasSchedules: true,
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
          const { response } = await addressService.getDepots(state.client?.id);
          if (cancelled) return;
          const lookup: Record<string, { depotId: number; depotName: string; hasSchedules: boolean }> = {};
          const list: Array<{ id: number; name: string }> = [];
          for (const dep of response.depots ?? []) {
            list.push({ id: dep.id, name: dep.name });
            // Older servers omit the flag; treat missing as serviced.
            const hasSchedules = dep.hasSchedules !== false;
            for (const pc of dep.postcodes ?? []) {
              // Zero-pad to 4 digits so "612" matches "0612" (Auckland
              // North Shore). Excel silently strips leading zeros on
              // upload; server-side postcode reference is canonical.
              const key = nzPostCode(pc);
              if (!key) continue;
              // The server resolves each postcode to one depot. If a
              // duplicate still arrives, keep the first claim unless the
              // newcomer is serviced and the existing one is not, so the
              // result never silently depends on response order.
              const existing = lookup[key];
              if (existing && (existing.hasSchedules || !hasSchedules)) continue;
              lookup[key] = {
                depotId: dep.id,
                depotName: dep.name,
                hasSchedules,
              };
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
  }, [open, isUs, state.parsed, state.client?.id]);

  // Bucket parsed rows into depots. Unmatched postcodes go into depotId=0
  // "Unmatched" bucket. Row lookup uses the mapped `toPostCode` (NZ) or
  // `toZipCode` (US) column.
  const buckets: DepotBucket[] = useMemo(() => {
    if (!state.parsed) return [];
    const key = isUs ? state.mapping.toZipCode : state.mapping.toPostCode;
    if (!key) return [];
    const byId = new Map<number, DepotBucket>();
    // Only routed imports book against schedules, so only routed imports
    // treat a schedule-less depot as unimportable.
    const isRouted = state.importType === 'routed';
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
          if (isRouted && !hit.hasSchedules) b.noService = true;
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
  }, [state.parsed, state.mapping, state.importType, isUs, depotLookup, coveredZipBases]);

  // Persist buckets onto wizard state so downstream picker + fireImport
  // can iterate them. SEED_DEPOTS pre-ticks depots the operator has not
  // seen yet (real depots and the US coverage-only bucket) but keeps the
  // existing tick state for depots already listed, so Back from the
  // schedule picker no longer re-ticks everything. Unmatched and
  // no-service buckets are never ticked.
  //
  // Keying the effect on a signature of the depot IDs (not just length) is
  // deliberate: the buckets list often mutates from [Unmatched(10 jobs)]
  // (before the depot lookup arrives) to [Auckland(10 jobs)] (after) - both
  // length 1 - so a length-only dep would skip the re-fire and Auckland
  // would never auto-tick. The per-depot cursor is positioned on Next
  // (START_PENDING_DEPOT), not here, so reopening this step never rewinds
  // to a depot that has already been imported.
  const bucketSignature = buckets
    .map((b) => `${b.depotId}:${b.jobIndexes.length}:${b.noService ? 'x' : ''}`)
    .join(',');
  useEffect(() => {
    if (!open) return;
    dispatch({ type: 'SEED_DEPOTS', depots: buckets });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bucketSignature]);

  const totalRows = state.parsed?.rows.length ?? 0;
  const isSelected = (b: DepotBucket) =>
    b.depotId !== 0 && !b.noService && state.selectedRegions.has(String(b.depotId));
  const selectedCount = buckets
    .filter(isSelected)
    .reduce((sum, b) => sum + b.jobIndexes.length, 0);
  const importedByDepot = new Map<number, number>();
  for (const r of state.perDepotResults) {
    importedByDepot.set(r.depotId, (importedByDepot.get(r.depotId) ?? 0) + r.imported);
  }

  // Next needs at least one ticked depot that still has rows to import.
  const nextDisabled = selectedCount === 0 || nextPendingDepotIndex(state, 0) < 0;

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
              {buckets.filter(isSelected).length}{' '}
              {isUs ? 'regions' : 'depots'}.
            </div>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {buckets.map((b) => {
                const isUnmatched = b.depotId === 0;
                const isNoService = !!b.noService;
                const isDone = state.completedDepotIds.has(b.depotId);
                const key = String(b.depotId);
                const checked = !isNoService && state.selectedRegions.has(key);
                // Completed depots are locked (legacy greys them out) so the
                // per-depot cursor cannot lose track of them.
                const disabled = isUnmatched || isNoService || isDone;
                const borderClass = isUnmatched || isNoService
                  ? 'border-warning/50 bg-warning/5'
                  : isDone
                    ? 'border-border bg-surface-cream opacity-60'
                    : 'border-brand-cyan/40 bg-brand-cyan/5';
                // Matches legacy "(0 of N jobs imported)" format. The first
                // number is the count already imported for this depot.
                const bucketSize = b.jobIndexes.length;
                const importedCount = importedByDepot.get(b.depotId) ?? 0;
                return (
                  <div key={key} className={`border ${borderClass} rounded p-3`}>
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => dispatch({ type: 'TOGGLE_REGION', region: key })}
                        disabled={disabled}
                      />
                      <span className={isDone ? 'line-through' : undefined}>
                        {b.depotName} ( {importedCount} of {bucketSize} jobs imported )
                      </span>
                    </label>
                    {isNoService && (
                      <p className="text-[11px] text-warning mt-1 pl-6">
                        This client has no service set up at this depot, so these rows
                        cannot be imported. Check the delivery addresses, or add a schedule
                        for this client at this depot.
                      </p>
                    )}
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
