// src/modules/schedules/data/sampleData.ts
// Sample data for Schedules module development — aligned with production schema

import type {
  Schedule,
  ScheduleGroup,
  DepotReference,
  ZoneReference,
  SpeedReference,
  LinehaulRunReference,
  ClientReference,
  DropoffLocation,
  RateCardReference,
  BulkRunScheduleRow,
} from '../types';
import { createEmptyConnections } from '../../territory/types';
import { createDefaultDeliveryWindow } from '../types';

// ============================================
// REFERENCE DATA (numeric IDs matching production)
// ============================================

export const sampleDepots: DepotReference[] = [
  { id: 1, name: 'Denver Main Depot', code: 'DEN' },
  { id: 2, name: 'Albuquerque Depot', code: 'ABQ' },
  { id: 3, name: 'Phoenix Hub', code: 'PHX' },
  { id: 4, name: 'Salt Lake City Depot', code: 'SLC' },
  { id: 5, name: 'Las Vegas Depot', code: 'LAS' },
];

export const sampleDropoffLocations: DropoffLocation[] = [
  { id: 101, depotId: 1, name: 'Bay 1 - Standard', qrCode: 'DEN-BAY1' },
  { id: 102, depotId: 1, name: 'Bay 2 - Chilled', qrCode: 'DEN-BAY2' },
  { id: 103, depotId: 1, name: 'Bay 3 - Frozen', qrCode: 'DEN-BAY3' },
  { id: 201, depotId: 2, name: 'Loading Dock A', qrCode: 'ABQ-DOCKA' },
  { id: 202, depotId: 2, name: 'Loading Dock B', qrCode: 'ABQ-DOCKB' },
];

export const sampleZones: ZoneReference[] = [
  { id: 1, name: 'DEN Inner City', code: '1', postcodeCount: 45 },
  { id: 2, name: 'DEN Metro', code: '2', postcodeCount: 120 },
  { id: 3, name: 'DEN Suburban', code: '3', postcodeCount: 85 },
  { id: 4, name: 'ABQ Central', code: '4', postcodeCount: 35 },
  { id: 5, name: 'ABQ Metro', code: '5', postcodeCount: 60 },
  { id: 6, name: 'PHX Central', code: '6', postcodeCount: 55 },
  { id: 7, name: 'Rural North', code: '7', postcodeCount: 200 },
  { id: 8, name: 'Rural South', code: '8', postcodeCount: 180 },
  { id: 9, name: 'Interstate Corridor', code: '9', postcodeCount: 40 },
  { id: 10, name: 'Remote Areas', code: '10', postcodeCount: 300 },
];

export const sampleSpeeds: SpeedReference[] = [
  { id: 1, name: 'Same Day', code: 'SD' },
  { id: 2, name: 'Next Day', code: 'ND' },
  { id: 3, name: 'Overnight', code: 'ON' },
  { id: 4, name: 'Economy', code: 'EC' },
  { id: 5, name: 'Express', code: 'EX' },
  { id: 6, name: 'Standard', code: 'ST' },
];

export const sampleLinehaulRuns: LinehaulRunReference[] = [
  {
    id: 1,
    name: 'DEN-ABQ Nightline',
    originDepotId: 1,
    destinationDepotId: 2,
    departureTime: '19:00',
    transitDuration: 10,
    transitUnit: 'hours',
    activeDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  },
  {
    id: 2,
    name: 'DEN-PHX Dayline',
    originDepotId: 1,
    destinationDepotId: 3,
    departureTime: '06:00',
    transitDuration: 12,
    transitUnit: 'hours',
    activeDays: ['mon', 'wed', 'fri'],
  },
  {
    id: 3,
    name: 'PHX-ABQ Shuttle',
    originDepotId: 3,
    destinationDepotId: 2,
    departureTime: '14:00',
    transitDuration: 6,
    transitUnit: 'hours',
    activeDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
  },
];

export const sampleClients: ClientReference[] = [
  { id: 1001, name: 'Acme Corporation', shortName: 'ACME' },
  { id: 1002, name: 'Globex Industries', shortName: 'GLOBEX' },
  { id: 1003, name: 'Initech', shortName: 'INITECH' },
  { id: 1004, name: 'Umbrella Corp', shortName: 'UMBRELLA' },
  { id: 1005, name: 'MedLab Central', shortName: 'MLC' },
  { id: 1006, name: 'Pathway Diagnostics', shortName: 'PATH' },
  { id: 1007, name: 'Northern Pharmacy Group', shortName: 'NPG' },
  { id: 1008, name: 'Harbour Radiology', shortName: 'HRAD' },
  { id: 1009, name: 'Rangitoto Clinics', shortName: 'RGT' },
  { id: 1010, name: 'Harvest Fresh', shortName: 'HFAK' },
];

export const sampleRateCards: RateCardReference[] = [
  { id: 1, name: 'Standard Rates 2024' },
  { id: 2, name: 'Express Premium' },
  { id: 3, name: 'Economy Rates' },
  { id: 4, name: 'ACME Negotiated' },
];

// ============================================
// SAMPLE PRODUCTION ROWS (tblBulkRunSchedule)
// These show what the API actually returns.
// ============================================

export const sampleProductionRows: BulkRunScheduleRow[] = [
  // "1-Hour Local Delivery" — 6 rows (Mon-Sat)
  { bulkRunScheduleId: 1, name: '1-Hour Local Delivery', dayOfWeek: 1, startTime: '09:00', endTime: '18:00', maxJobs: 10000, region: 1, speedId: 1, cutoffHours: 0, autoBook: true, bookPickup: false, postcodeGroupId: 1, clientId: undefined },
  { bulkRunScheduleId: 2, name: '1-Hour Local Delivery', dayOfWeek: 2, startTime: '09:00', endTime: '18:00', maxJobs: 10000, region: 1, speedId: 1, cutoffHours: 0, autoBook: true, bookPickup: false, postcodeGroupId: 1, clientId: undefined },
  { bulkRunScheduleId: 3, name: '1-Hour Local Delivery', dayOfWeek: 3, startTime: '09:00', endTime: '18:00', maxJobs: 10000, region: 1, speedId: 1, cutoffHours: 0, autoBook: true, bookPickup: false, postcodeGroupId: 1, clientId: undefined },
  { bulkRunScheduleId: 4, name: '1-Hour Local Delivery', dayOfWeek: 4, startTime: '09:00', endTime: '18:00', maxJobs: 10000, region: 1, speedId: 1, cutoffHours: 0, autoBook: true, bookPickup: false, postcodeGroupId: 1, clientId: undefined },
  { bulkRunScheduleId: 5, name: '1-Hour Local Delivery', dayOfWeek: 5, startTime: '09:00', endTime: '18:00', maxJobs: 10000, region: 1, speedId: 1, cutoffHours: 0, autoBook: true, bookPickup: false, postcodeGroupId: 1, clientId: undefined },
  { bulkRunScheduleId: 6, name: '1-Hour Local Delivery', dayOfWeek: 6, startTime: '10:00', endTime: '16:00', maxJobs: 10000, region: 1, speedId: 1, cutoffHours: 0, autoBook: true, bookPickup: false, postcodeGroupId: 1, clientId: undefined },
  // "Next Day Standard" — 5 rows (Mon-Fri)
  { bulkRunScheduleId: 10, name: 'Next Day Standard', dayOfWeek: 1, startTime: '08:00', endTime: '17:00', maxJobs: 10000, region: 1, speedId: 2, pickupRatingSpeed: 6, cutoffHours: 1, autoBook: true, bookPickup: true, pickupDepotId: 1, postcodeGroupId: 2, pickupPostcodeGroupId: 2, clientId: undefined },
  { bulkRunScheduleId: 11, name: 'Next Day Standard', dayOfWeek: 2, startTime: '08:00', endTime: '17:00', maxJobs: 10000, region: 1, speedId: 2, pickupRatingSpeed: 6, cutoffHours: 1, autoBook: true, bookPickup: true, pickupDepotId: 1, postcodeGroupId: 2, pickupPostcodeGroupId: 2, clientId: undefined },
  { bulkRunScheduleId: 12, name: 'Next Day Standard', dayOfWeek: 3, startTime: '08:00', endTime: '17:00', maxJobs: 10000, region: 1, speedId: 2, pickupRatingSpeed: 6, cutoffHours: 1, autoBook: true, bookPickup: true, pickupDepotId: 1, postcodeGroupId: 2, pickupPostcodeGroupId: 2, clientId: undefined },
  { bulkRunScheduleId: 13, name: 'Next Day Standard', dayOfWeek: 4, startTime: '08:00', endTime: '17:00', maxJobs: 10000, region: 1, speedId: 2, pickupRatingSpeed: 6, cutoffHours: 1, autoBook: true, bookPickup: true, pickupDepotId: 1, postcodeGroupId: 2, pickupPostcodeGroupId: 2, clientId: undefined },
  { bulkRunScheduleId: 14, name: 'Next Day Standard', dayOfWeek: 5, startTime: '08:00', endTime: '17:00', maxJobs: 10000, region: 1, speedId: 2, pickupRatingSpeed: 6, cutoffHours: 1, autoBook: true, bookPickup: true, pickupDepotId: 1, postcodeGroupId: 2, pickupPostcodeGroupId: 2, clientId: undefined },
];

// ============================================
// SAMPLE SCHEDULES (UI abstraction — mapped from production rows)
// ============================================

export const sampleSchedules: Schedule[] = [
  // SIMPLE: Direct delivery
  {
    id: 1,
    rowIds: [1, 2, 3, 4, 5, 6],
    name: '1-Hour Local Delivery',
    description: 'Same-day 1-hour delivery for local retailers',
    clientId: null,
    bookingMode: 'window',
    speedId: 1,
    pickupRatingSpeed: undefined,
    parentSpeedId: undefined,
    originType: 'client_address',
    pickupDepotId: undefined,
    region: 1,
    cutoffHours: 0,
    autoBook: true,
    bookPickup: false,
    postcodeGroupId: 1,
    legs: [
      {
        id: -1,
        order: 0,
        config: {
          type: 'delivery',
          speedId: 1,
          deliveryZoneIds: [1, 2],
          deliveryState: 'ambient',
        },
      },
    ],
    operatingSchedule: {
      uniformWeekdays: false,
      days: {
        mon: { enabled: true, startTime: '09:00', endTime: '18:00' },
        tue: { enabled: true, startTime: '09:00', endTime: '18:00' },
        wed: { enabled: true, startTime: '09:00', endTime: '18:00' },
        thu: { enabled: true, startTime: '09:00', endTime: '18:00' },
        fri: { enabled: true, startTime: '09:00', endTime: '18:00' },
        sat: { enabled: true, startTime: '10:00', endTime: '16:00' },
        sun: { enabled: false, startTime: '09:00', endTime: '17:00' },
      },
      cutoffValue: 0,
      cutoffUnit: 'hours',
    },
    deliveryWindow: createDefaultDeliveryWindow(),
    isActive: true,
    isOverride: false,
    connections: {
      ...createEmptyConnections(),
      customers: { hasConnections: true, count: 24 },
      services: { hasConnections: true, count: 2 },
    },
  },

  // MEDIUM: Collection + Delivery
  {
    id: 10,
    rowIds: [10, 11, 12, 13, 14],
    name: 'Next Day Standard',
    description: 'Collection in afternoon, delivery next morning',
    clientId: null,
    bookingMode: 'fixed_time',
    speedId: 2,
    pickupRatingSpeed: 6,
    parentSpeedId: undefined,
    originType: 'depot',
    pickupDepotId: 1,
    region: 1,
    cutoffHours: 1,
    autoBook: true,
    bookPickup: true,
    postcodeGroupId: 2,
    pickupPostcodeGroupId: 2,
    legs: [
      {
        id: -1,
        order: 0,
        config: {
          type: 'collection',
          speedId: 6,
          pickupZoneIds: [1, 2, 3],
          pickupTimeMode: 'window',
          pickupWindowStart: '14:00',
          pickupWindowEnd: '16:00',
          bookFromClientAddress: false,
          pickupSource: 'depot',
          createPickupJob: true,
        },
      },
      {
        id: -2,
        order: 1,
        config: {
          type: 'delivery',
          speedId: 2,
          deliveryZoneIds: [1, 2, 3],
          deliveryState: 'ambient',
        },
      },
    ],
    operatingSchedule: {
      uniformWeekdays: true,
      days: {
        mon: { enabled: true, startTime: '08:00', endTime: '17:00' },
        tue: { enabled: true, startTime: '08:00', endTime: '17:00' },
        wed: { enabled: true, startTime: '08:00', endTime: '17:00' },
        thu: { enabled: true, startTime: '08:00', endTime: '17:00' },
        fri: { enabled: true, startTime: '08:00', endTime: '17:00' },
        sat: { enabled: false, startTime: '08:00', endTime: '12:00' },
        sun: { enabled: false, startTime: '08:00', endTime: '12:00' },
      },
      cutoffValue: 1,
      cutoffUnit: 'hours',
    },
    deliveryWindow: createDefaultDeliveryWindow(),
    isActive: true,
    isOverride: false,
    connections: {
      ...createEmptyConnections(),
      customers: { hasConnections: true, count: 156 },
      services: { hasConnections: true, count: 4 },
      depots: { hasConnections: true, count: 1 },
    },
  },

  // COMPLEX: Multi-depot with linehaul
  {
    id: 20,
    rowIds: [20, 21, 22, 23, 24],
    name: 'DEN → ABQ Overnight Linehaul',
    description: 'Pickup in Denver, linehaul overnight, delivery in Albuquerque next day',
    clientId: null,
    bookingMode: 'fixed_time',
    speedId: 3,
    pickupRatingSpeed: 6,
    parentSpeedId: 3,
    originType: 'depot',
    pickupDepotId: 1,
    region: 2,
    cutoffHours: 2,
    autoBook: true,
    bookPickup: true,
    postcodeGroupId: 4,
    pickupPostcodeGroupId: 1,
    dropOffLocationId: 101,
    legs: [
      {
        id: -1,
        order: 0,
        config: {
          type: 'collection',
          speedId: 6,
          pickupZoneIds: [1, 2, 3],
          pickupTimeMode: 'window',
          pickupWindowStart: '13:00',
          pickupWindowEnd: '15:00',
          bookFromClientAddress: false,
          pickupSource: 'depot',
          createPickupJob: true,
        },
      },
      {
        id: -2,
        order: 1,
        config: {
          type: 'depot',
          depotId: 1,
          dropoffLocationId: 101,
          storageState: 'ambient',
        },
      },
      {
        id: 501,
        order: 2,
        config: {
          type: 'linehaul',
          runId: 1,
          fromDepotId: 1,
          toDepotId: 2,
          dayOffset: 0,
          activeDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
          transitMinutes: 600,
          insertToBulk: true,
        },
      },
      {
        id: -3,
        order: 3,
        config: {
          type: 'delivery',
          speedId: 3,
          deliveryZoneIds: [4, 5],
          deliveryState: 'ambient',
        },
      },
    ],
    operatingSchedule: {
      uniformWeekdays: true,
      days: {
        mon: { enabled: true, startTime: '09:00', endTime: '17:00' },
        tue: { enabled: true, startTime: '09:00', endTime: '17:00' },
        wed: { enabled: true, startTime: '09:00', endTime: '17:00' },
        thu: { enabled: true, startTime: '09:00', endTime: '17:00' },
        fri: { enabled: true, startTime: '09:00', endTime: '17:00' },
        sat: { enabled: false, startTime: '09:00', endTime: '17:00' },
        sun: { enabled: false, startTime: '09:00', endTime: '17:00' },
      },
      cutoffValue: 2,
      cutoffUnit: 'hours',
    },
    deliveryWindow: createDefaultDeliveryWindow(),
    isActive: true,
    isOverride: false,
    connections: {
      ...createEmptyConnections(),
      customers: { hasConnections: true, count: 89 },
      services: { hasConnections: true, count: 3 },
      depots: { hasConnections: true, count: 2 },
      linehauls: { hasConnections: true, count: 1 },
    },
  },

  // CLIENT OVERRIDE: ACME with later cutoff
  {
    id: 30,
    rowIds: [30, 31, 32, 33, 34],
    name: 'DEN → ABQ Overnight Linehaul',
    description: 'ACME-specific override with later cutoff',
    clientId: 1001,
    bookingMode: 'fixed_time',
    speedId: 3,
    pickupRatingSpeed: 6,
    parentSpeedId: 3,
    originType: 'depot',
    pickupDepotId: 1,
    region: 2,
    cutoffHours: 1,
    autoBook: true,
    bookPickup: true,
    postcodeGroupId: 4,
    pickupPostcodeGroupId: 1,
    dropOffLocationId: 101,
    legs: [
      {
        id: -1,
        order: 0,
        config: {
          type: 'collection',
          speedId: 6,
          pickupZoneIds: [1, 2, 3],
          pickupTimeMode: 'window',
          pickupWindowStart: '14:00',
          pickupWindowEnd: '16:00',
          bookFromClientAddress: false,
          pickupSource: 'depot',
          createPickupJob: true,
        },
      },
      {
        id: -2,
        order: 1,
        config: {
          type: 'depot',
          depotId: 1,
          dropoffLocationId: 101,
          storageState: 'ambient',
        },
      },
      {
        id: 502,
        order: 2,
        config: {
          type: 'linehaul',
          runId: 1,
          fromDepotId: 1,
          toDepotId: 2,
          dayOffset: 0,
          activeDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
          transitMinutes: 600,
          insertToBulk: true,
        },
      },
      {
        id: -3,
        order: 3,
        config: {
          type: 'delivery',
          speedId: 3,
          deliveryZoneIds: [4, 5],
          deliveryState: 'ambient',
        },
      },
    ],
    operatingSchedule: {
      uniformWeekdays: true,
      days: {
        mon: { enabled: true, startTime: '09:00', endTime: '18:00' },
        tue: { enabled: true, startTime: '09:00', endTime: '18:00' },
        wed: { enabled: true, startTime: '09:00', endTime: '18:00' },
        thu: { enabled: true, startTime: '09:00', endTime: '18:00' },
        fri: { enabled: true, startTime: '09:00', endTime: '18:00' },
        sat: { enabled: false, startTime: '09:00', endTime: '17:00' },
        sun: { enabled: false, startTime: '09:00', endTime: '17:00' },
      },
      cutoffValue: 1,
      cutoffUnit: 'hours',
    },
    deliveryWindow: createDefaultDeliveryWindow(),
    isActive: true,
    isOverride: true,
    baseScheduleName: 'DEN → ABQ Overnight Linehaul',
    connections: {
      ...createEmptyConnections(),
      customers: { hasConnections: true, count: 1 },
      services: { hasConnections: true, count: 3 },
      depots: { hasConnections: true, count: 2 },
      linehauls: { hasConnections: true, count: 1 },
    },
  },

  // Express Same Day
  {
    id: 40,
    rowIds: [40, 41, 42, 43, 44, 45, 46],
    name: 'Express Same Day',
    description: 'Premium same-day delivery service',
    clientId: null,
    bookingMode: 'window',
    speedId: 5,
    pickupRatingSpeed: 5,
    parentSpeedId: undefined,
    originType: 'client_address',
    pickupDepotId: undefined,
    region: 1,
    cutoffHours: 0,
    autoBook: true,
    bookPickup: false,
    postcodeGroupId: 1,
    legs: [
      {
        id: -1,
        order: 0,
        config: {
          type: 'delivery',
          speedId: 5,
          deliveryZoneIds: [1],
          deliveryState: 'ambient',
        },
      },
    ],
    operatingSchedule: {
      uniformWeekdays: false,
      days: {
        mon: { enabled: true, startTime: '07:00', endTime: '20:00' },
        tue: { enabled: true, startTime: '07:00', endTime: '20:00' },
        wed: { enabled: true, startTime: '07:00', endTime: '20:00' },
        thu: { enabled: true, startTime: '07:00', endTime: '20:00' },
        fri: { enabled: true, startTime: '07:00', endTime: '20:00' },
        sat: { enabled: true, startTime: '08:00', endTime: '18:00' },
        sun: { enabled: true, startTime: '10:00', endTime: '16:00' },
      },
      cutoffValue: 0,
      cutoffUnit: 'hours',
    },
    deliveryWindow: createDefaultDeliveryWindow(),
    isActive: true,
    isOverride: false,
    connections: {
      ...createEmptyConnections(),
      customers: { hasConnections: true, count: 2 },
      services: { hasConnections: true, count: 1 },
    },
  },
];

// ============================================
// SAMPLE SCHEDULE GROUPS (frontend-only)
// ============================================

export const sampleScheduleGroups: ScheduleGroup[] = [
  {
    id: 1,
    name: 'Denver Metro Services',
    description: 'All schedules servicing Denver metropolitan area',
    scheduleIds: [1, 10, 40],
    isActive: true,
    connections: {
      ...createEmptyConnections(),
      services: { hasConnections: true, count: 3 },
      depots: { hasConnections: true, count: 1 },
    },
  },
  {
    id: 2,
    name: 'Interstate Linehaul',
    description: 'Long-haul schedules between major depots',
    scheduleIds: [20, 30],
    isActive: true,
    connections: {
      ...createEmptyConnections(),
      services: { hasConnections: true, count: 2 },
      depots: { hasConnections: true, count: 2 },
      linehauls: { hasConnections: true, count: 1 },
    },
  },
];

// ============================================
// FILTER OPTIONS
// ============================================

export const scheduleFilterOptions = {
  status: [
    { value: 'all', label: 'All Status' },
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
  ],
  type: [
    { value: 'all', label: 'All Types' },
    { value: 'base', label: 'Base Schedules' },
    { value: 'override', label: 'Client Overrides' },
  ],
  bookingMode: [
    { value: 'all', label: 'All Modes' },
    { value: 'fixed_time', label: 'Fixed Time' },
    { value: 'window', label: 'Window' },
  ],
};

// ============================================
// ROUTED OPERATIONS: id-keyed client links on the sample schedules
// (tblBulkRunScheduleHeader.IsDefault + tblBulkRunScheduleClient link rows + BaseScheduleId)
// ============================================
const sampleLinks: Record<number, { visibility: 'all' | 'specific'; clientIds: number[]; baseScheduleId?: number }> = {
  1: { visibility: 'all', clientIds: [] },                                   // 1-Hour Local Delivery: default
  10: { visibility: 'specific', clientIds: [1001, 1002, 1003, 1005, 1006] }, // Next Day Standard: shared by 5 clients
  20: { visibility: 'specific', clientIds: [1002, 1003, 1005, 1006, 1007, 1008] }, // DEN → ABQ Overnight Linehaul: shared
  30: { visibility: 'specific', clientIds: [1001], baseScheduleId: 20 },     // ACME's override of #20
  40: { visibility: 'specific', clientIds: [1004, 1010] },                   // Express Same Day: 2 clients
};
for (const s of sampleSchedules) {
  const link = sampleLinks[s.id];
  if (!link) continue;
  s.visibility = link.visibility;
  s.clientIds = link.clientIds;
  s.clientId = link.clientIds[0] ?? null;
  if (link.baseScheduleId != null) s.baseScheduleId = link.baseScheduleId;
}

