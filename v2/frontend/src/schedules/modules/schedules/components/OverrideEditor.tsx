import { ScheduleEditForm } from './ScheduleEditForm';
import type { Schedule } from '../types';

interface OverrideEditorProps {
  schedule: Schedule;
  baseSchedule: Schedule;
  onSave: (schedule: Schedule) => void;
  onCancel: () => void;
  clientName?: string;
}

export function OverrideEditor({
  schedule,
  baseSchedule,
  onSave,
  onCancel,
  clientName,
}: OverrideEditorProps) {
  return (
    <ScheduleEditForm
      schedule={schedule}
      baseSchedule={baseSchedule}
      overrideMode
      overrideClientName={clientName}
      onSave={onSave}
      onCancel={onCancel}
    />
  );
}
