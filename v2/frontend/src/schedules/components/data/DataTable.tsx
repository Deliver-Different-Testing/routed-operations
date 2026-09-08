import { useState } from 'react';
import type { ReactNode } from 'react';

/** Column definition for the data table. */
interface Column {
  key: string;
  label: string;
  width?: string;
}

/** Base row shape — every row must have a string `id`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DataRow = { id: string | number; [key: string]: any };

/** Generic data table with selection, pagination, and row actions. */
interface DataTableProps {
  columns: Column[];
  data: DataRow[];
  selectable?: boolean;
  selectedIds?: Set<string | number>;
  onSelectionChange?: (ids: Set<string | number>) => void;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
  };
  onPageChange?: (page: number) => void;
  actions?: (row: DataRow) => ReactNode;
  onRowClick?: (row: DataRow) => void;
  /** Accessible caption for the table. */
  caption?: string;
}

export type { Column, DataTableProps };

export const DataTable = ({
  columns,
  data,
  selectable = false,
  selectedIds = new Set(),
  onSelectionChange,
  pagination,
  onPageChange,
  actions,
  onRowClick,
  caption,
}: DataTableProps) => {
  const [localSelectedIds, setLocalSelectedIds] = useState<Set<string | number>>(selectedIds);

  const currentSelectedIds = onSelectionChange ? selectedIds : localSelectedIds;

  const handleSelectAll = (checked: boolean) => {
    const newSelectedIds = checked
      ? new Set(data.map(row => row.id))
      : new Set<string | number>();

    if (onSelectionChange) {
      onSelectionChange(newSelectedIds);
    } else {
      setLocalSelectedIds(newSelectedIds);
    }
  };

  const handleSelectRow = (rowId: string | number, checked: boolean) => {
    const newSelectedIds = new Set(currentSelectedIds);

    if (checked) {
      newSelectedIds.add(rowId);
    } else {
      newSelectedIds.delete(rowId);
    }

    if (onSelectionChange) {
      onSelectionChange(newSelectedIds);
    } else {
      setLocalSelectedIds(newSelectedIds);
    }
  };

  const allSelected = data.length > 0 && data.every(row => currentSelectedIds.has(row.id));
  const someSelected = data.some(row => currentSelectedIds.has(row.id)) && !allSelected;

  const renderPagination = () => {
    if (!pagination || !onPageChange) return null;

    const { page, pageSize, total } = pagination;
    const totalPages = Math.ceil(total / pageSize);
    const startItem = (page - 1) * pageSize + 1;
    const endItem = Math.min(page * pageSize, total);

    const getPageNumbers = () => {
      const pages: (number | string)[] = [];
      const maxVisiblePages = 5;

      if (totalPages <= maxVisiblePages + 2) {
        for (let i = 1; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        pages.push(1);

        if (page > 3) {
          pages.push('...');
        }

        const start = Math.max(2, page - 1);
        const end = Math.min(totalPages - 1, page + 1);

        for (let i = start; i <= end; i++) {
          pages.push(i);
        }

        if (page < totalPages - 2) {
          pages.push('...');
        }

        pages.push(totalPages);
      }

      return pages;
    };

    return (
      <div className="flex items-center justify-between px-6 py-3 border-t border-border bg-white">
        <div className="text-sm text-text-secondary" aria-live="polite">
          Showing {startItem}-{endItem} of {total.toLocaleString()}
        </div>
        <nav aria-label="Table pagination" className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page === 1}
            aria-label="Previous page"
            className="px-3 py-1 text-sm text-text-secondary hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            &lt;
          </button>
          {getPageNumbers().map((pageNum, index) => (
            typeof pageNum === 'number' ? (
              <button
                key={index}
                onClick={() => onPageChange(pageNum)}
                className={`px-3 py-1 text-sm rounded ${
                  page === pageNum
                    ? 'bg-brand-cyan text-white'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {pageNum}
              </button>
            ) : (
              <span key={index} className="px-2 text-text-secondary">
                {pageNum}
              </span>
            )
          ))}
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page === totalPages}
            aria-label="Next page"
            className="px-3 py-1 text-sm text-text-secondary hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            &gt;
          </button>
        </nav>
      </div>
    );
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden" data-testid="data-table">
      <div className="overflow-x-auto">
        <table className="w-full">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="bg-surface-light">
            <tr>
              {selectable && (
                <th className="w-10 px-3 py-2.5 text-left">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    aria-label="Select all rows"
                    ref={input => {
                      if (input) {
                        input.indeterminate = someSelected;
                      }
                    }}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className="w-4 h-4 rounded border-border text-brand-cyan focus:ring-brand-cyan focus:ring-offset-0 focus:ring-2"
                  />
                </th>
              )}
              {columns.map((column) => (
                <th
                  key={column.key}
                  className="px-3 py-2.5 text-left text-xs font-medium text-text-muted uppercase tracking-wider whitespace-nowrap"
                  style={column.width ? { width: column.width } : undefined}
                >
                  {column.label}
                </th>
              ))}
              {actions && (
                <th className="px-3 py-2.5 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-border">
            {data.map((row) => {
              const isSelected = currentSelectedIds.has(row.id);
              return (
                <tr
                  key={row.id}
                  className={`border-b border-border transition-colors duration-150 cursor-pointer ${
                    isSelected
                      ? 'bg-brand-cyan/10 hover:bg-brand-cyan/15'
                      : 'hover:bg-surface-light'
                  }`}
                  onClick={() => onRowClick?.(row)}
                >
                  {selectable && (
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        aria-label={`Select row ${row.id}`}
                        onChange={(e) => handleSelectRow(row.id, e.target.checked)}
                        className="w-4 h-4 rounded border-border text-brand-cyan focus:ring-brand-cyan focus:ring-offset-0 focus:ring-2"
                      />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td key={column.key} className="px-3 py-2.5 text-sm text-text-primary whitespace-nowrap">
                      {row[column.key]}
                    </td>
                  ))}
                  {actions && (
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      {actions(row)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {renderPagination()}
    </div>
  );
};
