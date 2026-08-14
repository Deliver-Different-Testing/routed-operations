import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useAutoPoll } from '../../hooks/useAutoPoll';
import { routeViewerService } from '../../services/routeViewerService';
import { request } from '../../services/api';
import { tenantDate, tenantDateTime, tenantTodayYmd } from '../../lib/tenantDate';
import { Button } from '../../components/common/Button';
import { RvBox } from '../../components/route-viewer/RvBox';
import { RvJobDetail } from '../../components/route-viewer/RvJobDetail';
import { CreateEventDialog } from '../../components/route-viewer/CreateEventDialog';

// Customer Services page (master Section 12). Two panes:
//   - left: event grid filtered by date + client-internal + follow-up
//     radio (All / UCL / Client) + include-closed checkbox
//   - right: full RvJobDetail reused from Home when an event row is
//     clicked (drills to the linked bulkJob).
//
// Deep-link entry via ?eid=<eventId>: on mount, if the URL carries an
// eid, we prefetch the row + preselect it so operators land straight
// on the event they were paged about.
//
// T.1 SECURITY: backend short-circuits to empty for NP sessions
// pending tblBulkEvent.NpAgentId backfill.

type Followup = 'All' | 'UCL' | 'Client';

interface EventRow {
  bulkEventId: number;
  bulkJobId: number | null;
  clientId: number | null;
  courierId: number | null;
  jobNumber: string | null;
  courierCode: string | null;
  notes: string | null;
  internal: boolean;
  clientCreated: boolean;
  clientFollowup: boolean;
  createdByName: string | null;
  eventDate: string; // yyyy-MM-dd (SP emits DateOnly)
  created: string;   // ISO
  closedDate: string | null;
  closedByName: string | null;
}

export default function CustomerServices() {
  const user = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialDate = tenantTodayYmd({ isUsTenant: user.isUsTenant, timeZone: user.timeZone });
  const [runDate, setRunDate] = useState(initialDate);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [followup, setFollowup] = useState<Followup>('All');
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  // Fallback modal payload when navigator.clipboard is unavailable
  // (older browsers / non-secure contexts). Operator select-copies
  // the URL from the modal instead of a silent failure.
  const [clipboardFallback, setClipboardFallback] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['cs-events', runDate, includeClosed],
    queryFn: () => request<{ response: EventRow[] }>(
      `/runviewer/events?runDate=${encodeURIComponent(runDate)}&includeClosed=${includeClosed}`,
    ).then((r) => r.response),
    enabled: !!runDate,
    staleTime: 5_000,
  });

  useAutoPoll(() => { q.refetch(); }, 25, true);

  const rows = q.data ?? [];
  const tzOpts = { isUsTenant: user.isUsTenant, timeZone: user.timeZone };

  // Client-side follow-up filter (SP returns all events; radio narrows
  // to the ownership category). UCL = staff-followup (Internal=true).
  // Client = clientFollowup=true. All = show both.
  const filtered = useMemo(() => {
    if (followup === 'All') return rows;
    if (followup === 'UCL') return rows.filter((r) => r.internal);
    return rows.filter((r) => r.clientFollowup);
  }, [rows, followup]);

  // Deep-link entry: ?eid=<eventId>. Once the event list loads, find
  // the row and preselect it. Clear the query param so refresh doesn't
  // re-trigger the auto-select if the operator navigates away.
  useEffect(() => {
    const eid = searchParams.get('eid');
    if (!eid || q.isLoading || rows.length === 0) return;
    const target = rows.find((r) => r.bulkEventId === Number(eid));
    if (!target) return;
    setSelectedEventId(target.bulkEventId);
    if (target.bulkJobId != null) setSelectedJobId(target.bulkJobId);
    const next = new URLSearchParams(searchParams);
    next.delete('eid');
    setSearchParams(next, { replace: true });
  }, [searchParams, rows, q.isLoading, setSearchParams]);

  // Copy a shareable direct link to the operator's clipboard. Legacy
  // csControl.generateDirectLink hid this for internal events + relied
  // on document.execCommand('copy'); we gate on !internal here and use
  // navigator.clipboard with a select-copy modal fallback for
  // non-secure contexts (older browsers / http dev).
  const copyDirectLink = async (row: EventRow) => {
    if (row.internal || row.clientId == null) return;
    try {
      const { url } = await routeViewerService.generateDirectLink(row.bulkEventId, row.clientId);
      if (!url || url === 'Link Declined') {
        toast.show('Direct link not available for this client.', 'warning');
        return;
      }
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try {
          await navigator.clipboard.writeText(url);
          toast.show('Event link copied', 'success');
          return;
        } catch {
          // fall through to select-copy modal
        }
      }
      setClipboardFallback(url);
    } catch (e) {
      toast.show(`Copy link failed: ${(e as Error).message}`, 'error');
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
          <input
            type="checkbox"
            checked={includeClosed}
            onChange={(e) => setIncludeClosed(e.target.checked)}
            className="accent-brand-cyan"
          />
          Include closed
        </label>
        {!user.isNetworkPartner && (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span>Follow-up:</span>
            {(['All', 'UCL', 'Client'] as Followup[]).map((f) => (
              <label key={f} className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name="cs-followup"
                  checked={followup === f}
                  onChange={() => setFollowup(f)}
                  className="accent-brand-cyan"
                />
                {f}
              </label>
            ))}
          </div>
        )}
        {!user.isNetworkPartner && (
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            + Create event
          </Button>
        )}
        <div className="ml-auto text-xs text-text-muted">
          {q.isLoading ? 'Loading...' : `${filtered.length} event${filtered.length === 1 ? '' : 's'}`}
        </div>
      </div>

      {createOpen && (
        <CreateEventDialog
          jobId={selectedJobId ?? 0}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); q.refetch(); }}
        />
      )}

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="w-1/2 overflow-auto border-r border-border">
          <RvBox title="Events">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-white border-b border-border">
                <tr className="text-left text-text-muted">
                  <th className="px-2 py-1">Event #</th>
                  <th className="px-2 py-1">Job #</th>
                  <th className="px-2 py-1">Date</th>
                  <th className="px-2 py-1">Follow</th>
                  <th className="px-2 py-1">By</th>
                  <th className="px-2 py-1">Notes</th>
                  <th className="px-2 py-1">Closed</th>
                  <th className="px-2 py-1 w-8" aria-label="Actions"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const active = selectedEventId === r.bulkEventId;
                  // Legacy csControl.generateDirectLink returns early
                  // when event.internal is true; also need a clientId
                  // to build the URL server-side.
                  const canCopyLink = !r.internal && r.clientId != null;
                  return (
                    <tr
                      key={r.bulkEventId}
                      onClick={() => {
                        setSelectedEventId(r.bulkEventId);
                        if (r.bulkJobId != null) setSelectedJobId(r.bulkJobId);
                      }}
                      className={`cursor-pointer border-b border-border/50 ${
                        active ? 'bg-brand-cyan/20' : 'hover:bg-surface-cream/60'
                      }`}
                    >
                      <td className="px-2 py-1 font-mono">{r.bulkEventId}</td>
                      <td className="px-2 py-1 font-mono">{r.jobNumber ?? '-'}</td>
                      <td className="px-2 py-1">{tenantDate(r.eventDate, tzOpts)}</td>
                      <td className="px-2 py-1">
                        {r.internal && <span className="inline-block px-1 rounded bg-blue-100 text-blue-800 text-[10px] mr-0.5">UCL</span>}
                        {r.clientFollowup && <span className="inline-block px-1 rounded bg-emerald-100 text-emerald-800 text-[10px]">CLIENT</span>}
                      </td>
                      <td className="px-2 py-1">{r.createdByName ?? '-'}</td>
                      <td className="px-2 py-1 truncate max-w-[16rem]" title={r.notes ?? undefined}>
                        {r.notes ?? '-'}
                      </td>
                      <td className="px-2 py-1 text-text-muted">
                        {r.closedDate ? `${tenantDateTime(r.closedDate, tzOpts)} (${r.closedByName ?? '?'})` : '-'}
                      </td>
                      <td className="px-2 py-1 text-center">
                        {canCopyLink && (
                          <button
                            type="button"
                            aria-label="Copy event link"
                            title="Copy event link"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyDirectLink(r);
                            }}
                            className="text-text-muted hover:text-brand-cyan p-0.5 rounded focus:outline-none focus:ring-1 focus:ring-brand-cyan"
                          >
                            {/* clipboard-copy SVG (16x16) - inline to
                                avoid an icon-pack dependency for one glyph. */}
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && !q.isLoading && (
                  <tr>
                    <td className="px-3 py-6 text-center text-text-muted" colSpan={8}>
                      No events for this date / filter.
                    </td>
                  </tr>
                )}
                {q.isLoading && (
                  <tr>
                    <td className="px-3 py-6 text-center text-text-muted" colSpan={8}>Loading...</td>
                  </tr>
                )}
              </tbody>
            </table>
          </RvBox>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
          {selectedEventId != null && (
            <EventActions
              eventId={selectedEventId}
              isClosed={!!rows.find((r) => r.bulkEventId === selectedEventId)?.closedDate}
              onDone={() => q.refetch()}
            />
          )}
          <div className="flex-1 overflow-hidden">
            <RvJobDetail
              bulkJobId={selectedJobId}
              initialJob={null}
              onPickSibling={() => { /* CS doesn't cross-navigate; ignore */ }}
            />
          </div>
        </div>
      </div>

      {clipboardFallback && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setClipboardFallback(null)}
        >
          <div
            className="bg-surface-white rounded shadow-lg p-4 max-w-lg w-[90%]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-medium mb-2">Copy this link</div>
            <div className="text-xs text-text-muted mb-2">
              Clipboard access is unavailable. Select the URL below and copy it manually.
            </div>
            <input
              type="text"
              readOnly
              value={clipboardFallback}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full border border-border rounded px-2 py-1 text-xs bg-surface-white font-mono"
            />
            <div className="flex justify-end mt-2">
              <Button variant="neutral" size="sm" onClick={() => setClipboardFallback(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Close + threaded-reply strip. Sits above the RvJobDetail so
// operators complete their workflow (add a follow-up note, close
// the ticket) without leaving the CS grid. Uses the user's own
// display name for the audit trail.
function EventActions({ eventId, isClosed, onDone }: {
  eventId: number;
  isClosed: boolean;
  onDone: () => void;
}) {
  const user = useAuth();
  const [reply, setReply] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const who = user.fullName || user.email || 'operator';

  const submitReply = async () => {
    if (!reply.trim()) return;
    setSubmitting(true); setError(null);
    try {
      await routeViewerService.addEventReply(eventId, reply.trim(), who);
      setReply('');
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const submitClose = async () => {
    setSubmitting(true); setError(null);
    try {
      await routeViewerService.closeEvent(eventId, who);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border-b border-border bg-surface-white px-3 py-2 flex-shrink-0 flex flex-wrap items-center gap-2">
      <span className="text-xs text-text-muted">Event #{eventId}:</span>
      <input
        type="text"
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        placeholder="Add reply / note..."
        disabled={submitting || isClosed}
        className="flex-1 min-w-[12rem] border border-border rounded px-2 py-1 text-xs bg-surface-white disabled:bg-slate-50"
      />
      <Button variant="primary" size="sm" onClick={submitReply} disabled={submitting || !reply.trim() || isClosed}>
        Reply
      </Button>
      <Button variant="neutral" size="sm" onClick={submitClose} disabled={submitting || isClosed}>
        {isClosed ? 'Closed' : 'Close event'}
      </Button>
      {error && <span className="text-[10px] text-error">{error}</span>}
    </div>
  );
}
