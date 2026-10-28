import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { territoryService } from '../../services/territoryService';
import { postcodeLabel, postcodePluralLabel } from '../../lib/tenantLabels';

// Individual postcodes input + chip row for schedule modals.
//
// Kevin 2026-09-17: match the legacy ScheduleEditModal styling
// exactly (full-width text input + Add + cyan chip row with x
// remove buttons) AND validate every entry against the tenant's
// canonical postcode / zip list so operators can't bind a schedule
// to an invalid code.
//
// Data source:
//   - NZ tenant: /api/territory/nz/postcodes returns NzPostcode[] with
//     one row per known postcode (int).
//   - US tenant: /api/territory/us/zip-zones returns UsZipZone[] with
//     one row per known zip (string, may be 5-digit).
//   - Cached for 5 min via React Query; a large tenant with ~5k rows
//     ships ~250KB gzipped, done once per modal-open cycle.
//
// Behaviour:
//   - Enter or Add button attempts to add the typed value.
//   - Empty / non-numeric / out-of-range rejected inline.
//   - Not-in-lookup rejected inline with "unknown postcode" hint.
//   - Duplicate silently ignored (already bound is a no-op).
//   - x on a chip removes it. onChange fires with the new full list.

interface Props {
  /** Currently-bound postcode ints. Controlled by parent. */
  selected: number[];
  onChange: (next: number[]) => void;
  /** Whether the modal is open. Gates the lookup fetch so we don't
   *  hit the endpoint on every mount when the modal is closed. */
  enabled: boolean;
}

export function PostcodeLookupInput({ selected, onChange, enabled }: Props) {
  const auth = useAuth();
  const isUs = auth.isUsTenant;
  const singular = postcodeLabel(isUs, true);
  const singularLower = singular.toLowerCase();
  const plural = postcodePluralLabel(isUs);
  const pluralLower = plural.toLowerCase();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Digits-per-code: NZ postcodes are 4 digits (1000-9999), US zips
  // are 5 (00000-99999). Both stored as ints on the backend; padding
  // is applied for display only.
  const digitCount = isUs ? 5 : 4;
  const maxValue = Math.pow(10, digitCount) - 1; // 9999 or 99999

  // Normalise a raw string (from either the DB row or the user's
  // input) into a validated zip/postcode int, or null if unparseable.
  // Strips ZIP+4 suffixes so a US backend row like "12345-6789" hashes
  // to 12345 and the user typing "12345" finds it in the set. Also
  // handles leading-zero zips (Number("00501") -> 501, which we
  // consider valid US zip 00501; display pads it back on the way out).
  const normalise = (raw: string): number | null => {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 0) return null;
    // Take just the first `digitCount` digits so ZIP+4 or accidental
    // trailing input still hashes correctly.
    const head = digits.slice(0, digitCount);
    const n = Number(head);
    if (!Number.isInteger(n) || n < 0 || n > maxValue) return null;
    return n;
  };

  // Canonical postcode / zip lookup. Fetched once per modal-open
  // cycle. Tenant-scoped implicitly via the auth cookie.
  const lookupQuery = useQuery({
    queryKey: ['territory-postcode-lookup', isUs ? 'us' : 'nz'],
    queryFn: async () => {
      if (isUs) {
        const r = await territoryService.usZipZones();
        const set = new Set<number>();
        for (const z of r.response ?? []) {
          const n = normalise(z.zip ?? '');
          if (n != null) set.add(n);
        }
        return set;
      }
      const r = await territoryService.nzPostcodes();
      const set = new Set<number>();
      for (const p of r.response ?? []) {
        // NZ postCode is already an int; still route through normalise
        // so any weird 0 / null values get skipped.
        if (Number.isInteger(p.postCode) && p.postCode > 0 && p.postCode <= maxValue) {
          set.add(p.postCode);
        }
      }
      return set;
    },
    staleTime: 5 * 60_000,
    enabled,
    // Bust the cache when the tenant flips NZ<->US so we don't serve
    // the wrong country's set. The query key already discriminates,
    // but this makes intent explicit.
  });

  const validSet = lookupQuery.data;

  const attemptAdd = () => {
    const raw = input.trim();
    if (raw.length === 0) {
      setError(null);
      return;
    }
    const n = normalise(raw);
    if (n == null || n === 0) {
      setError(`Enter a valid ${singularLower}.`);
      return;
    }
    if (selected.includes(n)) {
      // Already bound. Not an error, just clear the input.
      setInput('');
      setError(null);
      return;
    }
    if (validSet && !validSet.has(n)) {
      setError(`${singular} ${pad(n, isUs)} is not a known ${singularLower} on this tenant.`);
      return;
    }
    onChange([...selected, n].sort((a, b) => a - b));
    setInput('');
    setError(null);
  };

  const remove = (p: number) => onChange(selected.filter((x) => x !== p));

  const sorted = useMemo(() => [...selected].sort((a, b) => a - b), [selected]);

  // ─── Paste (US coverage spec 5.2) ─────────────────────────────────────
  //
  // One at a time is 602 entries for Cheetah's Hub Group file. The three-way
  // result matters more than the count: an unknown code is the one an
  // operator has to act on, and it is NOT added by default, because a code
  // that is in no zone can never be offered. The depot rule runs before any
  // coverage test, so binding it would look like a configured schedule that
  // silently serves nothing.
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteResult, setPasteResult] = useState<{
    added: number[];
    alreadyBound: number[];
    unknown: number[];
    padded: number[];
    ignored: string[];
  } | null>(null);

  const applyPaste = () => {
    const result = classifyPaste(pasteText, selected, validSet, digitCount);
    if (result.added.length > 0) {
      onChange([...selected, ...result.added].sort((a, b) => a - b));
    }
    setPasteResult(result);
    setPasteText('');
    setError(null);
  };

  const addUnknownAnyway = () => {
    if (!pasteResult || pasteResult.unknown.length === 0) return;
    onChange([...selected, ...pasteResult.unknown].sort((a, b) => a - b));
    setPasteResult({ ...pasteResult, added: [...pasteResult.added, ...pasteResult.unknown], unknown: [] });
  };

  const list = (ns: number[]) => ns.map((n) => pad(n, isUs)).join(', ');

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              attemptAdd();
            }
          }}
          placeholder={`Add ${singularLower}...`}
          disabled={!enabled || lookupQuery.isLoading}
          className="flex-1 px-3 py-1.5 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40 disabled:bg-surface-light disabled:cursor-not-allowed"
        />
        <button
          type="button"
          onClick={attemptAdd}
          disabled={!enabled || lookupQuery.isLoading || input.trim().length === 0}
          className="px-3 py-1.5 text-sm rounded border border-border hover:bg-surface-light disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => { setPasteOpen((v) => !v); setPasteResult(null); }}
          disabled={!enabled || lookupQuery.isLoading}
          className="px-3 py-1.5 text-sm rounded border border-border hover:bg-surface-light disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pasteOpen ? 'Cancel paste' : '+ paste'}
        </button>
      </div>
      {pasteOpen && (
        <div className="mb-2">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={isUs ? '64030, 65201\n63501 64429' : '1010, 1011\n3010 3011'}
            className="w-full h-24 px-3 py-1.5 text-sm font-mono border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
          />
          <div className="flex items-center justify-between mt-1">
            <p className="text-[11px] text-text-muted">
              Commas, spaces, semicolons or new lines. Duplicates are dropped.
              {isUs && ` Short entries are read as ${digitCount}-digit zips.`}
            </p>
            <button
              type="button"
              onClick={applyPaste}
              disabled={pasteText.trim().length === 0}
              className="px-3 py-1.5 text-sm rounded border border-border hover:bg-surface-light disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Add {pluralLower}
            </button>
          </div>
        </div>
      )}
      {pasteResult && (
        <div className="rounded border border-border p-2 mb-2 text-[11px] space-y-1">
          <div>
            Bound: {pasteResult.added.length === 0 ? 'none' : list(pasteResult.added)}
          </div>
          {pasteResult.alreadyBound.length > 0 && (
            <div className="text-text-muted">
              Already bound: {list(pasteResult.alreadyBound)}
            </div>
          )}
          {pasteResult.padded.length > 0 && (
            <div className="text-text-muted">
              Read as {digitCount} digits: {list(pasteResult.padded)}
            </div>
          )}
          {pasteResult.unknown.length > 0 && (
            <div className="text-warning">
              <div>
                In no zone on this tenant, so not bound: {list(pasteResult.unknown)}.
                A {singularLower} in no zone can never be offered, because the depot
                is resolved from its zone before any coverage test runs.
              </div>
              <button
                type="button"
                onClick={addUnknownAnyway}
                className="mt-1 px-2 py-0.5 rounded border border-border hover:bg-surface-light"
              >
                Add anyway
              </button>
            </div>
          )}
          {pasteResult.ignored.length > 0 && (
            <div className="text-warning">
              Not a {singularLower}, so skipped: {pasteResult.ignored.join(', ')}
            </div>
          )}
        </div>
      )}
      {error && (
        <div className="text-[11px] text-error mb-2">{error}</div>
      )}
      {lookupQuery.isError && (
        <div className="text-[11px] text-warning mb-2">
          Could not load {pluralLower} lookup ({(lookupQuery.error as Error).message}). Validation is off; entries are accepted as-is.
        </div>
      )}
      {sorted.length === 0 && !error && (
        <div className="text-[11px] text-text-muted italic">
          No individual {pluralLower} bound.
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {sorted.map((p) => (
          <span
            key={p}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-brand-cyan/15 text-brand-cyan font-mono"
          >
            {pad(p, isUs)}
            <button
              type="button"
              onClick={() => remove(p)}
              className="ml-1 hover:opacity-70"
              title="Remove"
            >
              x
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

function pad(n: number, isUs: boolean): string {
  // NZ postcodes are 4 digits, US zips are 5. Zero-pad for display so
  // "1050" reads correctly instead of the raw int.
  return String(n).padStart(isUs ? 5 : 4, '0');
}

export interface PasteClassification {
  /** Valid, known and not already bound. These are bound immediately. */
  added: number[];
  /** Already bound, so not written again. Not an error. */
  alreadyBound: number[];
  /** Parses as a code but is in no zone on this tenant. NOT bound by
   *  default: the depot is resolved from a code's zone before any coverage
   *  test runs, so a code in no zone can never be offered, and binding it
   *  would look like a configured schedule that silently serves nothing.
   *  The operator can still force it. */
  unknown: number[];
  /** Entries shorter than the tenant's code length, listed because the
   *  reading is a guess worth showing: "7030" means 07030, not 70300. */
  padded: number[];
  /** Could not be read as a code at all, returned verbatim so the operator
   *  can see what was in their paste. Dane's Cheetah file carries 116
   *  "DOS NOT ON FILE" rows. */
  ignored: string[];
}

/**
 * Sort a pasted blob into what was bound, what was already there, and what
 * needs a decision.
 *
 * Pure so it can be tested without standing up the lookup fetch. The three
 * buckets are the point: a count of "97 added" hides the three codes the
 * operator actually has to do something about.
 *
 * `validSet` undefined means the lookup did not load, in which case entries
 * are accepted as typed rather than all being called unknown, matching what
 * the single-entry Add button does.
 */
export function classifyPaste(
  text: string,
  selected: number[],
  validSet: Set<number> | undefined,
  digitCount: number,
): PasteClassification {
  const added: number[] = [];
  const alreadyBound: number[] = [];
  const unknown: number[] = [];
  const padded: number[] = [];
  const ignored: string[] = [];
  const seen = new Set<number>();
  const maxValue = Math.pow(10, digitCount) - 1;

  for (const raw of text.split(/[\s,;]+/)) {
    const entry = raw.trim();
    if (entry.length === 0) continue;

    const digits = entry.replace(/\D/g, '');
    const n = digits.length === 0 ? NaN : Number(digits.slice(0, digitCount));
    if (!Number.isInteger(n) || n <= 0 || n > maxValue) {
      if (!ignored.includes(entry)) ignored.push(entry);
      continue;
    }
    if (seen.has(n)) continue;
    seen.add(n);

    if (digits.length < digitCount) padded.push(n);
    if (selected.includes(n)) { alreadyBound.push(n); continue; }
    if (validSet && !validSet.has(n)) { unknown.push(n); continue; }
    added.push(n);
  }

  return { added, alreadyBound, unknown, padded, ignored };
}
