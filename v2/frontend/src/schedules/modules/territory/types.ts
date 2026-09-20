/**
 * @module territory/types
 *
 * Domain types for the Territory module — zip-zones, zone groups, depots,
 * and the generic entity-connection system shared across modules.
 */

export interface ZipZone {
  id: number;
  zip: string;
  zoneNumber: number | null;
  zoneNameId: number | null;
  zoneName: string;
  clientId: number | null;
  applyCongestion: boolean | null;
}

export interface ZoneGroup {
  id: number;
  name: string;
  clearListAreaId: number | null;
}

export interface DropOffLocation {
  id: number;
  name: string;
  depotId: number;
  qrCode: string;
}

export interface Depot {
  id: number;
  name: string;
  fromAddress: string;
  fromSuburb: string;
  americanState: string | null;
  fromPostCode: number;
  active: boolean;
  fromCompany: string | null;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  accountsCode: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressLine3: string | null;
  addressLine4: string | null;
  addressLine5: string | null;
  addressLine6: string | null;
  addressLine7: string | null;
  addressLine8: string | null;
  courierApplicantEnabled: boolean | null;
  dropOffLocations: DropOffLocation[];
}

export interface FilterDefinition {
  id: string;
  label: string;
  options: string[];
  type?: 'select' | 'text' | 'multiselect';
}

// ============================================
// CONNECTION SYSTEM TYPES
// See TAG-SYSTEM-SPEC.md for full documentation
// ============================================

/**
 * Connection info for a single category.
 * Shows existence and count - NOT the actual list of items.
 */
export interface ConnectionInfo {
  hasConnections: boolean;      // For quick ✓/✗ display
  count: number;                // "Connected via 3 zone groups"
  connectionPath?: string;      // "via Manhattan Express zone group"
}

/**
 * All connections for an entity.
 * Each entity gets this computed based on its relationships.
 */
export interface EntityConnections {
  customers: ConnectionInfo;
  zoneGroups: ConnectionInfo;
  depots: ConnectionInfo;
  rateCards: ConnectionInfo;
  services: ConnectionInfo;
  vehicles: ConnectionInfo;
  notifications: ConnectionInfo;
  airports: ConnectionInfo;
  linehauls: ConnectionInfo;
  regions: ConnectionInfo;
}

/**
 * Source item context for the tag sidebar.
 * Identifies what item we're showing connections for.
 */
export interface SourceItem {
  type: 'zipZone' | 'zoneGroup' | 'depot' | 'customer' | 'rateCard' | 'service' | 'schedule';
  id: number;
  name: string;
  subtitle?: string;
}

/**
 * Tag category definition for display.
 */
export interface TagCategory {
  id: keyof EntityConnections;
  label: string;
  icon: string;
  route: string;  // Navigation target when clicked
}

/**
 * All 10 tag categories with their display info and routes.
 * Using Lucide icon names for consistent styling.
 */
export const TAG_CATEGORIES: TagCategory[] = [
  { id: 'customers', label: 'Customers', icon: 'Users', route: '/settings/customers' },
  { id: 'zoneGroups', label: 'Zone Groups', icon: 'MapPin', route: '/settings/territory?tab=groups' },
  { id: 'depots', label: 'Depots', icon: 'Building2', route: '/settings/territory?tab=depots' },
  { id: 'rateCards', label: 'Rate Cards', icon: 'DollarSign', route: '/settings/rate-cards' },
  { id: 'services', label: 'Services', icon: 'Zap', route: '/settings/services' },
  { id: 'vehicles', label: 'Vehicles', icon: 'Truck', route: '/settings/vehicles' },
  { id: 'notifications', label: 'Notifications', icon: 'Bell', route: '/settings/notifications' },
  { id: 'airports', label: 'Airports', icon: 'Plane', route: '/settings/airports' },
  { id: 'linehauls', label: 'Linehauls', icon: 'Route', route: '/settings/linehauls' },
  { id: 'regions', label: 'Regions', icon: 'Globe', route: '/settings/regions' },
];

/**
 * Create empty connections object (all disconnected).
 */
export function createEmptyConnections(): EntityConnections {
  return {
    customers: { hasConnections: false, count: 0 },
    zoneGroups: { hasConnections: false, count: 0 },
    depots: { hasConnections: false, count: 0 },
    rateCards: { hasConnections: false, count: 0 },
    services: { hasConnections: false, count: 0 },
    vehicles: { hasConnections: false, count: 0 },
    notifications: { hasConnections: false, count: 0 },
    airports: { hasConnections: false, count: 0 },
    linehauls: { hasConnections: false, count: 0 },
    regions: { hasConnections: false, count: 0 },
  };
}

/**
 * Count how many categories have connections.
 * Used for the ConnectionBadge display.
 */
export function countConnectedCategories(connections: EntityConnections): number {
  return Object.values(connections).filter(c => c.hasConnections).length;
}

// Legacy tag values - kept for reference but NOT for inline display
export const TERRITORY_TAGS = {
  Region: ['North America', 'Europe', 'Asia Pacific', 'Latin America', 'Middle East', 'Africa'],
  Depot: ['NYC Central', 'Brooklyn Hub', 'JFK Facility', 'Newark Gateway', 'Hoboken Depot', 'Queens Hub'],
  Country: ['United States', 'Canada', 'Mexico', 'United Kingdom', 'Germany', 'France', 'Japan', 'Australia'],
  Customer: ['1976 Limited', 'Acme Corp', 'Global Logistics', 'Metro Traders', 'Prime Distribution', 'Swift Transport'],
  Service: ['Standard', 'Express', 'Overnight', 'Same Day', 'Scheduled', 'On-Demand'],
  Vehicle: ['Van', 'Truck', 'Semi', 'Cargo Bike', 'Motorcycle', 'Walking Courier'],
  Notification: ['Email Alerts', 'SMS Updates', 'Push Notifications', 'Webhook Events'],
  'Rate Card': ['Standard Rates', 'Premium Rates', 'Corporate Rates', 'Volume Discounts', 'Off-Peak Rates'],
  Airport: ['JFK', 'LaGuardia', 'Newark', 'Teterboro', 'White Plains'],
  Linehaul: ['NYC-BOS', 'NYC-PHL', 'NYC-DC', 'NYC-BUF', 'NYC-PIT'],
};
