// src/modules/schedules/components/CopyGroupModal.tsx
import { useState, useMemo } from 'react';
import { X, Copy, ArrowRight } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { BulkEditPreview } from './BulkEditPreview';
import { BulkEditFieldSelector } from './BulkEditFieldSelector';
import type { ScheduleGroup, Schedule, BulkEditField, BulkEditPreviewRow, WarningLevel } from '../types';

interface CopyGroupModalProps {
  group: ScheduleGroup;
  schedules: Schedule[];
  onClose: () => void;
  onCreateCopies: (newGroupName: string, scheduleIds: number[], edits: BulkEditField[]) => void;
  onViewSchedule: (scheduleId: number) => void;
}

type Step = 'select' | 'edit';

export function CopyGroupModal({
  group,
  schedules,
  onClose,
  onCreateCopies,
  onViewSchedule,
}: CopyGroupModalProps) {
  const [step, setStep] = useState<Step>('select');
  const [newGroupName, setNewGroupName] = useState(`${group.name} (Copy)`);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set(group.scheduleIds));
  const [editFields, setEditFields] = useState<BulkEditField[]>([]);

  const memberSchedules = useMemo(
    () => schedules.filter((s) => group.scheduleIds.includes(s.id)),
    [schedules, group.scheduleIds]
  );

  const toggleSchedule = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Generate preview rows based on edit fields
  const previewRows: BulkEditPreviewRow[] = useMemo(() => {
    if (editFields.length === 0) return [];

    const firstField = editFields[0];

    return memberSchedules.map((schedule) => {
      const included = selectedIds.has(schedule.id);

      // Get before value based on field type
      let beforeValue = '';
      let afterValue = '';
      let warningLevel: WarningLevel = 'ok';
      let warningMessage: string | undefined;

      if (firstField.field === 'cutoffValue') {
        const cutoff = schedule.operatingSchedule.cutoffValue;
        const unit = schedule.operatingSchedule.cutoffUnit;
        beforeValue = `${cutoff} ${unit}`;

        if (firstField.mode === 'relative') {
          const adjustment = Number(firstField.value) || 0;
          const newValue = cutoff + adjustment;
          afterValue = `${newValue} ${firstField.unit || unit}`;

          if (newValue < cutoff) {
            warningLevel = 'caution';
            warningMessage = 'Reduced cutoff time';
          }
          if (newValue <= 0) {
            warningLevel = 'conflict';
            warningMessage = 'Invalid cutoff time';
          }
        } else {
          afterValue = `${firstField.value} ${firstField.unit || unit}`;
          if (Number(firstField.value) < cutoff) {
            warningLevel = 'caution';
            warningMessage = 'Reduced cutoff time';
          }
        }
      } else if (firstField.field === 'pickupTimeMode') {
        const collectionLeg = schedule.legs.find((l) => l.config.type === 'collection');
        const currentValue = collectionLeg?.config.type === 'collection'
          ? collectionLeg.config.pickupTimeMode
          : 'window';
        beforeValue = currentValue;
        afterValue = String(firstField.value);
      } else {
        beforeValue = '—';
        afterValue = String(firstField.value);
      }

      return {
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        included,
        beforeValue,
        afterValue,
        warningLevel,
        warningMessage,
      };
    });
  }, [memberSchedules, selectedIds, editFields]);

  const handleCreateCopies = () => {
    onCreateCopies(newGroupName, Array.from(selectedIds), editFields);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" data-testid="copy-group-modal" aria-label="copy group modal">
      <div className="bg-white rounded-none md:rounded-xl shadow-xl w-full max-w-3xl h-full md:h-auto md:max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">
              Copy Schedule Group: {group.name}
            </h2>
            <p className="text-sm text-text-muted">
              {step === 'select' ? 'Step 1: Select schedules to copy' : 'Step 2: Configure bulk edits'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-surface-cream rounded-lg transition-colors">
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {step === 'select' ? (
            <div className="space-y-4">
              {/* New group name */}
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  New Group Name
                </label>
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-cyan focus:border-transparent"
                />
              </div>

              {/* Schedule selection table */}
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Select schedules to copy:
                </label>
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-light">
                      <tr className="border-b border-border">
                        <th className="w-10 p-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.size === group.scheduleIds.length}
                            onChange={() => {
                              if (selectedIds.size === group.scheduleIds.length) {
                                setSelectedIds(new Set());
                              } else {
                                setSelectedIds(new Set(group.scheduleIds));
                              }
                            }}
                            className="w-4 h-4 rounded border-border text-brand-cyan focus:ring-brand-cyan"
                          />
                        </th>
                        <th className="p-2 text-left font-medium text-text-muted">Schedule</th>
                        <th className="p-2 text-left font-medium text-text-muted">Cutoff</th>
                        <th className="p-2 text-left font-medium text-text-muted">Speed</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {memberSchedules.map((schedule) => (
                        <tr key={schedule.id} className="bg-white hover:bg-surface-cream">
                          <td className="p-2">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(schedule.id)}
                              onChange={() => toggleSchedule(schedule.id)}
                              className="w-4 h-4 rounded border-border text-brand-cyan focus:ring-brand-cyan"
                            />
                          </td>
                          <td className="p-2 font-medium text-text-primary">{schedule.name}</td>
                          <td className="p-2 text-text-secondary">
                            {schedule.operatingSchedule.cutoffValue} {schedule.operatingSchedule.cutoffUnit}
                          </td>
                          <td className="p-2 text-text-secondary">
                            {schedule.speedId || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="text-sm text-text-muted mt-2">
                  {selectedIds.size} of {group.scheduleIds.length} selected
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Field selector */}
              <BulkEditFieldSelector fields={editFields} onFieldsChange={setEditFields} />

              {/* Preview table */}
              {editFields.length > 0 && (
                <BulkEditPreview
                  rows={previewRows}
                  fieldLabel={editFields[0].label}
                  onToggleInclude={(id) => toggleSchedule(id)}
                  onViewSchedule={onViewSchedule}
                />
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-border bg-surface-light">
          <div className="text-sm text-text-muted">
            {step === 'select'
              ? `${selectedIds.size} schedules will be copied`
              : editFields.length === 0
                ? 'No edits - copies will be identical'
                : `${editFields.length} field(s) will be modified`
            }
          </div>
          <div className="flex gap-2">
            {step === 'edit' && (
              <Button variant="secondary" onClick={() => setStep('select')}>
                Back
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            {step === 'select' ? (
              <Button
                variant="primary"
                onClick={() => setStep('edit')}
                disabled={selectedIds.size === 0 || !newGroupName.trim()}
              >
                Copy & Edit
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button variant="primary" onClick={handleCreateCopies}>
                <Copy className="w-4 h-4 mr-1" />
                Create Copies
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
