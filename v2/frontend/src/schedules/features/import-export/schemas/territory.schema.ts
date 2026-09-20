import type { ImportSchema } from '../types';

// ============================================
// ZIP ZONES SCHEMA
// ============================================
export const zipZonesSchema: ImportSchema = {
  id: 'zipZones',
  label: 'Zip Zones',
  description: 'Import/export zip code zone mappings',
  columns: [
    { key: 'id', header: 'Zone ID', type: 'id', locked: true },
    { key: 'zipCode', header: 'Zip Code', type: 'string', required: true },
    { key: 'suburb', header: 'Suburb', type: 'string' },
    { key: 'city', header: 'City', type: 'string' },
    { key: 'state', header: 'State', type: 'string' },
    { key: 'country', header: 'Country', type: 'string', templateDefault: 'AU' },
    { key: 'region', header: 'Region', type: 'reference', refTable: 'regions', refDisplayField: 'name' },
    { key: 'depotId', header: 'Depot', type: 'reference', refTable: 'depots', refDisplayField: 'name' },
    { key: 'pricingZone', header: 'Pricing Zone', type: 'string' },
    { key: 'deliveryDays', header: 'Delivery Days', type: 'string', templateHint: 'Comma-separated days (e.g., Mon,Tue,Wed)' },
    { key: 'surchargePercent', header: 'Surcharge %', type: 'number', min: 0 },
    { key: 'isRemote', header: 'Remote Area', type: 'boolean' },
    { key: 'status', header: 'Status', type: 'enum', values: ['Active', 'Inactive'] },
  ],
  uniqueKey: 'id',
  generateId: () => `ZZ-${Date.now().toString(36).toUpperCase()}`,
};

// ============================================
// ZONE GROUPS SCHEMA
// ============================================
export const zoneGroupsSchema: ImportSchema = {
  id: 'zoneGroups',
  label: 'Zone Groups',
  description: 'Import/export zone group definitions',
  columns: [
    { key: 'id', header: 'Group ID', type: 'id', locked: true },
    { key: 'name', header: 'Group Name', type: 'string', required: true },
    { key: 'description', header: 'Description', type: 'string' },
    { key: 'zoneIds', header: 'Zone IDs', type: 'string', templateHint: 'Comma-separated zone IDs (e.g., ZZ-123,ZZ-456)' },
    { key: 'depotId', header: 'Depot', type: 'reference', refTable: 'depots', refDisplayField: 'name' },
    { key: 'region', header: 'Region', type: 'reference', refTable: 'regions', refDisplayField: 'name' },
    { key: 'serviceType', header: 'Service Type', type: 'enum', values: ['Standard', 'Express', 'Same Day', 'Next Day'] },
    { key: 'status', header: 'Status', type: 'enum', values: ['Active', 'Inactive'] },
  ],
  uniqueKey: 'id',
  generateId: () => `ZG-${Date.now().toString(36).toUpperCase()}`,
};

// ============================================
// DEPOTS SCHEMA
// ============================================
export const depotsSchema: ImportSchema = {
  id: 'depots',
  label: 'Depots & Locations',
  description: 'Import/export depot location data',
  columns: [
    { key: 'id', header: 'Depot ID', type: 'id', locked: true },
    { key: 'name', header: 'Depot Name', type: 'string', required: true },
    { key: 'code', header: 'Depot Code', type: 'string', required: true },
    { key: 'address', header: 'Address', type: 'string' },
    { key: 'city', header: 'City', type: 'string' },
    { key: 'state', header: 'State', type: 'string' },
    { key: 'zip', header: 'Zip Code', type: 'string' },
    { key: 'country', header: 'Country', type: 'string' },
    { key: 'phone', header: 'Phone', type: 'phone' },
    { key: 'email', header: 'Email', type: 'email' },
    { key: 'region', header: 'Region', type: 'reference', refTable: 'regions', refDisplayField: 'name' },
    { key: 'operatingHours', header: 'Operating Hours', type: 'string', templateHint: 'Format: Mon-Fri 8:00-17:00' },
    { key: 'capacity', header: 'Capacity', type: 'number' },
    { key: 'status', header: 'Status', type: 'enum', values: ['Active', 'Inactive'] },
    { key: 'createdAt', header: 'Created At', type: 'datetime', locked: true },
    { key: 'updatedAt', header: 'Updated At', type: 'datetime', locked: true },
  ],
  uniqueKey: 'id',
  generateId: () => `DP-${Date.now().toString(36).toUpperCase()}`,
};

