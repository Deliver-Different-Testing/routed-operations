import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useAuth } from '../../context/AuthContext';
import { addressService, type SuburbDto, type ZipCodeDto } from '../../services/addressService';
import { bulkImportService, type SuburbAliasDto } from '../../services/bulkImportService';
import type { WizardAction, WizardState } from './wizardState';
import { buildExactSuburbMatcher, buildSuburbMatcher, findAlias, stripMarks } from './suburbAliases';

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

// #333. Match key for a US zip and the tucSuburb.Alias index: lower case
// with diacritics removed. NZ suburb names use buildSuburbMatcher (the
// shared normaliser, same as the server), so 'Mt Eden' matches 'Mount Eden'
// here and books there.
function matchKey(value: string): string {
  return stripMarks(value).toLowerCase();
}

// #333. The suburbs API pads postcodes to 4 digits but Excel drops the
// leading zero ("624" for "0624"). Same padding as nzPostCode in
// SelectRegionsModal.
function samePostCode(a: string, b: string): boolean {
  const pad = (pc: string) => {
    const digits = pc.replace(/[^0-9]/g, '');
    return digits ? digits.padStart(4, '0') : pc.trim();
  };
  return pad(a) === pad(b);
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

// A sheet value not in the reference list. `remembered` is set when a fix
// saved for this client (or tenant-wide) already covers it (#333).
interface BadValue {
  display: string;
  storeKey: string;
  raw: string;
  postCode: string;
  remembered?: SuburbAliasDto;
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
  // #333 NZ: fixes remembered for this client (then tenant-wide), and the
  // raw suburb rows so a pick can be saved by tucSuburb id.
  const [remembered, setRemembered] = useState<SuburbAliasDto[]>([]);
  const [nzSuburbs, setNzSuburbs] = useState<SuburbDto[]>([]);
  const [rememberError, setRememberError] = useState<string | null>(null);
  const clientId = state.client?.id ?? null;
  const nzMatch = useMemo(
    () => buildSuburbMatcher(known.map((k) => (k.zip ?? '').toString().trim())),
    [known]
  );
  // NZ order, same as the server: exact name, then a remembered fix, then
  // the normalised match.
  const nzExact = useMemo(
    () => buildExactSuburbMatcher(known.map((k) => (k.zip ?? '').toString().trim())),
    [known]
  );

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
          const [{ response }, aliases] = await Promise.all([
            addressService.getSuburbs(),
            clientId !== null
              ? bulkImportService
                  .getSuburbAliases(clientId)
                  .then((r) => r.response.aliases ?? [])
                  .catch(() => [] as SuburbAliasDto[])
              : Promise.resolve([] as SuburbAliasDto[]),
          ]);
          if (cancelled) return;
          const suburbs = response.suburbs ?? [];
          setNzSuburbs(suburbs);
          setRemembered(aliases);
          setKnown(suburbs.map(suburbToZipCodeDto));
          const idx = new Map<string, { name: string; postCode: string | null }>();
          for (const s of suburbs) {
            const raw = (s.alias ?? '').trim();
            if (!raw) continue;
            const canonical = (s.name ?? '').trim();
            for (const part of raw.split(',')) {
              const a = matchKey(part.trim());
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
  }, [open, isUs, clientId]);

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
      canonical.set(matchKey(raw), raw);
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
      // #333: an exact suburb name stands as itself; otherwise a fix
      // remembered for this client is applied without asking.
      if (!isUs) {
        const exact = nzExact(v);
        if (exact !== undefined) {
          if (exact !== v) dispatch({ type: 'SET_FIXED_ZIP', badZip: storeKey, corrected: exact });
          continue;
        }
        const hit = findAlias(remembered, clientId, v, pc, true);
        if (hit?.suburbName) {
          dispatch({ type: 'SET_FIXED_ZIP', badZip: storeKey, corrected: hit.suburbName });
          continue;
        }
      }
      const canon = isUs ? canonical.get(matchKey(v)) : nzMatch(v);
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
      if (!isUs && !canon) {
        const aliasHit = aliasIndex.get(matchKey(v));
        if (aliasHit && (!pc || !aliasHit.postCode || samePostCode(aliasHit.postCode, pc))) {
          dispatch({ type: 'SET_FIXED_ZIP', badZip: storeKey, corrected: aliasHit.name });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading, known.length, nzExact, nzMatch, aliasIndex, remembered, state.parsed]);

  // Find bad values. Legacy homeControl.js:2339-2344 keys the flaggedSuburbs
  // list on (name + postcode) because NZ has duplicate suburb names across
  // different postcodes (e.g. "Newton" in Auckland 1010 and elsewhere) that
  // need independent replacements. For US we key on zip alone (already unique).
  //
  // Returns [{ display, storeKey }] where storeKey is the state.fixedZips key.
  const badZips = useMemo(() => {
    const primaryCol = state.mapping[isUs ? 'toZipCode' : 'toSuburb'];
    const pcCol = isUs ? null : state.mapping['toPostCode'];
    if (!primaryCol || !state.parsed) return [] as BadValue[];
    const knownSet = new Set(
      known
        .map((k) => matchKey((k.zip ?? '').toString().trim()))
        .filter((z) => z.length > 0)
    );
    const seen = new Set<string>();
    const bad: BadValue[] = [];
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
      if (isUs ? knownSet.has(matchKey(v)) : nzExact(v) !== undefined) continue;
      // #333: a remembered fix comes before the normalised match.
      const fix = isUs ? undefined : findAlias(remembered, clientId, v, pc, true);
      if (!isUs && !fix?.suburbName && nzMatch(v) !== undefined) continue;
      // NZ alias match: if the value matches a canonical suburb's alias
      // and postcodes agree (or either side is unknown) it is NOT bad -
      // buildJobs will rewrite it to the canonical name at submit via
      // the auto-normalize effect above. Skip listing in the modal.
      if (!isUs && !fix?.suburbName) {
        const aliasHit = aliasIndex.get(matchKey(v));
        if (aliasHit && (!pc || !aliasHit.postCode || samePostCode(aliasHit.postCode, pc))) continue;
      }
      const display = isUs ? v : (pc ? `${v} (${pc})` : v);
      bad.push({ display, storeKey, raw: v, postCode: pc, remembered: fix?.suburbName ? fix : undefined });
    }
    return bad;
  }, [isUs, known, nzExact, nzMatch, aliasIndex, remembered, clientId, state.mapping, state.parsed]);
  const toAsk = badZips.filter((b) => !b.remembered);
  const rememberedRows = badZips.filter((b) => b.remembered);

  // #333: remember the operator's pick for this client so it is not asked
  // again. A failure leaves the pick applied for this import only.
  async function remember(bad: BadValue, suburbId: number) {
    if (isUs || clientId === null) return;
    const suburb = nzSuburbs.find((s) => s.id === suburbId);
    if (!suburb) return;
    try {
      const { response } = await bulkImportService.rememberSuburbAlias({
        clientId,
        rawSuburb: bad.raw,
        rawPostCode: bad.postCode || null,
        suburbId: suburb.id,
      });
      const saved = response.alias;
      setRememberError(null);
      setRemembered((prev) => [
        saved,
        ...prev.filter(
          (a) => !(a.clientId === saved.clientId && a.rawSuburb === saved.rawSuburb && a.rawPostCode === saved.rawPostCode)
        ),
      ]);
    } catch {
      setRememberError(`Could not remember the fix for ${bad.display}; it still applies to this import.`);
    }
  }

  async function forget(bad: BadValue) {
    const fix = bad.remembered;
    if (!fix) return;
    try {
      await bulkImportService.forgetSuburbAlias(fix.id);
      setRememberError(null);
      setRemembered((prev) => prev.filter((a) => a.id !== fix.id));
      dispatch({ type: 'SET_FIXED_ZIP', badZip: bad.storeKey, corrected: '' });
    } catch {
      setRememberError(`Could not clear the remembered fix for ${bad.display}.`);
    }
  }

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
        {!loading && rememberedRows.length > 0 && (
          <div className="space-y-1 mb-3" data-testid="remembered-fixes">
            <p className="text-xs text-text-muted">Remembered fixes for this client, applied automatically:</p>
            {rememberedRows.map((bad) => (
              <div
                key={bad.storeKey}
                data-testid={`remembered-fix-${bad.storeKey}`}
                className="flex justify-between items-center text-sm border border-border-light rounded px-2 py-1"
              >
                <span>
                  {bad.display} {'->'} {bad.remembered?.suburbName}
                  {bad.remembered?.clientId === null ? ' (all clients)' : ''}
                </span>
                {bad.remembered?.clientId !== null && (
                  <Button variant="ghost" size="sm" onClick={() => void forget(bad)}>
                    Forget
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
        {rememberError && <p className="text-xs text-warning mb-2">{rememberError}</p>}
        {!loading && !referenceListEmpty && toAsk.length === 0 && (
          <div className="text-sm text-success bg-success/10 border border-success/30 rounded px-3 py-2 text-center">
            {isUs ? 'Zip Codes seems OK.' : 'Suburbs seems OK.'}
          </div>
        )}
        {!loading && toAsk.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-text-muted">
              The following {isUs ? 'zip codes' : 'suburbs'} were not found in the reference list.
              Pick a valid replacement for each. Close matches are listed first.
            </p>
            {toAsk.map((bad) => {
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
                    value={
                      isUs
                        ? state.fixedZips[bad.storeKey] ?? ''
                        : String(
                            state.fixedSuburbIds[bad.storeKey] ??
                              known.find((k) => k.zip === state.fixedZips[bad.storeKey])?.id ??
                              ''
                          )
                    }
                    onChange={(e) => {
                      if (isUs) {
                        dispatch({ type: 'SET_FIXED_ZIP', badZip: bad.storeKey, corrected: e.target.value });
                        return;
                      }
                      const id = Number(e.target.value);
                      const picked = e.target.value ? known.find((k) => k.id === id) : undefined;
                      // NZ names repeat, so the option value is the tucSuburb id;
                      // it is kept in wizard state so Back then Next shows it again.
                      dispatch({
                        type: 'SET_FIXED_ZIP',
                        badZip: bad.storeKey,
                        corrected: picked?.zip ?? '',
                        suburbId: picked ? id : undefined,
                      });
                      if (picked) void remember(bad, id);
                    }}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-surface-white"
                  >
                    <option value="">
                      Choose {isUs ? 'Zip Code' : 'Suburb'}...
                    </option>
                    {suggested.length > 0 && (
                      <optgroup label="Suggested">
                        {suggested.map((k) => (
                          <option key={`s-${k.id}`} value={isUs ? k.zip ?? '' : String(k.id)}>
                            {k.zip}
                            {k.zoneName ? ` (${k.zoneName})` : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {rest.length > 0 && (
                      <optgroup label="All">
                        {rest.map((k) => (
                          <option key={k.id} value={isUs ? k.zip ?? '' : String(k.id)}>
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
