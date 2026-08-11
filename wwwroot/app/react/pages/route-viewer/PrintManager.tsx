import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { routeViewerService } from '../../services/routeViewerService';
import { tenantDateFromSpString, tenantTimeFromSpString, tenantTodayYmd } from '../../lib/tenantDate';
import { Button } from '../../components/common/Button';
import { RvBox } from '../../components/route-viewer/RvBox';
import { RvOverviewBox } from '../../components/route-viewer/RvOverviewBox';
import { RvJobDetail } from '../../components/route-viewer/RvJobDetail';
import { RvScanDetailBox } from '../../components/route-viewer/RvScanDetailBox';
import { useToast } from '../../context/ToastContext';

// Print Manager page (master Section 11). Reuses the Bulk Scan Jobs
// endpoint as a print-list source (same shape: bulkJobId + jobNumber +
// clientCode + deliveryDate + readyTime + items) since the print-
// dedicated endpoint isn't wired yet. Multi-select rows and hit Print
// Labels to POST them at /api/runviewer/labels/bulk-jobs.
//
// Backend label endpoints are still 501 pending the P14 AlertLabel +
// SSRS wiring. The UI is complete so the flow lights up immediately
// once the backend lands.

type SortMode = 1 | 2 | 3 | 4;

export default function PrintManager() {
  const user = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const initialDate = tenantTodayYmd({ isUsTenant: user.isUsTenant, timeZone: user.timeZone });
  const [runDate, setRunDate] = useState(initialDate);
  const [sortMode, setSortMode] = useState<SortMode>(1);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [editItemsFor, setEditItemsFor] = useState<{ bulkJobId: number; qty: number } | null>(null);
  // Focused job for the right-side JobDetail + ScanList panels. Legacy
  // Print Manager surfaces these to the right of the list; operators
  // drill into a print row and see the job's full record + scan history.
  const [focusedJobId, setFocusedJobId] = useState<number | null>(null);

  const q = useQuery({
    queryKey: ['pm-list', runDate],
    queryFn: () => routeViewerService.getBulkScanJobs(runDate, false),
    enabled: !!runDate,
    staleTime: 10_000,
  });

  const rows = q.data ?? [];

  // Client-side sort per legacy labelsSortMode 1-4:
  //   1 = Job # (default), 2 = Client, 3 = Delivery Date, 4 = Ready Time.
  const sorted = useMemo(() => {
    const copy = rows.slice();
    copy.sort((a, b) => {
      switch (sortMode) {
        case 1: return (a.jobNumber ?? '').localeCompare(b.jobNumber ?? '');
        case 2: return (a.clientCode ?? '').localeCompare(b.clientCode ?? '');
        case 3: return (a.deliveryDate ?? '').localeCompare(b.deliveryDate ?? '');
        case 4: return (a.readyTime ?? '').localeCompare(b.readyTime ?? '');
      }
    });
    return copy;
  }, [rows, sortMode]);

  const toggle = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  };
  const selectAll = () => setSelectedIds(sorted.map((r) => r.bulkJobId));
  const clearAll = () => setSelectedIds([]);

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
            onChange={(e) => setSortMode(Number(e.target.value) as SortMode)}
            className="border border-border rounded px-2 py-0.5 text-xs bg-surface-white"
          >
            <option value="1">Job #</option>
            <option value="2">Client</option>
            <option value="3">Delivery Date</option>
            <option value="4">Ready Time</option>
          </select>
        </label>
        <Button variant="neutral" size="sm" onClick={selectAll}>Select all</Button>
        <Button variant="neutral" size="sm" onClick={clearAll} disabled={selectedIds.length === 0}>Clear</Button>
        <Button variant="primary" size="sm" onClick={printSelected} disabled={selectedIds.length === 0 || submitting}>
          {submitting ? 'Printing...' : `Print Labels (${selectedIds.length})`}
        </Button>
        <Button variant="neutral" size="sm" onClick={cancelSelected} disabled={selectedIds.length === 0 || submitting}>
          Cancel ({selectedIds.length})
        </Button>
        <div className="ml-auto text-xs text-text-muted">
          {q.isLoading ? 'Loading...' : `${sorted.length} jobs`}
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
                    checked={selectedIds.length > 0 && selectedIds.length === sorted.length}
                    onChange={(e) => (e.target.checked ? selectAll() : clearAll())}
                    className="accent-brand-cyan"
                  />
                </th>
                <th className="px-2 py-1">Client</th>
                <th className="px-2 py-1">Job #</th>
                <th className="px-2 py-1">D Date</th>
                <th className="px-2 py-1">R Time</th>
                <th className="px-2 py-1">Address</th>
                <th className="px-2 py-1 text-center">Items</th>
                <th className="px-2 py-1 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const selected = selectedIds.includes(r.bulkJobId);
                const focused = focusedJobId === r.bulkJobId;
                return (
                  <tr
                    key={r.bulkJobId}
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
                    <td className="px-2 py-1">{r.clientCode ?? '-'}</td>
                    <td className="px-2 py-1 font-mono">{r.jobNumber ?? '-'}</td>
                    <td className="px-2 py-1">{tenantDateFromSpString(r.deliveryDate, user.isUsTenant) || '-'}</td>
                    <td className="px-2 py-1">{tenantTimeFromSpString(r.readyTime, user.isUsTenant) || '-'}</td>
                    <td className="px-2 py-1 truncate max-w-[16rem]" title={r.toAddress ?? undefined}>
                      {r.toAddress ?? '-'}
                    </td>
                    <td className="px-2 py-1 text-center">{r.items}</td>
                    <td className="px-2 py-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditItemsFor({ bulkJobId: r.bulkJobId, qty: r.items });
                        }}
                        className="text-[10px] px-2 py-0.5 rounded border border-border hover:bg-brand-cyan/10"
                      >
                        Edit qty
                      </button>
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && !q.isLoading && (
                <tr>
                  <td className="px-3 py-6 text-center text-text-muted" colSpan={8}>
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
