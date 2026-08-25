import { useMemo, useState, type ReactNode } from 'react';

// Shared data table primitive. Every list surface in the Schedules
// module (Schedules, Zones, Postcode Groups, US Zone Groups, US Zone
// Names, Depots) renders through this so heights, sort, and pagination
// behave consistently.
//
// Design:
//   * Shell matches ScheduledRoutes.tsx (bg-white rounded-xl border
//     overflow-x-auto). Header row bg-surface-cream. No max-h on the
//     table - the natural page (default 25 rows) sizes it.
//   * Sortable headers - click to toggle asc / desc. First click on a
//     sortable header sorts ascending; second click flips to
//     descending; subsequent clicks alternate.
//   * Pagination footer - "Prev  Page N of M  Next" plus total row
//     count. Hidden when only one page.
//   * Row click delegates to onRowClick if provided. Cell-level click
//     handlers can stopPropagation to opt out (e.g. auto-book toggle).
//   * Empty + loading states rendered inside the table body so the
//     shell chrome stays consistent.

export type DataTableAlign = 'left' | 'right' | 'center';

export interface DataTableColumn<T> {
  /** Stable identity used for the sort state. */
  key: string;
  /** Header cell content. */
  label: ReactNode;
  /** Row cell content. */
  render: (row: T) => ReactNode;
  /** Enable header-click sorting on this column. */
  sortable?: boolean;
  /**
   * Sort key extractor. Only used when `sortable` is true. Return
   * a comparable value (string / number / Date). null / undefined
   * sort to the end. If omitted on a sortable column, no-op sort.
   */
  sortValue?: (row: T) => string | number | Date | null | undefined;
  align?: DataTableAlign;
  /** Extra classes on the cell (both header + body). */
  className?: string;
  /** Extra classes on the header cell only. Useful for width utilities. */
  headerClassName?: string;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: DataTableColumn<T>[];
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  /** Fallback content when rows is empty (and not loading). */
  emptyMessage?: ReactNode;
  loading?: boolean;
  /** Rows per page. Default 25. */
  pageSize?: number;
  /** Minimum table width, e.g. 'min-w-[900px]'. Prevents narrow layouts from squishing columns. */
  minWidth?: string;
  /** Initial sort. Column must be sortable + carry a sortValue. */
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
  /**
   * When true, the sort/pagination state resets on rows-identity change.
   * Useful when reload swaps the entire dataset. Default true.
   */
  resetStateOnRowsChange?: boolean;
}

const ALIGN_CLASS: Record<DataTableAlign, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  emptyMessage = 'No rows.',
  loading = false,
  pageSize = 25,
  minWidth,
  defaultSort,
  resetStateOnRowsChange = true,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(defaultSort ?? null);
  const [page, setPage] = useState(0);

  // Reset page (and optionally sort) whenever the incoming rows array
  // reference changes - the caller is typically loading a fresh page
  // of data and expects to see page 0. Kept sort sticky because the
  // operator's sort preference outlives one reload.
  const rowsIdentity = rows; // referentially checked below via useMemo dep
  useMemo(() => {
    if (resetStateOnRowsChange) setPage(0);
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsIdentity]);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortable || !col.sortValue) return rows;
    const getKey = col.sortValue;
    const copy = rows.slice();
    copy.sort((a, b) => {
      const va = getKey(a);
      const vb = getKey(b);
      // null / undefined always sort to the end regardless of dir.
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      let cmp: number;
      if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
      else if (va instanceof Date && vb instanceof Date) cmp = va.getTime() - vb.getTime();
      else cmp = String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, sort, columns]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const start = currentPage * pageSize;
  const paged = sortedRows.slice(start, start + pageSize);

  const toggleSort = (col: DataTableColumn<T>) => {
    if (!col.sortable || !col.sortValue) return;
    setSort((prev) => {
      if (!prev || prev.key !== col.key) return { key: col.key, dir: 'asc' };
      return { key: col.key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
    });
  };

  return (
    <div>
      <div className="bg-white rounded-xl border border-border overflow-x-auto">
        <table className={`w-full text-xs ${minWidth ?? ''}`}>
          <thead className="bg-surface-cream border-b border-border">
            <tr className="text-left text-[11px] font-semibold text-text-muted">
              {columns.map((col) => {
                const isActive = sort?.key === col.key;
                const isSortable = !!col.sortable && !!col.sortValue;
                const alignClass = col.align ? ALIGN_CLASS[col.align] : 'text-left';
                return (
                  <th
                    key={col.key}
                    scope="col"
                    className={`px-2 py-1.5 ${alignClass} ${col.className ?? ''} ${col.headerClassName ?? ''} ${
                      isSortable ? 'cursor-pointer select-none hover:text-text-primary' : ''
                    }`}
                    onClick={isSortable ? () => toggleSort(col) : undefined}
                    aria-sort={isActive ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {isSortable && (
                        <span className={`text-[9px] ${isActive ? 'text-brand-cyan' : 'text-text-muted/60'}`} aria-hidden>
                          {isActive ? (sort!.dir === 'asc' ? '▲' : '▼') : '⇅'}
                        </span>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {paged.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b border-border-light last:border-b-0 hover:bg-surface-cream ${
                  onRowClick ? 'cursor-pointer' : ''
                }`}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-2 py-1.5 ${col.align ? ALIGN_CLASS[col.align] : ''} ${col.className ?? ''}`}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
            {!loading && paged.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="p-6 text-center text-xs text-text-muted italic">
                  {emptyMessage}
                </td>
              </tr>
            )}
            {loading && paged.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="p-6 text-center text-xs text-text-muted italic">
                  Loading...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-2 gap-2 text-[11px] text-text-secondary">
          <div>
            <span className="text-text-muted">Showing </span>
            <span className="font-semibold text-text-primary">{start + 1}</span>
            <span className="text-text-muted"> – </span>
            <span className="font-semibold text-text-primary">{Math.min(start + pageSize, sortedRows.length)}</span>
            <span className="text-text-muted"> of </span>
            <span className="font-semibold text-text-primary">{sortedRows.length}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="border border-border rounded-lg px-2 py-1 text-xs text-text-secondary hover:bg-surface-cream disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Previous page"
            >
              ←
            </button>
            <span className="px-2 tabular-nums">
              Page <span className="font-semibold text-text-primary">{currentPage + 1}</span> of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage >= totalPages - 1}
              className="border border-border rounded-lg px-2 py-1 text-xs text-text-secondary hover:bg-surface-cream disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Next page"
            >
              →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
