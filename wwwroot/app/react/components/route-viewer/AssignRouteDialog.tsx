import { useEffect, useRef, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useAuth } from '../../context/AuthContext';
import { routeViewerService } from '../../services/routeViewerService';

// Route Viewer Assign Route dialog (master Section 13.1 + P6). Unified
// 3-way picker: Courier / Agent / Network Partner. NP users see courier
// only. Typeahead is debounced 250ms with an anti-race `searchToken`
// (rapid typing does not let an earlier response overwrite a later one).
//
// The assign endpoint currently accepts either courierId / agentId /
// npAgentId - the picker fills exactly one and clears the others so
// there is no ambiguity server-side. Success callback receives the
// human-readable rollup ("Assigned Kerran Tetley to 12 jobs on run
// #204") which the caller toasts.
//
// Bucket search endpoints:
//   Courier  -> GET /runviewer/couriers/search?q=            (legacy,
//               NP-scoped server-side; returns { courierId, code, name })
//   Agent/NP -> GET /runviewer/jobs/{jobId}/assignable-targets/agents
//               ?q=&isNetworkPartner=&limit=  (returns { id, name, hint })
//
// The agent endpoint needs an anchor jobId for its NP scope guard.
// Callers that open the dialog from a job context (RvJobContextMenu)
// pass `anchorJobId`; callers with only a run in hand (RvRunContextMenu)
// leave it undefined, and we pass 0 - the scope guard no-ops for admin
// scope, and admin is the only scope that ever sees the Agent + NP tabs
// (NP users are locked to the courier-only variant just below).

interface Props {
  runId: number;
  /** Date the run is on. Needed so the dialog can resolve the run's
   *  bulk job ids at submit time - the assign endpoint requires
   *  JobIds and does NOT resolve them from runId + date server-side. */
  runDate: string;
  /** Optional anchor job id used by the Agent + NP search endpoint's
   *  NP scope guard. Callers with a selected job (job context menu)
   *  should pass it; run-scoped callers can omit and we default to 0. */
  anchorJobId?: number;
  onClose: () => void;
  onSuccess: (summary: string) => void;
}

type Bucket = 'courier' | 'agent' | 'np';

interface PickerRow {
  id: number;
  label: string;
  subtitle?: string;
}

export function AssignRouteDialog({ runId, runDate, anchorJobId, onClose, onSuccess }: Props) {
  const user = useAuth();
  const [bucket, setBucket] = useState<Bucket>('courier');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<PickerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<PickerRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef(0);
  const debounceRef = useRef<number | null>(null);

  // NP users are locked to courier picker.
  const availableBuckets: Bucket[] = user.isNetworkPartner
    ? ['courier']
    : ['courier', 'agent', 'np'];

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => runSearch(query), 250);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, bucket]);

  const runSearch = async (q: string) => {
    const token = ++tokenRef.current;
    setLoading(true);
    setError(null);
    try {
      let nextRows: PickerRow[];
      if (bucket === 'courier') {
        const results = await routeViewerService.searchCouriers(q);
        if (tokenRef.current !== token) return;
        nextRows = results.map((c) => ({
          id: c.courierId,
          // Legacy tenants (medical-prod in particular) have couriers
          // with a null tucCourier.Code - render just the name so we
          // don't emit "George Test (null)" in the picker.
          label: c.code ? `${c.name} (${c.code})` : c.name,
        }));
      } else {
        // Agent + NP share one endpoint distinguished by the
        // isNetworkPartner flag. Backend requires an anchor jobId for
        // its NP scope guard; run-only callers pass 0 which is a no-op
        // for admin scope (see Props.anchorJobId).
        const isNp = bucket === 'np';
        const results = await routeViewerService.searchAgents(
          anchorJobId ?? 0,
          q,
          isNp,
          200,
        );
        if (tokenRef.current !== token) return;
        nextRows = results.map((a) => ({
          id: a.id,
          label: a.name ?? `#${a.id}`,
          subtitle: a.hint ?? undefined,
        }));
      }
      setRows(nextRows);
    } catch (e) {
      if (tokenRef.current === token) setError((e as Error).message);
    } finally {
      if (tokenRef.current === token) setLoading(false);
    }
  };

  const submit = async () => {
    if (!picked) return;
    setSubmitting(true);
    setError(null);
    try {
      // The assign endpoint (POST /api/runviewer/jobs/assign) requires
      // an explicit JobIds list; it does NOT resolve them from runId +
      // runDate server-side. The backend AssignAsync treats those ids
      // as tucJob.UcjbId (per-job scope guard + DES_stpJob_AutoDespatch
      // SPs both key off ucjbID), so we send `jobId` NOT `bulkJobId` -
      // matches legacy homeControl.js:2196 (`j.jobID`) and keeps
      // synthetic Recurring Route runs assignable (they carry real
      // tucJob rows even though tblBulkJob is empty).
      const jobs = await routeViewerService.getRunJobs(runId, runDate, { group: 'Combined' });
      const jobIds = jobs.map((j) => j.jobId).filter((id) => id > 0);
      if (jobIds.length === 0) {
        setError('This run has no jobs to assign yet.');
        return;
      }
      const payload = bucket === 'courier'
        ? { jobIds, courierId: picked.id }
        : bucket === 'agent'
          ? { jobIds, agentId: picked.id }
          : { jobIds, npAgentId: picked.id };
      const result = await routeViewerService.assignRoute(payload);
      const label = bucket === 'courier' ? 'courier' : bucket === 'agent' ? 'agent' : 'network partner';
      onSuccess(`Assigned ${picked.label} as ${label} to run #${runId} (${result.assigned} jobs).`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={user.isNetworkPartner ? 'Assign courier' : 'Assign route'}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!picked || submitting}>
            {submitting ? 'Assigning...' : 'Assign'}
          </Button>
        </div>
      }
    >
      {availableBuckets.length > 1 && (
        <div className="flex gap-2 mb-2 text-sm">
          {availableBuckets.map((b) => (
            <label key={b} className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                checked={bucket === b}
                onChange={() => { setBucket(b); setPicked(null); }}
                className="accent-brand-cyan"
              />
              <span className="capitalize">
                {b === 'np' ? 'Network Partner' : b}
              </span>
            </label>
          ))}
        </div>
      )}

      <input
        type="text"
        placeholder={`Search ${bucket === 'np' ? 'network partners' : bucket + 's'}...`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full border border-border rounded px-2 py-1 text-sm mb-2"
        autoFocus
      />

      <div className="max-h-72 overflow-auto border border-border rounded">
        {loading && <div className="p-2 text-xs text-text-muted">Searching...</div>}
        {!loading && rows.length === 0 && (
          <div className="p-2 text-xs text-text-muted">
            No matches - type to search.
          </div>
        )}
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setPicked(r)}
            className={`w-full text-left px-2 py-1.5 text-sm border-b border-border/50 ${
              picked?.id === r.id ? 'bg-brand-cyan/20' : 'hover:bg-surface-cream'
            }`}
          >
            <div className="font-medium">{r.label}</div>
            {r.subtitle && <div className="text-xs text-text-muted">{r.subtitle}</div>}
          </button>
        ))}
      </div>

      {error && <div className="mt-2 text-xs text-error">{error}</div>}
    </Modal>
  );
}
