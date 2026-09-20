import type { ImportSchema } from '../types';
import { clientsSchema } from './clients.schema';
import { zipZonesSchema, zoneGroupsSchema, depotsSchema } from './territory.schema';
import { servicesSchema } from './services.schema';
import { notificationGroupsSchema } from './notifications.schema';
import { schedulesSchema } from './schedules.schema';

// Registry type
export interface SchemaRegistry {
  [key: string]: ImportSchema;
}

// Create the registry
export const schemaRegistry: SchemaRegistry = {
  clients: clientsSchema,
  zipZones: zipZonesSchema,
  zoneGroups: zoneGroupsSchema,
  depots: depotsSchema,
  services: servicesSchema,
  notificationGroups: notificationGroupsSchema,
  schedules: schedulesSchema,
};

// Helper functions
export function getSchema(schemaId: string): ImportSchema | undefined {
  return schemaRegistry[schemaId];
}

export function getAllSchemas(): ImportSchema[] {
  return Object.values(schemaRegistry);
}

export function getSchemaIds(): string[] {
  return Object.keys(schemaRegistry);
}

export function registerSchema(schema: ImportSchema): void {
  schemaRegistry[schema.id] = schema;
}

// Re-export all schemas
export {
  clientsSchema,
  zipZonesSchema,
  zoneGroupsSchema,
  depotsSchema,
  servicesSchema,
  notificationGroupsSchema,
  schedulesSchema,
};
