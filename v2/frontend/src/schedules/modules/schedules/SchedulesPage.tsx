import { useState, useCallback, useRef } from 'react';
import { PageHeader } from '../../components/layout/PageHeader';
import { Tabs } from '../../components/layout/Tabs';
import { Card } from '../../components/layout/Card';
import { Button } from '../../components/ui/Button';
import { SearchInput } from '../../components/filters/SearchInput';
import { TagSidebar } from '../../components/tags';
import { ScheduleTableView, type ScheduleTableViewHandle } from './components/ScheduleTableView';
import { ScheduleGroupsTab } from './components/ScheduleGroupsTab';
import { RecurringRoutesTab } from './components/RecurringRoutesTab';
import { AttachClientsModal } from './components/AttachClientsModal';
import { attachClientsToGroup } from './utils/clientLinks';
import { sampleLinehaulRuns, sampleRecurringRoutes } from './dispatch/dispatchData';
import type { SourceItem, EntityConnections } from '../territory/types';
import { createEmptyConnections } from '../territory/types';
import { sampleSchedules as initialSchedules, sampleScheduleGroups as initialScheduleGroups, sampleClients } from './data/sampleData';
import type { Schedule, ScheduleGroup, BulkEditField } from './types';

const tabs = [
  { id: 'schedules', label: 'Schedules' },
  { id: 'groups', label: 'Schedule Groups' },
  { id: 'routes', label: 'Recurring Routes' },
];

export function SchedulesPage() {
  const [activeTab, setActiveTab] = useState('schedules');
  const [searchQuery, setSearchQuery] = useState('');
  const [tagSearch, setTagSearch] = useState('');
  const [tagSidebarOpen, setTagSidebarOpen] = useState(false);
  const [sidebarSourceItem, setSidebarSourceItem] = useState<SourceItem>({
    id: 0,
    type: 'schedule',
    name: '',
  });
  const [sidebarConnections, setSidebarConnections] = useState<EntityConnections>(
    createEmptyConnections()
  );
  const [schedules, setSchedules] = useState<Schedule[]>(initialSchedules);
  const [scheduleGroups, setScheduleGroups] = useState<ScheduleGroup[]>(initialScheduleGroups);
  const [_selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null);
  const scheduleTableViewRef = useRef<ScheduleTableViewHandle>(null);
  // Routed Operations: attach clients to every member of a group (one link row per client per schedule)
  const [attachGroup, setAttachGroup] = useState<ScheduleGroup | null>(null);
  const handleAttachClientsToGroup = useCallback((clientIds: number[]) => {
    if (!attachGroup) return;
    setSchedules((prev) => attachClientsToGroup(prev, attachGroup.scheduleIds, clientIds).schedules);
    setAttachGroup(null);
  }, [attachGroup]);

  const handleConnectionsClick = (sourceItem: SourceItem, connections: EntityConnections) => {
    setSidebarSourceItem(sourceItem);
    setSidebarConnections(connections);
    setTagSidebarOpen(true);
  };

  const handleNavigate = (targetRoute: string, searchQuery: string) => {
    // In a real app, this would navigate to the related module
    console.log('Navigate to', targetRoute, 'with search', searchQuery);
    setTagSearch(searchQuery);
    setTagSidebarOpen(false);
  };

  const handleNewSchedule = () => {
    scheduleTableViewRef.current?.openNewSchedule();
  };

  const handleCopyGroup = useCallback(
    (newGroupName: string, scheduleIds: number[], edits: BulkEditField[]) => {
      // Create copies of selected schedules
      const newSchedules: Schedule[] = scheduleIds.map((id) => {
        const original = schedules.find((s) => s.id === id);
        if (!original) return null;

        const copy: Schedule = {
          ...original,
          id: original.id + Date.now(),
          name: `${original.name} (Copy)`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        // Apply edits
        edits.forEach((edit) => {
          if (edit.field === 'cutoffValue') {
            if (edit.mode === 'relative') {
              copy.operatingSchedule.cutoffValue += Number(edit.value);
            } else {
              copy.operatingSchedule.cutoffValue = Number(edit.value);
            }
            if (edit.unit) {
              copy.operatingSchedule.cutoffUnit = edit.unit;
            }
          }
          // Add more field handlers as needed
        });

        return copy;
      }).filter(Boolean) as Schedule[];

      // Create new group
      const newGroup: ScheduleGroup = {
        id: Date.now(),
        name: newGroupName,
        description: `Copied from original group`,
        scheduleIds: newSchedules.map((s) => s.id),
        isActive: true,
        connections: createEmptyConnections(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Update state
      setSchedules((prev) => [...prev, ...newSchedules]);
      setScheduleGroups((prev) => [...prev, newGroup]);

      console.log('Created group:', newGroup.name, 'with', newSchedules.length, 'schedules');
    },
    [schedules]
  );

  const handleDuplicateGroup = useCallback((group: ScheduleGroup) => {
    const timestamp = Date.now();
    const copiedSchedules = group.scheduleIds
      .map((id, index) => {
        const original = schedules.find((schedule) => schedule.id === id);
        if (!original) return null;

        return {
          ...original,
          id: timestamp + index,
          name: `${original.name} (Copy)`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      })
      .filter(Boolean) as Schedule[];

    const copiedGroup: ScheduleGroup = {
      ...group,
      id: timestamp,
      name: `${group.name} (Copy)`,
      scheduleIds: copiedSchedules.map((schedule) => schedule.id),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setSchedules((prev) => [...prev, ...copiedSchedules]);
    setScheduleGroups((prev) => [...prev, copiedGroup]);
  }, [schedules]);

  const handleDeleteGroup = useCallback((group: ScheduleGroup) => {
    setScheduleGroups((prev) => prev.filter((scheduleGroup) => scheduleGroup.id !== group.id));
  }, []);

  const handleApplyClientOverrides = useCallback(
    (clientId: number, scheduleIds: number[], edits: BulkEditField[]) => {
      const client = sampleClients.find((c) => c.id === clientId);

      const newOverrides: Schedule[] = scheduleIds.map((id) => {
        const base = schedules.find((s) => s.id === id);
        if (!base) return null;

        const override: Schedule = {
          ...base,
          id: base.id + 10000 + Date.now() % 10000,
          name: `${base.name} (${client?.shortName || client?.name || clientId})`,
          isOverride: true,
          clientId: clientId,
          baseScheduleName: base.name,
        };

        // Apply edits
        edits.forEach((edit) => {
          if (edit.field === 'cutoffValue') {
            if (edit.mode === 'relative') {
              override.operatingSchedule.cutoffValue += Number(edit.value);
            } else {
              override.operatingSchedule.cutoffValue = Number(edit.value);
            }
            if (edit.unit) {
              override.operatingSchedule.cutoffUnit = edit.unit;
            }
          }
          // Add more field handlers as needed
        });

        return override;
      }).filter(Boolean) as Schedule[];

      setSchedules((prev) => [...prev, ...newOverrides]);

      console.log('Created', newOverrides.length, 'overrides for client:', client?.name);
    },
    [schedules]
  );

  const handleViewScheduleFromGroup = useCallback((scheduleId: number) => {
    const schedule = schedules.find((s) => s.id === scheduleId);
    if (schedule) {
      setSelectedSchedule(schedule);
      setActiveTab('schedules'); // Switch to schedules tab to show detail
      // open it in the editor once the schedules tab has mounted
      setTimeout(() => scheduleTableViewRef.current?.openSchedule(scheduleId), 0);
    }
  }, [schedules]);

  // Import / Export: removed from the UI until the feature applies imports and export is verified
  // against the real table (Steve, 2026-09-08). Code stays under features/import-export.

  return (
    <div className="h-full min-h-0 flex flex-col bg-surface-light" data-testid="schedules-page">
      {/* Header */}
      <div className="px-3 md:px-6 pt-4 md:pt-6 pb-3" data-testid="schedules-header">
        <PageHeader
          title="Schedules"
          subtitle="Configure delivery schedule templates and routing rules"
          actions={
            <div className="flex items-center gap-2 md:gap-3 flex-wrap">
              <Button variant="primary" onClick={handleNewSchedule}>
                + New Schedule
              </Button>
            </div>
          }
        />
      </div>

      {/* Main Content */}
      <div className="px-3 md:px-6 pb-4 md:pb-6 flex-1 min-h-0 flex flex-col">
        <Card padding="none" className="flex-1 min-h-0 flex flex-col">
          <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

          {/* Search + Filters Section */}
          <div className="px-3 md:px-4 py-3 border-b border-border bg-white space-y-3">
            {/* Search Row - Full Width */}
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search schedules by name, route, or client..."
            />

            {/* Filter Row with Tag Search */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Tag/Connection Filter */}
              <div className="flex items-center gap-2 px-3 py-2 border-2 border-brand-cyan/30 rounded-lg bg-brand-cyan/5 hover:border-brand-cyan hover:bg-brand-cyan/10 transition-colors focus-within:ring-2 focus-within:ring-brand-cyan focus-within:border-brand-cyan shadow-sm">
                <svg className="w-4 h-4 text-brand-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                <input
                  type="text"
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                  placeholder="Filter by connected entity..."
                  className="min-w-[180px] text-sm bg-transparent border-none outline-none placeholder:text-brand-cyan/60 text-brand-dark"
                />
                {tagSearch && (
                  <button
                    onClick={() => setTagSearch('')}
                    className="text-brand-cyan hover:text-brand-dark transition-colors"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              {(searchQuery || tagSearch) && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setTagSearch('');
                  }}
                  className="text-sm text-text-muted hover:text-brand-cyan ml-2 transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>

          {activeTab === 'schedules' && (
            <ScheduleTableView
              ref={scheduleTableViewRef}
              onConnectionsClick={handleConnectionsClick}
              searchQuery={searchQuery}
              tagSearch={tagSearch}
              schedules={schedules}
              onSchedulesChange={setSchedules}
            />
          )}
          {activeTab === 'groups' && (
            <div className="p-4 flex-1 min-h-0 overflow-y-auto">
              <ScheduleGroupsTab
                onConnectionsClick={handleConnectionsClick}
                schedules={schedules}
                groups={scheduleGroups}
                onCopyGroup={handleCopyGroup}
                onDuplicateGroup={handleDuplicateGroup}
                onDeleteGroup={handleDeleteGroup}
                onApplyClientOverrides={handleApplyClientOverrides}
                onViewSchedule={handleViewScheduleFromGroup}
                onAttachClients={(group) => setAttachGroup(group)}
              />
            </div>
          )}
          {activeTab === 'routes' && (
            <RecurringRoutesTab
              schedules={schedules}
              clients={sampleClients}
              routes={sampleRecurringRoutes}
              runs={sampleLinehaulRuns}
              onOpenSchedule={handleViewScheduleFromGroup}
            />
          )}
          <AttachClientsModal
            isOpen={attachGroup !== null}
            title={attachGroup ? `Attach clients to "${attachGroup.name}"` : ''}
            subtitle={attachGroup ? `One link row per client per member schedule (${attachGroup.scheduleIds.length} schedules). Defaults are skipped; existing links are kept.` : undefined}
            confirmLabel="Attach to group"
            clients={sampleClients}
            onConfirm={handleAttachClientsToGroup}
            onClose={() => setAttachGroup(null)}
          />
        </Card>
      </div>

      {/* Tag Sidebar */}
      <TagSidebar
        isOpen={tagSidebarOpen}
        onClose={() => setTagSidebarOpen(false)}
        sourceItem={sidebarSourceItem}
        connections={sidebarConnections}
        onNavigate={handleNavigate}
      />
    </div>
  );
}

export default SchedulesPage;
