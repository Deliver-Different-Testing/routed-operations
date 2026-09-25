import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../components/common/Button';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { bulkImportService, type BulkJobDto } from '../services/bulkImportService';
import { NewImportWizard } from '../components/bulk-import/NewImportWizard';
import { StaffImportModal } from '../components/bulk-import/StaffImportModal';
import { BulkCompleteModal } from '../components/bulk-import/BulkCompleteModal';
import { ImportTypePill } from '../components/bulk-import/shared/ImportTypePill';
import { currencyCode, postcodeLabel, cityLabel } from '../lib/tenantLabels';

type Filter = 'all' | 'routed' | 'onDemand';
type SortKey =
  | 'jobNumber'
  | 'bookDate'
  | 'clientCode'
  | 'speed'
  | 'fromAddress'
  | 'toAddress'
  | 'toSuburbOrCity'
  | 'toZipOrPostcode'
  | 'quantity'
  | 'amount'
  | 'type';
type SortDir = 'asc' | 'desc';
const PAGE_SIZE = 50;

/**
 * Data Import list page - Phase 1 rewrite (2026-07-22).
 *
 * Matches the "Data Import" list section of BulkImportHyper's homeView.html.
 * Filter pills (All / Routed / On-Demand), search box, paginated 50-row
 * table with Job Number / Book Date / Client Code / Service / Qty / Amount /
 * Type / Delete columns. Row detail modal is a Phase 2 stub.
 */
export default function BulkImportPage() {
  const toast = useToast();
  const { isUsTenant, isInternal } = useAuth();
  const confirm = useConfirm();
  const [rows, setRows] = useState<BulkJobDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>('bookDate');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [staffImportOpen, setStaffImportOpen] = useState(false);
  const [bulkCompleteOpen, setBulkCompleteOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  // Bulk-delete selection. Keyed by `${type}-${id}` because id space isn't
  // unique across routed / on-demand / prebook tables (all three share the
  // same list). Prevents accidentally deleting a tucJob with the same id as
  // a tblBulkJob.
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { response } = await bulkImportService.getJobs();
      setRows(response.jobs ?? []);
    } catch (e) {
      toast.show(`Failed to load imports: ${(e as Error).message}`, 'error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Fire once on mount. `load` depends on `toast`; even though the ToastContext
  // value is now memoized (see ToastContext.tsx) we keep the empty dep array
  // as a defensive stopgap so any future consumer that widens `load`'s deps
  // does not accidentally re-introduce an infinite fetch loop here.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Client-side filter + search. The endpoint doesn't accept search/filter
  // query params today so we do it here.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== 'all') {
        const wanted = filter === 'routed' ? 'routed' : 'ondemand';
        if ((r.type ?? '').toLowerCase() !== wanted) return false;
      }
      if (!q) return true;
      const hay = [
        r.jobNumber,
        r.clientCode,
        r.fromAddress,
        r.fromSuburb,
        r.fromCity,
        r.fromCompany,
        r.toAddress,
        r.toSuburb,
        r.toCity,
        r.toCompany,
        r.toZipCode,
        r.toPostCode,
        r.speed,
      ]
        .map((v) => (v ?? '').toString().toLowerCase())
        .join(' | ');
      return hay.includes(q);
    });
  }, [filter, rows, search]);

  useEffect(() => {
    setPage(1);
  }, [filter, search]);

  // Client-side sort. Legacy homeControl.js has sortTable() for the same
  // column headers - we normalize each field to a comparable value + let
  // the operator toggle asc / desc by clicking the header.
  const sorted = useMemo(() => {
    const copy = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    const cmp = (a: BulkJobDto, b: BulkJobDto): number => {
      const va = getSortValue(a, sortKey, isUsTenant);
      const vb = getSortValue(b, sortKey, isUsTenant);
      if (va == null && vb == null) return 0;
      if (va == null) return 1 * dir;
      if (vb == null) return -1 * dir;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    };
    copy.sort(cmp);
    return copy;
  }, [filtered, sortKey, sortDir, isUsTenant]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageRows = sorted.slice(pageStart, pageStart + PAGE_SIZE);

  function toggleSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(k);
      setSortDir('asc');
    }
  }

  async function confirmDelete(row: BulkJobDto) {
    setPendingDeleteId(row.id);
    try {
      const isRouted = (row.type ?? '').toLowerCase() === 'routed';
      const req = isRouted
        ? bulkImportService.deleteRouted(row.id)
        : bulkImportService.deleteOnDemand(row.id);
      const { response } = await req;
      if (!response.success) {
        toast.show(
          `Delete failed: ${response.messages?.[0]?.message ?? 'unknown error'}`,
          'error'
        );
        return;
      }
      toast.show('Job deleted.', 'success');
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch (e) {
      toast.show(`Delete failed: ${(e as Error).message}`, 'error');
    } finally {
      setPendingDeleteId(null);
    }
  }

  // Reset selection when the filter or search narrows the visible set - any
  // ticked row that's no longer in `filtered` should not silently ride along
  // to a bulk delete.
  useEffect(() => {
    setSelectedKeys((prev) => {
      if (prev.size === 0) return prev;
      const validKeys = new Set(filtered.map((r) => rowKey(r)));
      const next = new Set<string>();
      for (const k of prev) if (validKeys.has(k)) next.add(k);
      return next.size === prev.size ? prev : next;
    });
  }, [filtered]);

  // Only rows that can actually be deleted participate in select-all so the
  // header checkbox reflects "everything I could bulk-delete now".
  const deletableFiltered = useMemo(
    () => filtered.filter((r) => r.canDelete),
    [filtered]
  );
  const selectedCount = selectedKeys.size;
  const allDeletableSelected =
    deletableFiltered.length > 0
    && deletableFiltered.every((r) => selectedKeys.has(rowKey(r)));
  const someDeletableSelected = selectedCount > 0 && !allDeletableSelected;

  function toggleRowSelected(row: BulkJobDto) {
    if (!row.canDelete) return;
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      const k = rowKey(row);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allDeletableSelected) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(deletableFiltered.map((r) => rowKey(r))));
    }
  }

  async function bulkDeleteSelected() {
    const rowsToDelete = filtered.filter((r) => selectedKeys.has(rowKey(r)) && r.canDelete);
    if (rowsToDelete.length === 0) return;
    const proceed = await confirm({
      title: 'Delete imports',
      message: `Delete ${rowsToDelete.length} selected import${rowsToDelete.length === 1 ? '' : 's'}?`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!proceed) return;
    setBulkDeleting(true);
    const failed: Array<{ jobNumber: string | null; err: string }> = [];
    const succeededKeys = new Set<string>();
    // Sequential to keep the backend happy and preserve error attribution.
    // Small N (page-scoped selections in practice) so latency is fine.
    for (const row of rowsToDelete) {
      try {
        const isRouted = (row.type ?? '').toLowerCase() === 'routed';
        const req = isRouted
          ? bulkImportService.deleteRouted(row.id)
          : bulkImportService.deleteOnDemand(row.id);
        const { response } = await req;
        if (!response.success) {
          failed.push({ jobNumber: row.jobNumber, err: response.messages?.[0]?.message ?? 'unknown error' });
        } else {
          succeededKeys.add(rowKey(row));
        }
      } catch (e) {
        failed.push({ jobNumber: row.jobNumber, err: (e as Error).message });
      }
    }
    if (succeededKeys.size > 0) {
      setRows((prev) => prev.filter((r) => !succeededKeys.has(rowKey(r))));
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        for (const k of succeededKeys) next.delete(k);
        return next;
      });
    }
    setBulkDeleting(false);
    if (failed.length === 0) {
      toast.show(`Deleted ${succeededKeys.size} job${succeededKeys.size === 1 ? '' : 's'}.`, 'success');
    } else {
      const preview = failed.slice(0, 3).map((f) => `${f.jobNumber ?? '?'}: ${f.err}`).join('; ');
      toast.show(
        `Deleted ${succeededKeys.size}. Failed ${failed.length}: ${preview}${failed.length > 3 ? '...' : ''}`,
        'warning'
      );
    }
  }

  const counts = useMemo(() => {
    let routed = 0;
    let onDemand = 0;
    for (const r of rows) {
      const t = (r.type ?? '').toLowerCase();
      if (t === 'routed') routed++;
      else if (t === 'ondemand') onDemand++;
    }
    return { all: rows.length, routed, onDemand };
  }, [rows]);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-surface-cream">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border-light bg-surface-white shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-brand-cyan flex items-center justify-center text-brand-dark font-bold text-sm">
            D
          </div>
          <span className="text-sm font-semibold text-text-primary tracking-wide">DFRNT</span>
        </div>
        <Button variant="neutral" size="sm" onClick={() => load()} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </header>

      <div className="flex items-center justify-between px-4 py-3 border-b border-border-light bg-surface-white">
        <div />
        <div className="flex gap-2">
          {selectedCount > 0 && (
            <Button
              variant="danger"
              size="md"
              onClick={bulkDeleteSelected}
              disabled={bulkDeleting}
              title={`Delete ${selectedCount} selected job${selectedCount === 1 ? '' : 's'}.`}
            >
              {bulkDeleting ? `Deleting ${selectedCount}...` : `Delete Selected (${selectedCount})`}
            </Button>
          )}
          {isInternal && (
            <Button
              variant="neutral"
              size="md"
              onClick={() => setStaffImportOpen(true)}
              title="Direct-insert path for internal staff. Bypasses the wizard."
            >
              Staff Import
            </Button>
          )}
          {/* Bulk Complete hidden to match legacy BulkImportHyper behaviour
              (homeView.html:26-28 keeps the button commented out). Feature
              plumbing (state, modal, service methods, API endpoints) is left
              intact so it can be re-enabled by uncommenting this block.
          <Button
            variant="neutral"
            size="md"
            onClick={() => setBulkCompleteOpen(true)}
            title="Mark a batch of routed or on-demand jobs as complete by job number."
          >
            Bulk Complete
          </Button>
          */}
          <Button variant="primary" size="md" onClick={() => setWizardOpen(true)}>
            New Import
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border-light bg-surface-white">
        <span className="text-xs font-medium text-text-secondary">Filter by Job Type:</span>
        <div className="flex gap-1">
          <Button
            variant="neutral"
            size="sm"
            active={filter === 'all'}
            onClick={() => setFilter('all')}
          >
            All Jobs ({counts.all})
          </Button>
          <Button
            variant="neutral"
            size="sm"
            active={filter === 'routed'}
            onClick={() => setFilter('routed')}
          >
            Routed ({counts.routed})
          </Button>
          <Button
            variant="neutral"
            size="sm"
            active={filter === 'onDemand'}
            onClick={() => setFilter('onDemand')}
          >
            On-Demand ({counts.onDemand})
          </Button>
        </div>
        <div className="flex-1 min-w-[220px]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by job number, address, company, etc."
          className="text-sm border border-border rounded px-3 py-1.5 min-w-[280px] focus:outline-none focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan"
          aria-label="Search imports"
        />
      </div>

      <main className="flex-1 overflow-auto px-4 py-3">
        <div className="bg-surface-white border border-border rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-cream text-xs uppercase tracking-wide text-text-secondary">
              <tr>
                <th className="text-center px-3 py-2 w-10">
                  <input
                    type="checkbox"
                    aria-label={allDeletableSelected ? 'Unselect all' : 'Select all deletable rows'}
                    title={allDeletableSelected ? 'Unselect all' : 'Select all deletable rows'}
                    checked={allDeletableSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someDeletableSelected;
                    }}
                    disabled={deletableFiltered.length === 0}
                    onChange={toggleSelectAll}
                    className="cursor-pointer accent-brand-cyan"
                  />
                </th>
                <SortableTh label="Job Number" k="jobNumber" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Book Date" k="bookDate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Client Code" k="clientCode" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Service" k="speed" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="From" k="fromAddress" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="To" k="toAddress" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label={cityLabel(isUsTenant)} k="toSuburbOrCity" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label={postcodeLabel(isUsTenant)} k="toZipOrPostcode" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Qty" k="quantity" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                <SortableTh label="Amount" k="amount" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                <SortableTh label="Type" k="type" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <th className="text-center px-3 py-2 w-16">Delete</th>
              </tr>
            </thead>
            <tbody>
              {loading && pageRows.length === 0 && (
                <>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <tr key={`sk-${i}`} className="animate-pulse border-t border-border-light">
                      <td colSpan={13} className="px-3 py-3">
                        <div className="h-3 bg-border rounded" />
                      </td>
                    </tr>
                  ))}
                </>
              )}
              {!loading && pageRows.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-3 py-6 text-center text-sm text-text-muted">
                    {rows.length === 0
                      ? 'No imports yet. Click New Import to get started.'
                      : 'No imports match the current filter.'}
                  </td>
                </tr>
              )}
              {pageRows.map((r) => {
                const key = rowKey(r);
                const isSelected = selectedKeys.has(key);
                // Zebra stripes on odd rows + a selected-row highlight that
                // takes precedence. Hover still lifts either state slightly.
                // Zebra: even rows keep pure white; odd rows get a faint
                // brand-cyan tint. `/[0.05]` reads as ~#f3fcfd against white -
                // enough contrast to segment rows on wide tables without
                // washing out text. Selected takes precedence and darkens.
                const rowClass = isSelected
                  ? 'bg-brand-cyan/15 hover:bg-brand-cyan/20'
                  : 'even:bg-surface-white odd:bg-brand-cyan/[0.05] hover:bg-brand-cyan/10';
                return (
                <tr
                  key={key}
                  className={`border-t border-border-light transition-colors ${rowClass}`}
                >
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={!r.canDelete || bulkDeleting}
                      onChange={() => toggleRowSelected(r)}
                      aria-label={`Select job ${r.jobNumber ?? r.id}`}
                      className="cursor-pointer accent-brand-cyan disabled:cursor-not-allowed disabled:opacity-30"
                    />
                  </td>
                  <td className="px-3 py-2 font-medium text-text-primary uppercase">
                    {r.jobNumber ?? '-'}
                  </td>
                  <td className="px-3 py-2 text-text-secondary whitespace-nowrap">
                    {formatDate(r.bookDate)}
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{r.clientCode ?? '-'}</td>
                  <td className="px-3 py-2 text-text-secondary">{r.speed ?? '-'}</td>
                  <td className="px-3 py-2 text-text-secondary truncate max-w-[200px]" title={r.fromAddress ?? ''}>
                    {r.fromAddress ?? '-'}
                  </td>
                  <td className="px-3 py-2 text-text-secondary truncate max-w-[200px]" title={r.toAddress ?? ''}>
                    {r.toAddress ?? '-'}
                  </td>
                  <td className="px-3 py-2 text-text-secondary">
                    {(isUsTenant ? r.toCity : r.toSuburb) ?? '-'}
                  </td>
                  <td className="px-3 py-2 text-text-secondary">
                    {(isUsTenant ? r.toZipCode : r.toPostCode) ?? '-'}
                  </td>
                  <td className="px-3 py-2 text-right text-text-secondary">
                    {r.quantity ?? 0}
                  </td>
                  <td className="px-3 py-2 text-right text-text-secondary">
                    {formatAmount(r.amount, isUsTenant)}
                  </td>
                  <td className="px-3 py-2">
                    <ImportTypePill type={r.type} isUsTenant={isUsTenant} />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      aria-label={`Delete job ${r.jobNumber ?? r.id}`}
                      title={r.canDelete ? 'Delete this import' : 'Delete unavailable'}
                      disabled={!r.canDelete || pendingDeleteId === r.id}
                      onClick={async () => {
                        const proceed = await confirm({
                          title: 'Delete import',
                          message: `Delete import ${r.jobNumber ?? r.id}?`,
                          confirmLabel: 'Delete',
                          danger: true,
                        });
                        if (!proceed) return;
                        confirmDelete(r);
                      }}
                      className="text-text-muted hover:text-error disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-3 text-xs text-text-secondary">
            <div>
              Showing {pageStart + 1}-{Math.min(pageStart + PAGE_SIZE, filtered.length)} of{' '}
              {filtered.length}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="neutral"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </Button>
              <span className="px-2">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="neutral"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </main>

      <NewImportWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        // onImported fires as soon as the per-depot import loop lands, so
        // the list refreshes in the background. It MUST NOT close the
        // wizard - the BookPickup + ImportSummary steps still need to
        // render on top for pickup-enabled clients or batches with failed
        // rows. The wizard closes itself via onClose when the operator
        // hits Cancel or after those trailing steps finish.
        onImported={() => {
          load();
        }}
      />
      {isInternal && (
        <StaffImportModal
          open={staffImportOpen}
          onClose={() => setStaffImportOpen(false)}
          onImported={() => {
            load();
          }}
        />
      )}
      <BulkCompleteModal
        open={bulkCompleteOpen}
        onClose={() => setBulkCompleteOpen(false)}
        onCompleted={() => {
          load();
        }}
      />
    </div>
  );
}

/**
 * SortableTh - clickable table header. Shows a chevron for the active
 * column, greyed when inactive. Toggles asc / desc on repeat clicks;
 * clicking a different column starts fresh at asc. Mirrors
 * BulkImportHyper's `sortTable()` at homeControl.js.
 */
interface SortableThProps {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  align?: 'left' | 'right' | 'center';
}
function SortableTh({ label, k, sortKey, sortDir, onSort, align = 'left' }: SortableThProps) {
  const active = k === sortKey;
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  const chevron = active ? (sortDir === 'asc' ? '▲' : '▼') : '';
  return (
    <th className={`${alignClass} px-3 py-2 cursor-pointer select-none hover:text-brand-cyan`}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`${alignClass === 'text-right' ? 'ml-auto flex flex-row-reverse' : 'flex'} items-center gap-1 uppercase tracking-wide text-xs font-semibold ${active ? 'text-brand-cyan' : 'text-text-secondary'}`}
      >
        <span>{label}</span>
        {active && <span aria-hidden="true">{chevron}</span>}
      </button>
    </th>
  );
}

/**
 * Extract a comparable value from a row for the given sort column. Numbers
 * for numeric fields, strings for text; null flows through so nulls always
 * sort to the end regardless of direction.
 */
function getSortValue(r: BulkJobDto, k: SortKey, isUs: boolean): string | number | null {
  switch (k) {
    case 'jobNumber':
      return r.jobNumber?.toLowerCase() ?? null;
    case 'bookDate':
      return r.bookDate ? new Date(r.bookDate).getTime() : null;
    case 'clientCode':
      return r.clientCode?.toLowerCase() ?? null;
    case 'speed':
      return r.speed?.toLowerCase() ?? null;
    case 'fromAddress':
      return r.fromAddress?.toLowerCase() ?? null;
    case 'toAddress':
      return r.toAddress?.toLowerCase() ?? null;
    case 'toSuburbOrCity':
      return (isUs ? r.toCity : r.toSuburb)?.toLowerCase() ?? null;
    case 'toZipOrPostcode':
      return (isUs ? r.toZipCode : r.toPostCode) ?? null;
    case 'quantity':
      return r.quantity ?? null;
    case 'amount':
      return r.amount ?? null;
    case 'type':
      return r.type?.toLowerCase() ?? null;
    default:
      return null;
  }
}

/**
 * Composite selection key for a job row. The id space isn't unique across
 * routed / on-demand / prebook (each lives in its own table), so we prefix
 * with `type` to prevent accidentally targeting the wrong row for delete.
 */
function rowKey(r: BulkJobDto): string {
  return `${(r.type ?? '').toLowerCase()}-${r.id}`;
}

function formatDate(iso: string) {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

function formatAmount(amount: number | null, isUsTenant: boolean) {
  if (amount == null) return '-';
  return amount.toLocaleString(undefined, { style: 'currency', currency: currencyCode(isUsTenant) });
}

function TrashIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
