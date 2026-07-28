import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useAuth } from '../../context/AuthContext';
import { addressService, type ZipCodeDto } from '../../services/addressService';
import type { WizardAction, WizardState } from './wizardState';

// Adapt SuburbDto -> ZipCodeDto so the same UI can render either shape.
// NZ tenants use the suburb name where US tenants use the zip string.
function suburbToZipCodeDto(s: { id: number; name: string; city: string | null }): ZipCodeDto {
  return {
    id: s.id,
    zoneNumber: null,
    zoneName: s.city,
    zip: s.name,
    clientId: null,
    applyCongestion: null,
  };
}

// Iterative Levenshtein (two-row rolling array). Small strings only - used per
// bad-suburb across the tenant suburb list, so worst case is O(rows * cols) on
// a couple hundred suburbs and a handful of bad rows. Cached upstream so the
// same bad value is not scored twice.
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
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
 * FixZipCodesModal - Step 3 of the wizard (US wording; NZ tenants get the
 * same modal with "Fix Suburbs" copy in a follow-on tweak). Extracts the
 * distinct target zip codes from the parsed data + finds ones missing from
 * the tenant's ZoneZip list, then offers a dropdown per bad zip.
 */
export function FixZipCodesModal({ open, state, dispatch, onBack, onNext, onCancel }: Props) {
  const auth = useAuth();
  const isUs = auth.isUsTenant || state.client?.isUsTenant || false;

  const [known, setKnown] = useState<ZipCodeDto[]>([]);
  const [loading, setLoading] = useState(false);
  // NZ-only: aliasLower -> { canonicalName, postCode }. Populated from
  // tucSuburb.Alias. Legacy findSuburb (homeControl.js:2516-2532) matches
  // by canonical name OR any alias entry, which is why "Mount Eden 1024"
  // is accepted despite the canonical row being "Mt Eden". Auto-remapping
  // via this index turns alias hits into first-class matches so the wizard
  // sends the canonical name to the server (which does exact match only).
  const [aliasIndex, setAliasIndex] = useState<Map<string, { name: string; postCode: string | null }>>(new Map());

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        if (isUs) {
          const { response } = await addressService.getZipCodes();
          if (!cancelled) {
            setKnown(response.zipCodes ?? []);
            setAliasIndex(new Map());
          }
        } else {
          // NZ tenants: /address/zipcodes returns no rows, so the modal used
          // to bypass the reference check silently. Load suburbs instead and
          // reshape into the same ZipCodeDto shape the UI renders.
          const { response } = await addressService.getSuburbs();
          if (cancelled) return;
          const suburbs = response.suburbs ?? [];
          setKnown(suburbs.map(suburbToZipCodeDto));
          const idx = new Map<string, { name: string; postCode: string | null }>();
          for (const s of suburbs) {
            const raw = (s.alias ?? '').trim();
            if (!raw) continue;
            const canonical = (s.name ?? '').trim();
            for (const part of raw.split(',')) {
              const a = part.trim().toLowerCase();
              if (!a) continue;
              // Prefer alias entries whose PostCode matches an actual reference
              // row - later duplicates would silently overwrite so we keep the
              // first-seen mapping (legacy findSuburb also short-circuits on
              // the first alias hit).
              if (!idx.has(a)) idx.set(a, { name: canonical, postCode: s.postCode ?? null });
            }
          }
          setAliasIndex(idx);
        }
      } catch {
        if (!cancelled) {
          setKnown([]);
          setAliasIndex(new Map());
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, isUs]);

  // Auto-normalise case/spelling: for every distinct row value that matches
  // a reference entry case-insensitively (but with different case), store
  // the canonical spelling in state.fixedZips so buildJobs picks it up on
  // submit. This ports legacy findSuburb (homeControl.js:2516-2532) and
  // findCity (homeControl.js:2486-2513) behaviour for rows the operator
  // never explicitly fixed (typical when the file just has case drift like
  // "auckland" instead of "Auckland"). Only writes entries that don't
  // already have an operator-chosen override.
  useEffect(() => {
    if (!open || loading || known.length === 0 || !state.parsed) return;
    const canonical = new Map<string, string>();
    for (const k of known) {
      const raw = (k.zip ?? '').toString().trim();
      if (!raw) continue;
      canonical.set(raw.toLowerCase(), raw);
    }
    const primaryCol = state.mapping[isUs ? 'toZipCode' : 'toSuburb'];
    const pcCol = isUs ? null : state.mapping['toPostCode'];
    if (!primaryCol) return;
    const seen = new Set<string>();
    for (const row of state.parsed.rows) {
      const v = (row[primaryCol] ?? '').toString().trim();
      if (!v) continue;
      const pc = pcCol ? (row[pcCol] ?? '').toString().trim() : '';
      const storeKey = isUs ? v : `${v.toLowerCase()}|${pc}`;
      if (seen.has(storeKey)) continue;
      seen.add(storeKey);
      // Skip when the operator has already picked an explicit replacement.
      if (state.fixedZips[storeKey]) continue;
      const canon = canonical.get(v.toLowerCase());
      if (canon && canon !== v) {
        dispatch({ type: 'SET_FIXED_ZIP', badZip: storeKey, corrected: canon });
        continue;
      }
      // NZ alias fallback: if the raw value is not itself a canonical suburb
      // but matches an alias entry, silently rewrite to the canonical name.
      // Ports legacy findSuburb's alias-lookup branch. Only applies when the
      // canonical row's postcode matches the row's postcode; if postcodes
      // disagree we treat it as a real conflict and leave it flagged for
      // the operator to resolve.
      if (!isUs && !canonical.has(v.toLowerCase())) {
        const aliasHit = aliasIndex.get(v.toLowerCase());
        if (aliasHit && (!pc || !aliasHit.postCode || aliasHit.postCode === pc)) {
          dispatch({ type: 'SET_FIXED_ZIP', badZip: storeKey, corrected: aliasHit.name });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading, known.length, aliasIndex, state.parsed]);

  // Find bad values. Legacy homeControl.js:2339-2344 keys the flaggedSuburbs
  // list on (name + postcode) because NZ has duplicate suburb names across
  // different postcodes (e.g. "Newton" in Auckland 1010 and elsewhere) that
  // need independent replacements. For US we key on zip alone (already unique).
  //
  // Returns [{ display, storeKey }] where storeKey is the state.fixedZips key.
  const badZips = useMemo(() => {
    const primaryCol = state.mapping[isUs ? 'toZipCode' : 'toSuburb'];
    const pcCol = isUs ? null : state.mapping['toPostCode'];
    if (!primaryCol || !state.parsed) return [] as Array<{ display: string; storeKey: string }>;
    const knownSet = new Set(
      known
        .map((k) => (k.zip ?? '').toString().trim().toLowerCase())
        .filter((z) => z.length > 0)
    );
    const seen = new Set<string>();
    const bad: Array<{ display: string; storeKey: string }> = [];
    for (const row of state.parsed.rows) {
      const v = (row[primaryCol] ?? '').toString().trim();
      if (!v) continue;
      const pc = pcCol ? (row[pcCol] ?? '').toString().trim() : '';
      // NZ compound key = name|postcode; US just zip.
      const storeKey = isUs ? v : `${v.toLowerCase()}|${pc}`;
      if (seen.has(storeKey)) continue;
      seen.add(storeKey);
      // If the reference list is empty (no data for this tenant) skip the
      // check entirely and treat every value as fine.
      if (knownSet.size === 0) continue;
      if (knownSet.has(v.toLowerCase())) continue;
      // NZ alias match: if the value matches a canonical suburb's alias
      // and postcodes agree (or either side is unknown) it is NOT bad -
      // buildJobs will rewrite it to the canonical name at submit via
      // the auto-normalize effect above. Skip listing in the modal.
      if (!isUs) {
        const aliasHit = aliasIndex.get(v.toLowerCase());
        if (aliasHit && (!pc || !aliasHit.postCode || aliasHit.postCode === pc)) continue;
      }
      const display = isUs ? v : (pc ? `${v} (${pc})` : v);
      bad.push({ display, storeKey });
    }
    return bad;
  }, [isUs, known, aliasIndex, state.mapping, state.parsed]);

  // Reference list is empty: show a banner but still let the operator proceed.
  // Happens on tenants with no ZoneZip / Suburb reference data seeded, so we
  // cannot validate anything. Server-side is still the source of truth if a
  // bad value slips through.
  const referenceListEmpty = !loading && known.length === 0;

  // Build a per-bad-value ordered dropdown list: fuzzy matches (Levenshtein <= 2
  // or shared startsWith prefix >= 3 chars) surface at the top, then the rest
  // in alphabetical order. Reduces the click cost when a suburb is misspelled
  // by a few characters (e.g. "Aukland" -> "Auckland").
  const suggestionsFor = useMemo(() => {
    const cache = new Map<string, ZipCodeDto[]>();
    const build = (bad: string): ZipCodeDto[] => {
      const cached = cache.get(bad);
      if (cached) return cached;
      const badLower = bad.toLowerCase();
      const scored = known
        .map((k) => {
          const name = (k.zip ?? '').toString().trim().toLowerCase();
          if (!name) return { k, score: Number.POSITIVE_INFINITY };
          if (name === badLower) return { k, score: 0 };
          const prefix = commonPrefixLength(name, badLower);
          if (prefix >= 3 && (name.startsWith(badLower) || badLower.startsWith(name))) {
            return { k, score: Math.max(1, Math.abs(name.length - badLower.length)) };
          }
          const dist = levenshtein(name, badLower);
          if (dist <= 2) return { k, score: 3 + dist };
          if (prefix >= 3) return { k, score: 10 + (badLower.length - prefix) };
          return { k, score: Number.POSITIVE_INFINITY };
        })
        .filter((x) => x.score !== Number.POSITIVE_INFINITY)
        .sort((a, b) => a.score - b.score)
        .map((x) => x.k);

      // Also keep the full list at the bottom so operators can still pick any
      // suburb even when no fuzzy match found.
      const suggestedIds = new Set(scored.map((k) => k.id));
      const rest = known
        .filter((k) => !suggestedIds.has(k.id))
        .sort((a, b) => (a.zip ?? '').localeCompare(b.zip ?? ''));
      const result = [...scored, ...rest];
      cache.set(bad, result);
      return result;
    };
    return build;
  }, [known]);

  const title = isUs ? 'Fix Zip Codes' : 'Fix Suburbs';

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      loading={loading}
      loadingMessage={isUs ? 'Loading zip code reference list...' : 'Loading suburb reference list...'}
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
      <div className="max-h-[60vh] overflow-y-auto">
        {loading && (
          <p className="text-xs text-text-muted text-center py-3">Loading reference list...</p>
        )}
        {referenceListEmpty && (
          <div className="text-sm text-warning bg-warning/10 border border-warning/30 rounded px-3 py-2 text-center">
            {isUs ? 'Zip code' : 'Suburb'} reference data unavailable -
            {isUs ? ' zip codes' : ' suburbs'} will not be validated.
          </div>
        )}
        {!loading && !referenceListEmpty && badZips.length === 0 && (
          <div className="text-sm text-success bg-success/10 border border-success/30 rounded px-3 py-2 text-center">
            {isUs ? 'Zip Codes seems OK.' : 'Suburbs seems OK.'}
          </div>
        )}
        {!loading && badZips.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-text-muted">
              The following {isUs ? 'zip codes' : 'suburbs'} were not found in the reference list.
              Pick a valid replacement for each. Close matches are listed first.
            </p>
            {badZips.map((bad) => {
              // Fuzzy suggestions rank against the raw display name (no
              // postcode suffix). For NZ that's the leading suburb name; for
              // US that's the zip string.
              const rawName = bad.display.split(' (')[0];
              const ordered = suggestionsFor(rawName);
              const suggested = ordered.slice(0, 5);
              const suggestedIds = new Set(suggested.map((k) => k.id));
              const rest = ordered.filter((k) => !suggestedIds.has(k.id));
              return (
                <div key={bad.storeKey} className="grid grid-cols-2 gap-3 items-center">
                  <div className="border border-warning/40 bg-warning/5 rounded px-2 py-1.5 text-sm text-text-primary">
                    {bad.display}
                  </div>
                  <select
                    value={state.fixedZips[bad.storeKey] ?? ''}
                    onChange={(e) =>
                      dispatch({ type: 'SET_FIXED_ZIP', badZip: bad.storeKey, corrected: e.target.value })
                    }
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-surface-white"
                  >
                    <option value="">
                      Choose {isUs ? 'Zip Code' : 'Suburb'}...
                    </option>
                    {suggested.length > 0 && (
                      <optgroup label="Suggested">
                        {suggested.map((k) => (
                          <option key={`s-${k.id}`} value={k.zip ?? ''}>
                            {k.zip}
                            {k.zoneName ? ` (${k.zoneName})` : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {rest.length > 0 && (
                      <optgroup label="All">
                        {rest.map((k) => (
                          <option key={k.id} value={k.zip ?? ''}>
                            {k.zip}
                            {k.zoneName ? ` (${k.zoneName})` : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
