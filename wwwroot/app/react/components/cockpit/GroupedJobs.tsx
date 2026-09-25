import { useMemo, useState } from 'react';
import type { BulkJob } from '../../types';
import { Panel } from '../common/Panel';
import { Button } from '../common/Button';
import { RowContextMenu, type ContextMenuItem } from './RowContextMenu';
import { useAuth } from '../../context/AuthContext';
import { postcodeLabel } from '../../lib/tenantLabels';

export type GroupMode = 'postcode' | 'time';

interface Props {
  jobs: BulkJob[];
  search: string;
  mode: GroupMode;
  onSetMode: (mode: GroupMode) => void;
  onSetSearch: (search: string) => void;
  onSelectGroup?: (jobIds: number[]) => void;
  onBulkMoveGroup?: (jobIds: number[], groupLabel: string) => void;
  // For time-mode groups, this also gets an isTimeGroup flag so the parent
  // can attach different actions (Open these times / Edit Group Date).
  onContextMenuItems?: (jobIds: number[], groupLabel: string, isTimeGroup: boolean) => ContextMenuItem[];
  onDragStart?: (jobIds: number[]) => void;
}

/**
 * Grouped jobs pane. Legacy groupedJobs.tpl supports two modes: postcode
 * (default) and time-of-day. Time mode buckets jobs into 30-minute windows
 * by BookTime and sorts ascending - it's used for time-critical dispatch
 * planning. Draggable onto runs, same payload as JobsList.
 */
export function GroupedJobs({
  jobs,
  search,
  mode,
  onSetMode,
  onSetSearch,
  onSelectGroup,
  onBulkMoveGroup,
  onContextMenuItems,
  onDragStart,
}: Props) {
  const { isUsTenant } = useAuth();
  const zipLabel = postcodeLabel(isUsTenant, true);
  const [ctx, setCtx] = useState<{ x: number; y: number; jobIds: number[]; label: string; isTimeGroup: boolean } | null>(null);

  const groups = useMemo(() => {
    const acc = new Map<string, BulkJob[]>();
    jobs.forEach((j) => {
      const key = mode === 'time'
        ? bucketByTime(j.bookTime)
        : (j.toPostCode?.toString() ?? j.toSuburb ?? 'Unknown');
      if (!acc.has(key)) acc.set(key, []);
      acc.get(key)!.push(j);
    });
    let entries = Array.from(acc.entries());
    if (mode === 'time') {
      entries.sort(([a], [b]) => a.localeCompare(b));
    } else {
      entries.sort(([a], [b]) => a.localeCompare(b));
    }
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      entries = entries.filter(([key, items]) =>
        key.toLowerCase().includes(needle) ||
        items.some((j) => (j.toSuburb ?? '').toLowerCase().includes(needle)));
    }
    return entries;
  }, [jobs, search, mode]);

  const handleDragStart = (e: React.DragEvent<HTMLLIElement>, jobIds: number[]) => {
    e.dataTransfer.setData('application/x-bulk-job-ids', JSON.stringify(jobIds));
    e.dataTransfer.effectAllowed = 'move';
    onDragStart?.(jobIds);
  };

  return (
    <Panel
      title={mode === 'time' ? 'Grouped by Time' : `Grouped by ${zipLabel} / Suburb`}
      actions={
        <div className="flex items-center gap-1">
          <div className="inline-flex border border-border rounded-lg overflow-hidden text-[10px]">
            <button
              type="button"
              onClick={() => onSetMode('postcode')}
              className={`px-2 py-0.5 ${
                mode === 'postcode' ? 'bg-brand-cyan text-brand-dark font-medium'
                : 'bg-surface-white text-text-secondary hover:bg-surface-cream'
              }`}
              title={`Group jobs by ${zipLabel.toLowerCase()} / suburb (default)`}
            >{zipLabel}</button>
            <button
              type="button"
              onClick={() => onSetMode('time')}
              className={`px-2 py-0.5 ${
                mode === 'time' ? 'bg-brand-cyan text-brand-dark font-medium'
                : 'bg-surface-white text-text-secondary hover:bg-surface-cream'
              }`}
              title="Group jobs by ready time (30 min buckets)"
            >Time</button>
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => onSetSearch(e.target.value)}
            placeholder={mode === 'time' ? 'Filter time...' : `Filter ${zipLabel.toLowerCase()}...`}
            className="border border-border rounded px-2 py-0.5 text-xs w-20"
          />
        </div>
      }
    >
      <ul className="divide-y divide-border-light">
        {groups.map(([key, items]) => {
          const jobIds = items.map((j) => j.bulkJobId);
          return (
            <li
              key={key}
              draggable={!!onDragStart}
              onDragStart={onDragStart ? (e) => handleDragStart(e, jobIds) : undefined}
              className={`px-3 py-2 ${onSelectGroup ? 'cursor-pointer hover:bg-surface-cream' : ''} ${
                onDragStart ? 'cursor-move' : ''
              }`}
              onClick={() => onSelectGroup?.(jobIds)}
              onContextMenu={(e) => {
                if (!onContextMenuItems) return;
                e.preventDefault();
                e.stopPropagation();
                setCtx({ x: e.clientX, y: e.clientY, jobIds, label: key, isTimeGroup: mode === 'time' });
              }}
              title={onDragStart
                ? 'Drag to a run to assign, or click to multi-select. Right-click for more.'
                : (onSelectGroup ? 'Click to multi-select; right-click for more' : undefined)}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-text-primary">
                  {key}
                  {/* Postcode-mode suburb tail (P1.6, legacy groupedJobs.tpl:47).
                      Show up to 3 distinct suburb names so operators can
                      eyeball which suburbs a postcode bucket covers before
                      opening it. Time-mode buckets get no tail. */}
                  {mode === 'postcode' && (() => {
                    const suburbs = Array.from(new Set(
                      items.map((j) => (j.toSuburb ?? '').trim()).filter(Boolean)
                    ));
                    if (suburbs.length === 0) return null;
                    const shown = suburbs.slice(0, 3);
                    const tail = suburbs.length > 3 ? `, +${suburbs.length - 3}` : '';
                    return (
                      <span className="ml-1 text-[10px] text-text-muted font-normal">
                        ({shown.join(', ')}{tail})
                      </span>
                    );
                  })()}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-muted">
                    {items.length} job{items.length === 1 ? '' : 's'}
                  </span>
                  {onBulkMoveGroup && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); onBulkMoveGroup(jobIds, key); }}
                      title={`Move all ${items.length} jobs in ${key} to another date`}
                    >
                      Move date
                    </Button>
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
        title={ctx ? `${ctx.isTimeGroup ? 'Time' : 'Group'} ${ctx.label} (${ctx.jobIds.length} jobs)` : undefined}
        items={ctx && onContextMenuItems ? onContextMenuItems(ctx.jobIds, ctx.label, ctx.isTimeGroup) : []}
        onClose={() => setCtx(null)}
      />
    </Panel>
  );
}

// Bucket a bookTime (either "HH:MM:SS" or ISO datetime) into a 30-min slot
// key like "06:00", "06:30", "07:00". Buckets align at :00 and :30 so all
// jobs booked between 06:00 and 06:29 land in "06:00".
function bucketByTime(raw: string | null): string {
  if (!raw) return '(no time)';
  let hh = 0, mm = 0;
  if (/^\d{2}:\d{2}/.test(raw)) {
    hh = parseInt(raw.slice(0, 2), 10);
    mm = parseInt(raw.slice(3, 5), 10);
  } else {
    try {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) { hh = d.getHours(); mm = d.getMinutes(); }
    } catch { /* fall through */ }
  }
  const bucketMm = mm < 30 ? 0 : 30;
  return `${String(hh).padStart(2, '0')}:${String(bucketMm).padStart(2, '0')}`;
}
