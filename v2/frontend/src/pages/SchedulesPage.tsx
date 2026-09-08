// Routed Operations › Schedules (new view).
// Dane's schedules module (Deliver-Different-Testing/admin-schedules-module) vendored under src/schedules,
// adapted for ScheduleId-keyed client links. See docs/KEVIN-NEW-SCHEDULES-VIEW-MULTI-CLIENT-2026-09-08.md.
import '../schedules/schedules.css';
import { SchedulesPage as SchedulesModulePage } from '../schedules/modules/schedules/SchedulesPage';

export default function SchedulesPage() {
  return (
    <div className="h-full overflow-auto bg-surface-light text-text-primary">
      <SchedulesModulePage />
    </div>
  );
}
