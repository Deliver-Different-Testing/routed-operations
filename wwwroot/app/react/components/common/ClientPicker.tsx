import { useEffect, useRef, useState } from 'react';
import { scheduleService, type LookupItem } from '../../services/scheduleService';

interface Props {
  value: number | null;
  onChange: (clientId: number | null, label: string | null) => void;
  /** Label for the "no client" option, e.g. "Default" or "All clients". */
  defaultLabel: string;
  testId?: string;
}

/**
 * Pick a client by searching, not by scrolling.
 *
 * `/api/schedules/clients` caps at 200 rows (`Take(Math.Clamp(limit, 1, 200))`),
 * so a plain dropdown silently cannot reach a client whose code sorts past the
 * first 200. On Urgent that already hides Woop, which is one of the busiest.
 * A dropdown that cannot offer a client, with nothing on screen saying so, is
 * the failure this control exists to avoid: it searches on what the operator
 * types and says when the list is capped.
 *
 * `/api/clients` is the wrong source here. It scopes to the signed-in user's
 * own clients and returns nothing at all for a staff login, which is what
 * Client Overrides found first.
 */
export function ClientPicker({ value, onChange, defaultLabel, testId }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<LookupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [capped, setCapped] = useState(false);
  /** Kept so the selected client stays listed once the search moves on. */
  const selectedRef = useRef<LookupItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await scheduleService.searchClients(q.trim(), 200);
        if (cancelled) return;
        const rows = res.response ?? [];
        setResults(rows);
        setCapped(rows.length >= 200);
      } catch {
        if (!cancelled) { setResults([]); setCapped(false); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, q.trim() ? 250 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  // The selected client first, so changing the search never makes the current
  // selection look as though it has been lost.
  const options = selectedRef.current && !results.some((r) => r.id === selectedRef.current!.id)
    ? [selectedRef.current, ...results]
    : results;

  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search clients..."
        data-testid={testId ? `${testId}-search` : undefined}
        className="w-36 border border-border rounded-lg px-2 py-1.5 text-xs bg-surface-white focus:outline-none focus:ring-1 focus:ring-brand-cyan"
      />
      <select
        value={value ?? ''}
        data-testid={testId}
        onChange={(e) => {
          const id = e.target.value ? Number(e.target.value) : null;
          const hit = options.find((o) => o.id === id) ?? null;
          selectedRef.current = hit;
          onChange(id, hit?.name ?? null);
        }}
        className="border border-border rounded-lg px-2 py-1.5 text-xs bg-surface-white max-w-[18rem]"
      >
        <option value="">{defaultLabel}</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      {loading && <span className="text-[10px] text-text-muted">...</span>}
      {capped && !loading && (
        <span className="text-[10px] text-brand-orange" title="The server returns at most 200 clients per search.">
          first 200, narrow the search
        </span>
      )}
    </span>
  );
}
