/**
 * Example usage of ColumnMapper component
 * This file demonstrates how to use the ColumnMapper for mapping CSV columns to schema fields
 */

import { useState } from 'react';
import { ColumnMapper } from './ColumnMapper';
import type { ImportSchema } from '../types';

// Example schema for clients
const clientSchema: ImportSchema = {
  id: 'clients',
  label: 'Clients',
  description: 'Client records',
  uniqueKey: 'id',
  generateId: () => `CLI-${Date.now()}`,
  columns: [
    {
      key: 'id',
      header: 'Client ID',
      type: 'id',
      required: true,
      locked: true,
    },
    {
      key: 'companyName',
      header: 'Company Name',
      type: 'string',
      required: true,
    },
    {
      key: 'email',
      header: 'Email',
      type: 'email',
      required: true,
    },
    {
      key: 'phone',
      header: 'Phone',
      type: 'phone',
      required: true,
    },
    {
      key: 'status',
      header: 'Status',
      type: 'enum',
      required: false,
      values: ['Active', 'Inactive', 'Pending'],
    },
    {
      key: 'notes',
      header: 'Notes',
      type: 'string',
      required: false,
    },
  ],
};

// Example CSV headers from uploaded file
const csvHeaders = [
  'CompanyName',      // Should auto-map to "Company Name"
  'cust_email',       // Should auto-map to "Email"
  'PhoneNumber',      // Should auto-map to "Phone"
  'cust_status',      // Should auto-map to "Status"
  'Extra Column',     // No match, user can skip
  'Random Data',      // No match, user can skip
];

export function ColumnMapperExample() {
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const handleMappingChange = (newMapping: Record<string, string>) => {
    setMapping(newMapping);
    console.log('Mapping updated:', newMapping);
  };

  return (
    <div className="p-8 bg-surface-light min-h-screen">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-text-primary mb-6">
          Column Mapper Example
        </h1>

        <ColumnMapper
          csvHeaders={csvHeaders}
          schema={clientSchema}
          onMappingChange={handleMappingChange}
          className="mb-6"
        />

        {/* Show current mapping state */}
        <div className="bg-white border-2 border-border rounded-lg p-6">
          <h2 className="text-lg font-semibold text-text-primary mb-4">
            Current Mapping (Debug)
          </h2>
          <pre className="text-sm text-text-secondary bg-surface-light p-4 rounded overflow-auto">
            {JSON.stringify(mapping, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

export default ColumnMapperExample;
