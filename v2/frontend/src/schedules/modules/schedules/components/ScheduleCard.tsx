// src/modules/schedules/components/ScheduleCard.tsx
// Note: This component provides a standalone card view for schedules.
// It may not be needed if ExpandableRow is used everywhere, but it's here for flexibility.

import { memo } from 'react';
import { Badge } from '../../../components/ui/Badge';
import type { Schedule, DepotReference } from '../types';
import { getRouteDescription, getBookingModeLabel, getActiveDaysSummary, countLegs } from '../types';

interface ScheduleCardProps {
  schedule: Schedule;
  onClick?: () => void;
  depots: DepotReference[];
}

/** Schedule card displaying summary info. Click to select/expand. */
export const ScheduleCard = memo(function ScheduleCard({ schedule, onClick, depots }: ScheduleCardProps) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={`Schedule: ${schedule.name}`}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      data-testid={`schedule-card-${schedule.id}`}
      className={`
        bg-white rounded-lg border border-border p-4 transition-all
        ${onClick ? 'cursor-pointer hover:shadow-md hover:border-brand-cyan' : ''}
      `}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <h3 className="text-base font-semibold text-text-primary mb-1">{schedule.name}</h3>
          {schedule.description && (
            <p className="text-sm text-text-secondary line-clamp-2">{schedule.description}</p>
          )}
        </div>
        <Badge variant={schedule.isActive ? 'customized' : 'system'} size="sm">
          {schedule.isActive ? 'Active' : 'Inactive'}
        </Badge>
      </div>

      {/* Route */}
      <div className="mb-3">
        <div className="text-xs text-text-muted mb-1">Route</div>
        <div className="text-sm text-text-primary font-medium">
          {getRouteDescription(schedule, depots)}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <div className="text-xs text-text-muted mb-1">Legs</div>
          <div className="text-sm text-text-primary font-medium">{countLegs(schedule)}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted mb-1">Mode</div>
          <div className="text-sm text-text-primary font-medium">
            {getBookingModeLabel(schedule.bookingMode)}
          </div>
        </div>
        <div>
          <div className="text-xs text-text-muted mb-1">Days</div>
          <div className="text-sm text-text-primary font-medium">
            {getActiveDaysSummary(schedule.operatingSchedule)}
          </div>
        </div>
      </div>

      {/* Badges */}
      <div className="flex gap-2 mt-3 flex-wrap">
        <Badge variant="blue" size="sm">
          {schedule.clientId == null
            ? 'All Clients'
            : '1 Client'}
        </Badge>
        {schedule.isOverride && (
          <Badge variant="system" size="sm">
            Override
          </Badge>
        )}
      </div>
    </div>
  );
});
