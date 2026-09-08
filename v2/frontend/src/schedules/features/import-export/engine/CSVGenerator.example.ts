/**
 * CSVGenerator Usage Examples
 * Real-world usage patterns for the Universal Import/Export System
 */

import {
  generateCSV,
  generateTemplate,
  downloadCSV,
  type CSVGenerateOptions,
  type TemplateOptions
} from './CSVGenerator';
import type { ImportSchema } from '../types/schema.types';

// Example Schema: Client Import
const clientSchema: ImportSchema = {
  id: 'clients',
  label: 'Client Import',
  description: 'Import client data',
  columns: [
    {
      key: 'id',
      header: 'Client ID',
      type: 'id',
      locked: true
    },
    {
      key: 'companyName',
      header: 'Company Name',
      type: 'string',
      required: true,
      templateHint: 'Legal company name'
    },
    {
      key: 'status',
      header: 'Status',
      type: 'enum',
      values: ['Active', 'Inactive'],
      required: true
    },
    {
      key: 'email',
      header: 'Email',
      type: 'email'
    },
    {
      key: 'phone',
      header: 'Phone',
      type: 'phone'
    },
    {
      key: 'rateGroup',
      header: 'Rate Group',
      type: 'reference',
      refTable: 'Rate Groups',
      refDisplayField: 'name'
    },
    {
      key: 'createdDate',
      header: 'Created Date',
      type: 'date',
      locked: true
    }
  ],
  uniqueKey: 'id',
  generateId: () => `CLIENT-${Date.now()}`
};

// =========================
// Example 1: Export Data
// =========================

export function exportClientsToCSV(clients: any[]) {
  const csv = generateCSV(clients, clientSchema);
  const filename = `clients-export-${new Date().toISOString().split('T')[0]}.csv`;
  downloadCSV(csv, filename);
}

// Sample data
const sampleClients = [
  {
    id: 'CLIENT-001',
    companyName: 'Acme Corporation',
    status: 'Active',
    email: 'contact@acme.com',
    phone: '(555) 123-4567',
    rateGroup: 'STANDARD',
    createdDate: new Date('2024-01-15')
  },
  {
    id: 'CLIENT-002',
    companyName: 'Beta Industries, LLC',
    status: 'Active',
    email: 'info@beta.com',
    phone: '(555) 987-6543',
    rateGroup: 'PREMIUM',
    createdDate: new Date('2024-02-20')
  }
];

// =========================
// Example 2: Generate Template
// =========================

export function downloadClientImportTemplate() {
  const template = generateTemplate(clientSchema, {
    includeHintRow: true,
    includeExampleRow: false
  });
  downloadCSV(template, 'client-import-template.csv');
}

// Generated template will look like:
/*
Client ID,Company Name,Status,Email,Phone,Rate Group,Created Date
[AUTO - DO NOT EDIT],Required - Legal company name,Required - Active/Inactive,email@example.com,(555) 555-5555,Reference to Rate Groups,[AUTO - DO NOT EDIT]
*/

// =========================
// Example 3: Template with Examples
// =========================

export function downloadClientTemplateWithExamples() {
  const template = generateTemplate(clientSchema, {
    includeHintRow: true,
    includeExampleRow: true
  });
  downloadCSV(template, 'client-import-template-with-examples.csv');
}

// =========================
// Example 4: Custom Delimiter (TSV)
// =========================

export function exportClientsToTSV(clients: any[]) {
  const options: CSVGenerateOptions = {
    delimiter: '\t',
    includeHeaders: true
  };
  const tsv = generateCSV(clients, clientSchema, options);
  downloadCSV(tsv, 'clients-export.tsv');
}

// =========================
// Example 5: European Format (Semicolon)
// =========================

export function exportClientsEuropean(clients: any[]) {
  const options: CSVGenerateOptions = {
    delimiter: ';',
    lineEnding: '\r\n', // Windows line endings
    includeHeaders: true
  };
  const csv = generateCSV(clients, clientSchema, options);
  downloadCSV(csv, 'clients-export.csv');
}

// =========================
// Example 6: Quote All Values
// =========================

export function exportClientsQuotedAll(clients: any[]) {
  const options: CSVGenerateOptions = {
    quoteAll: true,
    includeHeaders: true
  };
  const csv = generateCSV(clients, clientSchema, options);
  downloadCSV(csv, 'clients-export-quoted.csv');
}

// =========================
// Example 7: Headers Only (No Data)
// =========================

export function downloadHeadersOnly() {
  const csv = generateCSV([], clientSchema);
  downloadCSV(csv, 'client-headers.csv');
}

// =========================
// Example 8: React Component Integration
// =========================

/*
import { generateCSV, generateTemplate, downloadCSV } from '@/features/import-export/engine';

function ClientExportButton({ clients }: { clients: Client[] }) {
  const handleExport = () => {
    const csv = generateCSV(clients, clientSchema);
    const filename = `clients-${new Date().toISOString().split('T')[0]}.csv`;
    downloadCSV(csv, filename);
  };

  return (
    <button onClick={handleExport}>
      Export {clients.length} Clients to CSV
    </button>
  );
}

function ClientTemplateButton() {
  const handleDownload = () => {
    const template = generateTemplate(clientSchema);
    downloadCSV(template, 'client-import-template.csv');
  };

  return (
    <button onClick={handleDownload}>
      Download Import Template
    </button>
  );
}
*/

// =========================
// Example 9: Server-Side Generation (Node.js)
// =========================

/*
import { generateCSV } from './CSVGenerator';
import { writeFile } from 'fs/promises';

async function exportToFile(clients: any[]) {
  const csv = generateCSV(clients, clientSchema);
  await writeFile('clients-export.csv', csv, 'utf-8');
  console.log('Export complete!');
}
*/

// =========================
// Example 10: Conditional Template Generation
// =========================

export function downloadTemplateForUser(userRole: 'admin' | 'user') {
  // Filter schema columns based on user role
  const filteredSchema: ImportSchema = {
    ...clientSchema,
    columns: clientSchema.columns.filter(col => {
      // Non-admin users can't edit locked fields
      if (userRole !== 'admin' && col.locked) {
        return false;
      }
      return true;
    })
  };

  const template = generateTemplate(filteredSchema);
  downloadCSV(template, `client-template-${userRole}.csv`);
}

// =========================
// Example 11: Multi-Sheet Export (Separate Files)
// =========================

export function exportAllData(clients: any[], rateGroups: any[]) {
  // Export clients
  const clientCSV = generateCSV(clients, clientSchema);
  downloadCSV(clientCSV, 'clients.csv');

  // Note: In a real implementation, you'd have a rateGroupSchema
  // This is just to show the pattern for multiple exports
  console.log('Would also export rate groups...');
}

// =========================
// Example 12: Preview Before Download
// =========================

export function generatePreview(clients: any[]): string {
  // Generate first 10 rows for preview
  const previewData = clients.slice(0, 10);
  const csv = generateCSV(previewData, clientSchema);
  return csv;
}

// Usage in component:
/*
function ExportPreview({ clients }: { clients: Client[] }) {
  const [preview, setPreview] = useState<string>('');

  const showPreview = () => {
    setPreview(generatePreview(clients));
  };

  const confirmExport = () => {
    const csv = generateCSV(clients, clientSchema);
    downloadCSV(csv, 'clients.csv');
  };

  return (
    <div>
      <button onClick={showPreview}>Preview</button>
      {preview && (
        <>
          <pre>{preview}</pre>
          <button onClick={confirmExport}>Confirm Export</button>
        </>
      )}
    </div>
  );
}
*/
