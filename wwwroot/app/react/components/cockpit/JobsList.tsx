import { useMemo, useState } from 'react';
import type { BulkJob } from '../../types';
import { Panel } from '../common/Panel';
import { Button } from '../common/Button';
import type { JobSizeFilter, ListSort } from './CockpitState';
import { RowContextMenu, type ContextMenuItem } from './RowContextMenu';
import { sortIndicator, nextSortDirection } from '../../lib/sortLists';
import { exportJobsToCsv } from '../../lib/csvExport';
import { useAuth } from '../../context/AuthContext';
import { postcodeLabel } from '../../lib/tenantLabels';

interface Props {
  jobs: BulkJob[];
  selectedJobId: number | null;
  selectedJobIds: number[];
  sort: ListSort | null;
  sizeFilter: JobSizeFilter;
  search: string;
  onSetSort: (sort: ListSort | null) => void;
  onSetSizeFilter: (filter: JobSizeFilter) => void;
  onSetSearch: (search: string) => void;
  onSelectJob: (jobId: number) => void;
  onToggleMultiselect: (jobId: number) => void;
  onToggleAllMultiselect: () => void;
  onContextMenuItems: (job: BulkJob) => ContextMenuItem[];
}

export function JobsList({
  jobs,
  selectedJobId,
  selectedJobIds,
  sort,
  sizeFilter,
  search,
  onSetSort,
  onSetSizeFilter,
  onSetSearch,
  onSelectJob,
  onToggleMultiselect,
  onToggleAllMultiselect,
  onContextMenuItems,
}: Props) {
  const { isUsTenant } = useAuth();
  const zipLabel = postcodeLabel(isUsTenant, true);
  const [ctx, setCtx] = useState<{ x: number; y: number; job: BulkJob } | null>(null);
  // Phase 5 perf: rebuild the Set only when selectedJobIds actually changes.
  // Previous plain `new Set(...)` allocated 500+ entries on every render even
  // when nothing about selection had moved.
  const selectedSet = useMemo(() => new Set(selectedJobIds), [selectedJobIds]);
  // State-based allSelected derivation (per risk-audit mitigation for
  // future virtualization work): compare lengths rather than iterating
  // rows so this stays O(1) instead of O(n).
  const allSelected = jobs.length > 0 && jobs.length === selectedSet.size;

  const handleDragStart = (e: React.DragEvent<HTMLTableRowElement>, jobId: number) => {
    const ids = selectedSet.has(jobId) ? selectedJobIds : [jobId];
    e.dataTransfer.setData('application/x-bulk-job-ids', JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
  };

  const columns: { field: string; label: string }[] = [
    { field: 'clientCode', label: 'Client' },
    { field: 'jobNumber', label: 'Job #' },
    { field: 'bookDate', label: 'D Date' },
    { field: 'bookTime', label: 'R Time' },
    { field: 'toAddress', label: 'To' },
    { field: 'toSuburb', label: 'Suburb' },
    { field: 'toPostCode', label: zipLabel },
    { field: 'courierName', label: 'Courier' },
    { field: 'speedName', label: 'Speed' },
    { field: 'runName', label: 'Run' },
  ];

  return (
    <Panel
      title={`Jobs (${jobs.length}) - ${selectedJobIds.length} selected`}
      actions={
        <div className="flex gap-1 items-center">
          <input
            type="text"
            value={search}
            onChange={(e) => onSetSearch(e.target.value)}
            placeholder="Filter..."
            className="border border-border rounded px-2 py-0.5 text-xs w-24"
          />
          <Button
            variant="neutral"
            size="sm"
            active={sizeFilter === 'moreThan100Cubic'}
            onClick={() => onSetSizeFilter(sizeFilter === 'all' ? 'moreThan100Cubic' : 'all')}
            title="Show only jobs with cubic > 100 m3"
          >
            &gt;100 m3
          </Button>
          <Button
            variant="neutral"
            size="sm"
            onClick={() => exportJobsToCsv(jobs, isUsTenant)}
            disabled={jobs.length === 0}
            title={jobs.length === 0 ? 'No jobs to export' : `Download ${jobs.length} job(s) as CSV`}
          >
            CSV
          </Button>
        </div>
      }
    >
      <table className="w-full text-xs">
        <thead className="bg-surface-cream sticky top-0">
          <tr className="text-left text-text-muted">
            <th className="px-2 py-1 w-8">
              <input
                type="checkbox"
                aria-label="Select all"
                checked={allSelected}
                onChange={onToggleAllMultiselect}
              />
            </th>
            {columns.map((c) => (
              <th
                key={c.field}
                onClick={() => onSetSort(nextSortDirection(sort, c.field))}
                className="px-2 py-1 cursor-pointer hover:bg-surface-light select-none"
                title="Click to sort. Click again to reverse."
              >
                {c.label}{sortIndicator(sort, c.field)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => {
            const missingGps = !j.deliveryLatitude;
            return (
            <tr
              key={j.bulkJobId}
              draggable
              onDragStart={(e) => handleDragStart(e, j.bulkJobId)}
              onClick={() => onSelectJob(j.bulkJobId)}
              onContextMenu={(e) => {
                // stopPropagation prevents ancestor / body-level listeners
                // (react-resizable-panels adds one during resize) from
                // swallowing the event before React's synthetic dispatch.
                e.preventDefault();
                e.stopPropagation();
                setCtx({ x: e.clientX, y: e.clientY, job: j });
              }}
              className={`cursor-move border-t border-border-light hover:bg-surface-cream ${
                selectedJobId === j.bulkJobId ? 'bg-brand-cyan/20' : ''
              } ${missingGps ? 'text-error' : ''}`}
              title={missingGps
                ? 'Job is missing GPS coordinates - right-click and Fix GPS'
                : 'Drag onto a run - right-click for more'}
            >
              <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  aria-label={`Select job ${j.jobNumber ?? j.bulkJobId}`}
                  checked={selectedSet.has(j.bulkJobId)}
                  onChange={() => onToggleMultiselect(j.bulkJobId)}
                />
              </td>
              <td className="px-2 py-1">{j.clientCode}</td>
              <td className="px-2 py-1 font-medium">
                {j.jobNumber}
                {missingGps && <span title="Missing GPS coordinates" className="ml-1">!</span>}
              </td>
              <td className="px-2 py-1">{j.bookDate ? formatDate(j.bookDate) : ''}</td>
              <td className="px-2 py-1">{j.bookTime ? formatTime(j.bookTime) : ''}</td>
              <td className="px-2 py-1 truncate max-w-32" title={j.toAddress ?? ''}>{j.toAddress ?? ''}</td>
              <td className="px-2 py-1">{j.toSuburb}</td>
              <td className="px-2 py-1">{j.toPostCode}</td>
              <td className="px-2 py-1 truncate max-w-24" title={j.courierName ?? ''}>{j.courierName ?? ''}</td>
              <td className="px-2 py-1">{j.speedName ?? j.speed}</td>
              <td className="px-2 py-1">{j.runName ?? ''}</td>
            </tr>
          );
          })}
          {jobs.length === 0 && (
            <tr>
              <td colSpan={columns.length + 1} className="px-2 py-4 text-center text-text-muted">
                No jobs match the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <RowContextMenu
        clientX={ctx?.x ?? null}
        clientY={ctx?.y ?? null}
        title={ctx ? `Job ${ctx.job.jobNumber}` : undefined}
        items={ctx ? onContextMenuItems(ctx.job) : []}
        onClose={() => setCtx(null)}
      />
    </Panel>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  } catch {
    return '';
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
  } catch {
    return '';
  }
}
