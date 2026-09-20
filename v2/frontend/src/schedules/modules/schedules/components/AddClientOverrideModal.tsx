// src/modules/schedules/components/AddClientOverrideModal.tsx
import { useState, useMemo } from 'react';
import { X, Users, ArrowRight, Check } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { BulkEditPreview } from './BulkEditPreview';
import { BulkEditFieldSelector } from './BulkEditFieldSelector';
import type {
  ScheduleGroup,
  Schedule,
  ClientReference,
  BulkEditField,
  BulkEditPreviewRow,
  WarningLevel,
} from '../types';

interface AddClientOverrideModalProps {
  group: ScheduleGroup;
  schedules: Schedule[];
  clients: ClientReference[];
  onClose: () => void;
  onApplyOverrides: (clientId: number, scheduleIds: number[], edits: BulkEditField[]) => void;
  onViewSchedule: (scheduleId: number) => void;
}

type Step = 'customer' | 'configure';

export function AddClientOverrideModal({
  group,
  schedules,
  clients,
  onClose,
  onApplyOverrides,
  onViewSchedule,
}: AddClientOverrideModalProps) {
  const [step, setStep] = useState<Step>('customer');
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [selectedScheduleIds, setSelectedScheduleIds] = useState<Set<number>>(
    new Set(group.scheduleIds)
  );
  const [editFields, setEditFields] = useState<BulkEditField[]>([]);

  const memberSchedules = useMemo(
    () => schedules.filter((s) => group.scheduleIds.includes(s.id) && !s.isOverride),
    [schedules, group.scheduleIds]
  );

  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients;
    const search = clientSearch.toLowerCase();
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(search) ||
        c.shortName?.toLowerCase().includes(search)
    );
  }, [clients, clientSearch]);

  const selectedClient = clients.find((c) => c.id === selectedClientId);

  const toggleSchedule = (id: number) => {
    setSelectedScheduleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Generate preview rows
  const previewRows: BulkEditPreviewRow[] = useMemo(() => {
    if (editFields.length === 0) return [];

    const firstField = editFields[0];

    return memberSchedules.map((schedule) => {
      const included = selectedScheduleIds.has(schedule.id);

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
        const currentValue =
          collectionLeg?.config.type === 'collection'
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
  }, [memberSchedules, selectedScheduleIds, editFields]);

  const handleApply = () => {
    if (!selectedClientId) return;
    onApplyOverrides(selectedClientId!, Array.from(selectedScheduleIds), editFields);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" data-testid="add-client-override-modal" role="dialog" aria-modal="true" aria-label="Add client override">
      <div className="bg-white rounded-none md:rounded-xl shadow-xl w-full max-w-3xl h-full md:h-auto md:max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">
              Add Client Override: {group.name}
            </h2>
            <p className="text-sm text-text-muted">
              {step === 'customer'
                ? 'Step 1: Select customer'
                : `Step 2: Configure overrides for ${selectedClient?.name}`}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-surface-cream rounded-lg transition-colors">
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {step === 'customer' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Search customers
                </label>
                <input
                  type="text"
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  placeholder="Search by name..."
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-cyan focus:border-transparent"
                />
              </div>

              <div className="border border-border rounded-lg divide-y divide-border max-h-[300px] overflow-y-auto">
                {filteredClients.map((client) => (
                  <button
                    key={client.id}
                    onClick={() => setSelectedClientId(client.id)}
                    className={`
                      w-full px-4 py-3 text-left flex items-center justify-between
                      transition-colors
                      ${selectedClientId === client.id
                        ? 'bg-brand-cyan/10 border-l-2 border-l-brand-cyan'
                        : 'hover:bg-surface-cream'
                      }
                    `}
                  >
                    <div>
                      <div className="font-medium text-text-primary">{client.name}</div>
                      {client.shortName && (
                        <div className="text-sm text-text-muted">{client.shortName}</div>
                      )}
                    </div>
                    {selectedClientId === client.id && (
                      <Check className="w-5 h-5 text-brand-cyan" />
                    )}
                  </button>
                ))}
                {filteredClients.length === 0 && (
                  <div className="p-4 text-center text-text-muted">No customers found</div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Client banner */}
              <div className="bg-brand-purple/5 border-l-4 border-brand-purple p-4 rounded-r-lg">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-brand-purple" />
                  <span className="font-semibold text-text-primary">
                    Creating overrides for: {selectedClient?.name}
                  </span>
                </div>
                <p className="text-sm text-text-muted mt-1">
                  These overrides will only affect this customer's view of the schedules.
                </p>
              </div>

              {/* Field selector */}
              <BulkEditFieldSelector fields={editFields} onFieldsChange={setEditFields} />

              {/* Preview table */}
              {editFields.length > 0 && (
                <BulkEditPreview
                  rows={previewRows}
                  fieldLabel={editFields[0].label}
                  onToggleInclude={toggleSchedule}
                  onViewSchedule={onViewSchedule}
                />
              )}

              {editFields.length === 0 && (
                <div className="text-center text-text-muted py-8">
                  Select a field above to configure the override
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-border bg-surface-light">
          <div className="text-sm text-text-muted">
            {step === 'customer'
              ? selectedClientId
                ? `Selected: ${selectedClient?.name}`
                : 'Select a customer to continue'
              : `${selectedScheduleIds.size} schedules will receive overrides`}
          </div>
          <div className="flex gap-2">
            {step === 'configure' && (
              <Button variant="secondary" onClick={() => setStep('customer')}>
                Back
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            {step === 'customer' ? (
              <Button
                variant="primary"
                onClick={() => setStep('configure')}
                disabled={!selectedClientId}
              >
                Configure Override
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={handleApply}
                disabled={editFields.length === 0 || selectedScheduleIds.size === 0}
              >
                <Check className="w-4 h-4 mr-1" />
                Apply Overrides
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
