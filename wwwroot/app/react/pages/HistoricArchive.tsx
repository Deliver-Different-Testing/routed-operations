// Historic Archive Upload. Internal-only feature so ops can load legacy
// OTG (or any tenant) job-history spreadsheets straight into
// tucJobArchive without a developer running raw SSMS scripts. Uploaded
// rows are stamped with the billing-sentinel recipe server-side and can
// never be picked up by billing / BCTI / settlement processes.
//
// Page stages (single-page, no modal chain):
//   'list'   - landing view; shows past HistoricArchiveImportBatch rows
//              with a summary card + a table. New Upload button here.
//   'upload' - drag/drop a .csv / .xls / .xlsx
//   'map'    - operator maps each header to a canonical archive field;
//              required fields are highlighted
//   'result' - shows success banner + batch id + downloadable error CSV
//              if any rows were rejected. Back to history button returns
//              to the list view and refreshes.
//
// Not shipped in this first slice (see plan file "deferred" list):
//   auto-suggest heuristics, template save/reuse, courier-code lookup,
//   HERE geocoding fallback. Operator maps every column manually.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Button } from '../components/common/Button';
import { Panel } from '../components/common/Panel';
import FileUploadZone from '../components/import/FileUploadZone';
import { BatchDetailModal } from '../components/historic-archive/BatchDetailModal';
import { downloadCsv } from '../lib/csvExport';
import {
  autoMapHeaders,
  labelForCanonicalField,
  FIELD_GROUPS,
  GROUP_ORDER,
} from '../lib/historicArchiveAutoMap';
import {
  historicArchiveService,
  type HistoricArchiveUploadResponse,
  type HistoricArchiveCommitResponse,
  type HistoricArchiveBatch,
} from '../services/historicArchiveService';

type Step = 'list' | 'upload' | 'map' | 'result';

export default function HistoricArchive() {
  const auth = useAuth();
  const toast = useToast();

  const [step, setStep] = useState<Step>('list');
  const [uploading, setUploading] = useState(false);
  const [committing, setCommitting] = useState(false);

  const [parsed, setParsed] = useState<HistoricArchiveUploadResponse | null>(null);
  const [file, setFile] = useState<File | null>(null);

  // header -> canonical field. Unmapped headers stay unset.
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');

  const [commitResult, setCommitResult] = useState<HistoricArchiveCommitResponse | null>(null);

  const [batches, setBatches] = useState<HistoricArchiveBatch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);

  // Drill-down modal: null = closed, populated batch = open.
  const [selectedBatch, setSelectedBatch] = useState<HistoricArchiveBatch | null>(null);

  const loadBatches = useCallback(async () => {
    setLoadingBatches(true);
    try {
      const rows = await historicArchiveService.getBatches(100, 0);
      setBatches(rows);
    } catch (e) {
      toast.show((e as Error).message ?? 'Failed to load import history.', 'error');
    } finally {
      setLoadingBatches(false);
    }
  }, [toast]);

  // Fetch on mount for internal users.
  useEffect(() => {
    if (auth.isInternal) void loadBatches();
  }, [auth.isInternal, loadBatches]);

  if (!auth.isInternal) {
    return (
      <div className="p-6">
        <Panel title="Historic Archive Upload">
          <p className="text-sm text-text-secondary">
            This tool is only available for internal staff.
          </p>
        </Panel>
      </div>
    );
  }

  const canonicalMapped = new Set(Object.values(mapping).filter(Boolean));
  const missingRequired = useMemo(
    () => (parsed?.requiredFields ?? []).filter((r) => !canonicalMapped.has(r)),
    [parsed?.requiredFields, canonicalMapped],
  );

  const resetWizard = () => {
    setParsed(null);
    setFile(null);
    setMapping({});
    setNotes('');
    setCommitResult(null);
  };

  const backToList = () => {
    resetWizard();
    setStep('list');
    void loadBatches();
  };

  const startNewUpload = () => {
    resetWizard();
    setStep('upload');
  };

  const onFileSelected = async (chosen: File) => {
    setUploading(true);
    setFile(chosen);
    try {
      const response = await historicArchiveService.uploadFile(chosen);
      setParsed(response);
      // Auto-select via the normalized + alias-table heuristic. Operator
      // can override any suggestion on the Map step. See
      // lib/historicArchiveAutoMap.ts for the alias table.
      setMapping(autoMapHeaders(response.headers, response.canonicalFields));
      setStep('map');
      toast.show(`Parsed ${response.rows.length} rows from ${response.fileName}.`, 'success');
    } catch (e) {
      toast.show((e as Error).message ?? 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const onCommit = async () => {
    if (!parsed) return;
    if (missingRequired.length > 0) {
      toast.show(
        `Missing required mapping: ${missingRequired.map(labelForCanonicalField).join(', ')}`,
        'warning',
      );
      return;
    }
    setCommitting(true);
    try {
      const response = await historicArchiveService.commit({
        fileName: parsed.fileName,
        mapping,
        rows: parsed.rows,
        notes: notes.trim() || null,
      });
      setCommitResult(response);
      setStep('result');
      if (response.rejectedCount > 0) {
        toast.show(
          `Imported ${response.insertedCount} rows, ${response.rejectedCount} rejected.`,
          'warning',
        );
      } else {
        toast.show(`Imported ${response.insertedCount} rows.`, 'success');
      }
      // Refresh the history list in the background so it's ready when
      // the operator clicks "Back to history".
      void loadBatches();
    } catch (e) {
      toast.show((e as Error).message ?? 'Commit failed', 'error');
    } finally {
      setCommitting(false);
    }
  };

  const downloadErrors = () => {
    if (!commitResult || commitResult.errors.length === 0) return;
    const rows: (string | number)[][] = [
      ['RowIndex', 'JobNumber', 'Message'],
      ...commitResult.errors.map((e) => [e.rowIndex, e.jobNumber ?? '', e.message]),
    ];
    downloadCsv(rows, `historic-archive-batch-${commitResult.batchId}-errors.csv`);
  };

  return (
    // Container class matches the RecurringRoutes page-content standard
    // (h-full overflow-y-auto p-4 space-y-3): fills the layout region,
    // scrolls independently, uses the compact section rhythm every other
    // module in Routed Operations uses.
    <div className="h-full overflow-y-auto p-4 space-y-3">
      {/* Page title lives in the top-of-app Header (see components/Layout/
          Header.tsx PAGE_NAMES). This strip carries only the tagline +
          the step-contextual action button. */}
      <div className="flex items-center justify-between">
        <p className="text-text-secondary text-xs">
          Loads legacy job history into <code>tucJobArchive</code>. Rows land as
          completed historical jobs and are never selected by any billing / BCTI /
          settlement process.
        </p>
        <div className="flex items-center gap-2">
          {step === 'list' && (
            <Button
              variant="primary"
              onClick={startNewUpload}
              disabled={loadingBatches || uploading || committing}
            >
              New upload
            </Button>
          )}
          {(step === 'upload' || step === 'map') && (
            <Button
              variant="neutral"
              onClick={backToList}
              disabled={uploading || committing}
            >
              Back to history
            </Button>
          )}
        </div>
      </div>

      {step === 'list' && (
        <BatchHistory
          batches={batches}
          loading={loadingBatches}
          onRefresh={loadBatches}
          onNewUpload={startNewUpload}
          onSelect={setSelectedBatch}
        />
      )}
      <BatchDetailModal
        batch={selectedBatch}
        open={selectedBatch != null}
        onClose={() => setSelectedBatch(null)}
      />

      {step === 'upload' && (
        <Panel title="Step 1. Upload a spreadsheet">
          <div className="p-3">
            <FileUploadZone
              onFileSelected={onFileSelected}
              isLoading={uploading}
              fileName={file?.name ?? null}
              fileSize={file?.size ?? null}
            />
            <p className="mt-3 text-xs text-text-secondary">
              Accepted: <code>.csv</code>, <code>.xls</code>, <code>.xlsx</code>. The file is
              parsed server-side; no rows are written until you confirm on step 3.
            </p>
          </div>
        </Panel>
      )}

      {step === 'map' && parsed && (
        <MapAndPreview
          parsed={parsed}
          mapping={mapping}
          setMapping={setMapping}
          notes={notes}
          setNotes={setNotes}
          missingRequired={missingRequired}
          onCommit={onCommit}
          committing={committing}
        />
      )}

      {step === 'result' && commitResult && (
        <Panel title="Import result">
          <div className="p-3 space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Stat label="Batch id" value={commitResult.batchId} />
              <Stat label="Inserted" value={commitResult.insertedCount} />
              <Stat label="Rejected" value={commitResult.rejectedCount} />
              <Stat
                label="ID range"
                value={
                  commitResult.importedIdStart != null
                    ? `${commitResult.importedIdStart} - ${commitResult.importedIdEnd}`
                    : '-'
                }
              />
            </div>
            {commitResult.errors.length > 0 && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-warning font-medium">
                    {commitResult.errors.length} rows rejected
                  </span>
                  <Button size="sm" variant="secondary" onClick={downloadErrors}>
                    Download error CSV
                  </Button>
                </div>
                <div className="max-h-64 overflow-auto rounded border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-surface-cream sticky top-0">
                      <tr>
                        <th className="px-2 py-1 text-left">Row</th>
                        <th className="px-2 py-1 text-left">Job number</th>
                        <th className="px-2 py-1 text-left">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commitResult.errors.map((e) => (
                        <tr key={`${e.rowIndex}-${e.jobNumber ?? ''}`} className="border-t border-border">
                          <td className="px-2 py-1">{e.rowIndex}</td>
                          <td className="px-2 py-1">{e.jobNumber ?? ''}</td>
                          <td className="px-2 py-1">{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={startNewUpload}>
                Upload another file
              </Button>
              <Button variant="primary" onClick={backToList}>
                Back to history
              </Button>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-border bg-surface-white px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-text-secondary">{label}</div>
      <div className="text-base font-semibold text-text-primary">{value}</div>
    </div>
  );
}

// -------- Landing view: batch history --------

interface BatchHistoryProps {
  batches: HistoricArchiveBatch[];
  loading: boolean;
  onRefresh: () => void;
  onNewUpload: () => void;
  onSelect: (batch: HistoricArchiveBatch) => void;
}

function BatchHistory({ batches, loading, onRefresh, onNewUpload, onSelect }: BatchHistoryProps) {
  const summary = useMemo(() => {
    const totalBatches = batches.length;
    const totalInserted = batches.reduce((s, b) => s + b.insertedCount, 0);
    const totalRejected = batches.reduce((s, b) => s + b.rejectedCount, 0);
    const successfulBatches = batches.filter((b) => b.insertedCount > 0).length;
    const latest = batches[0]?.uploadedAt ?? null;
    return { totalBatches, totalInserted, totalRejected, successfulBatches, latest };
  }, [batches]);

  return (
    <div className="space-y-3">
      <Panel title="Summary">
        <div className="p-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Total imports" value={summary.totalBatches} />
            <Stat label="Successful" value={summary.successfulBatches} />
            <Stat label="Rows inserted" value={summary.totalInserted.toLocaleString()} />
            <Stat label="Rows rejected" value={summary.totalRejected.toLocaleString()} />
          </div>
          {summary.latest && (
            <p className="mt-3 text-xs text-text-secondary">
              Latest import: <span className="font-medium">{formatDateTime(summary.latest)}</span>
            </p>
          )}
        </div>
      </Panel>

      <Panel title="Import history">
        <div className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs text-text-secondary">
            Every historic archive upload the tenant has run. Most recent first.
          </p>
          <Button size="sm" variant="neutral" onClick={onRefresh} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>

        {loading && batches.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-secondary">Loading import history...</p>
        ) : batches.length === 0 ? (
          <div className="rounded border border-dashed border-border p-6 text-center text-sm text-text-secondary">
            <p>No historic archive imports for this tenant yet.</p>
            <div className="mt-3">
              <Button variant="primary" onClick={onNewUpload}>
                Upload your first file
              </Button>
            </div>
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-auto rounded border border-border">
            <table className="w-full text-xs">
              <thead className="bg-surface-cream sticky top-0">
                <tr>
                  <th className="px-2 py-1 text-left">Batch</th>
                  <th className="px-2 py-1 text-left">Uploaded at</th>
                  <th className="px-2 py-1 text-left">Uploaded by</th>
                  <th className="px-2 py-1 text-left">Client code(s)</th>
                  <th className="px-2 py-1 text-left">File</th>
                  <th className="px-2 py-1 text-right">Rows</th>
                  <th className="px-2 py-1 text-right">Inserted</th>
                  <th className="px-2 py-1 text-right">Rejected</th>
                  <th className="px-2 py-1 text-left">ID range</th>
                  <th className="px-2 py-1 text-left">Status</th>
                  <th className="px-2 py-1 text-left">Notes</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const status = batchStatus(b);
                  return (
                    <tr
                      key={b.id}
                      className="border-t border-border align-top cursor-pointer hover:bg-brand-cyan/5"
                      onClick={() => onSelect(b)}
                      title="Click to see imported jobs / rejection reasons"
                    >
                      <td className="px-2 py-1 font-mono">#{b.id}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{formatDateTime(b.uploadedAt)}</td>
                      <td className="px-2 py-1" title={`Contact id ${b.uploadedByContact}`}>
                        {b.uploadedByName?.trim() || (
                          <span className="text-text-secondary">#{b.uploadedByContact}</span>
                        )}
                      </td>
                      <td className="px-2 py-1 font-mono" title={b.clientCodes ?? ''}>
                        {b.clientCodes || <span className="text-text-secondary">-</span>}
                      </td>
                      <td className="px-2 py-1 max-w-[16rem] truncate" title={b.fileName}>
                        {b.fileName}
                      </td>
                      <td className="px-2 py-1 text-right">{b.rowCount.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right">{b.insertedCount.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right">
                        {b.rejectedCount > 0 ? (
                          <span className="text-warning font-medium">{b.rejectedCount.toLocaleString()}</span>
                        ) : (
                          '0'
                        )}
                      </td>
                      <td className="px-2 py-1 font-mono whitespace-nowrap">
                        {b.importedIdStart != null
                          ? `${b.importedIdStart} - ${b.importedIdEnd}`
                          : '-'}
                      </td>
                      <td className="px-2 py-1">
                        <span className={statusClass(status)}>{status}</span>
                      </td>
                      <td className="px-2 py-1 max-w-[20rem] truncate" title={b.notes ?? ''}>
                        {b.notes ?? ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        </div>
      </Panel>
    </div>
  );
}

type BatchStatus = 'success' | 'partial' | 'failed';

function batchStatus(b: HistoricArchiveBatch): BatchStatus {
  if (b.insertedCount === 0 && b.rejectedCount > 0) return 'failed';
  if (b.rejectedCount > 0) return 'partial';
  return 'success';
}

function statusClass(s: BatchStatus): string {
  const base = 'inline-block rounded px-2 py-0.5 text-[10px] uppercase tracking-wide';
  if (s === 'success') return `${base} bg-success/10 text-success`;
  if (s === 'partial') return `${base} bg-warning/10 text-warning`;
  return `${base} bg-error/10 text-error`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface MapAndPreviewProps {
  parsed: HistoricArchiveUploadResponse;
  mapping: Record<string, string>;
  setMapping: (m: Record<string, string>) => void;
  notes: string;
  setNotes: (n: string) => void;
  missingRequired: string[];
  onCommit: () => void;
  committing: boolean;
}

function MapAndPreview({
  parsed,
  mapping,
  setMapping,
  notes,
  setNotes,
  missingRequired,
  onCommit,
  committing,
}: MapAndPreviewProps) {
  const preview = parsed.rows.slice(0, 10);
  const requiredSet = new Set(parsed.requiredFields);

  // Bucket the canonical field list by FIELD_GROUPS so the dropdown
  // renders as <optgroup>s. Any canonical field the group map does not
  // classify falls into "Other" so a newly-added server field always
  // shows up somewhere. GROUP_ORDER controls the visible section order;
  // fields inside each group keep the server-supplied order.
  const groupedFields = useMemo(() => {
    const buckets = new Map<string, string[]>();
    for (const f of parsed.canonicalFields) {
      const group = FIELD_GROUPS[f] ?? 'Other';
      const arr = buckets.get(group) ?? [];
      arr.push(f);
      buckets.set(group, arr);
    }
    const ordered: { group: string; fields: string[] }[] = [];
    for (const g of GROUP_ORDER) {
      const fields = buckets.get(g);
      if (fields && fields.length > 0) ordered.push({ group: g, fields });
    }
    // Any group not covered by GROUP_ORDER (defensive - GROUP_ORDER
    // already includes "Other") lands at the end.
    for (const [g, fields] of buckets) {
      if (!GROUP_ORDER.includes(g)) ordered.push({ group: g, fields });
    }
    return ordered;
  }, [parsed.canonicalFields]);

  return (
    <div className="space-y-3">
      <Panel title="Step 2. Map columns">
        <div className="p-3">
        <p className="mb-3 text-xs text-text-secondary">
          Match each spreadsheet column to a canonical archive field. Fields marked
          <span className="text-warning font-medium"> required </span>
          must be mapped before you can import.
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          {parsed.headers.map((header) => {
            const current = mapping[header] ?? '';
            const isRequired = requiredSet.has(current);
            return (
              <label key={header} className="flex items-center gap-2 text-sm">
                <span className="w-48 truncate font-mono text-xs text-text-primary" title={header}>
                  {header}
                </span>
                <span className="text-text-secondary">-&gt;</span>
                <select
                  value={current}
                  onChange={(e) => setMapping({ ...mapping, [header]: e.target.value })}
                  className={`flex-1 rounded border px-2 py-1 text-sm ${
                    isRequired ? 'border-warning' : 'border-border'
                  }`}
                >
                  <option value="">(skip)</option>
                  {groupedFields.map(({ group, fields }) => (
                    <optgroup key={group} label={group}>
                      {fields.map((f) => (
                        <option key={f} value={f}>
                          {labelForCanonicalField(f)}
                          {requiredSet.has(f) ? ' *' : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
        {missingRequired.length > 0 && (
          <div className="mt-3 rounded border border-warning bg-warning/10 p-2 text-xs text-warning">
            Missing required mapping: {missingRequired.map(labelForCanonicalField).join(', ')}
          </div>
        )}
        </div>
      </Panel>

      <Panel title="Preview (first 10 rows)">
        <div className="p-3">
        <div className="max-h-72 overflow-auto rounded border border-border">
          <table className="w-full text-xs">
            <thead className="bg-surface-cream sticky top-0">
              <tr>
                {parsed.headers.map((h) => {
                  const target = mapping[h];
                  return (
                    <th key={h} className="px-2 py-1 text-left align-bottom">
                      <div className="font-mono">{h}</div>
                      {target && (
                        <div className="text-[10px] font-normal text-brand-cyan">
                          -&gt; {labelForCanonicalField(target)}
                        </div>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {preview.map((row, i) => (
                <tr key={i} className="border-t border-border">
                  {parsed.headers.map((h) => (
                    <td key={h} className="px-2 py-1">{row[h] ?? ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] text-text-secondary">
          Showing {preview.length} of {parsed.rows.length} rows.
        </p>
        </div>
      </Panel>

      <Panel title="Step 3. Confirm and commit">
        <div className="p-3">
        <label className="mb-3 flex flex-col gap-1 text-sm">
          <span className="text-text-secondary">Batch notes (optional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="rounded border border-border px-2 py-1 text-sm"
            placeholder='e.g. "OTG legacy 2024 export, Q4 batch"'
          />
        </label>
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="primary"
            onClick={onCommit}
            disabled={committing || missingRequired.length > 0}
          >
            {committing ? 'Committing...' : `Import ${parsed.rows.length} rows`}
          </Button>
        </div>
        </div>
      </Panel>
    </div>
  );
}
