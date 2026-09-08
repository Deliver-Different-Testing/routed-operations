// src/modules/schedules/components/ScheduleTableView.tsx
import { forwardRef, useState, useCallback, useImperativeHandle } from 'react';
import { Copy, Trash2, X } from 'lucide-react';
import { ScheduleTable } from './ScheduleTable';
import { ScheduleEditForm } from './ScheduleEditForm';
import { OverrideEditor } from './OverrideEditor';
import { ClientOverrideEditor } from './ClientOverrideEditor';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { createEmptySchedule, type Schedule } from '../types';
import type { SourceItem, EntityConnections } from '../../territory/types';
import { sampleSchedules, sampleClients } from '../data/sampleData';
import { AttachClientsModal } from './AttachClientsModal';
import { attachBlocker, baseOf, upsertOverride, withClientsAttached } from '../utils/clientLinks';

interface ScheduleTableViewProps {
  onConnectionsClick: (sourceItem: SourceItem, connections: EntityConnections) => void;
  searchQuery?: string;
  tagSearch?: string;
  /** Controlled schedules (shared with the Groups and Recurring Routes tabs). Falls back to sample data. */
  schedules?: Schedule[];
  onSchedulesChange?: (schedules: Schedule[]) => void;
}

export interface ScheduleTableViewHandle {
  openNewSchedule: () => void;
  /** Open an existing schedule in the editor (used by the Groups and Recurring Routes tabs). */
  openSchedule: (scheduleId: number) => void;
}

// Removed 'view' mode - clicking a schedule now opens edit directly
type PanelMode = 'edit' | 'override';

export const ScheduleTableView = forwardRef<ScheduleTableViewHandle, ScheduleTableViewProps>(function ScheduleTableView({
  onConnectionsClick,
  searchQuery = '',
  tagSearch = '',
  schedules: controlledSchedules,
  onSchedulesChange,
}, ref) {
  const [localSchedules, setLocalSchedules] = useState<Schedule[]>(sampleSchedules);
  const schedules = controlledSchedules ?? localSchedules;
  const setSchedules = useCallback((update: Schedule[] | ((prev: Schedule[]) => Schedule[])) => {
    const next = typeof update === 'function' ? update(controlledSchedules ?? localSchedules) : update;
    if (onSchedulesChange) onSchedulesChange(next);
    else setLocalSchedules(next);
  }, [controlledSchedules, localSchedules, onSchedulesChange]);
  // Routed Operations: attach clients from the table row action
  const [attachTarget, setAttachTarget] = useState<Schedule | null>(null);
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null);

  // Panel mode: edit (default), override (for client overrides)
  const [panelMode, setPanelMode] = useState<PanelMode>('edit');
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [schedulePendingDelete, setSchedulePendingDelete] = useState<Schedule | null>(null);

  // Client override editing
  const [editingClientId, setEditingClientId] = useState<number | null>(null);

  // Clicking a schedule opens it directly in edit mode (no intermediate view)
  const handleToggleActive = useCallback((schedule: Schedule, newValue: boolean) => {
    setSchedules((prev) =>
      prev.map((s) => s.id === schedule.id ? { ...s, isActive: newValue, autoBook: newValue } : s)
    );
  }, []);

  const handleSelectSchedule = useCallback((schedule: Schedule) => {
    setSelectedSchedule(schedule);
    setEditingSchedule({ ...schedule });
    setPanelMode(schedule.isOverride ? 'override' : 'edit');
    setEditingClientId(null);
  }, []);

  const createScheduleCopy = useCallback((sourceSchedule: Schedule): Schedule => ({
    ...sourceSchedule,
    id: Date.now(),
    name: `${sourceSchedule.name} (Copy)`,
    isOverride: sourceSchedule.isOverride,
    baseScheduleName: sourceSchedule.baseScheduleName,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }), []);

  const handleCopySchedule = useCallback((sourceSchedule: Schedule) => {
    const copiedSchedule = createScheduleCopy(sourceSchedule);
    setSchedules((prev) => [...prev, copiedSchedule]);
    setSelectedSchedule(copiedSchedule);
    setEditingSchedule({ ...copiedSchedule });
    setPanelMode(copiedSchedule.isOverride ? 'override' : 'edit');
    setEditingClientId(null);
  }, [createScheduleCopy]);

  const openNewSchedule = useCallback(() => {
    const now = new Date().toISOString();
    const newSchedule: Schedule = {
      ...createEmptySchedule(),
      id: Date.now(),
      rowIds: [],
      name: 'New Schedule',
      createdAt: now,
      updatedAt: now,
    };

    setSelectedSchedule(newSchedule);
    setEditingSchedule(newSchedule);
    setPanelMode('edit');
    setEditingClientId(null);
  }, []);

  const openSchedule = useCallback((scheduleId: number) => {
    const schedule = schedules.find((s) => s.id === scheduleId);
    if (schedule) handleSelectSchedule(schedule);
  }, [schedules, handleSelectSchedule]);
  useImperativeHandle(ref, () => ({ openNewSchedule, openSchedule }), [openNewSchedule, openSchedule]);

  const handleCopyToClient = useCallback((targetClientId: number, sourceSchedule: Schedule) => {
    const targetClient = sampleClients.find((c) => c.id === targetClientId);
    const baseSchedule = baseOf(schedules, sourceSchedule);

    if (!baseSchedule) return;

    const copiedOverride: Schedule = {
      ...sourceSchedule,
      id: Date.now(),
      name: `${baseSchedule.name} (${targetClient?.shortName || targetClient?.name || String(targetClientId)})`,
      clientId: targetClientId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setEditingSchedule(copiedOverride);
    setEditingClientId(targetClientId);
    setPanelMode('override');
  }, [schedules]);

  const handleRequestDeleteSchedule = useCallback((schedule: Schedule) => {
    setSchedulePendingDelete(schedule);
  }, []);

  const handleCancelDeleteSchedule = useCallback(() => {
    setSchedulePendingDelete(null);
  }, []);

  const handleConfirmDeleteSchedule = useCallback(() => {
    if (!schedulePendingDelete) return;

    setSchedules((prev) => prev.filter((schedule) => schedule.id !== schedulePendingDelete.id));

    if (selectedSchedule?.id === schedulePendingDelete.id) {
      setSelectedSchedule(null);
    }

    if (editingSchedule?.id === schedulePendingDelete.id) {
      setEditingSchedule(null);
      setEditingClientId(null);
    }

    setSchedulePendingDelete(null);
  }, [editingSchedule, schedulePendingDelete, selectedSchedule]);

  const handleSaveSchedule = useCallback((updatedSchedule: Schedule) => {
    setSchedules((prev) => {
      // An override's clients leave the base's link rows: a client is never on both.
      if (updatedSchedule.isOverride) return upsertOverride(prev, updatedSchedule);
      const exists = prev.some((s) => s.id === updatedSchedule.id);
      if (exists) {
        return prev.map((s) => (s.id === updatedSchedule.id ? updatedSchedule : s));
      } else {
        return [...prev, updatedSchedule];
      }
    });
    // Stay in edit mode after saving, update the editing state with saved data
    setSelectedSchedule(updatedSchedule);
    setEditingSchedule({ ...updatedSchedule });
    setEditingClientId(null);
  }, []);

  // Routed Operations: create an override of `base` for one client — new ScheduleId, BaseScheduleId set,
  // the client's link row moved from the base to the override — then open it.
  const handleCreateOverride = useCallback((base: Schedule, clientId: number) => {
    const client = sampleClients.find((c) => c.id === clientId);
    const now = new Date().toISOString();
    const override: Schedule = {
      ...base,
      id: Date.now(),
      rowIds: [],
      name: base.name,
      displayName: undefined,
      displayDescription: undefined,
      isOverride: true,
      baseScheduleId: base.id,
      baseScheduleName: base.name,
      visibility: 'specific',
      clientIds: [clientId],
      clientId,
      overriddenFields: [],
      createdAt: now,
      updatedAt: now,
    };
    setSchedules((prev) => upsertOverride(prev, override));
    setSelectedSchedule(override);
    setEditingSchedule({ ...override });
    setPanelMode('override');
    setEditingClientId(client ? clientId : null);
  }, [setSchedules]);

  const handleOpenOverride = useCallback((override: Schedule) => {
    setSelectedSchedule(override);
    setEditingSchedule({ ...override });
    setPanelMode('override');
    setEditingClientId(override.clientIds?.[0] ?? override.clientId ?? null);
  }, []);

  const handleAttachFromRow = useCallback((schedule: Schedule) => setAttachTarget(schedule), []);
  const handleConfirmAttach = useCallback((clientIds: number[]) => {
    if (!attachTarget) return;
    setSchedules((prev) => prev.map((s) => (s.id === attachTarget.id ? withClientsAttached(s, clientIds) : s)));
    setAttachTarget(null);
  }, [attachTarget, setSchedules]);

  const handleCloseModal = useCallback(() => {
    setSelectedSchedule(null);
    setEditingSchedule(null);
    setEditingClientId(null);
  }, []);

  // Handle connections badge click - opens TagSidebar with client connections
  const handleScheduleConnectionsClick = useCallback((schedule: Schedule) => {
    const sourceItem: SourceItem = {
      type: 'schedule',
      id: schedule.id,
      name: schedule.name,
      subtitle: schedule.clientId ? 'Specific Client' : 'All Clients',
    };

    // Build connections showing client associations
    const clientCount = schedule.clientId ? 1 : sampleClients.length;

    const connections: EntityConnections = {
      customers: {
        hasConnections: !!schedule.clientId,
        count: clientCount,
        connectionPath: '/clients',
      },
      zoneGroups: { hasConnections: false, count: 0 },
      depots: { hasConnections: !!schedule.pickupDepotId, count: schedule.pickupDepotId ? 1 : 0 },
      rateCards: { hasConnections: false, count: 0 },
      services: { hasConnections: false, count: 0 },
      vehicles: { hasConnections: false, count: 0 },
      notifications: { hasConnections: false, count: 0 },
      airports: { hasConnections: false, count: 0 },
      linehauls: { hasConnections: schedule.legs.some(l => l.config.type === 'linehaul'), count: schedule.legs.filter(l => l.config.type === 'linehaul').length },
      regions: { hasConnections: false, count: 0 },
    };

    onConnectionsClick(sourceItem, connections);
  }, [onConnectionsClick]);

  // Find base schedule for override editing
  const baseScheduleForOverride = editingSchedule?.isOverride
    ? baseOf(schedules, editingSchedule)
    : null;

  const isModalOpen = editingSchedule !== null;
  const isEditingExistingSchedule = editingSchedule
    ? schedules.some((s) => s.id === editingSchedule.id)
    : false;

  return (
    <div className="h-[calc(100vh-200px)] min-h-[500px] relative" data-testid="schedule-table-view" aria-label="schedule table view">
      {/* Table - always visible */}
      <ScheduleTable
        schedules={schedules}
        selectedId={selectedSchedule ? String(selectedSchedule.id) : null}
        onSelectSchedule={handleSelectSchedule}
        externalSearchQuery={searchQuery}
        externalTagSearch={tagSearch}
        onConnectionsClick={handleScheduleConnectionsClick}
        onToggleActive={handleToggleActive}
        onCopySchedule={handleCopySchedule}
        onDeleteSchedule={handleRequestDeleteSchedule}
        onAttachClients={handleAttachFromRow}
      />
      <AttachClientsModal
        isOpen={attachTarget !== null}
        title={attachTarget ? `Attach clients to ${attachTarget.name}` : ''}
        subtitle="Each client you tick gets a row in the schedule/client link table."
        clients={sampleClients}
        blockerFor={(id) => (attachTarget ? attachBlocker(schedules, attachTarget, id) : null)}
        onConfirm={handleConfirmAttach}
        onClose={() => setAttachTarget(null)}
      />

      {/* Modal Overlay */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={handleCloseModal}
          />

          {/* Modal */}
          <div className="relative bg-white rounded-none md:rounded-xl shadow-2xl w-full md:w-[90vw] max-w-6xl h-full md:h-[85vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-3 md:px-6 py-3 md:py-4 border-b border-border bg-surface-light">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-text-primary">
                  {panelMode === 'edit'
                    ? (isEditingExistingSchedule ? 'Edit Schedule' : 'New Schedule')
                    : (isEditingExistingSchedule ? 'Edit Override' : 'New Override')
                  }
                </h2>
                <span className="text-sm text-text-muted px-2 py-0.5 bg-surface-cream rounded">
                  {editingSchedule.name}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {isEditingExistingSchedule && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleCopySchedule(editingSchedule)}
                      className="p-2 text-text-muted hover:text-brand-dark hover:bg-brand-cyan/10 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-brand-cyan"
                      aria-label={`Copy open schedule ${editingSchedule.name}`}
                      title="Copy schedule"
                    >
                      <Copy className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRequestDeleteSchedule(editingSchedule)}
                      className="p-2 text-text-muted hover:text-error hover:bg-error/10 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-error"
                      aria-label={`Delete open schedule ${editingSchedule.name}`}
                      title="Delete schedule"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </>
                )}
                <button
                  onClick={handleCloseModal}
                  className="p-2 text-text-muted hover:text-text-primary hover:bg-surface-cream rounded-lg transition-colors"
                  aria-label="Close schedule editor"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-3 md:p-6">
              {panelMode === 'edit' && (
                <ScheduleEditForm
                  schedule={editingSchedule}
                  allSchedules={schedules}
                  onSave={handleSaveSchedule}
                  onCancel={handleCloseModal}
                  isNew={!isEditingExistingSchedule}
                  clients={sampleClients}
                  onCreateOverride={handleCreateOverride}
                  onOpenOverride={handleOpenOverride}
                />
              )}

              {panelMode === 'override' && baseScheduleForOverride && (
                <>
                  {editingClientId ? (
                    <ClientOverrideEditor
                      schedule={editingSchedule}
                      baseSchedule={baseScheduleForOverride}
                      client={sampleClients.find((c) => c.id === editingClientId) || { id: editingClientId || 0, name: String(editingClientId || '') }}
                      allClients={sampleClients}
                      allSchedules={schedules}
                      onSave={handleSaveSchedule}
                      onCancel={handleCloseModal}
                      onCopyToClient={handleCopyToClient}
                    />
                  ) : (
                    <OverrideEditor
                      schedule={editingSchedule}
                      baseSchedule={baseScheduleForOverride}
                      onSave={handleSaveSchedule}
                      onCancel={handleCloseModal}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <Modal
        isOpen={schedulePendingDelete !== null}
        onClose={handleCancelDeleteSchedule}
        title="Delete schedule?"
        subtitle={schedulePendingDelete ? schedulePendingDelete.name : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={handleCancelDeleteSchedule}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleConfirmDeleteSchedule}>
              Delete schedule
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-secondary">
          Are you sure you want to delete this schedule? This cannot be undone.
        </p>
      </Modal>
    </div>
  );
});
