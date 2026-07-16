import { useMemo } from 'react';
import type { Fleet } from '../../types';
import { Panel } from '../common/Panel';

interface Props {
  fleets: Fleet[];
  search: string;
  onSetSearch: (search: string) => void;
}

export function FleetsPanel({ fleets, search, onSetSearch }: Props) {
  const filtered = useMemo(() => {
    if (!search.trim()) return fleets;
    const needle = search.trim().toLowerCase();
    return fleets
      .map((f) => ({
        ...f,
        couriers: f.couriers.filter((c) =>
          c.displayName.toLowerCase().includes(needle) ||
          (f.fleet ?? '').toLowerCase().includes(needle)),
      }))
      .filter((f) => f.couriers.length > 0 || f.fleet.toLowerCase().includes(needle));
  }, [fleets, search]);

  return (
    <Panel
      title={`Fleets (${filtered.length})`}
      actions={
        <input
          type="text"
          value={search}
          onChange={(e) => onSetSearch(e.target.value)}
          placeholder="Filter..."
          className="border border-border rounded px-2 py-0.5 text-xs w-24"
        />
      }
    >
      <ul className="divide-y divide-border-light">
        {filtered.map((f) => (
          <li key={f.fleet} className="px-3 py-2">
            <div className="font-medium text-sm text-text-primary">{f.fleet}</div>
            <div className="text-xs text-text-muted">
              {f.couriers.length} courier{f.couriers.length === 1 ? '' : 's'}
            </div>
            <ul className="mt-1 text-xs text-text-secondary space-y-0.5">
              {f.couriers.slice(0, 8).map((c) => (
                <li key={c.courierId}>{c.displayName}</li>
              ))}
              {f.couriers.length > 8 && (
                <li className="text-text-muted">+ {f.couriers.length - 8} more</li>
              )}
            </ul>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="px-3 py-4 text-center text-text-muted">
            {search.trim() ? 'No fleets match the filter.' : 'No active couriers.'}
          </li>
        )}
      </ul>
    </Panel>
  );
}
