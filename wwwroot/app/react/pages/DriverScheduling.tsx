// Driver Scheduling page - the operator-facing surface for the
// CourierManager scheduler port. Sits adjacent to Schedules in the
// sidebar (`/driver-scheduling`).
//
// Composition (adapted from Configurator `pages/np/Scheduling.tsx`
// shell but rebuilt with RoutedOperations common components):
//
//   Top bar        : date picker + New Schedule + Copy + Refresh
//   Left panel     : Locations (tabs) + Schedule cards grid
//   Middle panel   : Selected schedule detail
//                    - Time slots row (Add / Delete / assign)
//                    - Courier responses table (Pending / Available /
//                      Unavailable tabs, availability toggle)
//   Modals         : New Schedule / Copy / Add Time Slot / Confirm
//
// Every write goes through driverSchedulingService and invalidates the
// React Query cache via useInvalidateDriverScheduling so the UI
// refetches without operator intervention.

import { useEffect, useMemo, useState } from 'react';
import { tenantTodayYmd } from '../lib/tenantDate';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import {
  driverSchedulingService,
  type CourierBySchedule,
  type Schedule,
  type ScheduleSummary,
  type TimeSlotVehicle,
} from '../services/driverSchedulingService';
import {
  useDriverSchedulingCouriers,
  useDriverSchedulingLocations,
  useDriverSchedulingNotifications,
  useDriverSchedulingSummaries,
  useDriverSchedulingVehicleTypes,
  useInvalidateDriverScheduling,
} from '../hooks/queries/useDriverScheduling';
import { Button } from '../components/common/Button';
import { Panel } from '../components/common/Panel';
import { Modal } from '../components/common/Modal';
import { MultiSelect } from '../components/common/MultiSelect';

export default function DriverScheduling() {
  const user = useAuth();
  const toast = useToast();
  const askConfirm = useConfirm();
  const invalidate = useInvalidateDriverScheduling();

  const initialDate = useMemo(
    () => tenantTodayYmd({ isUsTenant: user.isUsTenant, timeZone: user.timeZone }),
    [user.isUsTenant, user.timeZone],
  );
  const [bookDate, setBookDate] = useState(initialDate);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null);
  const [responseTab, setResponseTab] = useState<'pending' | 'available' | 'unavailable'>('pending');

  const [newScheduleOpen, setNewScheduleOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [notifyPickerOpen, setNotifyPickerOpen] = useState(false);
  const [addTimeSlotOpen, setAddTimeSlotOpen] = useState(false);
  /** When set, the AssignSlotModal opens with this courier response
   *  targeted. The modal fetches the available time slots for the
   *  containing schedule's location + date and lets the operator pick
   *  one (or 'Reserve' to unassign). */
  const [assigningResponse, setAssigningResponse] = useState<CourierBySchedule | null>(null);
  /** When set, EditTimeSlotModal opens for the picked slot. Matches
   *  legacy schedulerControl.js `showTimeSlotUpdate` -> `updateTimeSlot`
   *  flow so operators can reschedule a slot without deleting +
   *  recreating (SMS goes to every assigned courier via the service). */
  const [editingTimeSlot, setEditingTimeSlot] = useState<TimeSlotVehicle | null>(null);

  const summariesQuery = useDriverSchedulingSummaries(bookDate);
  const summaries = summariesQuery.data ?? [];

  // Clear location/schedule selection when the operator picks a new
  // date. Without this, a stale `selectedLocation` from the previous
  // date would prevent the auto-pick-first-location fallback from
  // running when the new date has a different set of locations, and a
  // stale `selectedScheduleId` would keep the courier panel loading a
  // schedule that isn't visible on the new date.
  useEffect(() => {
    setSelectedLocation(null);
    setSelectedScheduleId(null);
  }, [bookDate]);

  // "Notify all pending" - reads GET /notifications (which returns
  // every un-notified schedule from today onwards, tenant-wide) and
  // fires a single POST /send-notifications with the full id list.
  const notificationsQuery = useDriverSchedulingNotifications();
  const pendingNotifications = notificationsQuery.data ?? [];

  // Auto-pick first location when the summaries land and the operator
  // has not explicitly picked one yet.
  const effectiveLocation = selectedLocation ?? summaries[0]?.location ?? null;
  const currentLocationSummary = summaries.find((s) => s.location === effectiveLocation) ?? null;

  const couriersQuery = useDriverSchedulingCouriers(selectedScheduleId);
  const couriers: CourierBySchedule[] = couriersQuery.data ?? [];

  const filteredCouriers = couriers.filter((c) => {
    const s = c.scheduleResponse;
    if (responseTab === 'pending') return s == null;
    if (responseTab === 'available') return s?.statusId === 1;
    if (responseTab === 'unavailable') return s?.statusId === 3;
    return true;
  });

  const doDelete = async (s: ScheduleSummary) => {
    const ok = await askConfirm({
      title: 'Delete schedule?',
      message: `Delete "${s.name}" on ${s.location}? This clears every response attached to it.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await driverSchedulingService.deleteSchedule(s.id);
      toast.show('Schedule deleted', 'success');
      if (selectedScheduleId === s.id) setSelectedScheduleId(null);
      invalidate();
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  const doNotify = async (s: ScheduleSummary) => {
    try {
      await driverSchedulingService.sendNotifications([s.id]);
      toast.show(`Notifications sent for "${s.name}"`, 'success');
      invalidate();
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  const doRemind = async (s: ScheduleSummary) => {
    // Matches legacy CourierManager schedulerControl.js confirmation
    // step: reminders re-SMS every Available courier. A misclick sends
    // a batch of texts that can't be recalled, so require an explicit
    // confirm every time.
    const ok = await askConfirm({
      title: 'Send reminders?',
      message: `Send reminder SMS to every Available courier on "${s.name}"? This will re-notify anyone who has already confirmed. Cannot be undone.`,
      confirmLabel: 'Send reminders',
    });
    if (!ok) return;
    try {
      await driverSchedulingService.sendReminders(s.id);
      toast.show(`Reminders sent for "${s.name}"`, 'success');
      invalidate();
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  const doDeleteTimeSlot = async (slot: TimeSlotVehicle) => {
    const ok = await askConfirm({
      title: 'Delete time slot?',
      message: `Remove ${formatTime(slot.bookDateTime)} at ${slot.location}? Assigned couriers fall back to reserve.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await driverSchedulingService.deleteTimeSlot(slot.id);
      toast.show('Time slot deleted', 'success');
      invalidate();
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  const toggleAvailability = async (row: CourierBySchedule, nextStatus: 1 | 3) => {
    if (!row.scheduleResponse) {
      toast.show('Response record does not exist yet - courier has not been notified.', 'error');
      return;
    }
    try {
      await driverSchedulingService.updateResponseStatuses([row.scheduleResponse.id], nextStatus);
      toast.show('Response updated', 'success');
      invalidate();
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  // Legacy CourierManager had a full "Notify" modal that showed every
  // pending schedule as a removable row - operators could take some
  // out of the batch before firing. Port had regressed to a single
  // "Notify all" button. Restored via NotifyPendingModal below.
  const openBulkNotify = () => {
    if (pendingNotifications.length === 0) {
      toast.show('No pending schedules to notify.', 'error');
      return;
    }
    setNotifyPickerOpen(true);
  };

  const submitBulkNotify = async (ids: number[]) => {
    if (ids.length === 0) {
      toast.show('Select at least one schedule to notify.', 'error');
      return;
    }
    try {
      await driverSchedulingService.sendNotifications(ids);
      toast.show(`Notifications sent for ${ids.length} schedule${ids.length === 1 ? '' : 's'}.`, 'success');
      invalidate();
      setNotifyPickerOpen(false);
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-surface-white">
        <label className="flex items-center gap-1 text-xs text-text-secondary">
          <span>Date</span>
          <input
            type="date"
            value={bookDate}
            onChange={(e) => setBookDate(e.target.value)}
            className="border border-border rounded px-2 py-0.5 text-xs bg-surface-white"
          />
        </label>
        <Button variant="primary" size="sm" onClick={() => setNewScheduleOpen(true)}>+ New Schedule</Button>
        <Button variant="neutral" size="sm" onClick={() => setCopyOpen(true)}>Copy</Button>
        <Button
          variant="neutral"
          size="sm"
          onClick={openBulkNotify}
          disabled={pendingNotifications.length === 0}
          title={pendingNotifications.length === 0
            ? 'No pending-notification schedules'
            : `Review ${pendingNotifications.length} pending schedule${pendingNotifications.length === 1 ? '' : 's'} before sending`}
        >
          Notify pending ({pendingNotifications.length})
        </Button>
        <Button variant="neutral" size="sm" onClick={() => summariesQuery.refetch()}>
          {summariesQuery.isFetching ? 'Refreshing...' : 'Refresh'}
        </Button>
        <span className="ml-auto text-xs text-text-muted">
          {summariesQuery.isLoading ? 'Loading...' : `${summaries.length} location${summaries.length === 1 ? '' : 's'}`}
        </span>
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left: locations + schedule cards */}
        <div className="w-1/2 border-r border-border overflow-y-auto">
          {/* Location tabs */}
          <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-border">
            {summaries.length === 0 && !summariesQuery.isLoading && (
              <span className="text-xs text-text-muted">No schedules for this date. Click + New Schedule to create one.</span>
            )}
            {summaries.map((s) => (
              <button
                key={s.location}
                type="button"
                onClick={() => { setSelectedLocation(s.location); setSelectedScheduleId(null); }}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  s.location === effectiveLocation
                    ? 'bg-brand-cyan text-brand-dark border-brand-cyan'
                    : 'bg-surface-white border-border text-text-secondary hover:bg-surface-cream'
                }`}
              >
                {s.location} <span className="text-text-muted">({s.totalAvailable}/{s.totalCouriers})</span>
              </button>
            ))}
          </div>

          {/* Schedule cards for the selected location */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-3">
            {currentLocationSummary?.scheduleSummaries.map((s) => {
              const isSelected = selectedScheduleId === s.id;
              return (
                <div
                  key={s.id}
                  onClick={() => setSelectedScheduleId(s.id)}
                  className={`border rounded-lg p-3 cursor-pointer transition-shadow ${
                    isSelected ? 'border-brand-cyan shadow-cyan-glow' : 'border-border hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-sm">{s.name}</div>
                      <div className="text-xs text-text-muted">
                        {formatTimeSpan(s.startTime)} - {formatTimeSpan(s.endTime)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-semibold">{s.available}/{s.wanted}</div>
                      <div className="text-[10px] text-text-muted">avail/wanted</div>
                    </div>
                  </div>
                  {s.vehicleSummaries.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {s.vehicleSummaries.map((v) => (
                        <span
                          key={v.vehicle}
                          className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-surface-cream text-text-secondary"
                        >
                          {v.vehicle}: {v.available}/{v.total}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                    {s.notificationSent == null ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void doNotify(s); }}
                        className="px-2 py-0.5 rounded bg-brand-cyan/20 text-brand-cyan hover:bg-brand-cyan/30"
                      >
                        Send notifications
                      </button>
                    ) : (
                      <>
                        <span className="px-2 py-0.5 rounded bg-green-100 text-green-800">
                          Notified {formatDate(s.notificationSent)}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void doRemind(s); }}
                          className="px-2 py-0.5 rounded bg-brand-cyan/20 text-brand-cyan hover:bg-brand-cyan/30"
                        >
                          Send reminders
                        </button>
                      </>
                    )}
                    {s.notificationSent == null && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void doDelete(s); }}
                        className="px-2 py-0.5 rounded bg-red-100 text-red-800 hover:bg-red-200"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: time slots + courier responses */}
        <div className="flex-1 overflow-y-auto">
          <Panel
            title={currentLocationSummary ? `Time slots - ${currentLocationSummary.location}` : 'Time slots'}
            actions={
              <Button
                variant="primary"
                size="sm"
                onClick={() => setAddTimeSlotOpen(true)}
                disabled={!effectiveLocation}
              >
                + Add
              </Button>
            }
          >
            <div className="flex flex-wrap gap-1 p-2">
              {(currentLocationSummary?.timeSlots ?? []).length === 0 && (
                <span className="text-xs text-text-muted p-2">No time slots for this location.</span>
              )}
              {(currentLocationSummary?.timeSlots ?? []).map((t) => (
                <div key={t.id} className="border border-border rounded px-2 py-1 flex items-center gap-2 text-xs">
                  <span className="font-mono">{formatTime(t.bookDateTime)}</span>
                  {t.wanted != null && <span className="text-text-muted">wanted {t.wanted}</span>}
                  {t.vehicleTypes.length > 0 && (
                    <span className="text-text-muted">{t.vehicleTypes.join(', ')}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditingTimeSlot(t)}
                    className="text-brand-cyan hover:text-brand-cyan-dark text-[11px]"
                    title="Edit time slot (reschedule + notify)"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void doDeleteTimeSlot(t)}
                    className="text-red-500 hover:text-red-700 text-[11px]"
                    title="Delete time slot"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            title={selectedScheduleId
              ? `Courier responses - ${currentLocationSummary?.scheduleSummaries.find((s) => s.id === selectedScheduleId)?.name ?? ''}`
              : 'Courier responses (select a schedule)'}
          >
            <div className="flex gap-1 px-3 pt-2">
              {(['pending', 'available', 'unavailable'] as const).map((k) => {
                const count = couriers.filter((c) => {
                  const s = c.scheduleResponse;
                  if (k === 'pending') return s == null;
                  if (k === 'available') return s?.statusId === 1;
                  return s?.statusId === 3;
                }).length;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setResponseTab(k)}
                    className={`px-2 py-1 text-xs rounded-t border-b-2 transition-colors ${
                      responseTab === k
                        ? 'border-brand-cyan text-brand-cyan font-medium'
                        : 'border-transparent text-text-muted hover:text-text-primary'
                    }`}
                  >
                    {k.charAt(0).toUpperCase() + k.slice(1)} ({count})
                  </button>
                );
              })}
            </div>
            <table className="w-full text-xs">
              <thead className="bg-surface-white border-b border-border">
                <tr className="text-left text-text-muted">
                  <th className="px-2 py-1">Code</th>
                  <th className="px-2 py-1">Name</th>
                  <th className="px-2 py-1">Vehicle</th>
                  <th className="px-2 py-1">Time Slot</th>
                  <th className="px-2 py-1">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCouriers.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-text-muted">
                      {selectedScheduleId ? 'No couriers in this bucket.' : 'Select a schedule to view its couriers.'}
                    </td>
                  </tr>
                )}
                {filteredCouriers.map((row) => (
                  <tr key={row.courier.id} className="border-b border-border/50">
                    <td className="px-2 py-1 font-mono">{row.courier.code ?? '-'}</td>
                    <td className="px-2 py-1">{[row.courier.firstName, row.courier.surname].filter(Boolean).join(' ') || '-'}</td>
                    <td className="px-2 py-1">{row.courier.vehicleType ?? '-'}</td>
                    <td className="px-2 py-1">
                      {row.scheduleResponse?.timeSlot
                        ? formatTime(row.scheduleResponse.timeSlot.bookDateTime)
                        : row.scheduleResponse?.statusId === 1 ? 'Reserve' : '-'}
                    </td>
                    <td className="px-2 py-1 flex gap-1">
                      {responseTab !== 'available' && (
                        <button
                          type="button"
                          onClick={() => void toggleAvailability(row, 1)}
                          className="px-2 py-0.5 rounded bg-green-100 text-green-800 hover:bg-green-200 text-[11px]"
                        >
                          Available
                        </button>
                      )}
                      {responseTab !== 'unavailable' && (
                        <button
                          type="button"
                          onClick={() => void toggleAvailability(row, 3)}
                          className="px-2 py-0.5 rounded bg-red-100 text-red-800 hover:bg-red-200 text-[11px]"
                        >
                          Unavailable
                        </button>
                      )}
                      {/* Assign-slot picker: only meaningful when the
                          courier is already Available (StatusId=1).
                          Opens a modal grid of the day's slots for
                          this schedule's location. Endpoint:
                          POST /responses/{id}/time-slot. */}
                      {row.scheduleResponse?.statusId === 1 && (
                        <button
                          type="button"
                          onClick={() => setAssigningResponse(row)}
                          className="px-2 py-0.5 rounded bg-brand-cyan/20 text-brand-cyan hover:bg-brand-cyan/30 text-[11px]"
                          title="Assign to a time slot or move to reserve"
                        >
                          {row.scheduleResponse?.timeSlot ? 'Reassign' : 'Assign'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      </div>

      {/* Modals */}
      {newScheduleOpen && (
        <NewScheduleModal
          bookDate={bookDate}
          onClose={() => setNewScheduleOpen(false)}
          onCreated={() => { setNewScheduleOpen(false); invalidate(); toast.show('Schedule created', 'success'); }}
        />
      )}
      {copyOpen && (
        <CopyModal
          bookDate={bookDate}
          onClose={() => setCopyOpen(false)}
          onCopied={() => { setCopyOpen(false); invalidate(); toast.show('Schedules copied', 'success'); }}
        />
      )}
      {notifyPickerOpen && (
        <NotifyPendingModal
          pending={pendingNotifications}
          onClose={() => setNotifyPickerOpen(false)}
          onSubmit={(ids) => void submitBulkNotify(ids)}
        />
      )}
      {addTimeSlotOpen && effectiveLocation && (
        <AddTimeSlotModal
          bookDate={bookDate}
          location={effectiveLocation}
          onClose={() => setAddTimeSlotOpen(false)}
          onCreated={() => { setAddTimeSlotOpen(false); invalidate(); toast.show('Time slot added', 'success'); }}
        />
      )}
      {assigningResponse && currentLocationSummary && (
        <AssignSlotModal
          response={assigningResponse}
          availableSlots={currentLocationSummary.timeSlots}
          onClose={() => setAssigningResponse(null)}
          onAssigned={() => { setAssigningResponse(null); invalidate(); toast.show('Time slot updated', 'success'); }}
        />
      )}
      {editingTimeSlot && (
        <EditTimeSlotModal
          bookDate={bookDate}
          slot={editingTimeSlot}
          onClose={() => setEditingTimeSlot(null)}
          onSaved={() => { setEditingTimeSlot(null); invalidate(); toast.show('Time slot updated - assigned couriers notified', 'success'); }}
        />
      )}
    </div>
  );
}

// ─── Modals ─────────────────────────────────────────────────────────

function NewScheduleModal({
  bookDate, onClose, onCreated,
}: {
  bookDate: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  // Locations come from /api/driver-scheduling/locations - every
  // active bulk region. Legacy CourierManager had the same shape;
  // port had regressed to auto-completing from the current day's
  // summaries, which meant a fresh date with no schedules yet had an
  // empty datalist.
  const locationsQuery = useDriverSchedulingLocations();
  const locations = locationsQuery.data ?? [];
  const [location, setLocation] = useState('');
  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('17:00');
  const [wanted, setWanted] = useState(5);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    // Field-level validations lifted from the legacy AngularJS
    // schedulerControl.js so operators get feedback before hitting
    // the server. Matches CourierManager UX byte-for-byte.
    if (!location.trim() || !name.trim()) {
      toast.show('Location and name are required.', 'error');
      return;
    }
    if (startTime >= endTime) {
      toast.show('Start time must be before end time.', 'error');
      return;
    }
    if (!Number.isFinite(wanted) || wanted < 1) {
      toast.show('Wanted (headcount) must be at least 1.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await driverSchedulingService.createSchedules([{
        bookDate, location: location.trim(), name: name.trim(),
        startTime: `${startTime}:00`, endTime: `${endTime}:00`, wanted,
      }]);
      onCreated();
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setSubmitting(false); }
  };

  return (
    <Modal open onClose={onClose} title="New Schedule" size="md" loading={submitting}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" size="sm" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={submitting}>Create</Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-3 p-4 text-xs">
        <label className="flex flex-col gap-1">
          <span>Location</span>
          <select
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="border border-border rounded px-2 py-1 bg-surface-white"
            disabled={locationsQuery.isLoading}
          >
            <option value="">{locationsQuery.isLoading ? 'Loading...' : 'Select a location...'}</option>
            {locations.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="border border-border rounded px-2 py-1" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span>Start</span>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="border border-border rounded px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">
            <span>End</span>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="border border-border rounded px-2 py-1" />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span>Wanted (target headcount)</span>
          <input type="number" min={1} value={wanted} onChange={(e) => setWanted(parseInt(e.target.value) || 1)} className="border border-border rounded px-2 py-1" />
        </label>
        <div className="text-[11px] text-text-muted">
          Book date: {bookDate} - use the top-bar date picker to change.
        </div>
      </div>
    </Modal>
  );
}

function NotifyPendingModal({
  pending, onClose, onSubmit,
}: {
  pending: Schedule[];
  onClose: () => void;
  onSubmit: (ids: number[]) => void;
}) {
  // Legacy CourierManager showed every un-notified schedule in a table
  // with a "remove from batch" affordance so operators could hold back
  // a schedule they weren't ready to send yet. This modal restores
  // that: start with everything selected, click × to remove specific
  // rows, then submit only what's left.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set(pending.map((p) => p.id)));

  const rows = pending.slice().sort((a, b) => {
    if (a.bookDate !== b.bookDate) return a.bookDate < b.bookDate ? -1 : 1;
    if (a.location !== b.location) return a.location < b.location ? -1 : 1;
    return a.name < b.name ? -1 : 1;
  });

  const toggle = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectedCount = selectedIds.size;

  return (
    <Modal open onClose={onClose} title="Notify pending schedules" size="lg"
      footer={
        <div className="flex justify-between items-center gap-2">
          <span className="text-[11px] text-text-muted">
            {selectedCount} of {rows.length} selected. Each courier in the target regions receives an SMS.
          </span>
          <div className="flex gap-2">
            <Button variant="neutral" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => onSubmit(Array.from(selectedIds))}
              disabled={selectedCount === 0}
            >
              Send ({selectedCount})
            </Button>
          </div>
        </div>
      }
    >
      <div className="p-4 text-xs">
        {rows.length === 0 && (
          <div className="text-text-muted text-center py-6">No pending schedules.</div>
        )}
        {rows.length > 0 && (
          <table className="w-full">
            <thead className="bg-surface-cream text-left text-text-muted">
              <tr>
                <th className="px-2 py-1 w-8"></th>
                <th className="px-2 py-1">Date</th>
                <th className="px-2 py-1">Location</th>
                <th className="px-2 py-1">Name</th>
                <th className="px-2 py-1">Window</th>
                <th className="px-2 py-1 text-right">Wanted</th>
                <th className="px-2 py-1 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const included = selectedIds.has(s.id);
                return (
                  <tr key={s.id} className={`border-b border-border/40 ${included ? '' : 'opacity-50'}`}>
                    <td className="px-2 py-1">
                      <input type="checkbox" checked={included} onChange={() => toggle(s.id)} />
                    </td>
                    <td className="px-2 py-1 font-mono">{s.bookDate.slice(0, 10)}</td>
                    <td className="px-2 py-1">{s.location}</td>
                    <td className="px-2 py-1">{s.name}</td>
                    <td className="px-2 py-1 font-mono text-text-muted">{s.startTime.slice(0, 5)} - {s.endTime.slice(0, 5)}</td>
                    <td className="px-2 py-1 text-right">{s.wanted}</td>
                    <td className="px-2 py-1">
                      <button
                        type="button"
                        onClick={() => toggle(s.id)}
                        className="text-text-muted hover:text-error"
                        title={included ? 'Remove from batch' : 'Add back to batch'}
                      >
                        {included ? '×' : '+'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}

function CopyModal({
  bookDate, onClose, onCopied,
}: {
  bookDate: string;
  onClose: () => void;
  onCopied: () => void;
}) {
  const toast = useToast();
  const [destinationDate, setDestinationDate] = useState('');
  const [locationsInput, setLocationsInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!destinationDate || !locationsInput.trim()) {
      toast.show('Destination date + at least one location are required.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await driverSchedulingService.copySchedules({
        sourceDate: bookDate,
        destinationDate,
        locations: locationsInput.split(',').map((s) => s.trim()).filter(Boolean),
      });
      onCopied();
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setSubmitting(false); }
  };

  return (
    <Modal open onClose={onClose} title="Copy Schedules" size="md" loading={submitting}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" size="sm" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={submitting}>Copy</Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-3 p-4 text-xs">
        <div className="text-[11px] text-text-muted">Source date: {bookDate}</div>
        <label className="flex flex-col gap-1">
          <span>Destination date</span>
          <input type="date" value={destinationDate} onChange={(e) => setDestinationDate(e.target.value)} className="border border-border rounded px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          <span>Locations (comma-separated)</span>
          <input value={locationsInput} onChange={(e) => setLocationsInput(e.target.value)} placeholder="Auckland, Christchurch" className="border border-border rounded px-2 py-1" />
        </label>
      </div>
    </Modal>
  );
}

function EditTimeSlotModal({
  bookDate, slot, onClose, onSaved,
}: {
  bookDate: string;
  slot: TimeSlotVehicle;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  // Seed with the slot's current time in HH:mm form. Same date the
  // parent page is currently on - moving to another date is out of
  // scope for the edit modal (operator can delete + re-add if they
  // want to shift dates).
  const [time, setTime] = useState<string>(() => formatTime(slot.bookDateTime));
  const [wanted, setWanted] = useState<number | ''>(slot.wanted ?? '');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      await driverSchedulingService.updateTimeSlot(slot.id, {
        bookDateTime: `${bookDate}T${time}:00`,
        wanted: wanted === '' ? null : Number(wanted),
      });
      onSaved();
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setSubmitting(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit Time Slot - ${slot.location}`}
      size="md"
      loading={submitting}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" size="sm" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={submitting}>Save</Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-3 p-4 text-xs">
        <div className="text-[11px] text-text-muted">
          Current: {formatTime(slot.bookDateTime)}
          {slot.wanted != null && ` - wanted ${slot.wanted}`}.
          Every courier assigned to this slot will be SMS'd about the change.
        </div>
        <label className="flex flex-col gap-1">
          <span>New time</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="border border-border rounded px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          <span>Wanted (leave blank for no cap)</span>
          <input
            type="number"
            min={1}
            value={wanted}
            onChange={(e) => setWanted(e.target.value === '' ? '' : Number(e.target.value))}
            className="border border-border rounded px-2 py-1"
          />
        </label>
        <div className="text-[11px] text-text-muted">
          Note: the new time must fall inside an existing schedule window on this location + date.
        </div>
      </div>
    </Modal>
  );
}

function AssignSlotModal({
  response, availableSlots, onClose, onAssigned,
}: {
  response: CourierBySchedule;
  availableSlots: TimeSlotVehicle[];
  onClose: () => void;
  onAssigned: () => void;
}) {
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);

  const responseId = response.scheduleResponse?.id;
  const currentSlotId = response.scheduleResponse?.timeSlot?.id ?? null;
  const courierVehicle = response.courier.vehicleType?.trim().toLowerCase() ?? '';

  const submit = async (timeSlotId: number | null) => {
    if (responseId == null) {
      toast.show('Response has no id - cannot assign.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await driverSchedulingService.assignResponseTimeSlot(responseId, timeSlotId);
      onAssigned();
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setSubmitting(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Assign ${response.courier.code ?? '?'} - ${[response.courier.firstName, response.courier.surname].filter(Boolean).join(' ')}`}
      size="lg"
      loading={submitting}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" size="sm" onClick={onClose} disabled={submitting}>Cancel</Button>
        </div>
      }
    >
      <div className="p-4 space-y-3 text-xs">
        <div className="text-text-muted">
          Vehicle: <span className="font-medium text-text-primary">{response.courier.vehicleType ?? 'Unassigned'}</span>.
          Pick a slot below, or click Reserve to keep the courier available without a specific slot.
        </div>

        <button
          type="button"
          onClick={() => void submit(null)}
          disabled={submitting || currentSlotId == null}
          className={`w-full text-left px-3 py-2 rounded border ${
            currentSlotId == null
              ? 'bg-brand-cyan/10 border-brand-cyan text-brand-cyan font-medium'
              : 'border-border hover:bg-surface-cream'
          }`}
        >
          Reserve {currentSlotId == null && '(current)'}
          <div className="text-[10px] text-text-muted">Available for the schedule but not tied to a specific time slot.</div>
        </button>

        {availableSlots.length === 0 && (
          <div className="text-text-muted text-center py-4">
            No time slots exist for this location today. Add one via the "+ Add" button on the Time Slots panel first.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {availableSlots.map((s) => {
            const fitsVehicle = s.vehicleTypes.length === 0
              || (courierVehicle && s.vehicleTypes.some((v) => v.trim().toLowerCase() === courierVehicle));
            const isCurrent = s.id === currentSlotId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => void submit(s.id)}
                disabled={submitting || !fitsVehicle || isCurrent}
                className={`text-left px-3 py-2 rounded border transition-colors ${
                  isCurrent
                    ? 'bg-brand-cyan/10 border-brand-cyan text-brand-cyan font-medium'
                    : fitsVehicle
                      ? 'border-border hover:bg-surface-cream'
                      : 'border-border bg-surface-cream/40 text-text-muted cursor-not-allowed'
                }`}
              >
                <div className="font-mono text-sm">{formatTime(s.bookDateTime)}</div>
                <div className="text-[11px] text-text-muted">
                  {s.wanted != null ? `Wanted ${s.wanted}` : 'No cap'}
                  {s.vehicleTypes.length > 0 && ` - ${s.vehicleTypes.join(', ')}`}
                  {isCurrent && ' - current'}
                  {!fitsVehicle && ' - vehicle mismatch'}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

function AddTimeSlotModal({
  bookDate, location, onClose, onCreated,
}: {
  bookDate: string;
  location: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  // Vehicle types come from /api/driver-scheduling/vehicle-types (the
  // VehicleType lookup table). Legacy CourierManager had a dropdown
  // seeded from `Vehicles/Types`; port had regressed to a comma-
  // separated free-text field which meant a typo like "Cars" got
  // rejected server-side at save time.
  const vehicleTypesQuery = useDriverSchedulingVehicleTypes();
  const vehicleTypes = vehicleTypesQuery.data ?? [];
  const [time, setTime] = useState('12:00');
  const [wanted, setWanted] = useState<number | ''>('');
  const [selectedVehicleTypes, setSelectedVehicleTypes] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      await driverSchedulingService.createTimeSlot({
        bookDateTime: `${bookDate}T${time}:00`,
        location,
        wanted: wanted === '' ? null : Number(wanted),
        // Empty selection = "any vehicle" (matches legacy semantics).
        vehicleTypes: selectedVehicleTypes,
      });
      onCreated();
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setSubmitting(false); }
  };

  return (
    <Modal open onClose={onClose} title={`Add Time Slot - ${location}`} size="md" loading={submitting}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" size="sm" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={submitting}>Add</Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-3 p-4 text-xs">
        <div className="text-[11px] text-text-muted">Book date: {bookDate}, location: {location}</div>
        <label className="flex flex-col gap-1">
          <span>Time</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="border border-border rounded px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          <span>Wanted (leave blank for no cap)</span>
          <input type="number" min={1} value={wanted} onChange={(e) => setWanted(e.target.value === '' ? '' : Number(e.target.value))} className="border border-border rounded px-2 py-1" />
        </label>
        <div className="flex flex-col gap-1">
          <span>Vehicle types (leave empty for any)</span>
          <MultiSelect
            label="Vehicle types"
            options={vehicleTypes.map((v) => ({ value: v.name, label: v.name }))}
            selected={selectedVehicleTypes}
            onChange={setSelectedVehicleTypes}
            minWidth="12rem"
          />
        </div>
      </div>
    </Modal>
  );
}

// ─── Formatting helpers ─────────────────────────────────────────────

function formatTime(iso: string): string {
  // "2026-09-07T14:30:00" or similar -> "14:30".
  const t = iso.includes('T') ? iso.split('T')[1] : iso;
  return t.slice(0, 5);
}

function formatTimeSpan(hms: string): string {
  // "HH:mm:ss" -> "HH:mm"
  return hms.slice(0, 5);
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}
