// src/modules/schedules/components/TimelinePreview.tsx
import { useMemo } from 'react';
import { Pencil } from 'lucide-react';
import type { Schedule, DayOfWeek } from '../types';
import { DAYS_OF_WEEK, getDayLabel } from '../types';

interface TimelinePreviewProps {
  schedule: Schedule;
  onStepClick?: (legId: number) => void;
  /** Back-calculate edits: field = key on schedule model, value = new value */
  onFieldChange?: (field: string, value: any) => void;
}

interface TimelineEvent {
  label: string;
  day: DayOfWeek;
  dayShort: string;
  time: string;
  endTime?: string;
  isCutoff?: boolean;
  isDelivery?: boolean;
  isLinehaul?: boolean;
  legId?: number;
  absoluteMinutes?: number;
  editable?: boolean;
}

interface DayTimeline {
  events: TimelineEvent[];
  warnings: string[];
}

const DAY_INDEX: Record<DayOfWeek, number> = {
  mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6,
};

const DAY_ORDER: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

function minutesToTime(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function absMinutes(day: DayOfWeek, time: string): number {
  return DAY_INDEX[day] * 1440 + timeToMinutes(time);
}

function formatDuration(minutes: number): string {
  if (minutes < 0) minutes += 7 * 1440;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function getDayBefore(day: DayOfWeek, offset: number): DayOfWeek {
  const idx = DAY_ORDER.indexOf(day);
  return DAY_ORDER[(idx - offset + 7) % 7];
}

function convertToMinutes(value: number, unit: 'minutes' | 'hours' | 'days'): number {
  switch (unit) {
    case 'minutes': return value;
    case 'hours': return value * 60;
    case 'days': return value * 24 * 60;
    default: return value;
  }
}

function computeDayTimeline(schedule: Schedule, deliveryDay: DayOfWeek): DayTimeline {
  const events: TimelineEvent[] = [];
  const warnings: string[] = [];
  const daySchedule = schedule.operatingSchedule.days[deliveryDay];

  if (!daySchedule.enabled) return { events: [], warnings: [] };

  // Delivery
  events.push({
    label: 'Delivery',
    day: deliveryDay,
    dayShort: getDayLabel(deliveryDay, true),
    time: daySchedule.startTime,
    endTime: daySchedule.endTime,
    isDelivery: true,
    legId: schedule.legs.find(l => l.config.type === 'delivery')?.id,
    absoluteMinutes: absMinutes(deliveryDay, daySchedule.startTime),
    editable: true,
  });

  // Walk backwards
  let currentDayOffset = 0;
  const reversedLegs = [...schedule.legs].sort((a, b) => b.order - a.order);

  for (const leg of reversedLegs) {
    if (leg.config.type === 'linehaul') {
      currentDayOffset += leg.config.dayOffset;
      const departDay = getDayBefore(deliveryDay, currentDayOffset);
      if (!leg.config.activeDays.includes(departDay)) {
        warnings.push(`Linehaul doesn't run on ${getDayLabel(departDay, true)}`);
      }
      events.unshift({
        label: 'Linehaul',
        day: departDay,
        dayShort: getDayLabel(departDay, true),
        time: `${leg.config.transitMinutes}min`,
        isLinehaul: true,
        legId: leg.id,
      });
    } else if (leg.config.type === 'collection') {
      const collDay = getDayBefore(deliveryDay, currentDayOffset);
      const isFixed = leg.config.pickupTimeMode === 'fixed';
      const time = isFixed
        ? (leg.config.lockedCollectionTime || '17:00')
        : (leg.config.pickupWindowStart || '14:00');
      const endTime = isFixed ? undefined : (leg.config.pickupWindowEnd || '15:00');

      events.unshift({
        label: 'Collection',
        day: collDay,
        dayShort: getDayLabel(collDay, true),
        time,
        endTime,
        legId: leg.id,
        absoluteMinutes: absMinutes(collDay, time),
        editable: true,
      });
    }
  }

  // Cutoff — computed from origin cutoff value (relative)
  const cutoffMinutes = convertToMinutes(
    schedule.operatingSchedule.cutoffValue,
    schedule.operatingSchedule.cutoffUnit
  );
  const firstEvent = events[0];
  if (firstEvent?.absoluteMinutes != null) {
    const cutoffAbs = firstEvent.absoluteMinutes - cutoffMinutes;
    const cutoffDayIdx = ((Math.floor(cutoffAbs / 1440) % 7) + 7) % 7;
    const cutoffDay = DAY_ORDER[cutoffDayIdx];
    const cutoffTime = minutesToTime(cutoffAbs);
    events.unshift({
      label: 'Cutoff',
      day: cutoffDay,
      dayShort: getDayLabel(cutoffDay, true),
      time: cutoffTime,
      isCutoff: true,
      absoluteMinutes: ((cutoffAbs % (7 * 1440)) + 7 * 1440) % (7 * 1440),
      editable: true,
    });
  }

  return { events, warnings };
}

export function TimelinePreview({ schedule, onStepClick, onFieldChange }: TimelinePreviewProps) {
  const enabledDays = useMemo(
    () => DAYS_OF_WEEK.filter(d => schedule.operatingSchedule.days[d.value].enabled),
    [schedule.operatingSchedule.days]
  );

  const dayTimelines = useMemo(
    () => enabledDays.map(d => ({ day: d, ...computeDayTimeline(schedule, d.value) })),
    [schedule, enabledDays]
  );

  if (enabledDays.length === 0) {
    return (
      <div className="bg-surface-cream border border-border rounded-lg p-4" data-testid="timeline-preview" aria-label="timeline preview">
        <p className="text-sm text-text-muted">No operating days enabled</p>
      </div>
    );
  }

  /** When user changes a day-of-week select on a cutoff step, back-calculate the cutoff minutes */
  const handleCutoffDayChange = (_deliveryDay: DayOfWeek, newCutoffDay: DayOfWeek, currentTime: string, collectionEvent: TimelineEvent | undefined) => {
    if (!collectionEvent?.absoluteMinutes) return;
    const collAbs = collectionEvent.absoluteMinutes;
    const newCutoffAbs = absMinutes(newCutoffDay, currentTime);
    let diff = collAbs - newCutoffAbs;
    if (diff < 0) diff += 7 * 1440;
    if (diff % 1440 === 0) {
      onFieldChange?.('cutoffValue', diff / 1440);
      onFieldChange?.('cutoffUnit', 'days');
    } else if (diff % 60 === 0) {
      onFieldChange?.('cutoffValue', diff / 60);
      onFieldChange?.('cutoffUnit', 'hours');
    } else {
      onFieldChange?.('cutoffValue', diff);
      onFieldChange?.('cutoffUnit', 'minutes');
    }
  };

  const handleCutoffTimeChange = (_deliveryDay: DayOfWeek, cutoffDay: DayOfWeek, newTime: string, collectionEvent: TimelineEvent | undefined) => {
    if (!collectionEvent?.absoluteMinutes) return;
    const collAbs = collectionEvent.absoluteMinutes;
    const newCutoffAbs = absMinutes(cutoffDay, newTime);
    let diff = collAbs - newCutoffAbs;
    if (diff < 0) diff += 7 * 1440;
    if (diff % 60 === 0) {
      onFieldChange?.('cutoffValue', diff / 60);
      onFieldChange?.('cutoffUnit', 'hours');
    } else {
      onFieldChange?.('cutoffValue', diff);
      onFieldChange?.('cutoffUnit', 'minutes');
    }
  };

  return (
    <div className="bg-surface-cream border border-border rounded-lg p-4 space-y-5" data-testid="timeline-preview" aria-label="timeline preview">
      <h4 className="text-base font-semibold text-text-primary">Weekly Schedule</h4>
      <div className="overflow-x-auto">
        {dayTimelines.map(({ day, events, warnings }) => {
          const collectionEvent = events.find(e => e.label === 'Collection');

          // SHOULD-FIX 8: Total journey time
          const cutoffEvent = events.find(e => e.isCutoff);
          const deliveryEvent = events.find(e => e.isDelivery);
          let totalJourney: string | null = null;
          if (cutoffEvent?.absoluteMinutes != null && deliveryEvent?.absoluteMinutes != null) {
            let diff = deliveryEvent.absoluteMinutes - cutoffEvent.absoluteMinutes;
            if (diff < 0) diff += 7 * 1440;
            totalJourney = formatDuration(diff);
          }

          return (
            <div key={day.value} className="mb-5 last:mb-0">
              <h5 className="text-sm font-semibold text-text-primary mb-3 uppercase tracking-wide">{day.label}</h5>
              <div className="flex items-center gap-2 min-w-max pb-2">
                {events.map((event, i) => {
                  const prevEvent = i > 0 ? events[i - 1] : null;
                  let duration: string | null = null;
                  if (prevEvent?.absoluteMinutes != null && event.absoluteMinutes != null) {
                    let diff = event.absoluteMinutes - prevEvent.absoluteMinutes;
                    if (diff < 0) diff += 7 * 1440;
                    duration = formatDuration(diff);
                  }

                  // MUST-FIX 2: Only cutoff gets real inputs; others are plain text
                  const isCutoffStep = !!event.isCutoff;

                  return (
                    <div key={i} className="flex items-center gap-2">
                      {/* Duration connector */}
                      {i > 0 && (
                        <div className="flex flex-col items-center min-w-[40px]">
                          <span className="text-text-muted text-sm">→</span>
                          {duration && (
                            <span className="text-xs text-text-muted font-medium whitespace-nowrap">{duration}</span>
                          )}
                        </div>
                      )}

                      {/* Step card */}
                      <div
                        onClick={() => {
                          if (event.isCutoff) onStepClick?.(0);
                          else if (event.legId) onStepClick?.(event.legId);
                        }}
                        className={`group/step min-w-[160px] p-3 rounded-lg border-2 transition-all ${
                          event.isCutoff ? 'bg-red-50 border-red-200' :
                          event.isDelivery ? 'bg-green-50 border-green-200' :
                          event.isLinehaul ? 'bg-gray-50 border-gray-200' :
                          'bg-white border-border'
                        } ${!isCutoffStep && event.editable ? 'cursor-pointer hover:ring-2 hover:ring-brand-cyan hover:shadow-sm' : ''} ${isCutoffStep ? '' : ''}`}
                      >
                        <div className={`flex items-center justify-between mb-2`}>
                          <span className={`font-semibold text-sm uppercase tracking-wide ${
                            event.isCutoff ? 'text-red-700' :
                            event.isDelivery ? 'text-green-700' :
                            event.isLinehaul ? 'text-gray-600' :
                            'text-text-primary'
                          }`}>
                            {event.label}
                          </span>
                          {/* MUST-FIX 2: Pencil icon on hover for non-cutoff clickable steps */}
                          {!isCutoffStep && event.editable && (
                            <Pencil size={12} className="text-text-muted opacity-0 group-hover/step:opacity-100 transition-opacity" />
                          )}
                        </div>

                        {/* MUST-FIX 2: Cutoff = editable inputs, others = plain text */}
                        {event.isLinehaul ? (
                          <div className="text-sm text-text-secondary">{event.dayShort} • {event.time}</div>
                        ) : isCutoffStep ? (
                          <div className="space-y-1.5">
                            <select
                              value={event.day}
                              onChange={(e) => {
                                e.stopPropagation();
                                const newDay = e.target.value as DayOfWeek;
                                handleCutoffDayChange(day.value, newDay, event.time, collectionEvent);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="w-full text-sm border border-border rounded px-2 py-1 bg-white focus:ring-1 focus:ring-brand-cyan"
                              title="Change cutoff day"
                            >
                              {DAY_ORDER.map(d => (
                                <option key={d} value={d}>{getDayLabel(d, true)}</option>
                              ))}
                            </select>
                            <div className="flex items-center gap-1">
                              <input
                                type="time"
                                value={event.time}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  handleCutoffTimeChange(day.value, event.day, e.target.value, collectionEvent);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="text-sm border border-border rounded px-2 py-1 bg-white focus:ring-1 focus:ring-brand-cyan w-full"
                              />
                            </div>
                          </div>
                        ) : (
                          /* Plain text for Collection, Delivery */
                          <div className="text-sm text-text-secondary">
                            <span className="font-medium">{event.dayShort}</span>
                            <span className="mx-1">•</span>
                            <span>{event.time}</span>
                            {event.endTime && (
                              <span className="text-text-muted"> – {event.endTime}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* SHOULD-FIX 8: Total journey time */}
              {totalJourney && (
                <div className="text-xs text-text-muted mt-1 font-medium">
                  Total: Cutoff → Delivery = {totalJourney}
                </div>
              )}
              {warnings.map((w, i) => (
                <p key={i} className="text-xs text-yellow-700 mt-1">⚠️ {w}</p>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
