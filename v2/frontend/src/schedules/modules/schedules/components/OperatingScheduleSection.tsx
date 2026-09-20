// src/modules/schedules/components/OperatingScheduleSection.tsx
import { Plus } from 'lucide-react';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { Button } from '../../../components/ui/Button';
import type { OperatingSchedule, DayOfWeek, TimeUnit, CutoffException } from '../types';
import { DAYS_OF_WEEK, getSuggestedCutoffDay } from '../types';
import { CutoffExceptionRow } from './CutoffExceptionRow';

interface OperatingScheduleSectionProps {
  schedule: OperatingSchedule;
  onChange: (schedule: OperatingSchedule) => void;
}

export function OperatingScheduleSection({ schedule, onChange }: OperatingScheduleSectionProps) {
  const handleDayToggle = (day: DayOfWeek, enabled: boolean) => {
    onChange({
      ...schedule,
      days: {
        ...schedule.days,
        [day]: {
          ...schedule.days[day],
          enabled,
        },
      },
    });
  };

  const handleTimeChange = (day: DayOfWeek, field: 'startTime' | 'endTime', value: string) => {
    onChange({
      ...schedule,
      days: {
        ...schedule.days,
        [day]: {
          ...schedule.days[day],
          [field]: value,
        },
      },
    });
  };

  // Apply first enabled day's times to ALL enabled days (not just weekdays)
  const handleApplyToAllEnabled = () => {
    const enabledDays = DAYS_OF_WEEK.filter(d => schedule.days[d.value].enabled);
    if (enabledDays.length === 0) return;

    const sourceDay = enabledDays[0].value;
    const { startTime, endTime } = schedule.days[sourceDay];

    const updatedDays = { ...schedule.days };
    enabledDays.forEach((d) => {
      updatedDays[d.value] = {
        ...updatedDays[d.value],
        startTime,
        endTime,
      };
    });

    onChange({ ...schedule, days: updatedDays });
  };

  // Cutoff exception handlers
  const handleAddException = () => {
    const enabledDays = DAYS_OF_WEEK.filter(d => schedule.days[d.value].enabled);
    const existingDeliveryDays = (schedule.cutoffExceptions || []).map(e => e.deliveryDay);
    const availableDay = enabledDays.find(d => !existingDeliveryDays.includes(d.value));

    if (!availableDay) return; // All enabled days have exceptions

    const newException: CutoffException = {
      deliveryDay: availableDay.value,
      cutoffDay: getSuggestedCutoffDay(availableDay.value),
      cutoffTime: '17:00',
    };

    onChange({
      ...schedule,
      cutoffExceptions: [...(schedule.cutoffExceptions || []), newException],
    });
  };

  const handleExceptionChange = (index: number, updated: CutoffException) => {
    const updatedExceptions = [...(schedule.cutoffExceptions || [])];
    updatedExceptions[index] = updated;
    onChange({ ...schedule, cutoffExceptions: updatedExceptions });
  };

  const handleRemoveException = (index: number) => {
    const updatedExceptions = (schedule.cutoffExceptions || []).filter((_, i) => i !== index);
    onChange({ ...schedule, cutoffExceptions: updatedExceptions });
  };

  const enabledDays = DAYS_OF_WEEK.filter(d => schedule.days[d.value].enabled);
  const exceptions = schedule.cutoffExceptions || [];

  return (
    <div className="space-y-6" data-testid="operating-schedule-section" aria-label="operating schedule section">
      {/* Operating Days */}
      <div>
        <h4 className="text-sm font-semibold text-text-primary mb-3">Operating Days</h4>
        <div className="space-y-2">
          {DAYS_OF_WEEK.map((day) => (
            <div key={day.value} className="flex items-center justify-between">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={schedule.days[day.value].enabled}
                  onChange={(e) => handleDayToggle(day.value, e.target.checked)}
                  className="rounded border-border text-brand-cyan focus:ring-brand-cyan"
                />
                <span className="text-sm text-text-secondary font-medium w-20">
                  {day.label}
                </span>
              </label>
              {schedule.days[day.value].enabled && (
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={schedule.days[day.value].startTime}
                    onChange={(e) => handleTimeChange(day.value, 'startTime', e.target.value)}
                    className="w-28"
                  />
                  <span className="text-text-muted text-sm">to</span>
                  <Input
                    type="time"
                    value={schedule.days[day.value].endTime}
                    onChange={(e) => handleTimeChange(day.value, 'endTime', e.target.value)}
                    className="w-28"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Apply to All Enabled Days Button */}
      <div className="border-t-2 border-border pt-4">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleApplyToAllEnabled}
          disabled={enabledDays.length < 2}
        >
          Apply to all enabled days
        </Button>
        <p className="mt-2 text-xs text-text-muted">
          Copy the first enabled day's times to all other enabled days (including weekends)
        </p>
      </div>

      {/* Cutoff Configuration */}
      <div className="border-t-2 border-border pt-4">
        <h4 className="text-sm font-semibold text-text-primary mb-3">Booking Cutoff</h4>

        {/* Default Cutoff */}
        <div className="flex items-end gap-3 mb-2">
          <Input
            type="number"
            label="Default Cutoff"
            value={schedule.cutoffValue}
            onChange={(e) =>
              onChange({ ...schedule, cutoffValue: parseInt(e.target.value) || 0 })
            }
            min={0}
            className="flex-1"
          />
          <Select
            label="Unit"
            value={schedule.cutoffUnit}
            onChange={(e) => onChange({ ...schedule, cutoffUnit: e.target.value as TimeUnit })}
            options={[
              { value: 'minutes', label: 'Minutes' },
              { value: 'hours', label: 'Hours' },
              { value: 'days', label: 'Days' },
            ]}
            className="flex-1"
          />
        </div>
        <p className="text-xs text-text-muted mb-4">
          Default: Bookings must be received this far before the scheduled time
        </p>

        {/* Cutoff Exceptions */}
        {exceptions.length > 0 && (
          <div className="space-y-2 mb-4">
            <h5 className="text-xs font-medium text-text-secondary uppercase tracking-wide">
              Day-Specific Exceptions
            </h5>
            {exceptions.map((exception, index) => (
              <CutoffExceptionRow
                key={`${exception.deliveryDay}-${index}`}
                exception={exception}
                enabledDays={enabledDays}
                onChange={(updated) => handleExceptionChange(index, updated)}
                onRemove={() => handleRemoveException(index)}
              />
            ))}
          </div>
        )}

        {/* Add Exception Link */}
        {enabledDays.length > exceptions.length && (
          <button
            onClick={handleAddException}
            className="text-sm text-brand-cyan hover:text-brand-cyan/80 flex items-center gap-1 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add day exception
          </button>
        )}
        {exceptions.length === 0 && (
          <p className="text-xs text-text-muted mt-2">
            Use exceptions for days that need a different cutoff (e.g., Monday deliveries need Friday cutoff to skip weekend)
          </p>
        )}
      </div>
    </div>
  );
}
