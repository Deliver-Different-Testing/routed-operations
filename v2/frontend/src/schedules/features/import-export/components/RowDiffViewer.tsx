import React from 'react';
import type { FieldDiff, ParsedRow } from '../types/import.types';
import type { ImportSchema } from '../types/schema.types';

export interface RowDiffViewerProps {
  row: ParsedRow;
  schema: ImportSchema;
  showUnchanged?: boolean;
  compact?: boolean;
  className?: string;
}

function DiffIndicator({ type }: { type: FieldDiff['type'] }): React.ReactElement {
  switch (type) {
    case 'added':
      return <span className="text-green-600 font-bold">+</span>;
    case 'changed':
      return <span className="text-brand-cyan font-bold">←</span>;
    case 'removed':
      return <span className="text-red-600 font-bold">−</span>;
  }
}

function getFieldLabel(key: string, schema: ImportSchema): string {
  const col = schema.columns.find(c => c.key === key);
  return col?.header || key;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '(empty)';
  }
  return String(value);
}

function getStatusBadgeClass(status: ParsedRow['status']): string {
  switch (status) {
    case 'new':
      return 'bg-green-100 text-green-800';
    case 'modified':
      return 'bg-cyan-100 text-cyan-800';
    case 'unchanged':
      return 'bg-gray-100 text-gray-600';
    case 'error':
      return 'bg-red-100 text-red-800';
    case 'delete':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

function getStatusLabel(status: ParsedRow['status']): string {
  switch (status) {
    case 'new':
      return 'NEW';
    case 'modified':
      return 'MODIFIED';
    case 'unchanged':
      return 'UNCHANGED';
    case 'error':
      return 'ERROR';
    case 'delete':
      return 'DELETE';
  }
}

function getRecordIdentifier(row: ParsedRow, schema: ImportSchema): string {
  const uniqueKey = schema.uniqueKey;
  const identifier = row.data[uniqueKey];
  return identifier ? String(identifier) : `Row ${row.rowNumber}`;
}

function CompactView({
  row,
  schema
}: {
  row: ParsedRow;
  schema: ImportSchema;
}): React.ReactElement {
  const recordId = getRecordIdentifier(row, schema);
  const diffs = row.diff || [];

  if (diffs.length === 0) {
    return (
      <div className="text-sm text-gray-600" data-testid="row-diff-viewer" aria-label="row diff viewer">
        {recordId}: No changes
      </div>
    );
  }

  const diffSummaries = diffs.map((diff) => {
    const label = getFieldLabel(diff.field, schema);
    const oldVal = formatValue(diff.oldValue);
    const newVal = formatValue(diff.newValue);

    switch (diff.type) {
      case 'added':
        return `+${label}`;
      case 'removed':
        return `−${label}`;
      case 'changed':
        return `${label} (${oldVal} → ${newVal})`;
    }
  });

  return (
    <div className="text-sm">
      <span className="font-medium">{recordId}:</span>{' '}
      {diffSummaries.join(', ')}
    </div>
  );
}

function ExpandedView({
  row,
  schema,
  showUnchanged
}: {
  row: ParsedRow;
  schema: ImportSchema;
  showUnchanged: boolean;
}): React.ReactElement {
  const recordId = getRecordIdentifier(row, schema);
  const diffs = row.diff || [];

  // Get all fields if showUnchanged is true
  const allFields = showUnchanged
    ? Object.keys(row.data).map(field => {
        const existingDiff = diffs.find(d => d.field === field);
        if (existingDiff) {
          return existingDiff;
        }

        // Create unchanged field diff
        const currentValue = row.data[field];
        return {
          field,
          oldValue: currentValue,
          newValue: currentValue,
          type: 'unchanged' as const
        };
      })
    : diffs;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gray-50 px-4 py-3 flex items-center justify-between border-b border-gray-200">
        <div className="font-medium text-gray-900">
          Record: {recordId}
        </div>
        <div>
          <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusBadgeClass(row.status)}`}>
            {getStatusLabel(row.status)}
          </span>
        </div>
      </div>

      {/* Table */}
      {allFields.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/4">
                  Field
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/3">
                  Current Value
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/3">
                  New Value
                </th>
                <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-12">

                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {allFields.map((diff) => {
                const fieldLabel = getFieldLabel(diff.field, schema);
                const oldVal = formatValue(diff.oldValue);
                const newVal = formatValue(diff.newValue);
                const isUnchanged = diff.type === 'unchanged';

                return (
                  <tr
                    key={diff.field}
                    className={`hover:bg-gray-50 ${isUnchanged ? 'text-gray-400' : ''}`}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {fieldLabel}
                    </td>
                    <td className={`px-4 py-3 text-sm ${diff.type === 'changed' ? 'line-through text-gray-500' : 'text-gray-700'}`}>
                      {oldVal}
                    </td>
                    <td className={`px-4 py-3 text-sm font-medium ${
                      diff.type === 'added' ? 'text-green-600' :
                      diff.type === 'changed' ? 'text-brand-cyan' :
                      diff.type === 'removed' ? 'text-red-600' :
                      'text-gray-700'
                    }`}>
                      {newVal}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {!isUnchanged && <DiffIndicator type={diff.type} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-4 py-8 text-center text-sm text-gray-500">
          No changes detected
        </div>
      )}
    </div>
  );
}

export function RowDiffViewer({
  row,
  schema,
  showUnchanged = false,
  compact = false,
  className = ''
}: RowDiffViewerProps): React.ReactElement {
  return (
    <div className={className}>
      {compact ? (
        <CompactView row={row} schema={schema} />
      ) : (
        <ExpandedView row={row} schema={schema} showUnchanged={showUnchanged} />
      )}
    </div>
  );
}
