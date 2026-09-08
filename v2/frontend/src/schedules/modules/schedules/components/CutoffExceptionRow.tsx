// src/modules/schedules/components/CutoffExceptionRow.tsx
import { X } from 'lucide-react';
import { Select } from '../../../components/ui/Select';
import { Input } from '../../../components/ui/Input';
import type { CutoffException, DayOfWeek } from '../types';
import { DAYS_OF_WEEK, getDaysBetween } from '../types';

interface CutoffExceptionRowProps {
  exception: CutoffException;
  enabledDays: { value: DayOfWeek; label: string; short: string }[];
  onChange: (exception: CutoffException) => void;
  onRemove: () => void;
}

export function CutoffExceptionRow({
  exception,
  enabledDays,
  onChange,
  onRemove,
}: CutoffExceptionRowProps) {
  // Parse time (HH:MM) to hour and period (am/pm)
  const [hourStr] = exception.cutoffTime.split(':');
  const hour24 = parseInt(hourStr, 10);
  const hour12 = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;
  const period = hour24 >= 12 ? 'pm' : 'am';

  const handleDeliveryDayChange = (day: DayOfWeek) => {
    onChange({ ...exception, deliveryDay: day });
  };

  const handleCutoffDayChange = (day: DayOfWeek) => {
    onChange({ ...exception, cutoffDay: day });
  };

  const handleTimeChange = (newHour: number, newPeriod: 'am' | 'pm') => {
    let hour24Val = newHour;
    if (newPeriod === 'pm' && newHour !== 12) hour24Val = newHour + 12;
    if (newPeriod === 'am' && newHour === 12) hour24Val = 0;
    const newTime = `${hour24Val.toString().padStart(2, '0')}:00`;
    onChange({ ...exception, cutoffTime: newTime });
  };

  const daysBefore = getDaysBetween(exception.cutoffDay, exception.deliveryDay);

  return (
    <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm" data-testid="cutoff-exception-row" aria-label="cutoff exception row">
      {/* Delivery Day */}
      <Select
        value={exception.deliveryDay}
        onChange={(e) => handleDeliveryDayChange(e.target.value as DayOfWeek)}
        options={enabledDays.map(d => ({ value: d.value, label: d.short }))}
        className="w-20"
      />
      <span className="text-text-muted whitespace-nowrap">deliveries: cutoff</span>

      {/* Hour */}
      <Input
        type="number"
        value={hour12}
        onChange={(e) => handleTimeChange(parseInt(e.target.value) || 12, period)}
        min={1}
        max={12}
        className="w-16 text-center"
      />

      {/* AM/PM */}
      <Select
        value={period}
        onChange={(e) => handleTimeChange(hour12, e.target.value as 'am' | 'pm')}
        options={[
          { value: 'am', label: 'am' },
          { value: 'pm', label: 'pm' },
        ]}
        className="w-16"
      />

      <span className="text-text-muted">on</span>

      {/* Cutoff Day */}
      <Select
        value={exception.cutoffDay}
        onChange={(e) => handleCutoffDayChange(e.target.value as DayOfWeek)}
        options={DAYS_OF_WEEK.map(d => ({ value: d.value, label: d.short }))}
        className="w-20"
      />

      {/* Days Before (calculated) */}
      <span className="text-text-muted whitespace-nowrap">
        ({daysBefore} day{daysBefore !== 1 ? 's' : ''} before)
      </span>

      {/* Remove Button */}
      <button
        onClick={onRemove}
        className="p-1 text-text-muted hover:text-red-600 transition-colors ml-auto"
        title="Remove exception"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
