import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useAutoPoll } from '../../hooks/useAutoPoll';
import { routeViewerService, type BulkJob } from '../../services/routeViewerService';
import { request } from '../../services/api';
import { tenantDate, tenantDateTime, tenantTodayYmd } from '../../lib/tenantDate';
import { Button } from '../../components/common/Button';
import { Modal } from '../../components/common/Modal';
import { RvBox } from '../../components/route-viewer/RvBox';
import { RvJobDetail } from '../../components/route-viewer/RvJobDetail';
import { CreateEventDialog } from '../../components/route-viewer/CreateEventDialog';
import { nextSortDirection, sortIndicator } from '../../lib/sortLists';
import { RowContextMenu, type ContextMenuItem } from '../../components/cockpit/RowContextMenu';
import type { ListSort } from '../../components/cockpit/CockpitState';

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

// Match legacy CS eventList.tpl pageSize=45. Kept as a top-level const so
// tests can import + assert the boundary without duplicating the number.
const EVENT_PAGE_SIZE = 45;

// Legacy `orderList` supported these columns via label -> field mapping.
// Field names below match EventRow properties so the row getter can stay
// as a simple property lookup.
type SortField =
  | 'created' | 'bulkEventId' | 'jobNumber' | 'courierCode' | 'createdByName'
  | 'clientFollowup' | 'internal' | 'closedByName' | 'notes';

function eventFieldGetter(r: EventRow, field: SortField): unknown {
  switch (field) {
    case 'created': return r.created ? new Date(r.created).getTime() : 0;
    case 'bulkEventId': return r.bulkEventId;
    case 'jobNumber': return r.jobNumber ?? '';
    case 'courierCode': return r.courierCode ?? '';
    case 'createdByName': return r.createdByName ?? '';
    // Followup: legacy grid rendered "Client" or "UCL"; sorting on the
    // boolean matches that ordering (Client=true sorts after UCL=false
    // in asc, matching the legacy behaviour of a string sort where "C"
    // predates "U" - flipped via desc if the operator wants).
    case 'clientFollowup': return r.clientFollowup ? 1 : 0;
    // Client Visible: legacy tick appears when NOT internal, so we invert
    // to keep visible-first at the top on asc.
    case 'internal': return r.internal ? 1 : 0;
    case 'closedByName': return r.closedByName ?? '';
    case 'notes': return r.notes ?? '';
  }
}

function sortEvents(rows: EventRow[], sort: ListSort | null): EventRow[] {
  if (!sort) return rows;
  const mult = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = eventFieldGetter(a, sort.field as SortField);
    const bv = eventFieldGetter(b, sort.field as SortField);
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
    return String(av).localeCompare(String(bv)) * mult;
  });
}

// Numbered pager with prev/next. Same shape used by ScanManager's inline
// Pager; kept local so CS does not couple to Scan Manager's file.
function Pager({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (p: number) => void }) {
  if (pageCount <= 1) return null;
  const pages: (number | 'gap')[] = [];
  const push = (v: number | 'gap') => { pages.push(v); };
  const win = 1;
  push(1);
  if (page - win > 2) push('gap');
  for (let p = Math.max(2, page - win); p <= Math.min(pageCount - 1, page + win); p++) push(p);
  if (page + win < pageCount - 1) push('gap');
  if (pageCount > 1 && pages[pages.length - 1] !== pageCount) push(pageCount);
  return (
    <div className="flex items-center justify-center gap-1 px-2 py-1.5 border-t border-border bg-surface-white text-xs">
      <Button variant="neutral" size="sm" onClick={() => onChange(page - 1)} disabled={page <= 1} aria-label="Previous page">‹</Button>
      {pages.map((p, i) => p === 'gap' ? (
        <span key={`gap-${i}`} className="px-1 text-text-muted">...</span>
      ) : (
        <Button
          key={p}
          variant="neutral"
          size="sm"
          active={p === page}
          onClick={() => onChange(p)}
          aria-label={`Page ${p}`}
        >
          {p}
        </Button>
      ))}
      <Button variant="neutral" size="sm" onClick={() => onChange(page + 1)} disabled={page >= pageCount} aria-label="Next page">›</Button>
    </div>
  );
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
  // When the operator picks a job from the top-bar typeahead, we open the
  // Create Event dialog anchored to THAT job (bulkJobId), not the row
  // currently selected in the events grid. Null = fall back to
  // `selectedJobId` so the plain "+ Create event" button still works.
  const [createDialogJobId, setCreateDialogJobId] = useState<number | null>(null);
  // Top-bar job search (legacy csView.html:8-16 `jobSearchBox` +
  // `createJobEvent`). 200ms debounce, up to 8 results. Wraps the same
  // `searchByJobNumber` endpoint the Header uses on Route Viewer -
  // backend returns a single BulkJob or 404 so we normalise to [] on
  // miss + error.
  const [jobQuery, setJobQuery] = useState('');
  const [jobHits, setJobHits] = useState<BulkJob[]>([]);
  const [jobSearching, setJobSearching] = useState(false);
  const [jobSearchFocused, setJobSearchFocused] = useState(false);
  const jobDebounceRef = useRef<number | null>(null);
  const jobTokenRef = useRef(0);
  // Fallback modal payload when navigator.clipboard is unavailable
  // (older browsers / non-secure contexts). Operator select-copies
  // the URL from the modal instead of a silent failure.
  const [clipboardFallback, setClipboardFallback] = useState<string | null>(null);
  // Sort + pagination state. Legacy default was created-desc (newest
  // events at the top); mirror that so the first render matches.
  const [sort, setSort] = useState<ListSort | null>({ field: 'created', direction: 'desc' });
  const [page, setPage] = useState(1);
  // Right-click context menu + close-event modal state. `ctx` holds the
  // click coordinates + target event so the menu can render positioned;
  // `closeTarget` is set when the operator picks Close Event from the
  // menu, opening a name-editable confirmation modal (mirrors legacy
  // csControl.eventListMenu -> $scope.gather.form pattern).
  const [ctx, setCtx] = useState<{ x: number; y: number; event: EventRow } | null>(null);
  const [closeTarget, setCloseTarget] = useState<EventRow | null>(null);

  // Non-network-partner sessions are treated as admin / tenant staff for
  // the client-visible tick column (matches legacy csControl.js where
  // isAdmin = ClientInternal === "True"; in this SPA the equivalent
  // signal is "not a network partner").
  const isAdmin = !user.isNetworkPartner;

  const q = useQuery({
    queryKey: ['cs-events', runDate, includeClosed],
    queryFn: () => request<{ response: EventRow[] }>(
      `/runviewer/events?runDate=${encodeURIComponent(runDate)}&includeClosed=${includeClosed}`,
    ).then((r) => r.response),
    enabled: !!runDate,
    staleTime: 5_000,
  });

  useAutoPoll(() => { q.refetch(); }, 25, true);

  // Debounced top-bar job typeahead. Legacy csControl.createJobEvent
  // opened the Create Event dialog for the picked job; the modern
  // equivalent is to open CreateEventDialog with that bulkJobId. Token
  // ref guards against stale results (fast typers).
  useEffect(() => {
    if (jobDebounceRef.current) window.clearTimeout(jobDebounceRef.current);
    const term = jobQuery.trim();
    if (!term) { setJobHits([]); setJobSearching(false); return; }
    jobDebounceRef.current = window.setTimeout(async () => {
      const token = ++jobTokenRef.current;
      setJobSearching(true);
      try {
        // Backend returns a single BulkJob or 404 - normalise to array
        // (matches the Header pattern). `unwrap` throws on 404, so the
        // catch below handles miss + error the same way.
        const hit = (await routeViewerService.searchByJobNumber(term)) as unknown as BulkJob | null;
        if (jobTokenRef.current === token) {
          setJobHits(hit ? [hit] : []);
        }
      } catch {
        if (jobTokenRef.current === token) setJobHits([]);
      } finally {
        if (jobTokenRef.current === token) setJobSearching(false);
      }
    }, 200);
    return () => { if (jobDebounceRef.current) window.clearTimeout(jobDebounceRef.current); };
  }, [jobQuery]);

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

  const sorted = useMemo(() => sortEvents(filtered, sort), [filtered, sort]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / EVENT_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const paged = useMemo(
    () => sorted.slice((currentPage - 1) * EVENT_PAGE_SIZE, currentPage * EVENT_PAGE_SIZE),
    [sorted, currentPage],
  );

  // Reset the pager when the operative row set changes so page 4 of the
  // old view does not fall off the end of the new view.
  useEffect(() => { setPage(1); }, [runDate, includeClosed, followup, sort]);

  // Client Visible column visibility rule: admin-only, AND at least one
  // event on the list is client-visible (all-internal lists render
  // without the column so the header does not sit above an empty column).
  const hasClientVisible = useMemo(() => filtered.some((r) => !r.internal), [filtered]);
  const showClientVisibleCol = isAdmin && hasClientVisible;

  // Column count for empty / loading colSpan. 8 core columns + optional
  // Client Visible + trailing actions column.
  const colCount = 8 + (showClientVisibleCol ? 1 : 0);

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

  // Right-pane job snapshot for Track-It button + delivery-address map
  // iframe (legacy csView.html:110, 120-122). Shares the SAME query key
  // that RvJobDetail uses (`['rv-job-detail', bulkJobId]`) so the fetch
  // is de-duplicated by React Query - one network hit per selected job,
  // both consumers read from the same cache entry.
  const selectedJobQ = useQuery({
    queryKey: ['rv-job-detail', selectedJobId],
    queryFn: () => routeViewerService.getBulkJob(selectedJobId!),
    enabled: selectedJobId != null && selectedJobId > 0,
    staleTime: 15_000,
  });
  const selectedJob = selectedJobQ.data ?? null;

  // Column header spec used by the sortable header row + colSpan math.
  // Keeping this as data (not JSX) makes the "Client Visible" gate a
  // one-line filter rather than a jsx-if wrap.
  const columns: Array<{ field: SortField; label: string; visible?: boolean }> = [
    { field: 'created', label: 'Created' },
    { field: 'bulkEventId', label: 'Event #' },
    { field: 'jobNumber', label: 'Job #' },
    { field: 'courierCode', label: 'Courier' },
    { field: 'createdByName', label: 'Created By' },
    { field: 'clientFollowup', label: 'Followup By' },
    { field: 'internal', label: 'Client Visible', visible: showClientVisibleCol },
    { field: 'closedByName', label: 'Closed By' },
    { field: 'notes', label: 'Notes' },
  ];
  const visibleColumns = columns.filter((c) => c.visible !== false);

  const onHeaderClick = (field: SortField) => () => {
    setSort((prev) => nextSortDirection(prev, field));
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
        {/* Top-bar job typeahead (legacy csView.html:8-16 jobSearchBox).
            Operator types a job number, picks a result, and lands
            straight in the Create Event dialog pre-anchored to that job.
            Kept inline (not in Header) so it sits beside the CS-only
            toolbar controls, and so the dropdown positions relative to
            the input rather than the global header. */}
        <div className="relative">
          <input
            type="text"
            value={jobQuery}
            onChange={(e) => setJobQuery(e.target.value)}
            onFocus={() => setJobSearchFocused(true)}
            onBlur={() => setTimeout(() => setJobSearchFocused(false), 150)}
            placeholder="Search jobs..."
            aria-label="Search jobs"
            className="border border-border rounded px-2 py-0.5 text-xs bg-surface-white w-52"
          />
          {jobQuery && (
            <button
              type="button"
              onClick={() => { setJobQuery(''); setJobHits([]); }}
              aria-label="Clear job search"
              className="absolute right-1 top-0.5 text-text-muted hover:text-text-primary text-xs px-1"
            >
              X
            </button>
          )}
          {jobSearchFocused && jobQuery.trim() && (
            <div className="absolute left-0 top-full mt-1 bg-surface-white border border-border rounded shadow-lg w-80 max-h-80 overflow-y-auto z-40">
              {jobSearching && (
                <div className="px-3 py-2 text-xs text-text-muted italic">Searching...</div>
              )}
              {!jobSearching && jobHits.length === 0 && (
                <div className="px-3 py-2 text-xs text-text-muted italic">No results</div>
              )}
              <ul className="divide-y divide-border/50">
                {jobHits.slice(0, 8).map((hit) => (
                  <li key={hit.bulkJobId}>
                    <button
                      type="button"
                      // onMouseDown fires before onBlur so the click
                      // registers before the dropdown closes.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setCreateDialogJobId(hit.bulkJobId);
                        setCreateOpen(true);
                        setJobQuery('');
                        setJobHits([]);
                        setJobSearchFocused(false);
                      }}
                      className="w-full text-left px-3 py-1.5 hover:bg-brand-cyan/10 text-xs"
                    >
                      <div className="font-medium text-text-primary">
                        {hit.jobNumber ?? `Job #${hit.bulkJobId}`}
                        {hit.clientCode && (
                          <span className="ml-2 text-text-muted font-normal">{hit.clientCode}</span>
                        )}
                      </div>
                      <div className="text-[10px] text-text-muted">
                        {[hit.toSuburb, hit.toAddress].filter(Boolean).join(' - ')}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="ml-auto text-xs text-text-muted">
          {q.isLoading ? 'Loading...' : `${filtered.length} event${filtered.length === 1 ? '' : 's'}`}
        </div>
      </div>

      {createOpen && (
        <CreateEventDialog
          // Prefer the typeahead-picked job when the operator opened
          // the dialog via top-bar search; otherwise fall back to the
          // grid-selected job (legacy "+ Create event" button flow).
          jobId={createDialogJobId ?? selectedJobId ?? 0}
          onClose={() => { setCreateOpen(false); setCreateDialogJobId(null); }}
          onCreated={() => { setCreateOpen(false); setCreateDialogJobId(null); q.refetch(); }}
        />
      )}

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="w-1/2 overflow-auto border-r border-border flex flex-col">
          <RvBox title="Events">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-white border-b border-border">
                <tr className="text-left text-text-muted">
                  {visibleColumns.map((c) => (
                    <th
                      key={c.field}
                      className="px-2 py-1 cursor-pointer select-none hover:text-text-primary"
                      onClick={onHeaderClick(c.field)}
                      role="columnheader"
                      aria-sort={
                        sort?.field === c.field
                          ? (sort.direction === 'asc' ? 'ascending' : 'descending')
                          : 'none'
                      }
                      title="Click to sort. Click again to reverse."
                    >
                      {c.label}{sortIndicator(sort, c.field)}
                    </th>
                  ))}
                  <th className="px-2 py-1 w-8" aria-label="Actions"></th>
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => {
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
                      onContextMenu={(e) => {
                        // stopPropagation prevents ancestor / body-level
                        // listeners from swallowing the event before
                        // React's synthetic dispatch. Mirrors the JobsList
                        // right-click pattern.
                        e.preventDefault();
                        e.stopPropagation();
                        setCtx({ x: e.clientX, y: e.clientY, event: r });
                      }}
                      className={`cursor-pointer border-b border-border/50 ${
                        active ? 'bg-brand-cyan/20' : 'hover:bg-surface-cream/60'
                      }`}
                    >
                      <td className="px-2 py-1 font-mono">{tenantDateTime(r.created, tzOpts)}</td>
                      <td className="px-2 py-1 font-mono">{r.bulkEventId}</td>
                      <td className="px-2 py-1 font-mono">{r.jobNumber ?? '-'}</td>
                      <td className="px-2 py-1">{r.courierCode ?? '-'}</td>
                      <td className="px-2 py-1">{r.createdByName ?? '-'}</td>
                      <td className="px-2 py-1">
                        {r.internal && <span className="inline-block px-1 rounded bg-blue-100 text-blue-800 text-[10px] mr-0.5">UCL</span>}
                        {r.clientFollowup && <span className="inline-block px-1 rounded bg-emerald-100 text-emerald-800 text-[10px]">CLIENT</span>}
                      </td>
                      {showClientVisibleCol && (
                        <td className="px-2 py-1 text-center">
                          {!r.internal && (
                            <span
                              aria-label="Client visible"
                              title="Client visible"
                              className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 text-white text-[10px]"
                            >
                              ✓
                            </span>
                          )}
                        </td>
                      )}
                      <td className="px-2 py-1 text-text-muted">
                        {r.closedDate ? `${tenantDateTime(r.closedDate, tzOpts)} (${r.closedByName ?? '?'})` : '-'}
                      </td>
                      <td className="px-2 py-1 truncate max-w-[16rem]" title={r.notes ?? undefined}>
                        {r.notes ?? '-'}
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
                {sorted.length === 0 && !q.isLoading && (
                  <tr>
                    <td className="px-3 py-6 text-center text-text-muted" colSpan={colCount + 1}>
                      No events for this date / filter.
                    </td>
                  </tr>
                )}
                {q.isLoading && (
                  <tr>
                    <td className="px-3 py-6 text-center text-text-muted" colSpan={colCount + 1}>Loading...</td>
                  </tr>
                )}
              </tbody>
            </table>
          </RvBox>
          <Pager page={currentPage} pageCount={pageCount} onChange={setPage} />
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
          {selectedEventId != null && (
            <EventActions
              eventId={selectedEventId}
              isClosed={!!rows.find((r) => r.bulkEventId === selectedEventId)?.closedDate}
              trackingLink={selectedJob?.trackingLink ?? null}
              onDone={() => q.refetch()}
            />
          )}
          <div className="flex-1 min-h-0 overflow-auto flex flex-col">
            <div className="flex-shrink-0">
              <RvJobDetail
                bulkJobId={selectedJobId}
                initialJob={null}
                onPickSibling={() => { /* CS doesn't cross-navigate; ignore */ }}
              />
            </div>
            {/* Delivery-address map (legacy csView.html:120-122). Uses
                the public Google Maps embed URL - no API key needed for
                the basic q=<address>&output=embed variant. Only renders
                when we have both a job snapshot and a delivery address. */}
            {selectedJob?.toAddress && (
              <div className="flex-shrink-0 border-t border-border bg-surface-white p-2">
                <div className="text-xs text-text-muted mb-1">Delivery location</div>
                <iframe
                  title="Delivery location map"
                  data-testid="cs-delivery-map"
                  src={`https://maps.google.com/maps?q=${encodeURIComponent(
                    [selectedJob.toAddress, selectedJob.toSuburb].filter(Boolean).join(', '),
                  )}&output=embed`}
                  className="w-full h-64 border border-border rounded"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right-click context menu (legacy eventListMenu). Only exposes
          Close Event today; the legacy menu also had an editable-name
          form for the closer, which we surface via the modal below. */}
      <RowContextMenu
        clientX={ctx?.x ?? null}
        clientY={ctx?.y ?? null}
        title={ctx ? `Event #${ctx.event.bulkEventId}` : undefined}
        items={ctx ? closeMenuItems(ctx.event, (ev) => setCloseTarget(ev)) : []}
        onClose={() => setCtx(null)}
      />

      {closeTarget && (
        <CloseEventModal
          event={closeTarget}
          defaultName={user.fullName ?? user.email ?? 'operator'}
          onClose={() => setCloseTarget(null)}
          onClosed={() => { setCloseTarget(null); q.refetch(); }}
        />
      )}

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

// Build the right-click menu items for one event row. Extracted so tests
// can seed a menu without staging a full render cycle.
function closeMenuItems(event: EventRow, openCloseModal: (e: EventRow) => void): ContextMenuItem[] {
  const alreadyClosed = event.closedDate != null;
  return [
    {
      label: alreadyClosed ? 'Event already closed' : 'Close Event',
      onClick: () => { if (!alreadyClosed) openCloseModal(event); },
      disabled: alreadyClosed,
    },
  ];
}

// Close-event confirmation modal. Legacy csControl `gather.form` opened
// a single editable "Edit your name" input then fired uCSData.closeEvent
// with the typed value; mirror that with an editable closer name that
// defaults to the operator's fullName so a one-click close still works.
function CloseEventModal({
  event, defaultName, onClose, onClosed,
}: {
  event: EventRow;
  defaultName: string;
  onClose: () => void;
  onClosed: () => void;
}) {
  const toast = useToast();
  const [closerName, setCloserName] = useState(defaultName);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!closerName.trim()) return;
    setSubmitting(true);
    try {
      await routeViewerService.closeEvent(event.bulkEventId, closerName.trim());
      toast.show('Event closed', 'success');
      onClosed();
    } catch (e) {
      toast.show(`Close failed: ${(e as Error).message}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Close Event"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" size="sm" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={submitting || !closerName.trim()}>
            {submitting ? 'Closing...' : 'Close'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-text-muted">Event ID</span>
          <input
            type="text"
            readOnly
            value={event.bulkEventId}
            className="border border-border rounded px-2 py-1 bg-slate-50 font-mono text-text-primary"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-text-muted">Closer name</span>
          <input
            type="text"
            value={closerName}
            onChange={(e) => setCloserName(e.target.value)}
            disabled={submitting}
            aria-label="Closer name"
            className="border border-border rounded px-2 py-1 bg-surface-white text-text-primary"
          />
        </label>
      </div>
    </Modal>
  );
}

// Close + threaded-reply strip. Sits above the RvJobDetail so
// operators complete their workflow (add a follow-up note, close
// the ticket) without leaving the CS grid. Uses the user's own
// display name for the audit trail.
function EventActions({ eventId, isClosed, trackingLink, onDone }: {
  eventId: number;
  isClosed: boolean;
  /** Track-It URL for the selected event's job (legacy csView.html
   *  line 110 "Track it" button). Null when no link on file - button
   *  is hidden in that case. */
  trackingLink: string | null;
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
      {trackingLink && (
        <button
          type="button"
          aria-label="Track it"
          title="Open the courier tracking page for this job"
          onClick={() => window.open(trackingLink, '_blank')}
          className="inline-flex items-center gap-1 border border-border rounded px-2 py-1 text-[11px] text-text-secondary hover:text-brand-cyan hover:border-brand-cyan/60 focus:outline-none focus:ring-1 focus:ring-brand-cyan"
        >
          {/* Globe icon (legacy fa-globe). Inline SVG so we don't pull
              in an icon-pack dependency for this one glyph. */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="2" y1="12" x2="22" y2="12"></line>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
          </svg>
          Track it
        </button>
      )}
      {error && <span className="text-[10px] text-error">{error}</span>}
    </div>
  );
}
