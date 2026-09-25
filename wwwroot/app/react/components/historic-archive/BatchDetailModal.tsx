// Historic Archive Upload drill-down modal. Opens when the operator
// clicks a batch row on the Import history table.
//
// Two tabs:
//   'jobs'   - paged list of tucJobArchive rows produced by the batch
//              (via GET /api/historic-archive/batches/{id}/jobs). Empty
//              tab body when the batch had 0 inserts.
//   'errors' - persisted per-row rejection reasons (via GET
//              /api/historic-archive/batches/{id}). Empty tab body when
//              the batch had 0 rejections.
//
// The initial tab defaults to whichever side has content:
//   - inserted > 0 -> 'jobs'
//   - inserted = 0 AND rejected > 0 -> 'errors'
//   - inserted = 0 AND rejected = 0 -> 'jobs' (empty state)
//
// Jobs are fetched lazily on first render of the 'jobs' tab; errors
// arrive with the initial batch-detail GET so no separate fetch is
// needed there.
//
// Both fetches share the operator-visible "Loading..." state; render
// per-row errors + jobs as compact tables mirroring the history-view
// table style so the UI is instantly familiar.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useToast } from '../../context/ToastContext';
import { downloadCsv } from '../../lib/csvExport';
import {
  historicArchiveService,
  type HistoricArchiveBatch,
  type HistoricArchiveBatchDetail,
  type HistoricArchiveJob,
} from '../../services/historicArchiveService';

type Tab = 'jobs' | 'errors';

interface Props {
  batch: HistoricArchiveBatch | null;
  open: boolean;
  onClose: () => void;
}

const PAGE_SIZE = 50;

export function BatchDetailModal({ batch, open, onClose }: Props) {
  const toast = useToast();

  const [detail, setDetail] = useState<HistoricArchiveBatchDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [jobs, setJobs] = useState<HistoricArchiveJob[]>([]);
  const [jobsTotal, setJobsTotal] = useState(0);
  const [jobsOffset, setJobsOffset] = useState(0);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsFetched, setJobsFetched] = useState(false);

  const initialTab: Tab = useMemo(() => {
    if (!batch) return 'jobs';
    if (batch.insertedCount === 0 && batch.rejectedCount > 0) return 'errors';
    return 'jobs';
  }, [batch]);
  const [tab, setTab] = useState<Tab>(initialTab);

  // Fetch batch detail (for the errors payload) once the modal opens on
  // a real batch. Batch-detail read is cheap; the Jobs fetch happens
  // only when the 'jobs' tab is actually rendered.
  useEffect(() => {
    if (!open || !batch) {
      setDetail(null);
      setJobs([]);
      setJobsTotal(0);
      setJobsOffset(0);
      setJobsFetched(false);
      return;
    }
    setTab(initialTab);
    setDetailLoading(true);
    historicArchiveService
      .getBatch(batch.id)
      .then(setDetail)
      .catch((e) => toast.show((e as Error).message ?? 'Failed to load batch detail.', 'error'))
      .finally(() => setDetailLoading(false));
  }, [open, batch, initialTab, toast]);

  const loadJobs = useCallback(
    async (offset: number) => {
      if (!batch) return;
      setJobsLoading(true);
      try {
        const page = await historicArchiveService.getBatchJobs(batch.id, PAGE_SIZE, offset);
        setJobs(page.rows);
        setJobsTotal(page.total);
        setJobsOffset(offset);
        setJobsFetched(true);
      } catch (e) {
        toast.show((e as Error).message ?? 'Failed to load imported jobs.', 'error');
      } finally {
        setJobsLoading(false);
      }
    },
    [batch, toast],
  );

  // Lazy fetch the first jobs page on the first render of the 'jobs' tab
  // for a batch that actually has inserted rows.
  useEffect(() => {
    if (!open || !batch) return;
    if (tab !== 'jobs') return;
    if (jobsFetched) return;
    if (batch.insertedCount === 0) return;
    void loadJobs(0);
  }, [open, batch, tab, jobsFetched, loadJobs]);

  const downloadErrors = () => {
    if (!detail || detail.errors.length === 0) return;
    const rows: (string | number)[][] = [
      ['RowIndex', 'JobNumber', 'Message'],
      ...detail.errors.map((e) => [e.rowIndex, e.jobNumber ?? '', e.message]),
    ];
    downloadCsv(rows, `historic-archive-batch-${detail.id}-errors.csv`);
  };

  if (!batch) return null;

  const title = `Batch #${batch.id} - ${batch.fileName}`;
  const inserted = batch.insertedCount;
  const rejected = batch.rejectedCount;

  return (
    <Modal open={open} onClose={onClose} title={title} size="5xl">
      <div className="space-y-3 text-sm">
        <BatchSummaryHeader batch={batch} />

        <div className="flex gap-2 border-b border-border">
          <TabButton active={tab === 'jobs'} onClick={() => setTab('jobs')}>
            Imported jobs {inserted > 0 && <span className="ml-1 text-text-secondary">({inserted})</span>}
          </TabButton>
          <TabButton active={tab === 'errors'} onClick={() => setTab('errors')}>
            Rejected rows {rejected > 0 && <span className="ml-1 text-warning">({rejected})</span>}
          </TabButton>
        </div>

        {tab === 'jobs' && (
          <JobsTab
            batch={batch}
            jobs={jobs}
            total={jobsTotal}
            offset={jobsOffset}
            loading={jobsLoading}
            onReload={() => loadJobs(jobsOffset)}
            onPage={(newOffset) => loadJobs(newOffset)}
          />
        )}

        {tab === 'errors' && (
          <ErrorsTab
            detail={detail}
            loading={detailLoading}
            expectedCount={rejected}
            onDownload={downloadErrors}
          />
        )}
      </div>
    </Modal>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-sm border-b-2 -mb-px transition-colors ${
        active
          ? 'border-brand-cyan text-text-primary font-medium'
          : 'border-transparent text-text-secondary hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  );
}

function BatchSummaryHeader({ batch }: { batch: HistoricArchiveBatch }) {
  const d = new Date(batch.uploadedAt);
  const when = Number.isNaN(d.getTime()) ? batch.uploadedAt : d.toLocaleString();
  const idRange =
    batch.importedIdStart != null && batch.importedIdEnd != null
      ? `${batch.importedIdStart} - ${batch.importedIdEnd}`
      : '-';
  return (
    <div className="grid gap-x-6 gap-y-1 md:grid-cols-2 text-xs">
      <div>
        <span className="text-text-secondary">Uploaded at:</span>{' '}
        <span className="font-medium">{when}</span>
      </div>
      <div>
        <span className="text-text-secondary">Uploaded by:</span>{' '}
        <span className="font-medium">
          {batch.uploadedByName?.trim() || `#${batch.uploadedByContact}`}
        </span>
      </div>
      <div>
        <span className="text-text-secondary">Client code(s):</span>{' '}
        <span className="font-mono">{batch.clientCodes || '-'}</span>
      </div>
      <div>
        <span className="text-text-secondary">ID range:</span>{' '}
        <span className="font-mono">{idRange}</span>
      </div>
      {batch.notes && (
        <div className="md:col-span-2">
          <span className="text-text-secondary">Notes:</span>{' '}
          <span>{batch.notes}</span>
        </div>
      )}
    </div>
  );
}

function JobsTab({
  batch,
  jobs,
  total,
  offset,
  loading,
  onReload,
  onPage,
}: {
  batch: HistoricArchiveBatch;
  jobs: HistoricArchiveJob[];
  total: number;
  offset: number;
  loading: boolean;
  onReload: () => void;
  onPage: (offset: number) => void;
}) {
  if (batch.insertedCount === 0) {
    return (
      <div className="rounded border border-dashed border-border p-6 text-center text-sm text-text-secondary">
        This batch imported no rows.
      </div>
    );
  }

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + jobs.length, total);
  const canPrev = offset > 0;
  const canNext = offset + jobs.length < total;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-text-secondary">
        <span>
          Showing {from}-{to} of {total.toLocaleString()} imported rows.
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="neutral" onClick={onReload} disabled={loading}>
            {loading ? 'Loading...' : 'Reload'}
          </Button>
          <Button
            size="sm"
            variant="neutral"
            onClick={() => onPage(Math.max(0, offset - PAGE_SIZE))}
            disabled={loading || !canPrev}
          >
            Prev
          </Button>
          <Button
            size="sm"
            variant="neutral"
            onClick={() => onPage(offset + PAGE_SIZE)}
            disabled={loading || !canNext}
          >
            Next
          </Button>
        </div>
      </div>

      {loading && jobs.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-secondary">Loading imported jobs...</p>
      ) : jobs.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-secondary">No imported jobs to show.</p>
      ) : (
        <div className="max-h-[55vh] overflow-auto rounded border border-border">
          <table className="w-full text-xs">
            <thead className="bg-surface-cream sticky top-0">
              <tr>
                <th className="px-2 py-1 text-left">Archive id</th>
                <th className="px-2 py-1 text-left">Job number</th>
                <th className="px-2 py-1 text-left">Client</th>
                <th className="px-2 py-1 text-left">Date</th>
                <th className="px-2 py-1 text-right">Amount</th>
                <th className="px-2 py-1 text-right">Courier pay</th>
                <th className="px-2 py-1 text-left">POD name</th>
                <th className="px-2 py-1 text-left">Delivery</th>
                <th className="px-2 py-1 text-left">Suburb / city</th>
                <th className="px-2 py-1 text-left">Post code</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.ucjbId} className="border-t border-border align-top">
                  <td className="px-2 py-1 font-mono">{j.ucjbId}</td>
                  <td className="px-2 py-1 font-mono">{j.jobNumber ?? ''}</td>
                  <td className="px-2 py-1 font-mono">{j.clientCode ?? ''}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{formatDate(j.jobDate)}</td>
                  <td className="px-2 py-1 text-right">{fmtMoney(j.amount)}</td>
                  <td className="px-2 py-1 text-right">{fmtMoney(j.courierPayment)}</td>
                  <td className="px-2 py-1 max-w-[10rem] truncate" title={j.podName ?? ''}>
                    {j.podName ?? ''}
                  </td>
                  <td className="px-2 py-1 max-w-[14rem] truncate" title={j.deliveryCompany ?? ''}>
                    {j.deliveryCompany ?? ''}
                  </td>
                  <td className="px-2 py-1 max-w-[10rem] truncate" title={j.deliveryCity ?? ''}>
                    {j.deliveryCity ?? ''}
                  </td>
                  <td className="px-2 py-1">{j.deliveryPostCode ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ErrorsTab({
  detail,
  loading,
  expectedCount,
  onDownload,
}: {
  detail: HistoricArchiveBatchDetail | null;
  loading: boolean;
  expectedCount: number;
  onDownload: () => void;
}) {
  if (expectedCount === 0) {
    return (
      <div className="rounded border border-dashed border-border p-6 text-center text-sm text-text-secondary">
        This batch had no rejected rows.
      </div>
    );
  }

  if (loading) {
    return <p className="py-6 text-center text-sm text-text-secondary">Loading errors...</p>;
  }

  const errors = detail?.errors ?? [];
  if (errors.length === 0) {
    // Batch was created before the Errors column existed (batch id 1
    // pre-2026-08-19), so the reasons weren't persisted.
    return (
      <div className="rounded border border-dashed border-border p-6 text-center text-sm text-text-secondary">
        <p>Row-level reasons were not persisted for this batch.</p>
        <p className="mt-1 text-xs">
          The reason column was added on 2026-08-19; batches uploaded before that
          only carry their rejected-count.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-warning font-medium">{errors.length} rows rejected</span>
        <Button size="sm" variant="secondary" onClick={onDownload}>
          Download error CSV
        </Button>
      </div>
      <div className="max-h-[55vh] overflow-auto rounded border border-border">
        <table className="w-full text-xs">
          <thead className="bg-surface-cream sticky top-0">
            <tr>
              <th className="px-2 py-1 text-left">Row</th>
              <th className="px-2 py-1 text-left">Job number</th>
              <th className="px-2 py-1 text-left">Reason</th>
            </tr>
          </thead>
          <tbody>
            {errors.map((e) => (
              <tr key={`${e.rowIndex}-${e.jobNumber ?? ''}`} className="border-t border-border">
                <td className="px-2 py-1">{e.rowIndex}</td>
                <td className="px-2 py-1 font-mono">{e.jobNumber ?? ''}</td>
                <td className="px-2 py-1">{e.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

function fmtMoney(n: number | null): string {
  if (n == null) return '';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
