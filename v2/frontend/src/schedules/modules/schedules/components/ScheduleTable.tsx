// src/modules/schedules/components/ScheduleTable.tsx
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Trash2, Users } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { SearchInput } from '../../../components/filters/SearchInput';
import { FilterDropdown } from '../../../components/filters/FilterDropdown';
import { DayPills } from '../../../components/ui/DayPills';
import { ActiveToggle } from '../../../components/ui/ActiveToggle';
import type { Schedule, ScheduleFilterState, SortConfig, SortableColumn } from '../types';
import { buildScheduleTableData, getBookingModeLabel } from '../types';
import { sampleDepots, sampleClients, sampleSpeeds } from '../data/sampleData';
import { effectiveSchedulesForClient, clientLabel } from '../utils/clientLinks';
import { routesForSchedule, runsForSchedule, sampleLinehaulRuns, sampleRecurringRoutes } from '../dispatch/dispatchData';

interface ScheduleTableProps {
  schedules: Schedule[];
  selectedId: string | null;
  onSelectSchedule: (schedule: Schedule) => void;
  collapsedBaseIds?: Set<string>;
  onToggleCollapse?: (baseId: string) => void;
  externalSearchQuery?: string;
  externalTagSearch?: string;
  onConnectionsClick?: (schedule: Schedule) => void;
  onToggleActive?: (schedule: Schedule, newValue: boolean) => void;
  onCopySchedule?: (schedule: Schedule) => void;
  onDeleteSchedule?: (schedule: Schedule) => void;
  /** Routed Operations: attach clients to a schedule (link rows). */
  onAttachClients?: (schedule: Schedule) => void;
}

function DispatchCell({ schedule }: { schedule: Schedule }) {
  const routes = routesForSchedule(sampleRecurringRoutes, schedule.id);
  const runs = runsForSchedule(sampleLinehaulRuns, schedule);
  if (!routes.length && !runs.length) return <span className="text-xs text-text-muted">—</span>;
  const code = (depot: string) => depot.slice(0, 3).toUpperCase();
  return (
    <div className="flex flex-col items-start gap-1">
      {routes.length > 0 && <Badge variant="blue" size="sm">{routes.length} route{routes.length > 1 ? 's' : ''}</Badge>}
      {runs.map((run) => (
        <Badge key={run.id} variant="orange" size="sm" className="whitespace-nowrap" aria-label={`${run.name} departs ${run.departTime}`}>
          LH {code(run.fromDepot)}→{code(run.toDepot)} {run.departTime}
        </Badge>
      ))}
    </div>
  );
}

export function ScheduleTable({
  schedules,
  selectedId,
  onSelectSchedule,
  externalSearchQuery = '',
  externalTagSearch = '',
  onConnectionsClick,
  onToggleActive,
  onCopySchedule,
  onDeleteSchedule,
  onAttachClients,
}: ScheduleTableProps) {
  // "View as client": the schedules that client can actually book (resolution rule), tagged by source.
  const [viewAsClientId, setViewAsClientId] = useState<number | null>(null);
  const [filters, setFilters] = useState<ScheduleFilterState>({
    search: '',
    status: 'all',
    type: 'all',
    clientId: 'all',
    originDepotId: 'all',
    destinationDepotId: 'all',
  });

  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);

  const handleSort = (column: SortableColumn) => {
    setSortConfig((prev) => {
      if (!prev || prev.column !== column) {
        return { column, direction: 'asc' };
      }
      if (prev.direction === 'asc') {
        return { column, direction: 'desc' };
      }
      return null;
    });
  };

  // Build table data
  const sourceById = useMemo(() => {
    const map = new Map<number, string>();
    if (viewAsClientId != null) {
      effectiveSchedulesForClient(schedules, viewAsClientId).forEach((e) => map.set(e.schedule.id, e.source));
    }
    return map;
  }, [schedules, viewAsClientId]);
  const allRows = useMemo(() => {
    const rows = buildScheduleTableData(schedules, sampleDepots, sampleClients, sampleSpeeds);
    return viewAsClientId == null ? rows : rows.filter((r) => sourceById.has(r.id));
  }, [schedules, viewAsClientId, sourceById]);

  // Combine external search with internal filters
  const combinedSearch = externalSearchQuery || filters.search;

  // Apply filters
  const filteredRows = useMemo(() => {
    return allRows.filter((row) => {
      // Type filter: overrides nest under their base (Routed Operations), defaults vs shared by visibility
      if (filters.type === 'base' && row.isOverride) return false;
      if (filters.type === 'override' && !row.isOverride) return false;
      if (filters.type === 'default' && (row.isOverride || row.visibility !== 'all')) return false;
      if (filters.type === 'shared' && (row.isOverride || row.visibility !== 'specific')) return false;

      // Search filter (combined with external search)
      if (combinedSearch) {
        const searchLower = combinedSearch.toLowerCase();
        if (!row.name.toLowerCase().includes(searchLower) &&
            !row.route.toLowerCase().includes(searchLower) &&
            !row.clientDisplay.toLowerCase().includes(searchLower)) {
          return false;
        }
      }

      // Tag search filter (connected entities)
      if (externalTagSearch) {
        const tagLower = externalTagSearch.toLowerCase();
        // Search in client names, depot names, route info
        if (!row.clientDisplay.toLowerCase().includes(tagLower) &&
            !row.originDepot.toLowerCase().includes(tagLower) &&
            !row.destDepot.toLowerCase().includes(tagLower) &&
            !row.route.toLowerCase().includes(tagLower)) {
          return false;
        }
      }

      // Status filter
      if (filters.status !== 'all' && row.status !== filters.status) {
        return false;
      }

      return true;
    });
  }, [allRows, filters, combinedSearch, externalTagSearch]);

  // Apply sorting
  const sortedRows = useMemo(() => {
    if (!sortConfig) return filteredRows;

    const { column, direction } = sortConfig;
    const multiplier = direction === 'asc' ? 1 : -1;

    return [...filteredRows].sort((a, b) => {
      if (a.isOverride !== b.isOverride) {
        if (a.baseScheduleName === b.name) return 1;
        if (b.baseScheduleName === a.name) return -1;
      }

      const aVal = a[column] ?? '';
      const bVal = b[column] ?? '';

      if (typeof aVal === 'boolean' && typeof bVal === 'boolean') {
        return ((aVal ? 1 : 0) - (bVal ? 1 : 0)) * multiplier;
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return aVal.localeCompare(bVal) * multiplier;
      }

      return (Number(aVal) - Number(bVal)) * multiplier;
    });
  }, [filteredRows, sortConfig]);

  // Since override rows are hidden by default, visibleRows is just sortedRows
  const visibleRows = sortedRows;

  // Filter options
  const statusOptions = ['All Status', 'Active', 'Inactive'];
  const typeOptions = ['All Types', 'Defaults', 'Shared', 'Overrides'];
  const typeLabel: Record<ScheduleFilterState['type'], string> = { all: 'All Types', base: 'All Types', default: 'Defaults', shared: 'Shared', override: 'Overrides' };
  const viewAsOptions = ['All schedules', ...sampleClients.map((c) => c.name)];
  const depotOptions = ['All Depots', ...sampleDepots.map((d) => d.name)];

  return (
    <div className="flex flex-col h-full">
      {/* Filters */}
      <div className="p-3 border-b border-border bg-surface-light space-y-2">
        <SearchInput
          value={filters.search}
          onChange={(value) => setFilters((f) => ({ ...f, search: value }))}
          placeholder="Search schedules, routes, clients..."
        />
        <div className="flex items-center gap-2 flex-wrap">
          <FilterDropdown
            id="status"
            label="Status"
            options={statusOptions}
            selectedValues={filters.status === 'all' ? [] : [filters.status === 'active' ? 'Active' : 'Inactive']}
            onChange={(values) => {
              const v = values[0];
              setFilters((f) => ({
                ...f,
                status: !v || v === 'All Status' ? 'all' : v === 'Active' ? 'active' : 'inactive',
              }));
            }}
          />
          <FilterDropdown
            id="type"
            label="Type"
            options={typeOptions}
            selectedValues={filters.type === 'all' ? [] : [typeLabel[filters.type]]}
            onChange={(values) => {
              const v = values[0];
              setFilters((f) => ({
                ...f,
                type: !v || v === 'All Types' ? 'all' : v === 'Defaults' ? 'default' : v === 'Shared' ? 'shared' : 'override',
              }));
            }}
          />
          <FilterDropdown
            id="view-as"
            label="View as"
            options={viewAsOptions}
            selectedValues={viewAsClientId == null ? [] : [sampleClients.find((c) => c.id === viewAsClientId)?.name ?? '']}
            onChange={(values) => {
              const v = values[0];
              const client = sampleClients.find((c) => c.name === v);
              setViewAsClientId(client ? client.id : null);
            }}
          />
          <FilterDropdown
            id="depot"
            label="Depot"
            options={depotOptions}
            selectedValues={[]}
            onChange={() => {}}
          />
        </div>
        <div className="text-xs text-text-muted" data-testid="schedule-table-count">
          {viewAsClientId != null
            ? `${visibleRows.length} available to ${clientLabel(sampleClients, viewAsClientId)} · own override › shared › default`
            : `Showing ${visibleRows.length} of ${schedules.length} schedules`}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-x-auto overflow-y-auto">
        <table className="w-full text-sm" data-testid="schedule-table" aria-label="schedule table">
          <caption className="sr-only">Schedule list with sorting and filtering</caption>
          <thead className="bg-surface-light sticky top-0 z-10">
            <tr className="border-b border-border">
              <th
                onClick={() => handleSort('name')}
                className={`text-left py-2 px-2 font-medium uppercase text-xs cursor-pointer hover:text-text-primary hover:bg-surface-cream select-none transition-colors  ${sortConfig?.column === 'name' ? 'text-brand-dark bg-brand-cyan/5' : 'text-text-muted'}`}
              >
                <div className="flex items-center gap-1">
                  <span>Name</span>
                  <span className="w-4 h-4 flex items-center justify-center">
                    {sortConfig?.column === 'name' && sortConfig.direction === 'asc' && <ChevronUp className="w-3 h-3" />}
                    {sortConfig?.column === 'name' && sortConfig.direction === 'desc' && <ChevronDown className="w-3 h-3" />}
                  </span>
                </div>
              </th>
              <th className="text-center py-2 px-2 font-medium text-text-muted uppercase text-xs ">Days</th>
              <th
                onClick={() => handleSort('originDepot')}
                className={`hidden md:table-cell text-left py-2 px-2 font-medium uppercase text-xs cursor-pointer hover:text-text-primary hover:bg-surface-cream select-none transition-colors  ${sortConfig?.column === 'originDepot' ? 'text-brand-dark bg-brand-cyan/5' : 'text-text-muted'}`}
              >
                <div className="flex items-center gap-1">
                  <span>Origin</span>
                  <span className="w-4 h-4 flex items-center justify-center">
                    {sortConfig?.column === 'originDepot' && sortConfig.direction === 'asc' && <ChevronUp className="w-3 h-3" />}
                    {sortConfig?.column === 'originDepot' && sortConfig.direction === 'desc' && <ChevronDown className="w-3 h-3" />}
                  </span>
                </div>
              </th>
              <th
                onClick={() => handleSort('destDepot')}
                className={`hidden md:table-cell text-left py-2 px-2 font-medium uppercase text-xs cursor-pointer hover:text-text-primary hover:bg-surface-cream select-none transition-colors  ${sortConfig?.column === 'destDepot' ? 'text-brand-dark bg-brand-cyan/5' : 'text-text-muted'}`}
              >
                <div className="flex items-center gap-1">
                  <span>Dest</span>
                  <span className="w-4 h-4 flex items-center justify-center">
                    {sortConfig?.column === 'destDepot' && sortConfig.direction === 'asc' && <ChevronUp className="w-3 h-3" />}
                    {sortConfig?.column === 'destDepot' && sortConfig.direction === 'desc' && <ChevronDown className="w-3 h-3" />}
                  </span>
                </div>
              </th>
              <th className="hidden md:table-cell text-left py-2 px-2 font-medium text-text-muted uppercase text-xs">Dispatch</th>
              <th
                onClick={() => handleSort('speedDisplay')}
                className={`hidden lg:table-cell text-left py-2 px-2 font-medium uppercase text-xs cursor-pointer hover:text-text-primary hover:bg-surface-cream select-none transition-colors  ${sortConfig?.column === 'speedDisplay' ? 'text-brand-dark bg-brand-cyan/5' : 'text-text-muted'}`}
              >
                <div className="flex items-center gap-1">
                  <span>Speed</span>
                  <span className="w-4 h-4 flex items-center justify-center">
                    {sortConfig?.column === 'speedDisplay' && sortConfig.direction === 'asc' && <ChevronUp className="w-3 h-3" />}
                    {sortConfig?.column === 'speedDisplay' && sortConfig.direction === 'desc' && <ChevronDown className="w-3 h-3" />}
                  </span>
                </div>
              </th>
              <th
                onClick={() => handleSort('bookingMode')}
                className={`hidden lg:table-cell text-left py-2 px-2 font-medium uppercase text-xs cursor-pointer hover:text-text-primary hover:bg-surface-cream select-none transition-colors w-[12%] ${sortConfig?.column === 'bookingMode' ? 'text-brand-dark bg-brand-cyan/5' : 'text-text-muted'}`}
              >
                <div className="flex items-center gap-1">
                  <span>Mode</span>
                  <span className="w-4 h-4 flex items-center justify-center">
                    {sortConfig?.column === 'bookingMode' && sortConfig.direction === 'asc' && <ChevronUp className="w-3 h-3" />}
                    {sortConfig?.column === 'bookingMode' && sortConfig.direction === 'desc' && <ChevronDown className="w-3 h-3" />}
                  </span>
                </div>
              </th>
              <th className="hidden lg:table-cell text-left py-2 px-2 font-medium text-text-muted uppercase text-xs w-[18%]">
                Clients
              </th>
              <th
                onClick={() => handleSort('status')}
                className={`text-center py-2 px-2 font-medium uppercase text-xs cursor-pointer hover:text-text-primary hover:bg-surface-cream select-none transition-colors w-16 ${sortConfig?.column === 'status' ? 'text-brand-dark bg-brand-cyan/5' : 'text-text-muted'}`}
              >
                <div className="flex items-center justify-center gap-1">
                  <span>Status</span>
                  <span className="w-4 h-4 flex items-center justify-center">
                    {sortConfig?.column === 'status' && sortConfig.direction === 'asc' && <ChevronUp className="w-3 h-3" />}
                    {sortConfig?.column === 'status' && sortConfig.direction === 'desc' && <ChevronDown className="w-3 h-3" />}
                  </span>
                </div>
              </th>
              <th className="text-center py-2 px-2 font-medium text-text-muted uppercase text-xs w-20">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const isSelected = selectedId === String(row.id);
              const hasOverrides = !row.isOverride && row.overrideCount > 0;

              return (
                <tr
                  key={row.id}
                  onClick={() => onSelectSchedule(row.schedule)}
                  className={`
                    border-b border-border cursor-pointer transition-colors
                    ${isSelected ? 'bg-brand-cyan/10 border-l-2 border-l-brand-cyan' : 'hover:bg-surface-cream'}
                    ${row.depth > 0 ? 'bg-surface-cream/50' : ''}
                  `}
                >
                  {/* Name */}
                  <td className={`py-1.5 px-2 font-medium text-text-primary ${row.depth > 0 ? 'pl-5' : ''}`}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="truncate">{row.name}</span>
                      {row.isOverride && (
                        <Badge variant="system" className="text-xs flex-shrink-0">O</Badge>
                      )}
                      {hasOverrides && (
                        <span className="text-xs text-text-muted flex-shrink-0">
                          +{row.overrideCount}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Days */}
                  <td className="py-1.5 px-2">
                    {!row.isOverride && (
                      <DayPills days={row.schedule.operatingSchedule.days} size="sm" />
                    )}
                  </td>

                  {/* Origin Depot */}
                  <td className="hidden md:table-cell py-1.5 px-2 text-text-secondary text-xs truncate">
                    {row.isOverride ? '—' : row.originDepot}
                  </td>

                  {/* Destination Depot */}
                  <td className="hidden md:table-cell py-1.5 px-2 text-text-secondary text-xs truncate">
                    {row.isOverride ? '—' : row.destDepot}
                  </td>

                  {/* Dispatch: recurring routes bound to this schedule + the linehaul run behind its leg */}
                  <td className="hidden md:table-cell py-1.5 px-2">
                    {row.isOverride ? (
                      <span className="text-xs text-text-muted">as base</span>
                    ) : (
                      <DispatchCell schedule={row.schedule} />
                    )}
                  </td>
                  {/* Speed */}
                  <td className="hidden lg:table-cell py-1.5 px-2 text-text-secondary text-xs truncate">
                    {row.speedDisplay}
                  </td>

                  {/* Mode */}
                  <td className="hidden lg:table-cell py-1.5 px-2 text-text-secondary text-xs truncate">
                    {row.isOverride ? '—' : getBookingModeLabel(row.bookingMode)}
                  </td>

                  {/* Clients: link rows */}
                  <td className="hidden lg:table-cell py-1.5 px-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {sourceById.get(row.id) && (
                        <Badge variant="cyan" size="sm">{sourceById.get(row.id) === 'override' ? 'Own override' : sourceById.get(row.id) === 'shared' ? 'Shared' : 'Default'}</Badge>
                      )}
                      {row.visibility === 'all' ? (
                        <Badge variant="green" size="sm">All clients</Badge>
                      ) : row.clientIds.length === 0 ? (
                        <Badge variant="system" size="sm">No clients</Badge>
                      ) : (
                        <>
                          {row.clientIds.slice(0, 3).map((id) => (
                            <Badge key={id} variant="system" size="sm" aria-label={sampleClients.find((c) => c.id === id)?.name}>{clientLabel(sampleClients, id)}</Badge>
                          ))}
                          {row.clientIds.length > 3 && <span className="text-[11px] text-text-muted">+{row.clientIds.length - 3}</span>}
                        </>
                      )}
                    </div>
                  </td>
                  {/* Status */}
                  <td className="py-1.5 px-2">
                    <ActiveToggle
                      isActive={row.status === 'active'}
                      onToggle={(newValue) => onToggleActive?.(row.schedule, newValue)}
                    />
                  </td>

                  {/* Actions */}
                  <td className="py-1.5 px-2 text-center">
                    <div className="inline-flex items-center gap-1">
                      {!row.isOverride && (
                        <button
                          type="button"
                          aria-label={`Attach clients to ${row.name}`}
                          title="Attach clients"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAttachClients?.(row.schedule);
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-brand-cyan/10 hover:text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-cyan"
                        >
                          <Users className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={`Copy schedule ${row.name}`}
                        title="Copy schedule"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCopySchedule?.(row.schedule);
                        }}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-brand-cyan/10 hover:text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-cyan"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete schedule ${row.name}`}
                        title="Delete schedule"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSchedule?.(row.schedule);
                        }}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-error/10 hover:text-error focus:outline-none focus:ring-2 focus:ring-error"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {visibleRows.length === 0 && (
          <div className="py-12 text-center text-text-muted">
            No schedules found matching your filters
          </div>
        )}
      </div>
    </div>
  );
}
