import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import {
  bulkImportService,
  type BulkJobFoundDto,
  type BulkJobSearchItem,
} from '../../services/bulkImportService';
import { clientsService, type ClientDto } from '../../services/clientsService';
import { ClientTypeahead } from './shared/ClientTypeahead';

interface Props {
  open: boolean;
  onClose: () => void;
  onCompleted: () => void;
}

type JobType = 'routed' | 'ondemand';

/**
 * BulkCompleteModal - Bulk Complete flow ported from legacy
 * homeControl.js:4446-4685. Operator picks a client + job type, pastes a
 * list of job numbers (one per line, optionally CSV with `jobNumber,
 * bookDate, courierCode`), and hits Search. The matched jobs render in a
 * table with tick boxes; anything not found is surfaced separately. On
 * Complete Selected the server marks the ticked rows done via
 * UTL_stpJob_InsertFromRunBuilder (routed) or an in-place update (on-demand).
 *
 * Backend contract lives in BulkImportController.cs:291 (search-for-complete)
 * and 311 (bulk-complete) and mirrors legacy BulkController.cs:242,262.
 */
export function BulkCompleteModal({ open, onClose, onCompleted }: Props) {
  const toast = useToast();
  const { isInternal } = useAuth();

  // Client picker - internal staff get typeahead, others get dropdown.
  const [client, setClient] = useState<ClientDto | null>(null);
  const [clientList, setClientList] = useState<ClientDto[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);

  const [jobType, setJobType] = useState<JobType>('routed');
  const [jobNumbersText, setJobNumbersText] = useState('');
  const [searching, setSearching] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [found, setFound] = useState<BulkJobFoundDto[]>([]);
  const [notFound, setNotFound] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // Freeze the flow once search returns a non-empty set so the operator
  // isn't tempted to edit the number list mid-review.
  const hasSearched = found.length > 0 || notFound.length > 0;

  useEffect(() => {
    if (!open) return;
    // Reset transient state each open so the modal doesn't leak between
    // sessions (e.g. after Complete + reopen for a different client).
    setJobNumbersText('');
    setFound([]);
    setNotFound([]);
    setSelected(new Set());
    if (!isInternal) {
      let cancelled = false;
      (async () => {
        setClientsLoading(true);
        try {
          const { response } = await clientsService.getClients();
          if (cancelled) return;
          const list = response.clients ?? [];
          setClientList(list);
          if (list.length === 1 && !client) setClient(list[0]);
        } catch (e) {
          if (!cancelled) toast.show(`Failed to load clients: ${(e as Error).message}`, 'error');
        } finally {
          if (!cancelled) setClientsLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const parsedJobs: BulkJobSearchItem[] = useMemo(() => {
    // One line per job. Comma-separated tokens on the same line let the
    // operator supply `jobNumber, bookDate (yyyy-MM-dd), courierCode`
    // without leaving the textarea. Blank lines skipped.
    const lines = jobNumbersText.split(/\r?\n/);
    const items: BulkJobSearchItem[] = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const tokens = line.split(',').map((t) => t.trim()).filter(Boolean);
      if (tokens.length === 0) continue;
      const item: BulkJobSearchItem = { jobNumber: tokens[0] };
      if (tokens[1] && /^\d{4}-\d{2}-\d{2}$/.test(tokens[1])) {
        item.dateTime = tokens[1];
      }
      if (tokens[2]) item.courierCode = tokens[2];
      items.push(item);
    }
    return items;
  }, [jobNumbersText]);

  const searchDisabled =
    !client || parsedJobs.length === 0 || searching || completing;
  const completeDisabled =
    !client || selected.size === 0 || completing;

  async function handleSearch() {
    if (!client) return;
    setSearching(true);
    try {
      const { response } = await bulkImportService.searchForComplete({
        clientId: client.id,
        jobType,
        jobs: parsedJobs,
      });
      if (!response.success) {
        const msg = response.messages?.[0]?.message ?? 'Search failed.';
        toast.show(msg, 'error');
        return;
      }
      setFound(response.foundJobs ?? []);
      setNotFound(response.notFoundJobNumbers ?? []);
      // Pre-tick every completable row (matches legacy pattern of "select
      // all by default, operator un-ticks any they want to skip").
      const preTick = new Set<number>();
      for (const j of response.foundJobs ?? []) {
        if (j.canComplete) preTick.add(j.id);
      }
      setSelected(preTick);
    } catch (e) {
      toast.show(`Search failed: ${(e as Error).message}`, 'error');
    } finally {
      setSearching(false);
    }
  }

  async function handleComplete() {
    if (!client || selected.size === 0) return;
    setCompleting(true);
    try {
      const jobs = found
        .filter((j) => selected.has(j.id))
        .map((j) => ({
          jobId: j.id,
          jobNumber: j.jobNumber,
          courierCode: j.courierCode,
        }));
      const { response } = await bulkImportService.bulkComplete({
        clientId: client.id,
        jobType,
        jobs,
      });
      const msg = response.messages?.[0]?.message ?? (response.success ? 'Jobs completed.' : 'Bulk complete failed.');
      toast.show(msg, response.success ? 'success' : 'warning');
      if (response.success) {
        onCompleted();
        onClose();
      }
    } catch (e) {
      toast.show(`Bulk complete failed: ${(e as Error).message}`, 'error');
    } finally {
      setCompleting(false);
    }
  }

  function resetSearch() {
    setFound([]);
    setNotFound([]);
    setSelected(new Set());
  }

  function toggle(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function toggleAll() {
    const completable = found.filter((j) => j.canComplete);
    if (selected.size === completable.length && completable.length > 0) {
      setSelected(new Set());
    } else {
      const next = new Set<number>();
      for (const j of completable) next.add(j.id);
      setSelected(next);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Bulk Complete"
      size="5xl"
      loading={searching || completing}
      loadingMessage={completing ? 'Completing selected jobs...' : 'Searching for jobs...'}
      footer={
        <div className="flex justify-between items-center">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <div className="flex gap-2">
            {hasSearched && (
              <Button variant="neutral" onClick={resetSearch} disabled={completing}>
                Clear Results
              </Button>
            )}
            {!hasSearched && (
              <Button variant="primary" onClick={handleSearch} disabled={searchDisabled}>
                {searching ? 'Searching...' : 'Search'}
              </Button>
            )}
            {hasSearched && (
              <Button variant="primary" onClick={handleComplete} disabled={completeDisabled}>
                {completing ? 'Completing...' : `Complete Selected (${selected.size})`}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Client</label>
            {isInternal ? (
              <ClientTypeahead
                value={client}
                onChange={setClient}
                disabled={hasSearched}
              />
            ) : (
              <select
                value={client?.id ?? ''}
                disabled={clientsLoading || clientList.length === 0 || hasSearched}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  const picked = clientList.find((c) => c.id === id) ?? null;
                  setClient(picked);
                }}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-surface-white"
              >
                <option value="">
                  {clientsLoading ? 'Loading clients...' : 'Select a client'}
                </option>
                {clientList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} - {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Job Type</label>
            <div className="flex gap-2">
              <label className={`flex-1 border rounded px-2 py-1.5 text-xs cursor-pointer text-center ${jobType === 'routed' ? 'border-brand-cyan bg-brand-cyan/10' : 'border-border'}`}>
                <input
                  type="radio"
                  name="bulk-complete-jobtype"
                  className="mr-1"
                  checked={jobType === 'routed'}
                  disabled={hasSearched}
                  onChange={() => setJobType('routed')}
                />
                Routed / Scheduled
              </label>
              <label className={`flex-1 border rounded px-2 py-1.5 text-xs cursor-pointer text-center ${jobType === 'ondemand' ? 'border-brand-cyan bg-brand-cyan/10' : 'border-border'}`}>
                <input
                  type="radio"
                  name="bulk-complete-jobtype"
                  className="mr-1"
                  checked={jobType === 'ondemand'}
                  disabled={hasSearched}
                  onChange={() => setJobType('ondemand')}
                />
                On-Demand
              </label>
            </div>
          </div>
        </div>

        {!hasSearched && (
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Job Numbers ({parsedJobs.length} parsed)
            </label>
            <textarea
              value={jobNumbersText}
              onChange={(e) => setJobNumbersText(e.target.value)}
              rows={8}
              placeholder={
                'One per line. Optional CSV: JobNumber, YYYY-MM-DD, CourierCode\nExample:\n167022889\n168672574DEL, 2026-07-20\n168672576DEL, 2026-07-20, ACME01'
              }
              className="w-full text-sm border border-border rounded px-2 py-1.5 font-mono"
              disabled={searching}
            />
            <p className="text-[11px] text-text-muted mt-1">
              Paste job numbers from a spreadsheet or dispatch note. Comma-separated tokens on the
              same line narrow the match by book date and (optionally) courier code.
            </p>
          </div>
        )}

        {hasSearched && (
          <div className="space-y-3">
            {found.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-text-secondary">
                    Matched Jobs ({found.length})
                  </span>
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="text-[11px] text-brand-cyan hover:underline"
                  >
                    {selected.size > 0 && selected.size === found.filter((j) => j.canComplete).length
                      ? 'Un-tick all'
                      : 'Tick all completable'}
                  </button>
                </div>
                <div className="border border-border rounded overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-surface-cream text-text-secondary">
                      <tr>
                        <th className="px-2 py-1.5 text-left w-8"></th>
                        <th className="px-2 py-1.5 text-left">Job #</th>
                        <th className="px-2 py-1.5 text-left">Book Date</th>
                        <th className="px-2 py-1.5 text-left">From</th>
                        <th className="px-2 py-1.5 text-left">To</th>
                        <th className="px-2 py-1.5 text-left">Courier</th>
                        <th className="px-2 py-1.5 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {found.map((j) => {
                        const disabledRow = !j.canComplete;
                        return (
                          <tr
                            key={j.id}
                            className={`border-t border-border-light ${disabledRow ? 'bg-surface-cream/50 text-text-muted' : ''}`}
                          >
                            <td className="px-2 py-1.5">
                              <input
                                type="checkbox"
                                checked={selected.has(j.id)}
                                disabled={disabledRow}
                                onChange={() => toggle(j.id)}
                              />
                            </td>
                            <td className="px-2 py-1.5 font-mono">{j.jobNumber ?? '-'}</td>
                            <td className="px-2 py-1.5">
                              {j.bookDate ? new Date(j.bookDate).toLocaleDateString() : '-'}
                            </td>
                            <td className="px-2 py-1.5">
                              {j.fromAddress ?? '-'}
                              {j.fromSuburb ? `, ${j.fromSuburb}` : ''}
                            </td>
                            <td className="px-2 py-1.5">
                              {j.toAddress ?? '-'}
                              {j.toSuburb ? `, ${j.toSuburb}` : ''}
                            </td>
                            <td className="px-2 py-1.5">{j.courierCode ?? '-'}</td>
                            <td className="px-2 py-1.5">
                              {j.void ? 'Void' : j.done ? 'Done' : j.status ?? '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {notFound.length > 0 && (
              <div className="border border-warning/40 bg-warning/5 rounded p-3">
                <p className="text-xs font-medium text-warning mb-1">
                  Not found ({notFound.length})
                </p>
                <p className="text-[11px] text-text-secondary break-all">
                  {notFound.join(', ')}
                </p>
              </div>
            )}
            {found.length === 0 && notFound.length === 0 && (
              <p className="text-xs text-text-muted text-center py-4">
                No results.
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
