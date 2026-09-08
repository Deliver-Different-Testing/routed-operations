// src/modules/schedules/utils/conflictDetection.ts
import type { Schedule } from '../types';

export interface OverrideConflict {
  severity: 'error' | 'warning';
  message: string;
  field?: string;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function detectOverrideConflicts(
  baseSchedule: Schedule,
  override: Schedule
): OverrideConflict[] {
  const conflicts: OverrideConflict[] = [];

  // Check 1: Cutoff vs collection time
  const collectionLeg = baseSchedule.legs.find(l => l.config.type === 'collection');
  if (collectionLeg?.config.type === 'collection' && collectionLeg.config.lockedCollectionTime) {
    const _collectionMinutes = timeToMinutes(collectionLeg.config.lockedCollectionTime);
    const cutoffHours = override.operatingSchedule.cutoffValue;
    const cutoffUnit = override.operatingSchedule.cutoffUnit;
    let cutoffMinutesBefore = cutoffHours;
    if (cutoffUnit === 'hours') cutoffMinutesBefore = cutoffHours * 60;
    if (cutoffUnit === 'days') cutoffMinutesBefore = cutoffHours * 24 * 60;

    if (cutoffMinutesBefore <= 0) {
      conflicts.push({
        severity: 'error',
        message: `Cutoff (${cutoffHours} ${cutoffUnit} before) allows bookings after collection time (${collectionLeg.config.lockedCollectionTime}).`,
        field: 'operatingSchedule.cutoffValue',
      });
    }

    // Suppress unused variable warning
    void _collectionMinutes;
  }

  // Check 2: Override enables a day where linehaul doesn't run
  const linehaulLegs = baseSchedule.legs.filter(l => l.config.type === 'linehaul');
  if (linehaulLegs.length > 0) {
    const overrideEnabledDays = Object.entries(override.operatingSchedule.days)
      .filter(([, v]) => v.enabled)
      .map(([k]) => k);

    for (const lh of linehaulLegs) {
      if (lh.config.type === 'linehaul') {
        const lhDays = lh.config.activeDays as string[];
        for (const day of overrideEnabledDays) {
          if (!lhDays.includes(day)) {
            conflicts.push({
              severity: 'warning',
              message: `Override enables ${day} but linehaul doesn't run on that day.`,
              field: 'operatingSchedule.days',
            });
          }
        }
      }
    }
  }

  return conflicts;
}
