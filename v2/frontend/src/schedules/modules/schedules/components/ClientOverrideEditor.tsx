// src/modules/schedules/components/ClientOverrideEditor.tsx
import { useState } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { OverrideEditor } from './OverrideEditor';
import { ClientSearch } from './ClientSearch';
import type { Schedule, ClientReference } from '../types';

interface ClientOverrideEditorProps {
  /** The override schedule being edited (or new override with base values) */
  schedule: Schedule;
  /** The base schedule this overrides */
  baseSchedule: Schedule;
  /** The client this override is for */
  client: ClientReference;
  /** All clients for copy-to feature */
  allClients: ClientReference[];
  /** All schedules to check for existing overrides */
  allSchedules: Schedule[];
  onSave: (schedule: Schedule) => void;
  onCancel: () => void;
  /** Called when user wants to copy this override to another client */
  onCopyToClient: (targetClientId: number, sourceSchedule: Schedule) => void;
}

export function ClientOverrideEditor({
  schedule,
  baseSchedule,
  client,
  allClients,
  allSchedules,
  onSave,
  onCancel,
  onCopyToClient,
}: ClientOverrideEditorProps) {
  const [showCopyPicker, setShowCopyPicker] = useState(false);
  const [copyTargetClientId, setCopyTargetClientId] = useState<number | null>(null);

  const isNewOverride = !allSchedules.some((s) => s.id === schedule.id);

  // Filter out current client from copy targets
  const copyTargetClients = allClients.filter((c) => c.id !== client.id);

  const handleCopyConfirm = () => {
    if (copyTargetClientId) {
      onCopyToClient(copyTargetClientId, schedule);
      setShowCopyPicker(false);
      setCopyTargetClientId(null);
    }
  };

  return (
    <div
      className="h-full flex flex-col overflow-hidden"
      data-testid="client-override-editor"
      aria-label="client override editor"
    >
      {/* Override Editor */}
      <div className="flex-1 overflow-y-auto">
        <OverrideEditor
          schedule={schedule}
          baseSchedule={baseSchedule}
          clientName={client.name}
          onSave={onSave}
          onCancel={onCancel}
        />
      </div>

      {/* Copy to Another Client section */}
      {!isNewOverride && (
        <div className="border-t border-border p-4 bg-surface-light">
          {!showCopyPicker ? (
            <Button
              variant="secondary"
              onClick={() => setShowCopyPicker(true)}
              className="w-full"
            >
              <Copy className="w-4 h-4 mr-2" />
              Copy Override to Another Client
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="text-sm font-medium text-text-primary">
                Select client to copy this override to:
              </div>
              <ClientSearch
                clients={copyTargetClients}
                schedules={allSchedules}
                baseScheduleId={baseSchedule.id}
                selectedClientId={copyTargetClientId}
                onSelectClient={setCopyTargetClientId}
              />
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowCopyPicker(false);
                    setCopyTargetClientId(null);
                  }}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleCopyConfirm}
                  disabled={!copyTargetClientId}
                  className="flex-1"
                >
                  Copy & Edit
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
