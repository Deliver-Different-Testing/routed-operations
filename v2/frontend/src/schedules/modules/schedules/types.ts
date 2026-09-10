/**
 * @module schedules/types
 *
 * Domain types for the Schedules module — schedule definitions, legs, operating
 * schedules, booking modes, cutoff rules, client overrides, and table view helpers.
 *
 * ## Production Model (tblBulkRunSchedule)
 * Production stores **one row per day-of-week per schedule-name**. A "schedule"
 * is a group of rows sharing the same `Name`. Each row has its own start/end
 * times, zones, linehauls, and cutoff.
 *
 * This file contains:
 * 1. Production-aligned types (BulkRunScheduleRow, etc.)
 * 2. UI types (Schedule — our multi-day abstraction)
 * 3. Mapping layer (multiDayToPerDay / perDayToMultiDay)
 */

import type { EntityConnections } from '../territory/types';
import { createEmptyConnections } from '../territory/types';

export type { EntityConnections };
export { createEmptyConnections };

// ============================================
// ENUMS & CONSTANTS
// ============================================

export type BookingMode = 'fixed_time' | 'window';

export type LegType = 'collection' | 'depot' | 'linehaul' | 'delivery';

export type ScheduleOriginType = 'unselected' | 'client_address' | 'depot' | 'booking';

export type AdditionalItemChargingLogic =
  | 'none'
  | 'speed_second_box_discount'
  | 'client_speed_addon_percentage'
  | 'client_additional_charges'
  | 'rate_special_additional_charge';

export const ADDITIONAL_ITEM_CHARGING_OPTIONS: { value: AdditionalItemChargingLogic; label: string }[] = [
  { value: 'none', label: 'No additional item charge' },
  { value: 'speed_second_box_discount', label: 'Speed Second Box %' },
  { value: 'client_speed_addon_percentage', label: 'Client Speed Addon %' },
  { value: 'client_additional_charges', label: 'Client Additional Charges' },
  { value: 'rate_special_additional_charge', label: 'Rate Special Additional Charge' },
];

export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type TemperatureState = 'ambient' | 'chilled' | 'frozen';

export type TimeUnit = 'minutes' | 'hours' | 'days';

export const DAYS_OF_WEEK: { value: DayOfWeek; label: string; short: string }[] = [
  { value: 'mon', label: 'Monday', short: 'Mon' },
  { value: 'tue', label: 'Tuesday', short: 'Tue' },
  { value: 'wed', label: 'Wednesday', short: 'Wed' },
  { value: 'thu', label: 'Thursday', short: 'Thu' },
  { value: 'fri', label: 'Friday', short: 'Fri' },
  { value: 'sat', label: 'Saturday', short: 'Sat' },
  { value: 'sun', label: 'Sunday', short: 'Sun' },
];

/** Maps DayOfWeek string to production numeric (1=Mon..7=Sun) */
export const DAY_TO_NUMBER: Record<DayOfWeek, number> = {
  mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7,
};

/** Maps production numeric (1-7) to DayOfWeek string */
export const NUMBER_TO_DAY: Record<number, DayOfWeek> = {
  1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat', 7: 'sun',
};

export const TEMPERATURE_STATES: { value: TemperatureState; label: string }[] = [
  { value: 'ambient', label: 'Ambient' },
  { value: 'chilled', label: 'Chilled' },
  { value: 'frozen', label: 'Frozen' },
];

export const BOOKING_MODES: { value: BookingMode; label: string; description: string }[] = [
  { value: 'fixed_time', label: 'Fixed Time', description: 'Delivery at specific scheduled time' },
  { value: 'window', label: 'Window', description: 'Delivery within a time range' },
];

// ============================================
// PRODUCTION TYPES (tblBulkRunSchedule row)
// ============================================

/**
 * Represents a single row in tblBulkRunSchedule.
 * Production stores one row per day-of-week per schedule name.
 */
export interface BulkRunScheduleRow {
  bulkRunScheduleId: number;
  name: string;
  description?: string;
  dayOfWeek: number; // 1=Mon..7=Sun
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  maxJobs: number; // typically 10000
  region: number; // FK → BulkRegion (destination depot)
  speedId?: number; // FK → delivery speed
  parentSpeedId?: number; // FK → linehaul speed
  pickupRatingSpeed?: number; // FK → pickup speed
  cutoffHours: number;
  autoBook?: boolean;
  bookPickup?: boolean;
  pickupDepotId?: number; // FK
  postcodeGroupId?: number; // FK → delivery zone group
  pickupPostcodeGroupId?: number; // FK → pickup zone group
  storageState?: number;
  deliveryState?: number;
  pickupBoxDiscount?: number;
  dropOffLocationId?: number; // FK
  applyPickupCutoff?: boolean;
  pickupCutoff?: number;
  clientId?: number; // null = default/all, non-null = client-specific
}

/**
 * Linehaul row associated with a BulkRunSchedule row.
 */
export interface BulkScheduleLinehaulRow {
  bulkScheduleLinehaulId: number;
  bulkRunScheduleId: number; // parent FK
  linehaulRunId?: number;
  fromDepotId?: number;
  toDepotId?: number;
  departureAdvanceDays: number;
  weekDay: string; // "1111111" encoding (Mon-Sun, 1=active)
  minutes: number; // transit time
  insertToBulk: boolean;
  fromClientAddress?: boolean;
  dropOffLocationId?: number;
  amount?: number;
  amountPercentage?: number;
  applyDiscount?: boolean;
  applyAddOnPercentage?: boolean;
}

/**
 * Zone association for a schedule row.
 */
export interface BulkZoneScheduleRow {
  bulkZoneScheduleId: number;
  bulkRunScheduleId: number;
  zoneId: number;
}

// ============================================
// PRODUCTION API DTOs
// ============================================

export interface BulkRunScheduleCreateRequest {
  name: string;
  description?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  maxJobs?: number;
  region: number;
  speedId?: number;
  parentSpeedId?: number;
  pickupRatingSpeed?: number;
  cutoffHours: number;
  autoBook?: boolean;
  bookPickup?: boolean;
  pickupDepotId?: number;
  postcodeGroupId?: number;
  pickupPostcodeGroupId?: number;
  storageState?: number;
  deliveryState?: number;
  pickupBoxDiscount?: number;
  dropOffLocationId?: number;
  applyPickupCutoff?: boolean;
  pickupCutoff?: number;
  clientId?: number;
  zones?: { zoneId: number }[];
  linehauls?: Omit<BulkScheduleLinehaulRow, 'bulkScheduleLinehaulId' | 'bulkRunScheduleId'>[];
}

export interface BulkRunScheduleUpdateRequest extends BulkRunScheduleCreateRequest {
  bulkRunScheduleId: number;
}

// ============================================
// REFERENCE TYPES (from other modules)
// ============================================

export interface DepotReference {
  id: number;
  name: string;
  code?: string;
}

export interface DropoffLocation {
  id: number;
  depotId: number;
  name: string;
  qrCode?: string;
}

export interface ZoneReference {
  id: number;
  name: string;
  code?: string;
  postcodeCount?: number;
}

export interface SpeedReference {
  id: number;
  name: string;
  code: string;
}

export interface LinehaulRunReference {
  id: number;
  name: string;
  originDepotId: number;
  destinationDepotId: number;
  departureTime: string; // HH:MM
  transitDuration: number;
  transitUnit: TimeUnit;
  activeDays: DayOfWeek[];
}

export interface RateCardReference {
  id: number;
  name: string;
}

export interface ClientReference {
  id: number;
  name: string;
  shortName?: string;
}

// ============================================
// LEG CONFIGURATION TYPES
// ============================================

export interface CollectionLegConfig {
  type: 'collection';
  speedId?: number;
  additionalItemChargingLogic?: AdditionalItemChargingLogic;
  pickupZoneIds: number[];
  pickupTimeMode: 'window' | 'fixed';
  pickupWindowStart?: string; // HH:MM e.g. "14:00"
  pickupWindowEnd?: string;   // HH:MM e.g. "15:00"
  bookFromClientAddress: boolean;
  createPickupJob: boolean;
  lockedCollectionTime?: string; // HH:MM format, used for fixed mode
  pickupSource: 'client_address' | 'depot' | 'booking';
  pickupDepotId?: number;
}

export interface DepotLegConfig {
  type: 'depot';
  depotId: number;
  dropoffLocationId?: number;
  storageState?: TemperatureState;
}

export interface LinehaulLegConfig {
  type: 'linehaul';
  speedId?: number;
  additionalItemChargingLogic?: AdditionalItemChargingLogic;
  runId?: number;
  fromDepotId?: number;
  toDepotId?: number;
  dayOffset: number;
  activeDays: DayOfWeek[];
  transitMinutes: number;
  insertToBulk: boolean;
  fromClientAddress?: boolean;
  dropOffLocationId?: number;
  amount?: number;
  amountPercentage?: number;
  applyDiscount?: boolean;
  applyAddOnPercentage?: boolean;
}

export interface DeliveryLegConfig {
  type: 'delivery';
  speedId?: number;
  additionalItemChargingLogic?: AdditionalItemChargingLogic;
  deliveryZoneIds: number[];
  deliveryState?: TemperatureState;
  courierId?: number; // Temp — until auto-dispatch engine. FK → Courier
}

export type LegConfig = CollectionLegConfig | DepotLegConfig | LinehaulLegConfig | DeliveryLegConfig;

// ============================================
// SCHEDULE LEG (Node in the chain)
// ============================================

export interface ScheduleLeg {
  id: number;
  order: number;
  config: LegConfig;
}

// ============================================
// OPERATING SCHEDULE (Days/Times)
// ============================================

export interface DaySchedule {
  enabled: boolean;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
}

export interface CutoffException {
  deliveryDay: DayOfWeek;
  cutoffDay: DayOfWeek;
  cutoffTime: string; // HH:MM
}

export interface OperatingSchedule {
  uniformWeekdays: boolean;
  days: Record<DayOfWeek, DaySchedule>;
  cutoffValue: number;
  cutoffUnit: TimeUnit;
  cutoffExceptions?: CutoffException[];
}

// Helper: Calculate days between two DayOfWeek values
export function getDaysBetween(cutoffDay: DayOfWeek, deliveryDay: DayOfWeek): number {
  const from = DAY_TO_NUMBER[cutoffDay] - 1;
  const to = DAY_TO_NUMBER[deliveryDay] - 1;
  let diff = to - from;
  if (diff <= 0) diff += 7;
  return diff;
}

export function getSuggestedCutoffDay(deliveryDay: DayOfWeek): DayOfWeek {
  const suggestions: Record<DayOfWeek, DayOfWeek> = {
    mon: 'fri', tue: 'mon', wed: 'tue', thu: 'wed',
    fri: 'thu', sat: 'fri', sun: 'fri',
  };
  return suggestions[deliveryDay];
}

// ============================================
// DELIVERY WINDOW RULES (frontend-only)
// ============================================

export type DeliveryWindowMode = 'automatic' | 'fixed';

export interface DeliveryWindowRule {
  id: number;
  condition: {
    arrivalBefore: string;
  };
  result: {
    deliverSameDay: boolean;
    windowStart: string;
    windowEnd: string;
  };
}

export interface DeliveryWindowConfig {
  mode: DeliveryWindowMode;
  rules: DeliveryWindowRule[];
  fixedDays: DayOfWeek[];
  fixedWindowStart: string;
  fixedWindowEnd: string;
  fixedTransitDays: number;
}

// ============================================
// MAIN SCHEDULE INTERFACE (UI abstraction)
// ============================================

/**
 * UI-level schedule — multi-day abstraction over production's per-day rows.
 * Use multiDayToPerDay() / perDayToMultiDay() to convert.
 *
 * Key differences from production:
 * - `id` is the first row's BulkRunScheduleId (or synthetic for new)
 * - `rowIds` tracks all production row IDs belonging to this schedule
 * - `clientId` is singular (production is 1 client per schedule set)
 * - bookingMode, deliveryWindow, connections are frontend-only
 */
export interface Schedule {
  id: number;
  /** All production row IDs grouped under this schedule name */
  rowIds: number[];
  name: string;
  description?: string;
  /** UI-only customer-facing name for a client override. Not mapped to production schedule name. */
  displayName?: string;
  /** UI-only customer-facing description for a client override. Not mapped to production schedule description. */
  displayDescription?: string;

  // Client — production supports ONE client per schedule set
  clientId: number | null; // legacy: first linked client (kept for Dane's code paths); null = default/all clients

  // Routed Operations: id-keyed client links (tblBulkRunScheduleHeader + tblBulkRunScheduleClient)
  /** 'all' = default schedule (IsDefault = 1, no link rows); 'specific' = only the clients in clientIds */
  visibility?: 'all' | 'specific';
  /** Link rows: the clients attached to this schedule (ScheduleId, ClientId) */
  clientIds?: number[];

  // Booking mode (frontend-only — no production equivalent)
  bookingMode: BookingMode;

  // Speed IDs (production field names in comments)
  speedId?: number; // SpeedId — delivery speed
  pickupRatingSpeed?: number; // PickupRatingSpeed
  parentSpeedId?: number; // ParentSpeedId — linehaul speed

  // Origin configuration
  originType: ScheduleOriginType;
  pickupDepotId?: number;
  originDepotId?: number; // Alias for pickupDepotId for some components
  additionalItemChargingLogic?: AdditionalItemChargingLogic;

  // Destination
  region: number; // FK → BulkRegion (destination depot)

  // Production fields
  cutoffHours: number;
  autoBook?: boolean;
  bookPickup?: boolean;
  postcodeGroupId?: number;
  pickupPostcodeGroupId?: number;
  storageState?: number;
  deliveryState?: number;
  pickupBoxDiscount?: number;
  dropOffLocationId?: number;
  applyPickupCutoff?: boolean;
  pickupCutoff?: number;

  // The leg chain (UI abstraction)
  legs: ScheduleLeg[];

  // Operating schedule (mapped from/to per-day rows)
  operatingSchedule: OperatingSchedule;

  // Delivery window configuration (frontend-only)
  deliveryWindow: DeliveryWindowConfig;

  // Status (frontend-only or derived from autoBook)
  isActive: boolean;

  // Override info — derived from clientId presence
  isOverride: boolean;
  baseScheduleId?: number | null; // For overrides: ScheduleId of the base (replaces name matching)
  baseScheduleName?: string; // Linked by Name matching
  clientVisibility?: string; // For overrides: visibility setting
  overriddenFields?: string[]; // For overrides: which fields are overridden

  // Connections (frontend-only tag system)
  connections: EntityConnections;

  // Metadata (frontend-only — no audit fields in ClientManager)
  createdAt?: string;
  updatedAt?: string;
}

// ============================================
// MAPPING LAYER: Multi-day ↔ Per-day rows
// ============================================

/**
 * Encode DayOfWeek[] into production "1111111" string (Mon-Sun).
 */
export function encodeDaysToWeekDay(days: DayOfWeek[]): string {
  return (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as DayOfWeek[])
    .map(d => days.includes(d) ? '1' : '0')
    .join('');
}

/**
 * Decode production "1111111" string to DayOfWeek[].
 */
export function decodeWeekDayToDays(weekDay: string): DayOfWeek[] {
  const allDays: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  return allDays.filter((_, i) => weekDay[i] === '1');
}

/**
 * Convert a UI Schedule (multi-day) into production per-day rows for save.
 */
export function multiDayToPerDay(schedule: Schedule): BulkRunScheduleCreateRequest[] {
  const enabledDays = DAYS_OF_WEEK.filter(d => schedule.operatingSchedule.days[d.value].enabled);

  return enabledDays.map(day => {
    const dayConfig = schedule.operatingSchedule.days[day.value];
    const collectionLeg = schedule.legs.find(l => l.config.type === 'collection');
    const linehaulLeg = schedule.legs.find(l => l.config.type === 'linehaul');
    const deliveryLeg = schedule.legs.find(l => l.config.type === 'delivery');
    const collectionConfig = collectionLeg?.config.type === 'collection' ? collectionLeg.config : undefined;
    const linehaulConfig = linehaulLeg?.config.type === 'linehaul' ? linehaulLeg.config : undefined;
    const deliveryConfig = deliveryLeg?.config.type === 'delivery' ? deliveryLeg.config : undefined;

    // Map linehaul legs
    const linehauls = schedule.legs
      .filter(l => l.config.type === 'linehaul')
      .map(l => {
        const cfg = l.config as LinehaulLegConfig;
        return {
          linehaulRunId: cfg.runId,
          fromDepotId: cfg.fromDepotId,
          toDepotId: cfg.toDepotId,
          departureAdvanceDays: cfg.dayOffset,
          weekDay: encodeDaysToWeekDay(cfg.activeDays),
          minutes: cfg.transitMinutes,
          insertToBulk: cfg.insertToBulk,
          fromClientAddress: cfg.fromClientAddress,
          dropOffLocationId: cfg.dropOffLocationId,
          amount: cfg.amount,
          amountPercentage: cfg.amountPercentage,
          applyDiscount: cfg.applyDiscount,
          applyAddOnPercentage: cfg.applyAddOnPercentage,
        };
      });

    // Map delivery zone IDs
    const zones = deliveryConfig
      ? deliveryConfig.deliveryZoneIds.map(zoneId => ({ zoneId }))
      : [];

    const row: BulkRunScheduleCreateRequest = {
      name: schedule.name,
      description: schedule.description,
      dayOfWeek: DAY_TO_NUMBER[day.value],
      startTime: dayConfig.startTime,
      endTime: dayConfig.endTime,
      maxJobs: 10000,
      region: schedule.region,
      speedId: deliveryConfig?.speedId ?? schedule.speedId,
      parentSpeedId: linehaulConfig?.speedId ?? schedule.parentSpeedId,
      pickupRatingSpeed: collectionConfig?.speedId ?? schedule.pickupRatingSpeed,
      cutoffHours: schedule.cutoffHours,
      autoBook: schedule.autoBook,
      bookPickup: schedule.bookPickup,
      pickupDepotId: schedule.pickupDepotId,
      postcodeGroupId: schedule.postcodeGroupId,
      pickupPostcodeGroupId: schedule.pickupPostcodeGroupId,
      storageState: schedule.storageState,
      deliveryState: schedule.deliveryState,
      pickupBoxDiscount: schedule.pickupBoxDiscount,
      dropOffLocationId: schedule.dropOffLocationId,
      applyPickupCutoff: schedule.applyPickupCutoff,
      pickupCutoff: schedule.pickupCutoff,
      // Routed Operations: the one-to-one ClientId column is never written by the new view.
      // Client references live only in the schedule/client link table (see utils/clientLinks, api/v2).
      clientId: undefined,
      zones,
      linehauls: linehauls.length > 0 ? linehauls : undefined,
    };

    return row;
  });
}

/**
 * Convert production per-day rows (grouped by Name) into a UI Schedule.
 */
export function perDayToMultiDay(
  rows: BulkRunScheduleRow[],
  linehauls: BulkScheduleLinehaulRow[] = [],
  zones: BulkZoneScheduleRow[] = [],
): Schedule {
  if (rows.length === 0) {
    throw new Error('Cannot convert empty row set to Schedule');
  }

  // Use first row as canonical source for shared fields
  const first = rows[0];

  // Build operating schedule from rows
  const days: Record<DayOfWeek, DaySchedule> = {
    mon: { enabled: false, startTime: '09:00', endTime: '17:00' },
    tue: { enabled: false, startTime: '09:00', endTime: '17:00' },
    wed: { enabled: false, startTime: '09:00', endTime: '17:00' },
    thu: { enabled: false, startTime: '09:00', endTime: '17:00' },
    fri: { enabled: false, startTime: '09:00', endTime: '17:00' },
    sat: { enabled: false, startTime: '09:00', endTime: '17:00' },
    sun: { enabled: false, startTime: '09:00', endTime: '17:00' },
  };

  const rowIds: number[] = [];
  for (const row of rows) {
    const dayKey = NUMBER_TO_DAY[row.dayOfWeek];
    if (dayKey) {
      days[dayKey] = {
        enabled: true,
        startTime: row.startTime,
        endTime: row.endTime,
      };
    }
    rowIds.push(row.bulkRunScheduleId);
  }

  // Check if all enabled days have same times
  const enabledDayConfigs = Object.values(days).filter(d => d.enabled);
  const uniformWeekdays = enabledDayConfigs.length <= 1 || enabledDayConfigs.every(
    d => d.startTime === enabledDayConfigs[0].startTime && d.endTime === enabledDayConfigs[0].endTime
  );

  // Build legs from production data
  const legs: ScheduleLeg[] = [];
  let legOrder = 0;
  const hasValue = (value: unknown): boolean => value !== undefined && value !== null;

  // Collection leg (if bookPickup is set)
  if (first.bookPickup) {
    const pickupZoneIds = zones
      .filter(z => z.bulkRunScheduleId === first.bulkRunScheduleId)
      .map(z => z.zoneId);

    legs.push({
      id: -(legOrder + 1), // negative = synthetic
      order: legOrder++,
      config: {
        type: 'collection',
        speedId: first.pickupRatingSpeed,
        additionalItemChargingLogic: first.pickupBoxDiscount ? 'speed_second_box_discount' : 'none',
        pickupZoneIds: first.pickupPostcodeGroupId ? [first.pickupPostcodeGroupId] : pickupZoneIds,
        pickupTimeMode: 'window',
        pickupWindowStart: '14:00',
        pickupWindowEnd: '15:00',
        bookFromClientAddress: false,
        createPickupJob: true,
        pickupSource: "client_address",
      },
    });
  }

  // Linehaul legs (from first row's linehauls)
  const firstRowLinehauls = linehauls.filter(lh => lh.bulkRunScheduleId === first.bulkRunScheduleId);
  for (const lh of firstRowLinehauls) {
    legs.push({
      id: lh.bulkScheduleLinehaulId,
      order: legOrder++,
      config: {
        type: 'linehaul',
        speedId: first.parentSpeedId,
        additionalItemChargingLogic: lh.applyDiscount
          ? 'speed_second_box_discount'
          : lh.applyAddOnPercentage
            ? 'client_speed_addon_percentage'
            : lh.amount || lh.amountPercentage
              ? 'rate_special_additional_charge'
              : 'none',
        runId: lh.linehaulRunId,
        fromDepotId: lh.fromDepotId,
        toDepotId: lh.toDepotId,
        dayOffset: lh.departureAdvanceDays,
        activeDays: decodeWeekDayToDays(lh.weekDay),
        transitMinutes: lh.minutes,
        insertToBulk: lh.insertToBulk,
        fromClientAddress: lh.fromClientAddress,
        dropOffLocationId: lh.dropOffLocationId,
        amount: lh.amount,
        amountPercentage: lh.amountPercentage,
        applyDiscount: lh.applyDiscount,
        applyAddOnPercentage: lh.applyAddOnPercentage,
      },
    });
  }

  const hasDeliveryData = hasValue(first.speedId)
    || hasValue(first.postcodeGroupId)
    || hasValue(first.deliveryState);

  // Depot leg: visual surface for existing depot storage/dropoff fields when no delivery leg exists.
  if (!hasDeliveryData && firstRowLinehauls.length === 0) {
    legs.push({
      id: -(legOrder + 1),
      order: legOrder++,
      config: {
        type: 'depot',
        depotId: first.pickupDepotId ?? first.region,
        dropoffLocationId: first.dropOffLocationId,
        storageState: first.storageState as unknown as TemperatureState,
      },
    });
  }

  // Delivery leg (only when production data contains a real delivery component)
  const deliveryZoneIds = first.postcodeGroupId ? [first.postcodeGroupId] : [];
  if (hasDeliveryData) {
    legs.push({
      id: -(legOrder + 1),
      order: legOrder++,
      config: {
        type: 'delivery',
        speedId: first.speedId,
        additionalItemChargingLogic: first.pickupBoxDiscount ? 'speed_second_box_discount' : 'none',
        deliveryZoneIds,
        deliveryState: first.deliveryState as unknown as TemperatureState,
      },
    });
  }

  return {
    id: first.bulkRunScheduleId,
    rowIds,
    name: first.name,
    description: first.description,
    clientId: first.clientId ?? null,
    bookingMode: 'window', // frontend-only default
    speedId: first.speedId,
    pickupRatingSpeed: first.pickupRatingSpeed,
    parentSpeedId: first.parentSpeedId,
    originType: first.pickupDepotId ? 'depot' : 'client_address',
    pickupDepotId: first.pickupDepotId,
    region: first.region,
    cutoffHours: first.cutoffHours,
    autoBook: first.autoBook,
    bookPickup: first.bookPickup,
    postcodeGroupId: first.postcodeGroupId,
    pickupPostcodeGroupId: first.pickupPostcodeGroupId,
    storageState: first.storageState,
    deliveryState: first.deliveryState,
    pickupBoxDiscount: first.pickupBoxDiscount,
    dropOffLocationId: first.dropOffLocationId,
    applyPickupCutoff: first.applyPickupCutoff,
    pickupCutoff: first.pickupCutoff,
    legs,
    operatingSchedule: {
      uniformWeekdays,
      days,
      cutoffValue: first.cutoffHours,
      cutoffUnit: 'hours',
    },
    deliveryWindow: createDefaultDeliveryWindow(),
    isActive: first.autoBook ?? true,
    isOverride: first.clientId != null,
    baseScheduleName: first.clientId != null ? first.name : undefined,
    connections: createEmptyConnections(),
  };
}

/**
 * Group flat production rows by Name into schedule sets.
 */
export function groupRowsByName(rows: BulkRunScheduleRow[]): Map<string, BulkRunScheduleRow[]> {
  const map = new Map<string, BulkRunScheduleRow[]>();
  for (const row of rows) {
    const existing = map.get(row.name) ?? [];
    existing.push(row);
    map.set(row.name, existing);
  }
  return map;
}

// ============================================
// SCHEDULE GROUP (frontend-only — no production equivalent)
// ============================================

export interface ScheduleGroup {
  id: number;
  name: string;
  description?: string;
  scheduleIds: number[];
  isActive: boolean;
  connections: EntityConnections;
  createdAt?: string;
  updatedAt?: string;
}

// ============================================
// FILTER STATE
// ============================================

export interface ScheduleFilterState {
  search: string;
  status: 'all' | 'active' | 'inactive';
  type: 'all' | 'base' | 'override' | 'default' | 'shared';
  clientId: number | 'all';
  originDepotId: number | 'all';
  destinationDepotId: number | 'all';
}

// ============================================
// SORT CONFIGURATION
// ============================================

export type SortDirection = 'asc' | 'desc';

export type SortableColumn =
  | 'name'
  | 'originDepot'
  | 'destDepot'
  | 'speedDisplay'
  | 'bookingMode'
  | 'clientDisplay'
  | 'status';

export interface SortConfig {
  column: SortableColumn;
  direction: SortDirection;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

export function getBookingModeLabel(mode: BookingMode): string {
  const found = BOOKING_MODES.find(m => m.value === mode);
  return found?.label ?? mode;
}

export function getDayLabel(day: DayOfWeek, short = false): string {
  const found = DAYS_OF_WEEK.find(d => d.value === day);
  return short ? (found?.short ?? day) : (found?.label ?? day);
}

export function getTemperatureLabel(state?: TemperatureState): string {
  if (!state) return '—';
  const found = TEMPERATURE_STATES.find(t => t.value === state);
  return found?.label ?? state;
}

export function getLegTypeLabel(type: LegType): string {
  const labels: Record<LegType, string> = {
    collection: 'Collection',
    depot: 'Depot Stop',
    linehaul: 'Linehaul',
    delivery: 'Delivery',
  };
  return labels[type] ?? type;
}

export function countLegs(schedule: Schedule): number {
  return schedule.legs.length;
}

export function getRouteDescription(schedule: Schedule, depots: DepotReference[]): string {
  const parts: string[] = [];

  if (schedule.originType === 'booking') {
    parts.push('Booking');
  } else if (schedule.originType === 'client_address') {
    parts.push('Customer');
  } else if (schedule.pickupDepotId) {
    const depot = depots.find(d => d.id === schedule.pickupDepotId);
    parts.push(depot?.code ?? depot?.name ?? 'Depot');
  }

  schedule.legs.forEach(({ config }) => {
    if (config.type === 'collection') {
      parts.push('Collection');
    } else if (config.type === 'depot') {
      const depot = depots.find(d => d.id === config.depotId);
      parts.push(depot?.code ?? depot?.name ?? 'Depot');
    } else if (config.type === 'linehaul') {
      parts.push('Linehaul');
    } else if (config.type === 'delivery') {
      parts.push('Delivery');
    }
  });

  return parts.length > 0 ? parts.join(' → ') : 'No route';
}

export function getActiveDaysSummary(schedule: OperatingSchedule): string {
  const activeDays = DAYS_OF_WEEK.filter(d => schedule.days[d.value].enabled);

  if (activeDays.length === 7) return 'Every day';
  if (activeDays.length === 0) return 'No days';

  const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri'] as DayOfWeek[];
  const weekend = ['sat', 'sun'] as DayOfWeek[];

  const hasAllWeekdays = weekdays.every(d => schedule.days[d].enabled);
  const hasNoWeekend = weekend.every(d => !schedule.days[d].enabled);

  if (hasAllWeekdays && hasNoWeekend) return 'Mon–Fri';

  return activeDays.map(d => d.short).join(', ');
}

export function createDefaultOperatingSchedule(): OperatingSchedule {
  const defaultDay: DaySchedule = { enabled: true, startTime: '09:00', endTime: '17:00' };
  const weekendDay: DaySchedule = { enabled: false, startTime: '09:00', endTime: '17:00' };

  return {
    uniformWeekdays: true,
    days: {
      mon: { ...defaultDay },
      tue: { ...defaultDay },
      wed: { ...defaultDay },
      thu: { ...defaultDay },
      fri: { ...defaultDay },
      sat: { ...weekendDay },
      sun: { ...weekendDay },
    },
    cutoffValue: 2,
    cutoffUnit: 'hours',
  };
}

export function createDefaultDeliveryWindow(): DeliveryWindowConfig {
  return {
    mode: 'automatic',
    rules: [
      {
        id: 1,
        condition: { arrivalBefore: '10:00' },
        result: { deliverSameDay: true, windowStart: '12:00', windowEnd: '17:00' },
      },
      {
        id: 2,
        condition: { arrivalBefore: '23:59' },
        result: { deliverSameDay: false, windowStart: '08:00', windowEnd: '12:00' },
      },
    ],
    fixedDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    fixedWindowStart: '08:00',
    fixedWindowEnd: '17:00',
    fixedTransitDays: 1,
  };
}

export function createEmptySchedule(): Omit<Schedule, 'id' | 'rowIds'> {
  return {
    name: '',
    description: '',
    clientId: null,
    visibility: 'specific',
    clientIds: [],
    baseScheduleId: null,
    bookingMode: 'window',
    speedId: undefined,
    pickupRatingSpeed: undefined,
    parentSpeedId: undefined,
    originType: 'unselected',
    pickupDepotId: undefined,
    additionalItemChargingLogic: 'none',
    region: 0,
    cutoffHours: 2,
    autoBook: false,
    bookPickup: false,
    legs: [],
    operatingSchedule: createDefaultOperatingSchedule(),
    deliveryWindow: createDefaultDeliveryWindow(),
    isActive: true,
    isOverride: false,
    connections: createEmptyConnections(),
  };
}

export function createEmptyScheduleGroup(): Omit<ScheduleGroup, 'id'> {
  return {
    name: '',
    description: '',
    scheduleIds: [],
    isActive: true,
    connections: createEmptyConnections(),
  };
}

// ============================================
// OVERRIDE SYSTEM HELPERS
// ============================================

export const OVERRIDABLE_FIELDS: { field: string; label: string; category: string }[] = [
  { field: 'operatingSchedule.cutoffValue', label: 'Booking Cutoff', category: 'Timing' },
  { field: 'operatingSchedule.days', label: 'Operating Days', category: 'Timing' },
  { field: 'speedId', label: 'Delivery Speed', category: 'Speeds' },
  { field: 'pickupRatingSpeed', label: 'Pickup Speed', category: 'Speeds' },
  { field: 'parentSpeedId', label: 'Linehaul Speed', category: 'Speeds' },
  { field: 'postcodeGroupId', label: 'Delivery Zone Group', category: 'Zones' },
  { field: 'pickupPostcodeGroupId', label: 'Pickup Zone Group', category: 'Zones' },
];

export const NON_OVERRIDABLE_FIELDS = [
  'legs',
  'originType',
  'pickupDepotId',
  'region',
  'deliveryWindow.mode',
];

export function isFieldOverridable(field: string): boolean {
  return !NON_OVERRIDABLE_FIELDS.some(nof => field.startsWith(nof));
}

// ============================================
// TABLE VIEW TYPES
// ============================================

export interface ScheduleTableRow {
  id: number;
  name: string;
  route: string;
  legCount: number;
  bookingMode: BookingMode;
  clientDisplay: string;
  status: 'active' | 'inactive';
  isOverride: boolean;
  baseScheduleName?: string;
  overrideCount: number;
  depth: number;
  schedule: Schedule;
  originDepot: string;
  destDepot: string;
  hasLinehaul: boolean;
  speedDisplay: string;
  /** id-keyed client links */
  visibility: 'all' | 'specific';
  clientIds: number[];
  baseScheduleId: number | null;
}

export function scheduleToTableRow(
  schedule: Schedule,
  depots: DepotReference[],
  clients: ClientReference[],
  speeds: SpeedReference[],
  overrideCount: number = 0,
): ScheduleTableRow {
  // Clients column: 'All' for a default schedule, otherwise the linked client codes (link rows).
  let clientDisplay = 'All';
  if (getVisibility(schedule) === 'specific') {
    const codes = getClientIds(schedule).map((id) => {
      const client = clients.find((c) => c.id === id);
      return client?.shortName || client?.name || String(id);
    });
    clientDisplay = codes.length ? codes.join(', ') : 'No clients';
  }

  let originDepot = '—';
  if (schedule.pickupDepotId) {
    const depot = depots.find(d => d.id === schedule.pickupDepotId);
    originDepot = depot?.code || depot?.name || String(schedule.pickupDepotId);
  } else if (schedule.originType === 'client_address') {
    originDepot = 'Customer';
  } else if (schedule.originType === 'booking') {
    originDepot = 'Booking';
  }

  let destDepot = '—';
  if (schedule.region) {
    const depot = depots.find(d => d.id === schedule.region);
    destDepot = depot?.code || depot?.name || String(schedule.region);
  }

  const hasLinehaul = schedule.legs.some(l => l.config.type === 'linehaul');

  let speedDisplay = '—';
  if (schedule.speedId) {
    const speed = speeds.find(s => s.id === schedule.speedId);
    speedDisplay = speed?.code || speed?.name || '—';
  }

  return {
    id: schedule.id,
    name: schedule.name,
    route: getRouteDescription(schedule, depots),
    legCount: schedule.legs.length,
    bookingMode: schedule.bookingMode,
    clientDisplay,
    status: schedule.isActive ? 'active' : 'inactive',
    isOverride: schedule.isOverride,
    visibility: getVisibility(schedule),
    clientIds: getClientIds(schedule),
    baseScheduleId: schedule.baseScheduleId ?? null,
    baseScheduleName: schedule.baseScheduleName,
    overrideCount,
    depth: schedule.isOverride ? 1 : 0,
    schedule,
    originDepot,
    destDepot,
    hasLinehaul,
    speedDisplay,
  };
}

/** An override belongs to a base by ScheduleId; name matching is the legacy fallback. */
export function isOverrideOf(override: Schedule, base: Schedule): boolean {
  if (override.baseScheduleId != null) return override.baseScheduleId === base.id;
  return override.baseScheduleName === base.name;
}

/** Link rows of a schedule (legacy clientId folded in). */
export function getClientIds(schedule: Schedule): number[] {
  if (schedule.clientIds && schedule.clientIds.length) return schedule.clientIds;
  return schedule.clientId != null ? [schedule.clientId] : [];
}

/** 'all' = default schedule available to every client with nothing of its own. */
export function getVisibility(schedule: Schedule): 'all' | 'specific' {
  if (schedule.visibility) return schedule.visibility;
  return getClientIds(schedule).length || schedule.isOverride ? 'specific' : 'all';
}

export function buildScheduleTableData(
  schedules: Schedule[],
  depots: DepotReference[],
  clients: ClientReference[],
  speeds: SpeedReference[],
): ScheduleTableRow[] {
  const rows: ScheduleTableRow[] = [];
  const baseSchedules = schedules.filter(s => !s.isOverride);
  const overrides = schedules.filter(s => s.isOverride);

  baseSchedules.forEach(base => {
    const childOverrides = overrides.filter(o => isOverrideOf(o, base));
    rows.push(scheduleToTableRow(base, depots, clients, speeds, childOverrides.length));
    childOverrides.forEach(override => {
      rows.push(scheduleToTableRow(override, depots, clients, speeds, 0));
    });
  });

  return rows;
}

// ============================================
// BULK OPERATION TYPES (frontend-only)
// ============================================

export type BulkEditMode = 'absolute' | 'relative';

export type BulkEditFieldType =
  | 'cutoffValue'
  | 'cutoffUnit'
  | 'pickupTimeMode'
  | 'departureTime'
  | 'deliveryWindowStart'
  | 'deliveryWindowEnd'
  | 'operatingDays';

export interface BulkEditField {
  field: BulkEditFieldType;
  label: string;
  mode: BulkEditMode;
  value: string | number;
  unit?: TimeUnit;
}

export type WarningLevel = 'ok' | 'caution' | 'conflict';

export interface BulkEditPreviewRow {
  scheduleId: number;
  scheduleName: string;
  included: boolean;
  beforeValue: string;
  afterValue: string;
  warningLevel: WarningLevel;
  warningMessage?: string;
}

export interface BulkEditState {
  fields: BulkEditField[];
  previews: BulkEditPreviewRow[];
}

export const BULK_EDITABLE_FIELDS: { field: BulkEditFieldType; label: string; supportsRelative: boolean }[] = [
  { field: 'cutoffValue', label: 'Booking Cutoff', supportsRelative: true },
  { field: 'pickupTimeMode', label: 'Pickup Time Mode', supportsRelative: false },
  { field: 'departureTime', label: 'Departure Time', supportsRelative: true },
  { field: 'deliveryWindowStart', label: 'Delivery Window Start', supportsRelative: true },
  { field: 'deliveryWindowEnd', label: 'Delivery Window End', supportsRelative: true },
  { field: 'operatingDays', label: 'Operating Days', supportsRelative: false },
];
