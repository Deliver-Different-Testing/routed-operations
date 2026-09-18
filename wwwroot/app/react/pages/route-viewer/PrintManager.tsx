import { Fragment, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { routeViewerService, type BulkJob } from '../../services/routeViewerService';
import { useRouteViewerLookups } from '../../hooks/queries/useRouteViewerLookups';
import { tenantDateFromSpString, tenantTimeFromSpString, tenantTodayYmd } from '../../lib/tenantDate';
import { Button } from '../../components/common/Button';
import { RvBox } from '../../components/route-viewer/RvBox';
import { RvOverviewBox } from '../../components/route-viewer/RvOverviewBox';
import { RvJobDetail } from '../../components/route-viewer/RvJobDetail';
import { RvScanDetailBox } from '../../components/route-viewer/RvScanDetailBox';
import { useToast } from '../../context/ToastContext';
import type { ListSort } from '../../components/cockpit/CockpitState';
import { nextSortDirection, sortIndicator } from '../../lib/sortLists';

// Print Manager page (master Section 11). Wires to the dedicated
// Print list endpoint (`GET /runviewer/jobs/print-list` -> wraps
// `RVW_stpPrintJobsV2`) so the 13-column legacy grid parity fields
// (Speed / RefA / RefB / OurRef / Mobile / Email / Notes) land in
// the row shape without a separate DTO. Multi-select rows and hit
// Print Labels to POST them at `/api/runviewer/labels/bulk-jobs`.
//
// Backend label endpoints are still 501 pending the P14 AlertLabel +
// SSRS wiring. The UI is complete so the flow lights up immediately
// once the backend lands.

type SortMode = 1 | 2 | 3 | 4;

// Legacy printControl.js jobList.headings order, mapped to BulkJob fields.
type PrintColumn = {
  label: string;
  field: string;                             // used as ListSort field id + search matching
  get: (j: BulkJob) => string | number | null;
  className?: string;                        // per-<td> tailwind width / truncation
  align?: 'left' | 'center' | 'right';
};

const COLUMNS: PrintColumn[] = [
  { label: 'Client',  field: 'clientCode', get: (j) => j.clientCode },
  { label: 'Job #',   field: 'jobNumber',  get: (j) => j.jobNumber, className: 'font-mono' },
  { label: 'D Date',  field: 'bookDate',   get: (j) => j.bookDate },
  { label: 'R Time',  field: 'bookTime',   get: (j) => j.bookTime },
  { label: 'Speed',   field: 'speed',      get: (j) => j.speed ?? j.speedName },
  { label: 'Qty',     field: 'qty',        get: (j) => j.qty, align: 'center' },
  { label: 'RefA',    field: 'refA',       get: (j) => j.refA, className: 'max-w-[16ch] truncate' },
  { label: 'RefB',    field: 'refB',       get: (j) => j.refB, className: 'max-w-[16ch] truncate' },
  { label: 'OurRef',  field: 'ourRef',     get: (j) => j.ourRef, className: 'max-w-[16ch] truncate' },
  { label: 'Mobile',  field: 'mobile',     get: (j) => j.proofOfDeliveryMobile ?? j.deliverToPhone, className: 'max-w-[14ch] truncate' },
  { label: 'Email',   field: 'email',      get: (j) => j.trackingEmail ?? j.proofOfDeliveryEmail, className: 'max-w-[24ch] truncate' },
  { label: 'To',      field: 'toAddress',  get: (j) => j.toAddress, className: 'max-w-[16rem] truncate' },
  { label: 'Notes',   field: 'notes',      get: (j) => j.notes, className: 'max-w-[24ch] truncate' },
];

// Substring-match every visible column's stringified value against the
// search query (case-insensitive). Runs on the sorted rows list, not
// the full result set, so it doesn't shuffle order.
function matchesSearch(row: BulkJob, needle: string): boolean {
  if (!needle) return true;
  const q = needle.toLowerCase();
  for (const col of COLUMNS) {
    const v = col.get(row);
    if (v == null) continue;
    if (String(v).toLowerCase().includes(q)) return true;
  }
  return false;
}

export default function PrintManager() {
  const user = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const initialDate = tenantTodayYmd({ isUsTenant: user.isUsTenant, timeZone: user.timeZone });
  const [runDate, setRunDate] = useState(initialDate);
  // Legacy 4-choice sort dropdown; kept alongside the column-header
  // sort per audit request. Both feed the same visible sort state so
  // the arrow indicator + list order stay consistent.
  const [sortMode, setSortMode] = useState<SortMode>(1);
  const [columnSort, setColumnSort] = useState<ListSort | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [editItemsFor, setEditItemsFor] = useState<{ bulkJobId: number; qty: number } | null>(null);
  // Focused job for the right-side JobDetail + ScanList panels. Legacy
  // Print Manager surfaces these to the right of the list; operators
  // drill into a print row and see the job's full record + scan history.
  const [focusedJobId, setFocusedJobId] = useState<number | null>(null);
  // Multibox inline expand: which parent bulkJobIds are currently open,
  // and a lazy client-side cache of their child rows. First chevron click
  // fetches + caches; second click flips visibility only (no refetch).
  // Kept as two separate pieces of state so a collapse retains the cache
  // for the next expand without a network round-trip. Matches the legacy
  // jobList.tpl `getChildren(job)` + `job.expanded` toggle at lines 27+38.
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set());
  const [childrenCache, setChildrenCache] = useState<Map<number, BulkJob[]>>(() => new Map());
  const [childrenLoading, setChildrenLoading] = useState<Set<number>>(() => new Set());
  // Top-bar substring search over any-column value. 200ms debounce so
  // typing does not thrash the memoised filter on every keystroke.
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setSearchQuery(searchInput.trim()), 200);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  // Hydrate tenant lookups so the first fetch already carries the full
  // clientIds + regionIds scope. Fixes George's 2026-09-18 Medical-Prod
  // report: RVW_stpPrintJobsV2 was returning 0 rows because the query
  // called `getPrintJobList(runDate)` with null @ClientIDs + null
  // @Regions. Legacy /home/PrintJobList always sends the operator's
  // checked-client + checked-region sets (printService.js:6). Defaulting
  // to "everything the tenant + user can see" matches legacy on a fresh
  // page-load with no filters touched.
  const lookups = useRouteViewerLookups(runDate);
  const defaultClientIds = useMemo(
    () => lookups.clients.map((c) => c.id).filter((id) => id > 0),
    [lookups.clients],
  );
  const defaultRegionIds = useMemo(
    () => lookups.regions.map((r) => r.id).filter((id) => id > 0),
    [lookups.regions],
  );

  const q = useQuery({
    // Include the lookup array lengths so the query refetches once
    // lookups arrive (initial paint has 0 clients/regions, then the
    // lookup responses land and the query key changes).
    queryKey: ['pm-list', runDate, defaultClientIds.length, defaultRegionIds.length],
    queryFn: () => routeViewerService.getPrintJobList(runDate, {
      clientIds: defaultClientIds.length > 0 ? defaultClientIds : undefined,
      regionIds: defaultRegionIds.length > 0 ? defaultRegionIds : undefined,
    }),
    // Wait until the lookups settle so we don't waste a call with
    // empty arrays that reproduces the exact bug this fix is closing.
    // If the lookups themselves fail (0 rows), fire anyway - the
    // filter arrays fall to undefined and behaviour matches the
    // pre-fix path (which at least surfaces a network error rather
    // than looking indefinitely blocked).
    enabled: !!runDate && !lookups.isLoading,
    staleTime: 10_000,
  });

  const rows = q.data ?? [];

  // Client-side sort. Column-header sort wins when set (mirrors the
  // Home cockpit's ListSort semantics via sortLists.ts helpers).
  // Otherwise fall back to the legacy labelsSortMode 1-4 dropdown:
  //   1 = Job # (default), 2 = Client, 3 = Delivery Date, 4 = Ready Time.
  const sorted = useMemo(() => {
    const copy = rows.slice();
    if (columnSort) {
      const col = COLUMNS.find((c) => c.field === columnSort.field);
      if (col) {
        const mult = columnSort.direction === 'asc' ? 1 : -1;
        copy.sort((a, b) => {
          const av = col.get(a);
          const bv = col.get(b);
          if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
          return String(av ?? '').localeCompare(String(bv ?? '')) * mult;
        });
        return copy;
      }
    }
    copy.sort((a, b) => {
      switch (sortMode) {
        case 1: return (a.jobNumber ?? '').localeCompare(b.jobNumber ?? '');
        case 2: return (a.clientCode ?? '').localeCompare(b.clientCode ?? '');
        case 3: return (a.bookDate ?? '').localeCompare(b.bookDate ?? '');
        case 4: return (a.bookTime ?? '').localeCompare(b.bookTime ?? '');
      }
    });
    return copy;
  }, [rows, sortMode, columnSort]);

  const visible = useMemo(
    () => (searchQuery ? sorted.filter((r) => matchesSearch(r, searchQuery)) : sorted),
    [sorted, searchQuery],
  );

  const toggle = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  };
  const selectAll = () => setSelectedIds(visible.map((r) => r.bulkJobId));
  const clearAll = () => setSelectedIds([]);

  // Chevron click on a multibox parent row. Toggle-only when the row is
  // already open (cache-preserving collapse). First open fires the child
  // fetch, caches under the parent bulkJobId, and marks the row expanded
  // when the request lands. Failure surfaces via useToast and leaves the
  // row unexpanded so the operator can retry.
  const toggleExpand = async (bulkJobId: number) => {
    if (expandedIds.has(bulkJobId)) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.delete(bulkJobId);
        return next;
      });
      return;
    }
    if (childrenCache.has(bulkJobId)) {
      setExpandedIds((prev) => new Set(prev).add(bulkJobId));
      return;
    }
    setChildrenLoading((prev) => new Set(prev).add(bulkJobId));
    try {
      const children = await routeViewerService.getPrintJobChildren(bulkJobId, runDate);
      setChildrenCache((prev) => {
        const next = new Map(prev);
        next.set(bulkJobId, children);
        return next;
      });
      setExpandedIds((prev) => new Set(prev).add(bulkJobId));
    } catch (e) {
      toast.show(`Load children failed: ${(e as Error).message}`, 'error');
    } finally {
      setChildrenLoading((prev) => {
        const next = new Set(prev);
        next.delete(bulkJobId);
        return next;
      });
    }
  };

  const printSelected = async () => {
    if (selectedIds.length === 0) return;
    setSubmitting(true);
    try {
      await routeViewerService.printLabels(selectedIds);
      toast.show(`Print queued for ${selectedIds.length} job(s).`);
      setSelectedIds([]);
    } catch (e) {
      // Backend is 501 today (P14 AlertLabel + SSRS wiring pending);
      // surface the error verbatim so operators aren't confused.
      toast.show(`Print failed: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Bulk cancel selected jobs. Wraps RVW_stpCancelJob per legacy
  // printControl.js jobListMenu Cancel entry. Confirm-gated because
  // cancel is not reversible from this surface (operator has to
  // Activate the job again).
  const cancelSelected = async () => {
    if (selectedIds.length === 0) return;
    if (!(await confirm({
      title: 'Cancel jobs',
      message: `Cancel ${selectedIds.length} job(s)? This voids them and cannot be undone from this surface.`,
      danger: true,
    }))) return;
    setSubmitting(true);
    try {
      await routeViewerService.cancelJobs(selectedIds);
      toast.show(`Cancelled ${selectedIds.length} job(s).`, 'success');
      setSelectedIds([]);
      q.refetch();
    } catch (e) {
      toast.show(`Cancel failed: ${(e as Error).message}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Save the edited item quantity for a single job. Wraps the
  // WS_stpBulkJob_Update SP downstream via updateJobTextFields (which
  // triggers the item barcode + Amount cascade). Single-job scope
  // since qty edits are per-package.
  const saveEditItems = async () => {
    if (!editItemsFor) return;
    setSubmitting(true);
    try {
      await routeViewerService.updateJobTextFields(editItemsFor.bulkJobId, {
        quantity: editItemsFor.qty,
      });
      toast.show(`Updated item count to ${editItemsFor.qty}.`, 'success');
      setEditItemsFor(null);
      q.refetch();
    } catch (e) {
      toast.show(`Edit items failed: ${(e as Error).message}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-border bg-surface-white">
        <label className="flex items-center gap-1 text-xs text-text-secondary">
          <span>Date</span>
          <input
            type="date"
            value={runDate}
            onChange={(e) => setRunDate(e.target.value)}
            className="border border-border rounded px-2 py-0.5 text-xs bg-surface-white"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-text-muted">
          <span>Sort</span>
          <select
            value={String(sortMode)}
            onChange={(e) => { setSortMode(Number(e.target.value) as SortMode); setColumnSort(null); }}
            className="border border-border rounded px-2 py-0.5 text-xs bg-surface-white"
          >
            <option value="1">Job #</option>
            <option value="2">Client</option>
            <option value="3">Delivery Date</option>
            <option value="4">Ready Time</option>
          </select>
        </label>
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search jobs..."
          aria-label="Search jobs"
          className="border border-border rounded px-2 py-0.5 text-xs bg-surface-white"
        />
        <Button variant="neutral" size="sm" onClick={selectAll}>Select all</Button>
        <Button variant="neutral" size="sm" onClick={clearAll} disabled={selectedIds.length === 0}>Clear</Button>
        <Button variant="primary" size="sm" onClick={printSelected} disabled={selectedIds.length === 0 || submitting}>
          {submitting ? 'Printing...' : `Print Labels (${selectedIds.length})`}
        </Button>
        <Button variant="neutral" size="sm" onClick={cancelSelected} disabled={selectedIds.length === 0 || submitting}>
          Cancel ({selectedIds.length})
        </Button>
        <div className="ml-auto text-xs text-text-muted">
          {q.isLoading ? 'Loading...' : `${visible.length} jobs`}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-[3] min-w-0 flex flex-col overflow-hidden border-r border-border">
          {/* Overview - fixed height (~160px), scrolls internally if
              region list overflows. Below it Print list takes flex-1. */}
          <div className="h-40 flex-shrink-0 border-b border-border overflow-hidden">
            <RvOverviewBox runDate={runDate} />
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
        <RvBox title="Print list">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface-white border-b border-border">
              <tr className="text-left text-text-muted">
                <th className="px-2 py-1 w-6">
                  <input
                    type="checkbox"
                    checked={selectedIds.length > 0 && selectedIds.length === visible.length}
                    onChange={(e) => (e.target.checked ? selectAll() : clearAll())}
                    className="accent-brand-cyan"
                  />
                </th>
                {/* Chevron column - only meaningful for multibox parent
                    rows, kept empty in the header to match the legacy
                    layout which put the expand icon inline in the Items
                    cell. Given the current 13-column shape it's cleaner
                    as a dedicated leading column so widths don't shift
                    when a chevron appears mid-row. */}
                <th className="px-1 py-1 w-6"></th>
                {COLUMNS.map((c) => (
                  <th
                    key={c.field}
                    onClick={() => { setColumnSort(nextSortDirection(columnSort, c.field)); }}
                    className={`px-2 py-1 cursor-pointer select-none hover:bg-surface-cream/60 ${c.align === 'center' ? 'text-center' : ''}`}
                    title="Click to sort. Click again to reverse."
                  >
                    {c.label}{sortIndicator(columnSort, c.field)}
                  </th>
                ))}
                <th className="px-2 py-1 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const selected = selectedIds.includes(r.bulkJobId);
                const focused = focusedJobId === r.bulkJobId;
                const isMultiBox = r.multiBox === true;
                const isExpanded = expandedIds.has(r.bulkJobId);
                const isLoadingChildren = childrenLoading.has(r.bulkJobId);
                const children = childrenCache.get(r.bulkJobId) ?? [];
                return (
                  <Fragment key={r.bulkJobId}>
                    <tr
                      onClick={() => { toggle(r.bulkJobId); setFocusedJobId(r.bulkJobId); }}
                      className={`cursor-pointer border-b border-border/50 ${
                        focused ? 'bg-brand-cyan/30' : selected ? 'bg-brand-cyan/20' : 'hover:bg-surface-cream/60'
                      }`}
                    >
                      <td className="px-2 py-1">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggle(r.bulkJobId)}
                          onClick={(e) => e.stopPropagation()}
                          className="accent-brand-cyan"
                        />
                      </td>
                      <td className="px-1 py-1 text-center">
                        {isMultiBox && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void toggleExpand(r.bulkJobId); }}
                            className="w-4 h-4 inline-flex items-center justify-center text-text-muted hover:text-text-primary"
                            aria-label={isExpanded ? 'Collapse multi-box' : 'Expand multi-box'}
                            aria-expanded={isExpanded}
                            title={isExpanded ? 'Collapse children' : 'Expand children'}
                            disabled={isLoadingChildren}
                          >
                            <svg
                              width="10" height="10" viewBox="0 0 24 24" fill="none"
                              stroke="currentColor" strokeWidth="3"
                              className={`transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                            >
                              <polyline points="9 6 15 12 9 18" />
                            </svg>
                          </button>
                        )}
                      </td>
                      {COLUMNS.map((c) => {
                        const raw = c.get(r);
                        const display =
                          c.field === 'bookDate'
                            ? tenantDateFromSpString(r.bookDate, user.isUsTenant) || '-'
                            : c.field === 'bookTime'
                              ? tenantTimeFromSpString(r.bookTime, user.isUsTenant) || '-'
                              : (raw == null || raw === '' ? '-' : String(raw));
                        return (
                          <td
                            key={c.field}
                            className={`px-2 py-1 ${c.className ?? ''} ${c.align === 'center' ? 'text-center' : ''}`}
                            title={raw != null && raw !== '' ? String(raw) : undefined}
                          >
                            {display}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditItemsFor({ bulkJobId: r.bulkJobId, qty: r.qty ?? 1 });
                          }}
                          className="text-[10px] px-2 py-0.5 rounded border border-border hover:bg-brand-cyan/10"
                        >
                          Edit qty
                        </button>
                      </td>
                    </tr>
                    {isExpanded && children.map((child) => (
                      <tr
                        key={`c-${r.bulkJobId}-${child.bulkJobId}`}
                        data-child-of={r.bulkJobId}
                        onClick={() => setFocusedJobId(child.bulkJobId)}
                        className="cursor-pointer border-b border-border/40 bg-surface-cream/40 hover:bg-surface-cream/70 text-text-secondary"
                      >
                        <td className="px-2 py-1"></td>
                        <td className="px-1 py-1"></td>
                        {COLUMNS.map((c, idx) => {
                          const raw = c.get(child);
                          const display =
                            c.field === 'bookDate'
                              ? tenantDateFromSpString(child.bookDate, user.isUsTenant) || '-'
                              : c.field === 'bookTime'
                                ? tenantTimeFromSpString(child.bookTime, user.isUsTenant) || '-'
                                : (raw == null || raw === '' ? '-' : String(raw));
                          return (
                            <td
                              key={c.field}
                              className={`px-2 py-1 ${c.className ?? ''} ${c.align === 'center' ? 'text-center' : ''} ${idx === 0 ? 'pl-6' : ''}`}
                              title={raw != null && raw !== '' ? String(raw) : undefined}
                            >
                              {display}
                            </td>
                          );
                        })}
                        <td className="px-2 py-1"></td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
              {visible.length === 0 && !q.isLoading && (
                <tr>
                  <td className="px-3 py-6 text-center text-text-muted" colSpan={COLUMNS.length + 3}>
                    No print-eligible jobs for this date.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </RvBox>
          </div>
        </div>

        {/* Right column - JobDetail on top, ScanDetail below. Matches
            legacy `print/tpls/jobDetail.tpl` + `scanList.tpl` right-pane
            layout. Operator drills into a print row to see the full job
            record + scan history without leaving the Print Manager. */}
        <div className="flex-[2] min-w-0 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-auto border-b border-border">
            <RvJobDetail
              bulkJobId={focusedJobId}
              initialJob={null}
              onPickSibling={() => { /* PrintManager doesn't cross-navigate */ }}
            />
          </div>
          <div className="h-64 overflow-auto">
            <RvScanDetailBox selectedJobId={focusedJobId} />
          </div>
        </div>
      </div>

      {editItemsFor && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) setEditItemsFor(null); }}
        >
          <div className="bg-surface-white rounded-lg shadow-lg border border-border w-full max-w-sm p-4">
            <h2 className="text-sm font-medium mb-2">Edit item quantity</h2>
            <p className="text-xs text-text-muted mb-3">
              Bulk job #{editItemsFor.bulkJobId}. Changing qty regenerates item barcodes and
              recalculates the price via WS_stpBulkJob_Update downstream.
            </p>
            <label className="flex items-center gap-2 text-sm mb-4">
              <span className="w-16 text-text-muted">Qty</span>
              <input
                type="number"
                min={1}
                value={editItemsFor.qty}
                onChange={(e) => setEditItemsFor({ ...editItemsFor, qty: Math.max(1, Number(e.target.value) || 1) })}
                className="flex-1 border border-border rounded px-2 py-1 text-sm"
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="neutral" size="sm" onClick={() => setEditItemsFor(null)} disabled={submitting}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={saveEditItems} disabled={submitting}>
                {submitting ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
