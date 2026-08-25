import { useEffect, useMemo, useRef, useState } from 'react';
import { scheduleService, type LookupItem } from '../../services/scheduleService';

interface Props {
  /** Currently-selected client codes. Kept as a Set of code strings
   *  because operators identify clients by code, not id. */
  selectedCodes: Set<string>;
  onToggle: (code: string) => void;
  /** Optional. If provided, used as the initial browse list before the
   *  operator types anything (typically lookups.clients from the
   *  ScheduleLookups bundle). Falls back to the first server hits. */
  initialList?: LookupItem[];
  /** Debounce ms for the search input. Default 250. */
  debounceMs?: number;
  placeholder?: string;
  /** Cap the visible list. Server-side search returns up to 50 by
   *  default; keep the local render capped so the browser doesn't
   *  paint a 200-item list on a fresh browse either. */
  maxRender?: number;
}

/**
 * Multi-select client picker with server-side search. Solves the
 * "operator types a client code and gets no results" bug that came
 * from filtering the lookups-bundle client list client-side - the
 * bundle is capped at 500 alphabetically and misses codes past the
 * cutoff on any large tenant.
 *
 * Behaviour:
 *   * Debounced (250ms) search hits /api/schedules/clients?q=X
 *   * Empty query = show initialList (or the first server hits)
 *   * Selected codes render as chips below the picker with click-to-remove
 *
 * Code extraction: the LookupItem.name field is "CODE Name" per the
 * ScheduleService projection. First space split isolates the code.
 */
export function ClientMultiPicker({
  selectedCodes,
  onToggle,
  initialList,
  debounceMs = 250,
  placeholder = 'Filter clients by code / name...',
  maxRender = 100,
}: Props) {
  const [filter, setFilter] = useState('');
  const [results, setResults] = useState<LookupItem[]>(() => initialList ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    // Cancel any in-flight request when a new keystroke arrives.
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    // Empty query: fall back to the initial list (or hit server for a
    // browse if no initial list was supplied). No debounce needed for
    // the initial list case.
    if (!filter.trim() && initialList) {
      setResults(initialList);
      setError(null);
      return;
    }

    debounceRef.current = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await scheduleService.searchClients(filter.trim());
        setResults(res.response ?? []);
      } catch (e) {
        setError((e as Error).message);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, [filter, initialList, debounceMs]);

  const shown = useMemo(() => results.slice(0, maxRender), [results, maxRender]);

  const codeFromLabel = (label: string): string => {
    const trimmed = (label ?? '').trim();
    const space = trimmed.indexOf(' ');
    return space > 0 ? trimmed.slice(0, space) : trimmed;
  };

  return (
    <div>
      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-border rounded-lg px-2 py-1.5 text-sm bg-surface-white focus:outline-none focus:ring-1 focus:ring-brand-cyan mb-2"
      />
      <div className="max-h-56 overflow-y-auto rounded-lg border border-border bg-white">
        {loading && (
          <div className="p-3 text-[11px] text-text-muted italic">Searching...</div>
        )}
        {error && (
          <div className="p-3 text-[11px] text-red-600 italic">{error}</div>
        )}
        {!loading && !error && shown.length === 0 && (
          <div className="p-3 text-[11px] text-text-muted italic">
            {filter.trim() ? 'No clients match.' : 'Type to search clients.'}
          </div>
        )}
        {!loading && !error && shown.map((c) => {
          const code = codeFromLabel(c.name);
          const checked = selectedCodes.has(code);
          return (
            <label
              key={c.id}
              className={`flex items-center gap-2 px-2 py-1 border-b border-border-light last:border-b-0 cursor-pointer hover:bg-surface-cream ${checked ? 'bg-brand-cyan/10' : ''}`}
            >
              <input type="checkbox" className="w-3.5 h-3.5" checked={checked}
                onChange={() => onToggle(code)} />
              <span className="text-xs">{c.name}</span>
            </label>
          );
        })}
        {!loading && results.length > maxRender && (
          <div className="p-2 text-center text-[11px] text-text-muted italic border-t border-border-light">
            Showing first {maxRender} of {results.length}. Refine the search to narrow.
          </div>
        )}
      </div>
      {selectedCodes.size > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {Array.from(selectedCodes).sort().map((c) => (
            <span key={c} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-brand-cyan/15 text-brand-cyan">
              {c}
              <button type="button" className="ml-1 hover:opacity-70" onClick={() => onToggle(c)}>x</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
