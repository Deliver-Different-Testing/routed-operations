// src/modules/schedules/components/ScheduleListTab.tsx
import { useState, useMemo } from 'react';
import { ExpandableRow } from '../../../components/data/ExpandableRow';
import { SearchInput } from '../../../components/filters/SearchInput';
import { FilterDropdown } from '../../../components/filters/FilterDropdown';
import { sampleSchedules, sampleDepots, scheduleFilterOptions } from '../data/sampleData';
import type { Schedule, ScheduleFilterState } from '../types';
import { getBookingModeLabel, getActiveDaysSummary, getRouteDescription, countLegs } from '../types';
import type { SourceItem, EntityConnections } from '../../territory/types';
import { countConnectedCategories } from '../../territory/types';
import { ScheduleEditForm } from './ScheduleEditForm';
import { OverrideEditor } from './OverrideEditor';

interface ScheduleListTabProps {
  onConnectionsClick: (sourceItem: SourceItem, connections: EntityConnections) => void;
}

export function ScheduleListTab({ onConnectionsClick }: ScheduleListTabProps) {
  const [expandedItem, setExpandedItem] = useState<number | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>(sampleSchedules);
  const [filters, setFilters] = useState<ScheduleFilterState>({
    search: '',
    status: 'all',
    type: 'all',
    clientId: 'all',
    originDepotId: 'all',
    destinationDepotId: 'all',
  });

  const filteredSchedules = useMemo(() => {
    return schedules.filter((schedule) => {
      // Search filter
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const matchesName = schedule.name.toLowerCase().includes(searchLower);
        const matchesDescription = schedule.description?.toLowerCase().includes(searchLower);
        if (!matchesName && !matchesDescription) return false;
      }

      // Status filter
      if (filters.status !== 'all') {
        if (filters.status === 'active' && !schedule.isActive) return false;
        if (filters.status === 'inactive' && schedule.isActive) return false;
      }

      // Type filter (base vs override)
      if (filters.type !== 'all') {
        if (filters.type === 'base' && schedule.isOverride) return false;
        if (filters.type === 'override' && !schedule.isOverride) return false;
      }

      // Origin depot filter
      if (filters.originDepotId !== 'all') {
        if (schedule.pickupDepotId !== filters.originDepotId) return false;
      }

      return true;
    });
  }, [schedules, filters]);

  // Group schedules: base schedules first, then their overrides nested below
  const groupedSchedules = useMemo(() => {
    const baseSchedules = filteredSchedules.filter((s) => !s.isOverride);
    const overrides = filteredSchedules.filter((s) => s.isOverride);

    return baseSchedules.map((base) => ({
      base,
      overrides: overrides.filter((o) => o.baseScheduleName === base.name),
    }));
  }, [filteredSchedules]);

  const handleToggle = (scheduleId: number) => {
    setExpandedItem(expandedItem === scheduleId ? null : scheduleId);
  };

  const handleScheduleSave = (updatedSchedule: Schedule) => {
    setSchedules((prev) =>
      prev.map((s) => (s.id === updatedSchedule.id ? updatedSchedule : s))
    );
    setExpandedItem(null); // Close the edit form after saving
  };

  const handleScheduleCancel = () => {
    setExpandedItem(null);
  };

  // Build filter options
  const statusOptions = ['All Status', ...scheduleFilterOptions.status.slice(1).map(s => s.label)];
  const typeOptions = ['All Types', ...scheduleFilterOptions.type.slice(1).map(t => t.label)];
  const depotOptions = ['All Depots', ...sampleDepots.map(d => d.name)];

  // Convert selected filter value to display
  const getSelectedStatus = (): string[] => {
    if (filters.status === 'all') return [];
    const found = scheduleFilterOptions.status.find(s => s.value === filters.status);
    return found ? [found.label] : [];
  };

  const getSelectedType = (): string[] => {
    if (filters.type === 'all') return [];
    const found = scheduleFilterOptions.type.find(t => t.value === filters.type);
    return found ? [found.label] : [];
  };

  const getSelectedDepot = (): string[] => {
    if (filters.originDepotId === 'all') return [];
    const found = sampleDepots.find(d => d.id === filters.originDepotId);
    return found ? [found.name] : [];
  };

  // Convert display value back to filter value
  const handleStatusChange = (values: string[]) => {
    const value = values[0];
    if (!value || value === 'All Status') {
      setFilters(prev => ({ ...prev, status: 'all' }));
    } else {
      const found = scheduleFilterOptions.status.find(s => s.label === value);
      setFilters(prev => ({ ...prev, status: (found?.value as ScheduleFilterState['status']) || 'all' }));
    }
  };

  const handleTypeChange = (values: string[]) => {
    const value = values[0];
    if (!value || value === 'All Types') {
      setFilters(prev => ({ ...prev, type: 'all' }));
    } else {
      const found = scheduleFilterOptions.type.find(t => t.label === value);
      setFilters(prev => ({ ...prev, type: (found?.value as ScheduleFilterState['type']) || 'all' }));
    }
  };

  const handleDepotChange = (values: string[]) => {
    const value = values[0];
    if (!value || value === 'All Depots') {
      setFilters(prev => ({ ...prev, originDepotId: 'all' }));
    } else {
      const found = sampleDepots.find(d => d.name === value);
      setFilters(prev => ({ ...prev, originDepotId: found?.id || 'all' }));
    }
  };

  return (
    <div className="space-y-4" data-testid="schedule-list-tab" aria-label="schedule list tab">
      {/* Filters */}
      <div className="space-y-3">
        <SearchInput
          value={filters.search}
          onChange={(value) => setFilters((f) => ({ ...f, search: value }))}
          placeholder="Search schedules..."
        />
        <div className="flex items-center gap-2 flex-wrap">
          <FilterDropdown
            id="status"
            label="Status"
            options={statusOptions}
            selectedValues={getSelectedStatus()}
            onChange={handleStatusChange}
          />
          <FilterDropdown
            id="type"
            label="Type"
            options={typeOptions}
            selectedValues={getSelectedType()}
            onChange={handleTypeChange}
          />
          <FilterDropdown
            id="depot"
            label="Origin Depot"
            options={depotOptions}
            selectedValues={getSelectedDepot()}
            onChange={handleDepotChange}
          />
        </div>
      </div>

      {/* Results count */}
      <div className="text-sm text-text-secondary">
        Showing {filteredSchedules.length} of {schedules.length} schedules
      </div>

      {/* Schedule List */}
      <div className="space-y-2">
        {groupedSchedules.map(({ base, overrides }) => (
          <div key={base.id} className="space-y-1">
            {/* Base schedule row */}
            <ExpandableRow
              id={String(base.id)}
              name={base.name}
              badge={{
                text: base.isActive ? 'Active' : 'Inactive',
                variant: base.isActive ? 'customized' : 'system',
              }}
              stats={[
                { label: 'Route', value: getRouteDescription(base, sampleDepots) },
                { label: 'Legs', value: String(countLegs(base)) },
                { label: 'Mode', value: getBookingModeLabel(base.bookingMode) },
                { label: 'Days', value: getActiveDaysSummary(base.operatingSchedule) },
              ]}
              connectionCount={countConnectedCategories(base.connections)}
              hasConnectionIssues={false}
              isExpanded={expandedItem === base.id}
              onToggle={() => handleToggle(base.id)}
              onConnectionsClick={() =>
                onConnectionsClick(
                  {
                    id: base.id,
                    type: 'schedule',
                    name: base.name,
                    subtitle: getRouteDescription(base, sampleDepots),
                  },
                  base.connections
                )
              }
            >
              {/* Expanded content with ScheduleEditForm */}
              <div className="p-4 bg-surface-cream rounded-lg">
                <ScheduleEditForm
                  schedule={base}
                  onSave={handleScheduleSave}
                  onCancel={handleScheduleCancel}
                  isNew={false}
                />
              </div>
            </ExpandableRow>

            {/* Override schedules (indented) */}
            {overrides.length > 0 && (
              <div className="ml-6 space-y-1 border-l-2 border-border pl-4">
                {overrides.map((override) => (
                  <ExpandableRow
                    key={override.id}
                    id={String(override.id)}
                    name={override.name}
                    badge={{
                      text: 'Override',
                      variant: 'system',
                    }}
                    stats={[
                      { label: 'Client', value: override.clientId ? 'Specific Client' : 'All Clients' },
                      { label: 'Overrides', value: 'Custom fields' },
                    ]}
                    connectionCount={countConnectedCategories(override.connections)}
                    hasConnectionIssues={false}
                    isExpanded={expandedItem === override.id}
                    onToggle={() => handleToggle(override.id)}
                    onConnectionsClick={() =>
                      onConnectionsClick(
                        {
                          id: override.id,
                          type: 'schedule',
                          name: override.name,
                          subtitle: `Override of ${base.name}`,
                        },
                        override.connections
                      )
                    }
                  >
                    <div className="p-4 bg-surface-cream rounded-lg">
                      <OverrideEditor
                        schedule={override}
                        baseSchedule={base}
                        onSave={handleScheduleSave}
                        onCancel={handleScheduleCancel}
                      />
                    </div>
                  </ExpandableRow>
                ))}
              </div>
            )}
          </div>
        ))}

        {filteredSchedules.length === 0 && (
          <div className="py-12 text-center text-text-muted">
            No schedules found matching your filters
          </div>
        )}
      </div>
    </div>
  );
}
