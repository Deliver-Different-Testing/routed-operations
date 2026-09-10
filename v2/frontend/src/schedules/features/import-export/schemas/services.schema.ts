import type { ImportSchema } from '../types';

export const servicesSchema: ImportSchema = {
  id: 'services',
  label: 'Services',
  description: 'Import/export service type definitions',
  columns: [
    { key: 'id', header: 'Service ID', type: 'id', locked: true },
    { key: 'name', header: 'Service Name', type: 'string', required: true },
    { key: 'code', header: 'Service Code', type: 'string', required: true },
    { key: 'description', header: 'Description', type: 'string' },
    { key: 'category', header: 'Category', type: 'enum', values: ['Courier', 'Freight', 'Express', 'Same Day', 'International'] },
    { key: 'basePrice', header: 'Base Price', type: 'number', min: 0 },
    { key: 'pricePerKm', header: 'Price Per Km', type: 'number', min: 0 },
    { key: 'pricePerKg', header: 'Price Per Kg', type: 'number', min: 0 },
    { key: 'minCharge', header: 'Minimum Charge', type: 'number', min: 0 },
    { key: 'maxWeight', header: 'Max Weight (kg)', type: 'number' },
    { key: 'maxDimension', header: 'Max Dimension (cm)', type: 'number' },
    { key: 'estimatedDays', header: 'Estimated Days', type: 'number' },
    { key: 'status', header: 'Status', type: 'enum', values: ['Active', 'Inactive'] },
  ],
  uniqueKey: 'id',
  generateId: () => `SV-${Date.now().toString(36).toUpperCase()}`,
};
