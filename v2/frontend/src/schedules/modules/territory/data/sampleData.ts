import type { ZipZone, ZoneGroup, Depot, DropOffLocation, FilterDefinition, EntityConnections } from '../types';

// ============================================
// ZIP ZONES DATA (updated to match production schema)
// ============================================

export const zipZonesData: ZipZone[] = [
  // Manhattan Central (1A) - ZoneName ID 1
  { id: 1, zip: '10001', zoneNumber: 1, zoneNameId: 1, zoneName: 'Manhattan Central', clientId: 101, applyCongestion: true },
  { id: 2, zip: '10002', zoneNumber: 1, zoneNameId: 1, zoneName: 'Manhattan Central', clientId: 101, applyCongestion: true },
  { id: 3, zip: '10003', zoneNumber: 1, zoneNameId: 1, zoneName: 'Manhattan Central', clientId: 102, applyCongestion: false },
  { id: 4, zip: '10004', zoneNumber: 1, zoneNameId: 1, zoneName: 'Manhattan Central', clientId: 102, applyCongestion: false },
  { id: 5, zip: '10005', zoneNumber: 1, zoneNameId: 1, zoneName: 'Manhattan Central', clientId: 103, applyCongestion: true },
  { id: 6, zip: '10006', zoneNumber: 1, zoneNameId: 1, zoneName: 'Manhattan Central', clientId: 104, applyCongestion: false },
  { id: 7, zip: '10007', zoneNumber: 1, zoneNameId: 1, zoneName: 'Manhattan Central', clientId: 101, applyCongestion: true },
  { id: 8, zip: '10008', zoneNumber: 1, zoneNameId: 1, zoneName: 'Manhattan Central', clientId: 105, applyCongestion: null },

  // Manhattan Upper (1B) - ZoneName ID 2
  { id: 9, zip: '10016', zoneNumber: 2, zoneNameId: 2, zoneName: 'Manhattan Upper', clientId: 101, applyCongestion: true },
  { id: 10, zip: '10017', zoneNumber: 2, zoneNameId: 2, zoneName: 'Manhattan Upper', clientId: 102, applyCongestion: true },
  { id: 11, zip: '10018', zoneNumber: 2, zoneNameId: 2, zoneName: 'Manhattan Upper', clientId: 106, applyCongestion: false },
  { id: 12, zip: '10019', zoneNumber: 2, zoneNameId: 2, zoneName: 'Manhattan Upper', clientId: 104, applyCongestion: true },
  { id: 13, zip: '10020', zoneNumber: 2, zoneNameId: 2, zoneName: 'Manhattan Upper', clientId: 103, applyCongestion: false },

  // Brooklyn East (2A) - ZoneName ID 3
  { id: 14, zip: '11201', zoneNumber: 3, zoneNameId: 3, zoneName: 'Brooklyn East', clientId: 102, applyCongestion: true },
  { id: 15, zip: '11202', zoneNumber: 3, zoneNameId: 3, zoneName: 'Brooklyn East', clientId: 102, applyCongestion: true },
  { id: 16, zip: '11203', zoneNumber: 3, zoneNameId: 3, zoneName: 'Brooklyn East', clientId: 101, applyCongestion: true },
  { id: 17, zip: '11204', zoneNumber: 3, zoneNameId: 3, zoneName: 'Brooklyn East', clientId: 103, applyCongestion: false },
  { id: 18, zip: '11205', zoneNumber: 3, zoneNameId: 3, zoneName: 'Brooklyn East', clientId: 104, applyCongestion: false },
  { id: 19, zip: '11206', zoneNumber: 3, zoneNameId: 3, zoneName: 'Brooklyn East', clientId: 106, applyCongestion: null },

  // Brooklyn West (2B) - ZoneName ID 4
  { id: 20, zip: '11210', zoneNumber: 4, zoneNameId: 4, zoneName: 'Brooklyn West', clientId: 105, applyCongestion: true },
  { id: 21, zip: '11211', zoneNumber: 4, zoneNameId: 4, zoneName: 'Brooklyn West', clientId: 101, applyCongestion: true },
  { id: 22, zip: '11212', zoneNumber: 4, zoneNameId: 4, zoneName: 'Brooklyn West', clientId: 102, applyCongestion: false },
  { id: 23, zip: '11213', zoneNumber: 4, zoneNameId: 4, zoneName: 'Brooklyn West', clientId: 103, applyCongestion: false },

  // Queens North (3A) - ZoneName ID 5
  { id: 24, zip: '11351', zoneNumber: 5, zoneNameId: 5, zoneName: 'Queens North', clientId: 103, applyCongestion: false },
  { id: 25, zip: '11352', zoneNumber: 5, zoneNameId: 5, zoneName: 'Queens North', clientId: 104, applyCongestion: true },
  { id: 26, zip: '11353', zoneNumber: 5, zoneNameId: 5, zoneName: 'Queens North', clientId: 101, applyCongestion: true },
  { id: 27, zip: '11354', zoneNumber: 5, zoneNameId: 5, zoneName: 'Queens North', clientId: 106, applyCongestion: false },
  { id: 28, zip: '11355', zoneNumber: 5, zoneNameId: 5, zoneName: 'Queens North', clientId: 105, applyCongestion: null },

  // Queens South (3B) - ZoneName ID 6
  { id: 29, zip: '11360', zoneNumber: 6, zoneNameId: 6, zoneName: 'Queens South', clientId: 102, applyCongestion: true },
  { id: 30, zip: '11361', zoneNumber: 6, zoneNameId: 6, zoneName: 'Queens South', clientId: 101, applyCongestion: true },
  { id: 31, zip: '11362', zoneNumber: 6, zoneNameId: 6, zoneName: 'Queens South', clientId: 103, applyCongestion: false },

  // JFK Area (4A) - ZoneName ID 7
  { id: 32, zip: '11430', zoneNumber: 7, zoneNameId: 7, zoneName: 'JFK Airport', clientId: 101, applyCongestion: false },
  { id: 33, zip: '11431', zoneNumber: 7, zoneNameId: 7, zoneName: 'JFK Airport', clientId: 106, applyCongestion: false },
  { id: 34, zip: '11432', zoneNumber: 7, zoneNameId: 7, zoneName: 'JFK Airport', clientId: 103, applyCongestion: true },
  { id: 35, zip: '11433', zoneNumber: 7, zoneNameId: 7, zoneName: 'JFK Airport', clientId: 104, applyCongestion: true },

  // Newark Area (4B) - ZoneName ID 8
  { id: 36, zip: '07101', zoneNumber: 8, zoneNameId: 8, zoneName: 'Newark Gateway', clientId: 102, applyCongestion: true },
  { id: 37, zip: '07102', zoneNumber: 8, zoneNameId: 8, zoneName: 'Newark Gateway', clientId: 105, applyCongestion: true },
  { id: 38, zip: '07103', zoneNumber: 8, zoneNameId: 8, zoneName: 'Newark Gateway', clientId: 103, applyCongestion: false },
  { id: 39, zip: '07104', zoneNumber: 8, zoneNameId: 8, zoneName: 'Newark Gateway', clientId: 106, applyCongestion: null },

  // Hoboken (5A) - ZoneName ID 9
  { id: 40, zip: '07030', zoneNumber: 9, zoneNameId: 9, zoneName: 'Hoboken', clientId: 101, applyCongestion: true },
  { id: 41, zip: '07031', zoneNumber: 9, zoneNameId: 9, zoneName: 'Hoboken', clientId: 102, applyCongestion: false },
  { id: 42, zip: '07032', zoneNumber: 9, zoneNameId: 9, zoneName: 'Hoboken', clientId: 104, applyCongestion: true },
  { id: 43, zip: '07033', zoneNumber: 9, zoneNameId: 9, zoneName: 'Hoboken', clientId: 103, applyCongestion: true },

  // Jersey City (5B) - ZoneName ID 10
  { id: 44, zip: '07302', zoneNumber: 10, zoneNameId: 10, zoneName: 'Jersey City', clientId: 105, applyCongestion: true },
  { id: 45, zip: '07303', zoneNumber: 10, zoneNameId: 10, zoneName: 'Jersey City', clientId: 102, applyCongestion: false },
  { id: 46, zip: '07304', zoneNumber: 10, zoneNameId: 10, zoneName: 'Jersey City', clientId: 106, applyCongestion: false },
  { id: 47, zip: '07305', zoneNumber: 10, zoneNameId: 10, zoneName: 'Jersey City', clientId: 101, applyCongestion: null },

  // Bronx (6A) - ZoneName ID 11
  { id: 48, zip: '10451', zoneNumber: 11, zoneNameId: 11, zoneName: 'South Bronx', clientId: 104, applyCongestion: true },
  { id: 49, zip: '10452', zoneNumber: 11, zoneNameId: 11, zoneName: 'South Bronx', clientId: 101, applyCongestion: true },
  { id: 50, zip: '10453', zoneNumber: 11, zoneNameId: 11, zoneName: 'South Bronx', clientId: 103, applyCongestion: false },

  // Staten Island (6B) - ZoneName ID 12
  { id: 51, zip: '10301', zoneNumber: 12, zoneNameId: 12, zoneName: 'Staten Island', clientId: 105, applyCongestion: true },
  { id: 52, zip: '10302', zoneNumber: 12, zoneNameId: 12, zoneName: 'Staten Island', clientId: 102, applyCongestion: true },
  { id: 53, zip: '10303', zoneNumber: 12, zoneNameId: 12, zoneName: 'Staten Island', clientId: 106, applyCongestion: null },
];

// ============================================
// ZONE GROUPS DATA (updated to match production schema)
// ============================================

export const zoneGroupsData: ZoneGroup[] = [
  { id: 1, name: 'Manhattan Express', clearListAreaId: 101 },
  { id: 2, name: 'Brooklyn Standard', clearListAreaId: 102 },
  { id: 3, name: 'Queens Full Service', clearListAreaId: 103 },
  { id: 4, name: 'Airport Express', clearListAreaId: 104 },
  { id: 5, name: 'Newark Regional', clearListAreaId: 105 },
  { id: 6, name: 'Hoboken Metro', clearListAreaId: 106 },
  { id: 7, name: '1976 Limited Zones', clearListAreaId: null },
  { id: 8, name: 'Same Day Coverage', clearListAreaId: 107 },
  { id: 9, name: 'Overnight Network', clearListAreaId: 108 },
  { id: 10, name: 'Truck Routes', clearListAreaId: 109 },
  { id: 11, name: 'Bronx Coverage', clearListAreaId: null },
  { id: 12, name: 'Global Logistics Zones', clearListAreaId: 110 },
];

// ============================================
// DROP OFF LOCATIONS DATA (updated to match production schema)
// ============================================

export const dropOffLocationsData: DropOffLocation[] = [
  { id: 1, name: 'Times Square Drop-off', depotId: 1, qrCode: 'QR-TS-001' },
  { id: 2, name: 'Penn Station Drop-off', depotId: 1, qrCode: 'QR-PS-002' },
  { id: 3, name: 'Grand Central Drop-off', depotId: 1, qrCode: 'QR-GC-003' },
  { id: 4, name: 'DUMBO Drop-off', depotId: 2, qrCode: 'QR-DB-004' },
  { id: 5, name: 'Williamsburg Drop-off', depotId: 2, qrCode: 'QR-WB-005' },
  { id: 6, name: 'Flushing Drop-off', depotId: 3, qrCode: 'QR-FL-006' },
  { id: 7, name: 'Terminal 1 Cargo', depotId: 4, qrCode: 'QR-T1-007' },
  { id: 8, name: 'Terminal 4 Cargo', depotId: 4, qrCode: 'QR-T4-008' },
  { id: 9, name: 'Newark Penn Station', depotId: 5, qrCode: 'QR-NP-009' },
  { id: 10, name: 'Hoboken Terminal', depotId: 6, qrCode: 'QR-HT-010' },
  { id: 11, name: 'Exchange Place', depotId: 6, qrCode: 'QR-EP-011' },
];

// ============================================
// DEPOTS DATA (updated to match production TblBulkRegion schema)
// ============================================

export const depotsData: Depot[] = [
  {
    id: 1,
    name: 'NYC Central',
    fromAddress: '123 Industrial Parkway',
    fromSuburb: 'New York',
    americanState: 'NY',
    fromPostCode: 10001,
    active: true,
    fromCompany: 'Deliver Different NYC',
    pickupLatitude: 40.7128,
    pickupLongitude: -74.0060,
    accountsCode: 'NYC-001',
    addressLine1: '123 Industrial Parkway',
    addressLine2: 'Suite 100',
    addressLine3: null,
    addressLine4: null,
    addressLine5: null,
    addressLine6: null,
    addressLine7: null,
    addressLine8: null,
    courierApplicantEnabled: true,
    dropOffLocations: dropOffLocationsData.filter(loc => loc.depotId === 1),
  },
  {
    id: 2,
    name: 'Brooklyn Hub',
    fromAddress: '456 Commerce Drive',
    fromSuburb: 'Brooklyn',
    americanState: 'NY',
    fromPostCode: 11201,
    active: true,
    fromCompany: 'Deliver Different Brooklyn',
    pickupLatitude: 40.6782,
    pickupLongitude: -73.9442,
    accountsCode: 'BKL-002',
    addressLine1: '456 Commerce Drive',
    addressLine2: null,
    addressLine3: null,
    addressLine4: null,
    addressLine5: null,
    addressLine6: null,
    addressLine7: null,
    addressLine8: null,
    courierApplicantEnabled: true,
    dropOffLocations: dropOffLocationsData.filter(loc => loc.depotId === 2),
  },
  {
    id: 3,
    name: 'Queens Hub',
    fromAddress: '789 Queens Blvd',
    fromSuburb: 'Long Island City',
    americanState: 'NY',
    fromPostCode: 11101,
    active: true,
    fromCompany: 'Deliver Different Queens',
    pickupLatitude: 40.7420,
    pickupLongitude: -73.9352,
    accountsCode: 'QNS-003',
    addressLine1: '789 Queens Blvd',
    addressLine2: null,
    addressLine3: null,
    addressLine4: null,
    addressLine5: null,
    addressLine6: null,
    addressLine7: null,
    addressLine8: null,
    courierApplicantEnabled: true,
    dropOffLocations: dropOffLocationsData.filter(loc => loc.depotId === 3),
  },
  {
    id: 4,
    name: 'JFK Facility',
    fromAddress: 'Building 75, JFK Airport',
    fromSuburb: 'Jamaica',
    americanState: 'NY',
    fromPostCode: 11430,
    active: true,
    fromCompany: 'Deliver Different JFK',
    pickupLatitude: 40.6413,
    pickupLongitude: -73.7781,
    accountsCode: 'JFK-004',
    addressLine1: 'Building 75, JFK Airport',
    addressLine2: 'Cargo Area',
    addressLine3: null,
    addressLine4: null,
    addressLine5: null,
    addressLine6: null,
    addressLine7: null,
    addressLine8: null,
    courierApplicantEnabled: true,
    dropOffLocations: dropOffLocationsData.filter(loc => loc.depotId === 4),
  },
  {
    id: 5,
    name: 'Newark Gateway',
    fromAddress: '100 Gateway Center',
    fromSuburb: 'Newark',
    americanState: 'NJ',
    fromPostCode: 7102,
    active: true,
    fromCompany: 'Deliver Different Newark',
    pickupLatitude: 40.7357,
    pickupLongitude: -74.1724,
    accountsCode: 'NWK-005',
    addressLine1: '100 Gateway Center',
    addressLine2: null,
    addressLine3: null,
    addressLine4: null,
    addressLine5: null,
    addressLine6: null,
    addressLine7: null,
    addressLine8: null,
    courierApplicantEnabled: true,
    dropOffLocations: dropOffLocationsData.filter(loc => loc.depotId === 5),
  },
  {
    id: 6,
    name: 'Hoboken Depot',
    fromAddress: '200 River Street',
    fromSuburb: 'Hoboken',
    americanState: 'NJ',
    fromPostCode: 7030,
    active: true,
    fromCompany: 'Deliver Different Hoboken',
    pickupLatitude: 40.7370,
    pickupLongitude: -74.0302,
    accountsCode: 'HBK-006',
    addressLine1: '200 River Street',
    addressLine2: null,
    addressLine3: null,
    addressLine4: null,
    addressLine5: null,
    addressLine6: null,
    addressLine7: null,
    addressLine8: null,
    courierApplicantEnabled: true,
    dropOffLocations: dropOffLocationsData.filter(loc => loc.depotId === 6),
  },
  {
    id: 7,
    name: 'LaGuardia Station',
    fromAddress: '100 LaGuardia Rd',
    fromSuburb: 'East Elmhurst',
    americanState: 'NY',
    fromPostCode: 11369,
    active: false,
    fromCompany: null,
    pickupLatitude: 40.7769,
    pickupLongitude: -73.8740,
    accountsCode: null,
    addressLine1: '100 LaGuardia Rd',
    addressLine2: null,
    addressLine3: null,
    addressLine4: null,
    addressLine5: null,
    addressLine6: null,
    addressLine7: null,
    addressLine8: null,
    courierApplicantEnabled: null,
    dropOffLocations: [],
  },
  {
    id: 8,
    name: 'White Plains Center',
    fromAddress: '50 Main Street',
    fromSuburb: 'White Plains',
    americanState: 'NY',
    fromPostCode: 10601,
    active: false,
    fromCompany: null,
    pickupLatitude: 41.0330,
    pickupLongitude: -73.7627,
    accountsCode: null,
    addressLine1: '50 Main Street',
    addressLine2: null,
    addressLine3: null,
    addressLine4: null,
    addressLine5: null,
    addressLine6: null,
    addressLine7: null,
    addressLine8: null,
    courierApplicantEnabled: null,
    dropOffLocations: [],
  },
];

// ============================================
// FILTER DEFINITIONS (frontend-only - for UI filtering)
// ============================================

// Filter definitions for all 9 required filters
export const zipZoneFilters: FilterDefinition[] = [
  { id: 'zoneNumber', label: 'Zone #', options: ['All Zones', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] },
  { id: 'zoneName', label: 'Zone Name', options: ['All Names', 'Manhattan Central', 'Manhattan Upper', 'Brooklyn East', 'Brooklyn West', 'Queens North', 'Queens South', 'JFK Airport', 'Newark Gateway', 'Hoboken', 'Jersey City', 'South Bronx', 'Staten Island'] },
  { id: 'clientId', label: 'Client', options: ['All Clients', '101', '102', '103', '104', '105', '106'] },
  { id: 'applyCongestion', label: 'Congestion', options: ['All', 'Yes', 'No', 'Not Set'] },
];

// Depot zone group filters (subset of main filters)
export const depotZoneGroupFilters: FilterDefinition[] = [
  { id: 'americanState', label: 'State', options: ['All States', 'NY', 'NJ'] },
  { id: 'active', label: 'Status', options: ['All', 'Active', 'Inactive'] },
  { id: 'courierApplicantEnabled', label: 'Courier Apps', options: ['All', 'Enabled', 'Disabled'] },
];

// Table columns for zip zones
export const zipZoneColumns = [
  { key: 'zip', label: 'Zip Code' },
  { key: 'zoneNumber', label: 'Zone #' },
  { key: 'zoneName', label: 'Zone Name' },
  { key: 'clientId', label: 'Client ID' },
  { key: 'applyCongestion', label: 'Congestion' },
];

// Table columns for zone groups
export const zoneGroupColumns = [
  { key: 'name', label: 'Name' },
  { key: 'clearListAreaId', label: 'Clear List Area ID' },
];

// ============================================
// SAMPLE CONNECTION DATA (frontend-only UX system)
// ============================================

interface SampleConnectionData {
  connections: EntityConnections;
  connectedCount: number;
  hasIssues: boolean;
}

/**
 * Sample connection data for zone groups.
 * In production, this would be computed from actual relationships.
 */
export const sampleZoneGroupConnections: Record<string, SampleConnectionData> = {
  '1': {
    connections: {
      customers: { hasConnections: true, count: 847, connectionPath: 'via rate cards and service areas' },
      zoneGroups: { hasConnections: false, count: 0 },
      depots: { hasConnections: true, count: 1, connectionPath: 'NYC Central' },
      rateCards: { hasConnections: true, count: 4, connectionPath: 'Standard, Premium, Corporate, Volume' },
      services: { hasConnections: true, count: 3, connectionPath: 'Express, Same Day, Standard' },
      vehicles: { hasConnections: true, count: 3, connectionPath: 'Van, Cargo Bike, Motorcycle' },
      notifications: { hasConnections: true, count: 2, connectionPath: 'Email, SMS' },
      airports: { hasConnections: false, count: 0 },
      linehauls: { hasConnections: false, count: 0 },
      regions: { hasConnections: true, count: 1, connectionPath: 'North America' },
    },
    connectedCount: 7,
    hasIssues: false,
  },
  '2': {
    connections: {
      customers: { hasConnections: true, count: 234, connectionPath: 'via Brooklyn Hub' },
      zoneGroups: { hasConnections: false, count: 0 },
      depots: { hasConnections: true, count: 1, connectionPath: 'Brooklyn Hub' },
      rateCards: { hasConnections: true, count: 3, connectionPath: 'Standard, Corporate, Premium' },
      services: { hasConnections: true, count: 2, connectionPath: 'Standard, Overnight' },
      vehicles: { hasConnections: true, count: 2, connectionPath: 'Truck, Van' },
      notifications: { hasConnections: true, count: 1, connectionPath: 'Email only' },
      airports: { hasConnections: false, count: 0 },
      linehauls: { hasConnections: false, count: 0 },
      regions: { hasConnections: true, count: 1, connectionPath: 'North America' },
    },
    connectedCount: 7,
    hasIssues: false,
  },
};

/**
 * Sample connection data for depots.
 */
export const sampleDepotConnections: Record<string, SampleConnectionData> = {
  '1': {
    connections: {
      customers: { hasConnections: true, count: 1243 },
      zoneGroups: { hasConnections: true, count: 4 },
      depots: { hasConnections: false, count: 0 },
      rateCards: { hasConnections: true, count: 4 },
      services: { hasConnections: true, count: 4 },
      vehicles: { hasConnections: true, count: 4 },
      notifications: { hasConnections: true, count: 3 },
      airports: { hasConnections: false, count: 0 },
      linehauls: { hasConnections: true, count: 3 },
      regions: { hasConnections: true, count: 1 },
    },
    connectedCount: 8,
    hasIssues: false,
  },
  '2': {
    connections: {
      customers: { hasConnections: true, count: 567 },
      zoneGroups: { hasConnections: true, count: 1 },
      depots: { hasConnections: false, count: 0 },
      rateCards: { hasConnections: true, count: 3 },
      services: { hasConnections: true, count: 3 },
      vehicles: { hasConnections: true, count: 2 },
      notifications: { hasConnections: true, count: 2 },
      airports: { hasConnections: false, count: 0 },
      linehauls: { hasConnections: false, count: 0 },
      regions: { hasConnections: true, count: 1 },
    },
    connectedCount: 7,
    hasIssues: false,
  },
};
