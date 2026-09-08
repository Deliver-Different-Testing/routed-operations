import React, { useState, useMemo } from 'react';
import type { ParsedRow, ImportSummary } from '../types/import.types';
import type { ImportSchema } from '../types/schema.types';
import { Tabs } from '../../../components/layout/Tabs';
import { DataTable } from '../../../components/data/DataTable';
import { Badge } from '../../../components/ui/Badge';

export interface ImportConfirmationTabsProps {
  rows: ParsedRow[];
  schema: ImportSchema;
  summary: ImportSummary;
  onRowSelect?: (row: ParsedRow) => void;
  pageSize?: number;
  className?: string;
}

type TabId = 'new' | 'modified' | 'unchanged' | 'errors' | 'delete';

interface TabConfig {
  id: TabId;
  label: string;
  count: number;
  badgeVariant: 'green' | 'cyan' | 'default' | 'red';
}

export function ImportConfirmationTabs({
  rows,
  schema,
  summary,
  onRowSelect,
  pageSize = 20,
  className = ''
}: ImportConfirmationTabsProps): React.ReactElement {
  const [activeTab, setActiveTab] = useState<TabId>('new');
  const [page, setPage] = useState(1);

  // Filter rows by status
  const newRows = useMemo(() => rows.filter(r => r.status === 'new'), [rows]);
  const modifiedRows = useMemo(() => rows.filter(r => r.status === 'modified'), [rows]);
  const unchangedRows = useMemo(() => rows.filter(r => r.status === 'unchanged'), [rows]);
  const errorRows = useMemo(() => rows.filter(r => r.status === 'error'), [rows]);
  const deleteRows = useMemo(() => rows.filter(r => r.status === 'delete'), [rows]);

  // Build tab configuration
  const tabs: TabConfig[] = useMemo(() => {
    const baseTabs: TabConfig[] = [
      { id: 'new', label: 'New', count: summary.new, badgeVariant: 'green' },
      { id: 'modified', label: 'Modified', count: summary.modified, badgeVariant: 'cyan' },
      { id: 'unchanged', label: 'Unchanged', count: summary.unchanged, badgeVariant: 'default' },
      { id: 'errors', label: 'Errors', count: summary.errors, badgeVariant: 'red' },
    ];

    // Add delete tab if there are any delete rows
    if (summary.deleted > 0) {
      baseTabs.push({
        id: 'delete',
        label: 'Delete',
        count: summary.deleted,
        badgeVariant: 'red'
      });
    }

    return baseTabs;
  }, [summary]);

  // Get current rows based on active tab
  const currentRows = useMemo(() => {
    switch (activeTab) {
      case 'new':
        return newRows;
      case 'modified':
        return modifiedRows;
      case 'unchanged':
        return unchangedRows;
      case 'errors':
        return errorRows;
      case 'delete':
        return deleteRows;
      default:
        return [];
    }
  }, [activeTab, newRows, modifiedRows, unchangedRows, errorRows, deleteRows]);

  // Pagination
  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    return currentRows.slice(start, end);
  }, [currentRows, page, pageSize]);

  // Reset page when tab changes
  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId as TabId);
    setPage(1);
  };

  // Get display name (usually second column or first string field)
  const getDisplayName = (row: ParsedRow): string => {
    // Try to find a 'name' field
    const nameField = schema.columns.find(c =>
      c.key.toLowerCase().includes('name') && c.key !== schema.uniqueKey
    );

    if (nameField) {
      const value = row.data[nameField.key];
      return value ? String(value) : '-';
    }

    // Fallback to second column
    if (schema.columns.length > 1) {
      const secondCol = schema.columns[1];
      const value = row.data[secondCol.key];
      return value ? String(value) : '-';
    }

    return '-';
  };

  // Build columns for New tab
  const newColumns = useMemo(() => {
    const cols = schema.columns.slice(0, 4).map(col => ({
      key: col.key,
      label: col.header,
      width: undefined
    }));

    return cols;
  }, [schema]);

  // Build columns for Modified tab
  const modifiedColumns = [
    { key: 'id', label: 'ID', width: '20%' },
    { key: 'name', label: 'Name', width: '30%' },
    { key: 'status', label: 'Status', width: '15%' },
    { key: 'changes', label: 'Changes', width: '35%' }
  ];

  // Build columns for Unchanged tab
  const unchangedColumns = [
    { key: 'id', label: 'ID', width: '40%' },
    { key: 'name', label: 'Name', width: '60%' }
  ];

  // Build columns for Errors tab
  const errorColumns = [
    { key: 'row', label: 'Row #', width: '15%' },
    { key: 'field', label: 'Field', width: '20%' },
    { key: 'error', label: 'Error', width: '40%' },
    { key: 'value', label: 'Value', width: '25%' }
  ];

  // Build columns for Delete tab
  const deleteColumns = [
    { key: 'id', label: 'ID', width: '30%' },
    { key: 'name', label: 'Name', width: '40%' },
    { key: 'status', label: 'Status', width: '30%' }
  ];

  // Transform rows for DataTable based on tab
  const tableData = useMemo(() => {
    switch (activeTab) {
      case 'new':
        return paginatedRows.map((row, idx) => {
          const data: { id: string; _row: typeof row; [key: string]: unknown } = {
            id: `new-${idx}`,
            _row: row, // Keep reference to original row
          };

          // Map schema columns
          schema.columns.slice(0, 4).forEach(col => {
            data[col.key] = row.data[col.key] ?? '-';
          });

          return data;
        });

      case 'modified':
        return paginatedRows.map((row, idx) => ({
          id: `modified-${idx}`,
          _row: row,
          name: getDisplayName(row),
          status: (
            <Badge variant="cyan" size="sm">
              MODIFIED
            </Badge>
          ),
          changes: row.diff ? `${row.diff.length} field${row.diff.length !== 1 ? 's' : ''} changed` : '-',
        }));

      case 'unchanged':
        return paginatedRows.map((row, idx) => ({
          id: `unchanged-${idx}`,
          _row: row,
          name: getDisplayName(row),
        }));

      case 'errors':
        // Flatten errors - one row per field error
        const errorData: { id: string; [key: string]: unknown }[] = [];
        paginatedRows.forEach(row => {
          if (row.validationResult?.errors && row.validationResult.errors.length > 0) {
            row.validationResult.errors.forEach((error, errorIdx) => {
              errorData.push({
                id: `error-${row.rowNumber}-${errorIdx}`,
                _row: row,
                row: row.rowNumber,
                field: error.column || '-',
                error: error.message || 'Unknown error',
                value: error.column ? String(row.data[error.column] ?? '-') : '-'
              });
            });
          } else {
            // Row marked as error but no specific field errors
            errorData.push({
              id: `error-${row.rowNumber}`,
              _row: row,
              row: row.rowNumber,
              field: '-',
              error: 'Validation failed',
              value: '-'
            });
          }
        });
        return errorData;

      case 'delete':
        return paginatedRows.map((row, idx) => ({
          id: `delete-${idx}`,
          _row: row,
          name: getDisplayName(row),
          status: (
            <Badge variant="red" size="sm">
              DELETE
            </Badge>
          ),
        }));

      default:
        return [];
    }
  }, [activeTab, paginatedRows, schema]);

  // Get columns based on active tab
  const columns = useMemo(() => {
    switch (activeTab) {
      case 'new':
        return newColumns;
      case 'modified':
        return modifiedColumns;
      case 'unchanged':
        return unchangedColumns;
      case 'errors':
        return errorColumns;
      case 'delete':
        return deleteColumns;
      default:
        return [];
    }
  }, [activeTab, newColumns]);

  // Handle row click
  const handleRowClick = (tableRow: { id: string | number; [key: string]: unknown }) => {
    if (onRowSelect && tableRow._row) {
      onRowSelect(tableRow._row as ParsedRow);
    }
  };

  // Build tabs for Tabs component
  const tabsForComponent = tabs.map(tab => ({
    id: tab.id,
    label: tab.label,
    count: tab.count,
  }));

  return (
    <div className={className} data-testid="import-confirmation-tabs" aria-label="import confirmation tabs">
      {/* Tabs */}
      <Tabs
        tabs={tabsForComponent}
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />

      {/* Content */}
      <div className="mt-4">
        {currentRows.length === 0 ? (
          <div className="text-center py-12 text-text-muted">
            No {activeTab} rows
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={tableData}
            onRowClick={handleRowClick}
            pagination={{
              page,
              pageSize,
              total: currentRows.length
            }}
            onPageChange={setPage}
          />
        )}
      </div>
    </div>
  );
}
