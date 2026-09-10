// src/modules/schedules/components/ScheduleGroupsTab.tsx
import { useState, useMemo } from 'react';
import { Copy, Trash2, UserPlus, Users } from 'lucide-react';
import { ExpandableRow } from '../../../components/data/ExpandableRow';
import { SearchInput } from '../../../components/filters/SearchInput';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { CopyGroupModal } from './CopyGroupModal';
import { AddClientOverrideModal } from './AddClientOverrideModal';
import { sampleClients } from '../data/sampleData';
import type { SourceItem, EntityConnections } from '../../territory/types';
import { countConnectedCategories } from '../../territory/types';
import type { ScheduleGroup, Schedule, BulkEditField } from '../types';

interface ScheduleGroupsTabProps {
  onConnectionsClick: (sourceItem: SourceItem, connections: EntityConnections) => void;
  schedules: Schedule[];
  onCopyGroup: (newGroupName: string, scheduleIds: number[], edits: BulkEditField[]) => void;
  onDuplicateGroup: (group: ScheduleGroup) => void;
  onApplyClientOverrides: (clientId: number, scheduleIds: number[], edits: BulkEditField[]) => void;
  onViewSchedule: (scheduleId: number) => void;
  onDeleteGroup: (group: ScheduleGroup) => void;
  groups: ScheduleGroup[];
  /** Routed Operations: attach clients to every non-default member (link rows). */
  onAttachClients?: (group: ScheduleGroup) => void;
}

export function ScheduleGroupsTab({
  onConnectionsClick,
  schedules,
  onCopyGroup,
  onDuplicateGroup,
  onApplyClientOverrides,
  onViewSchedule,
  onDeleteGroup,
  groups,
  onAttachClients,
}: ScheduleGroupsTabProps) {
  const [expandedItem, setExpandedItem] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [copyModalGroup, setCopyModalGroup] = useState<ScheduleGroup | null>(null);
  const [overrideModalGroup, setOverrideModalGroup] = useState<ScheduleGroup | null>(null);
  const [groupPendingDelete, setGroupPendingDelete] = useState<ScheduleGroup | null>(null);

  const filteredGroups = useMemo(() => {
    return groups.filter((group) => {
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        const matchesName = group.name.toLowerCase().includes(searchLower);
        const matchesDescription = group.description?.toLowerCase().includes(searchLower);
        if (!matchesName && !matchesDescription) return false;
      }
      return true;
    });
  }, [groups, searchTerm]);

  const handleToggle = (groupId: number) => {
    setExpandedItem(expandedItem === groupId ? null : groupId);
  };

  return (
    <div className="space-y-4" data-testid="schedule-groups-tab" aria-label="schedule groups tab">
      {/* Search */}
      <SearchInput
        value={searchTerm}
        onChange={setSearchTerm}
        placeholder="Search schedule groups..."
      />

      {/* Results count */}
      <div className="text-sm text-text-secondary">
        Showing {filteredGroups.length} of {groups.length} schedule groups
      </div>

      {/* Groups List */}
      <div className="space-y-2">
        {filteredGroups.map((group) => {
          const memberSchedules = schedules.filter((s) =>
            group.scheduleIds.includes(s.id)
          );

          return (
            <ExpandableRow
              key={group.id}
              id={String(group.id)}
              name={group.name}
              badge={{
                text: group.isActive ? 'Active' : 'Inactive',
                variant: group.isActive ? 'customized' : 'system',
              }}
              stats={[
                { label: 'Schedules', value: String(group.scheduleIds.length) },
                { label: 'Description', value: group.description || 'No description' },
              ]}
              connectionCount={countConnectedCategories(group.connections)}
              hasConnectionIssues={false}
              isExpanded={expandedItem === group.id}
              onToggle={() => handleToggle(group.id)}
              onConnectionsClick={() =>
                onConnectionsClick(
                  {
                    id: group.id,
                    type: 'schedule',
                    name: group.name,
                    subtitle: group.description,
                  },
                  group.connections
                )
              }
              actions={
                <>
                  <button
                    type="button"
                    aria-label={`Copy schedule group ${group.name}`}
                    title="Copy schedule group"
                    onClick={() => onDuplicateGroup(group)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-brand-cyan/10 hover:text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-cyan"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete schedule group ${group.name}`}
                    title="Delete schedule group"
                    onClick={() => setGroupPendingDelete(group)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-error/10 hover:text-error focus:outline-none focus:ring-2 focus:ring-error"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              }
            >
              {/* Expanded content - show member schedules and actions */}
              <div className="p-4 bg-surface-cream rounded-lg space-y-4">
                {/* Action buttons */}
                <div className="flex flex-col md:flex-row gap-2">
                  {onAttachClients && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAttachClients(group);
                      }}
                    >
                      <Users className="w-4 h-4 mr-1" />
                      Attach clients to group
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDuplicateGroup(group);
                    }}
                  >
                    <Copy className="w-4 h-4 mr-1" />
                    Quick Copy
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCopyModalGroup(group);
                    }}
                  >
                    <Copy className="w-4 h-4 mr-1" />
                    Copy & Edit
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOverrideModalGroup(group);
                    }}
                  >
                    <UserPlus className="w-4 h-4 mr-1" />
                    Add Client Override
                  </Button>
                </div>

                {/* Member schedules list */}
                <div>
                  <h4 className="text-sm font-semibold text-text-primary mb-3">
                    Member Schedules ({memberSchedules.length})
                  </h4>
                  {memberSchedules.length === 0 ? (
                    <div className="text-sm text-text-muted text-center py-4">
                      No schedules in this group
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {memberSchedules.map((schedule) => (
                        <div
                          key={schedule.id}
                          onClick={() => onViewSchedule(schedule.id)}
                          className="flex items-center justify-between p-3 bg-white rounded-lg border border-border hover:border-brand-cyan cursor-pointer transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <Badge
                              variant={schedule.isActive ? 'customized' : 'system'}
                              size="sm"
                            >
                              {schedule.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                            <div>
                              <div className="text-sm font-medium text-text-primary">
                                {schedule.name}
                              </div>
                              {schedule.description && (
                                <div className="text-xs text-text-muted">
                                  {schedule.description}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-text-muted">
                              {schedule.legs.length} legs
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </ExpandableRow>
          );
        })}

        {filteredGroups.length === 0 && (
          <div className="py-12 text-center text-text-muted">
            No schedule groups found matching your search
          </div>
        )}
      </div>

      {/* Copy Group Modal */}
      {copyModalGroup && (
        <CopyGroupModal
          group={copyModalGroup}
          schedules={schedules}
          onClose={() => setCopyModalGroup(null)}
          onCreateCopies={(name, ids, edits) => {
            onCopyGroup(name, ids, edits);
            setCopyModalGroup(null);
          }}
          onViewSchedule={onViewSchedule}
        />
      )}

      {/* Add Client Override Modal */}
      {overrideModalGroup && (
        <AddClientOverrideModal
          group={overrideModalGroup}
          schedules={schedules}
          clients={sampleClients}
          onClose={() => setOverrideModalGroup(null)}
          onApplyOverrides={(clientId, ids, edits) => {
            onApplyClientOverrides(clientId, ids, edits);
            setOverrideModalGroup(null);
          }}
          onViewSchedule={onViewSchedule}
        />
      )}

      <Modal
        isOpen={groupPendingDelete !== null}
        onClose={() => setGroupPendingDelete(null)}
        title="Delete schedule group?"
        subtitle={groupPendingDelete ? groupPendingDelete.name : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setGroupPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!groupPendingDelete) return;
                onDeleteGroup(groupPendingDelete);
                setGroupPendingDelete(null);
              }}
            >
              Delete group
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-secondary">
          Are you sure you want to delete this schedule group? This will not delete the schedules inside it.
        </p>
      </Modal>
    </div>
  );
}
