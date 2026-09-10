import type { ImportSchema } from '../types';

export const notificationGroupsSchema: ImportSchema = {
  id: 'notificationGroups',
  label: 'Notification Groups',
  description: 'Import/export notification group settings',
  columns: [
    { key: 'id', header: 'Group ID', type: 'id', locked: true },
    { key: 'name', header: 'Group Name', type: 'string', required: true },
    { key: 'description', header: 'Description', type: 'string' },
    { key: 'eventType', header: 'Event Type', type: 'enum', values: ['Pickup', 'Delivery', 'Status Update', 'Exception', 'Invoice'] },
    { key: 'emailEnabled', header: 'Email Enabled', type: 'boolean' },
    { key: 'smsEnabled', header: 'SMS Enabled', type: 'boolean' },
    { key: 'pushEnabled', header: 'Push Enabled', type: 'boolean' },
    { key: 'templateId', header: 'Template', type: 'reference', refTable: 'templates' },
    { key: 'status', header: 'Status', type: 'enum', values: ['Active', 'Inactive'] },
  ],
  uniqueKey: 'id',
  generateId: () => `NG-${Date.now().toString(36).toUpperCase()}`,
};
