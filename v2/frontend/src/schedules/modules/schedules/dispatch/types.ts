// src/modules/schedules/dispatch/types.ts
//
// The dispatch side of a schedule, read from the Recurring Routes tables
// (Routes, RouteZipcodes, Dispatch_RouteRoster, TblbulkLinehaulRun, tucJobBooking master job).
// The schedule owns the time window; these own geography, who runs it, and the trunk leg.

export type RouteType = 'first' | 'middle' | 'final';
export type TargetType = 'Courier' | 'Agent' | 'NP';

export interface AssignTarget {
  name: string;
  type: TargetType;
  hint?: string;
}

/** ISO weekday 1 = Mon … 7 = Sun */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface RosterPattern {
  /** weekly pattern: who runs it on each weekday */
  weekly: Partial<Record<IsoWeekday, string>>;
  /** one-off date overrides, ISO date → who */
  dateOverrides: Record<string, string>;
}

export interface RecurringRoute {
  id: number;
  name: string;
  type: Exclude<RouteType, 'middle'>;
  area: string;
  /** ScheduleIds this route is bound to (Routes.ScheduleId; >1 = proposed multi-binding) */
  scheduleIds: number[];
  zipCount: number;
  mappedStops: number;
  defaultTarget: AssignTarget;
  roster: RosterPattern;
  active: boolean;
}

export interface MasterJob {
  jobNumber: string;
  /** e.g. "Materialised 04:10 · 38 items linked" */
  todayState: string;
}

export interface LinehaulRun {
  id: number;
  name: string;
  fromDepot: string;
  toDepot: string;
  days: IsoWeekday[];
  despatchTime: string;
  departTime: string;
  mode: 'Road' | 'Flight';
  defaultTarget: AssignTarget;
  /** 'Use schedule default' or a speed name */
  speed: string;
  roster: RosterPattern;
  /** The booking that represents this run (IsLinehaulMaster = 1); null = none set */
  masterJob: MasterJob | null;
  mappedStops: number;
  active: boolean;
}

export interface RosterDay {
  date: string; // ISO
  weekday: IsoWeekday;
  label: string; // Mon…Sun
  who: string | null;
  isOverride: boolean;
  isToday: boolean;
}
