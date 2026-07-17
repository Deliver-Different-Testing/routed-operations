import { useMemo, useState } from 'react';
import type { Fleet } from '../../types';
import { Panel } from '../common/Panel';

interface Props {
  fleets: Fleet[];
  search: string;
  onSetSearch: (search: string) => void;
}

/**
 * Fleets panel. Legacy potentialCourierFleets.tpl - lists every fleet the
 * tenant has active, grouped, with each courier draggable onto a run to
 * assign. Search filters both fleet + courier name. Fleets collapse to save
 * vertical space when the operator has 20+ fleets.
 */
export function FleetsPanel({ fleets, search, onSetSearch }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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

  const toggle = (fleet: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(fleet)) next.delete(fleet); else next.add(fleet);
      return next;
    });
  };

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
        {filtered.map((f) => {
          const isCollapsed = collapsed.has(f.fleet);
          return (
            <li key={f.fleet} className="px-3 py-2">
              <button
                type="button"
                onClick={() => toggle(f.fleet)}
                className="w-full text-left flex items-center justify-between text-sm text-text-primary font-medium hover:text-brand-cyan"
              >
                <span>
                  <span className="inline-block w-3 text-text-muted">{isCollapsed ? '+' : '-'}</span>
                  {f.fleet}
                </span>
                <span className="text-xs text-text-muted font-normal">
                  {f.couriers.length}
                </span>
              </button>
              {!isCollapsed && (
                <ul className="mt-1 text-xs text-text-secondary space-y-0.5">
                  {f.couriers.map((c) => (
                    <li
                      key={c.courierId}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/x-courier-id', String(c.courierId));
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      className="cursor-move hover:bg-surface-cream px-1 rounded"
                      title="Drag onto a run in the Runs list to assign this courier"
                    >
                      {c.displayName}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="px-3 py-4 text-center text-text-muted">
            {search.trim() ? 'No fleets match the filter.' : 'No active couriers.'}
          </li>
        )}
      </ul>
    </Panel>
  );
}
