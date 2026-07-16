import { useMemo, useState } from 'react';
import type { BulkJob } from '../../types';
import { Panel } from '../common/Panel';
import { RowContextMenu, type ContextMenuItem } from './RowContextMenu';

interface Props {
  jobs: BulkJob[];
  search: string;
  onSetSearch: (search: string) => void;
  onSelectGroup?: (jobIds: number[]) => void;
  onBulkMoveGroup?: (jobIds: number[], groupLabel: string) => void;
  onContextMenuItems?: (jobIds: number[], groupLabel: string) => ContextMenuItem[];
}

export function GroupedJobs({
  jobs,
  search,
  onSetSearch,
  onSelectGroup,
  onBulkMoveGroup,
  onContextMenuItems,
}: Props) {
  const [ctx, setCtx] = useState<{ x: number; y: number; jobIds: number[]; label: string } | null>(null);

  const groups = useMemo(() => {
    const acc = new Map<string, BulkJob[]>();
    jobs.forEach((j) => {
      const key = j.toPostCode?.toString() ?? j.toSuburb ?? 'Unknown';
      if (!acc.has(key)) acc.set(key, []);
      acc.get(key)!.push(j);
    });
    let entries = Array.from(acc.entries()).sort(([a], [b]) => a.localeCompare(b));
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      entries = entries.filter(([key, items]) =>
        key.toLowerCase().includes(needle) ||
        items.some((j) => (j.toSuburb ?? '').toLowerCase().includes(needle)));
    }
    return entries;
  }, [jobs, search]);

  return (
    <Panel
      title="Grouped by Zip / Suburb"
      actions={
        <input
          type="text"
          value={search}
          onChange={(e) => onSetSearch(e.target.value)}
          placeholder="Filter zip..."
          className="border border-border rounded px-2 py-0.5 text-xs w-24"
        />
      }
    >
      <ul className="divide-y divide-border-light">
        {groups.map(([key, items]) => {
          const jobIds = items.map((j) => j.bulkJobId);
          return (
            <li
              key={key}
              className={`px-3 py-2 ${onSelectGroup ? 'cursor-pointer hover:bg-surface-cream' : ''}`}
              onClick={() => onSelectGroup?.(jobIds)}
              onContextMenu={(e) => {
                if (!onContextMenuItems) return;
                e.preventDefault();
                e.stopPropagation();
                setCtx({ x: e.clientX, y: e.clientY, jobIds, label: key });
              }}
              title={onSelectGroup ? 'Click to multi-select; right-click for more' : undefined}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-text-primary">{key}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-muted">
                    {items.length} job{items.length === 1 ? '' : 's'}
                  </span>
                  {onBulkMoveGroup && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onBulkMoveGroup(jobIds, key); }}
                      className="text-xs px-2 py-0.5 border border-brand-purple text-brand-purple rounded hover:bg-brand-purple/10"
                      title={`Move all ${items.length} jobs in ${key} to another date`}
                    >
                      Move date
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
        {groups.length === 0 && (
          <li className="px-3 py-4 text-center text-text-muted">
            {search.trim() ? 'No groups match the filter.' : 'No jobs to group.'}
          </li>
        )}
      </ul>
      <RowContextMenu
        clientX={ctx?.x ?? null}
        clientY={ctx?.y ?? null}
        title={ctx ? `Group ${ctx.label} (${ctx.jobIds.length} jobs)` : undefined}
        items={ctx && onContextMenuItems ? onContextMenuItems(ctx.jobIds, ctx.label) : []}
        onClose={() => setCtx(null)}
      />
    </Panel>
  );
}
