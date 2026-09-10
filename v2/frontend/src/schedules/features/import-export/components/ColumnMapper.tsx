import React, { useState, useEffect, useMemo } from 'react';
import type { ImportSchema } from '../types';

export interface ColumnMapping {
  csvColumn: string;
  schemaColumn: string | null;  // null = skip/ignore
}

export interface ColumnMapperProps {
  csvHeaders: string[];                    // Headers from parsed CSV
  schema: ImportSchema;                    // Target schema
  initialMapping?: Record<string, string>; // csvCol -> schemaCol
  onMappingChange: (mapping: Record<string, string>) => void;
  className?: string;
}

// Auto-mapping logic
function autoMapColumns(csvHeaders: string[], schema: ImportSchema): Record<string, string> {
  const mapping: Record<string, string> = {};

  for (const header of csvHeaders) {
    const normalizedHeader = header.toLowerCase().replace(/[_\s-]/g, '');

    for (const col of schema.columns) {
      const normalizedCol = col.header.toLowerCase().replace(/[_\s-]/g, '');
      if (normalizedHeader === normalizedCol || normalizedHeader === col.key.toLowerCase()) {
        mapping[header] = col.key;
        break;
      }
    }
  }

  return mapping;
}

/**
 * Maps CSV header columns to schema fields via dropdowns.
 * Auto-maps matching columns on mount; highlights unmapped required fields.
 */
export function ColumnMapper({
  csvHeaders,
  schema,
  initialMapping,
  onMappingChange,
  className = ''
}: ColumnMapperProps): React.ReactElement {
  // Initialize mapping state
  const [mapping, setMapping] = useState<Record<string, string>>(() => {
    if (initialMapping) {
      return initialMapping;
    }
    return autoMapColumns(csvHeaders, schema);
  });

  // Notify parent of mapping changes
  useEffect(() => {
    onMappingChange(mapping);
  }, [mapping, onMappingChange]);

  // Get mapped schema columns
  const mappedSchemaColumns = useMemo(() => {
    return new Set(Object.values(mapping).filter(Boolean));
  }, [mapping]);

  // Get unmapped required fields
  const unmappedRequiredFields = useMemo(() => {
    return schema.columns
      .filter(col => col.required && !mappedSchemaColumns.has(col.key))
      .map(col => col.header);
  }, [schema.columns, mappedSchemaColumns]);

  // Handle mapping change
  const handleMappingChange = (csvColumn: string, schemaColumn: string) => {
    setMapping(prev => {
      const newMapping = { ...prev };

      if (schemaColumn === '') {
        // Skip/ignore this column
        delete newMapping[csvColumn];
      } else {
        newMapping[csvColumn] = schemaColumn;
      }

      return newMapping;
    });
  };

  // Get mapping status for a CSV column
  const getMappingStatus = (csvColumn: string): 'mapped' | 'skipped' => {
    const schemaKey = mapping[csvColumn];
    if (!schemaKey) return 'skipped';
    return 'mapped';
  };

  // Get status icon
  const getStatusIcon = (csvColumn: string) => {
    const status = getMappingStatus(csvColumn);

    switch (status) {
      case 'mapped':
        return <span className="text-success text-lg">✓</span>;
      case 'skipped':
        return <span className="text-text-muted text-lg">–</span>;
      default:
        return null;
    }
  };

  return (
    <div className={`bg-white border-2 border-border rounded-lg p-6 ${className}`} data-testid="column-mapper">
      {/* Header */}
      <h3 className="text-lg font-semibold text-text-primary mb-4">
        Map CSV Columns
      </h3>

      {/* Column mapping grid */}
      <div className="space-y-3">
        {/* Column headers */}
        <div className="grid grid-cols-[1fr_auto_2fr_auto] gap-4 items-center pb-2 border-b-2 border-border">
          <div className="text-sm font-medium text-text-secondary">
            CSV Column
          </div>
          <div></div>
          <div className="text-sm font-medium text-text-secondary">
            Schema Field
          </div>
          <div className="w-8"></div>
        </div>

        {/* Mapping rows */}
        {csvHeaders.map((csvHeader) => {
          const currentMapping = mapping[csvHeader] || '';

          return (
            <div
              key={csvHeader}
              className="grid grid-cols-[1fr_auto_2fr_auto] gap-4 items-center"
            >
              {/* CSV Column (read-only) */}
              <div className="px-3.5 py-2.5 bg-surface-light border-2 border-border rounded-md text-text-primary">
                {csvHeader}
              </div>

              {/* Arrow */}
              <div className="text-text-secondary">→</div>

              {/* Schema Field (dropdown) */}
              <select
                value={currentMapping}
                onChange={(e) => handleMappingChange(csvHeader, e.target.value)}
                aria-label={`Map CSV column "${csvHeader}" to schema field`}
                data-testid={`column-mapper-${csvHeader}`}
                className={`
                  w-full px-3.5 py-2.5 text-base
                  border-2 border-border rounded-md
                  bg-white text-text-primary
                  appearance-none cursor-pointer
                  transition-all duration-normal
                  focus:outline-none focus:border-brand-cyan focus:shadow-cyan-glow
                  bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%2364748b%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')]
                  bg-no-repeat bg-[right_12px_center]
                  pr-10
                `}
              >
                <option value="">(Skip this column)</option>
                {schema.columns.map((col) => {
                  const isAlreadyMapped = mappedSchemaColumns.has(col.key) && currentMapping !== col.key;
                  const label = `${col.header}${col.required ? ' *' : ''}${isAlreadyMapped ? ' ✓' : ''}`;

                  return (
                    <option
                      key={col.key}
                      value={col.key}
                      disabled={isAlreadyMapped}
                    >
                      {label}
                    </option>
                  );
                })}
              </select>

              {/* Status indicator */}
              <div className="w-8 flex items-center justify-center">
                {getStatusIcon(csvHeader)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Validation warnings */}
      {unmappedRequiredFields.length > 0 && (
        <div className="mt-4 p-4 bg-warning bg-opacity-10 border-2 border-warning rounded-md">
          <div className="flex items-start gap-2">
            <span className="text-warning text-lg">⚠</span>
            <div>
              <p className="text-sm font-medium text-warning">
                Required fields not mapped:
              </p>
              <p className="text-sm text-text-secondary mt-1">
                {unmappedRequiredFields.join(', ')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Success message */}
      {unmappedRequiredFields.length === 0 && csvHeaders.length > 0 && (
        <div className="mt-4 p-4 bg-success bg-opacity-10 border-2 border-success rounded-md">
          <div className="flex items-start gap-2">
            <span className="text-success text-lg">✓</span>
            <p className="text-sm font-medium text-success">
              All required fields are mapped
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
