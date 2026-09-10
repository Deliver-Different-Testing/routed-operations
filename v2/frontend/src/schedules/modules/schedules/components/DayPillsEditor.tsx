// src/modules/schedules/components/DayPillsEditor.tsx
import type { OperatingSchedule, DayOfWeek } from '../types';
import { DAYS_OF_WEEK } from '../types';

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

interface DayPillsEditorProps {
  schedule: OperatingSchedule;
  onChange: (schedule: OperatingSchedule) => void;
}

export function DayPillsEditor({ schedule, onChange }: DayPillsEditorProps) {
  const handleToggleDay = (day: DayOfWeek) => {
    onChange({
      ...schedule,
      days: {
        ...schedule.days,
        [day]: {
          ...schedule.days[day],
          enabled: !schedule.days[day].enabled,
        },
      },
    });
  };

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-medium text-text-muted uppercase tracking-wide">Operating Days</span>
      <div className="flex items-center gap-1">
        {DAYS_OF_WEEK.map((day, i) => {
          const enabled = schedule.days[day.value].enabled;
          return (
            <button
              key={day.value}
              onClick={() => handleToggleDay(day.value)}
              className={`w-8 h-8 rounded-full text-sm font-semibold transition-colors ${
                enabled
                  ? 'bg-brand-cyan text-white hover:bg-brand-cyan/80'
                  : 'bg-white text-text-muted border border-border hover:bg-surface-cream'
              }`}
              title={day.label}
            >
              {DAY_LETTERS[i]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
