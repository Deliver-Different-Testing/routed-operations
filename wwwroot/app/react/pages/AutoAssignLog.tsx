import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { Button } from '../components/common/Button';
import { Panel } from '../components/common/Panel';
import {
  autoAssignLogService,
  type AutoAssignLogEntry,
  type AutoAssignLogPage,
  type AutoAssignLogQuery,
  type UnresolvedBookingEntry,
  type UnresolvedBookingPage,
  type UnresolvedBookingQuery,
} from '../services/autoAssignLogService';

/**
 * Diagnostic page over the resolver output. Two tabs:
 *
 *   - Auto-Assign Log       -- append-only feed of every resolver run
 *                              (dbo.RouteAutoAssignLog). Answers "why did
 *                              this booking get this route?".
 *   - Unresolved Recurring  -- current-state list of recurring booking
 *     Bookings                templates on routed speeds that still have
 *                              RouteId = NULL. Answers "which recurring
 *                              bookings will land on the dispatch board
 *                              unassigned when they materialise?".
 *                              Steve spec 2026-08-03 §827 diagnostic #1.
 *
 * The audit log covers "resolver ran, here's what happened"; the
 * unresolved tab covers "resolver never ran on this booking" (pre-
 * 2026-06-12 templates that predate the create-time resolver).
 */
export default function AutoAssignLog() {
  const [tab, setTab] = useState<'log' | 'unresolved'>('log');

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-4 px-3 py-1.5 bg-surface-white border-b border-border text-xs">
        <h1 className="text-base font-semibold text-text-primary">Route Auto-Assign Diagnostics</h1>
        <TabButton active={tab === 'log'} onClick={() => setTab('log')}>
          Auto-Assign Log
        </TabButton>
        <TabButton active={tab === 'unresolved'} onClick={() => setTab('unresolved')}>
          Unresolved Recurring Bookings
        </TabButton>
      </div>

      <div className="flex-1 min-h-0">
        {tab === 'log' ? <AutoAssignLogTab /> : <UnresolvedRecurringBookingsTab />}
      </div>
    </div>
  );
}

function TabButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'px-2 py-1 rounded text-xs font-medium transition-colors ' +
        (active
          ? 'bg-brand-cyan/20 text-brand-dark'
          : 'text-text-muted hover:bg-surface-cream hover:text-text-primary')
      }
    >
      {children}
    </button>
  );
}

// ==========================================================================
// Tab 1: append-only audit feed over dbo.RouteAutoAssignLog. This is the
// original page contents, unchanged in behaviour; only the outer container
// changed to give up the top-level header slot to the tab bar.
// ==========================================================================
function AutoAssignLogTab() {
  const toast = useToast();

  const [outcome, setOutcome] = useState<string>('');
  const [side, setSide] = useState<string>('');
  const [range, setRange] = useState<'1h' | '24h' | '7d' | 'all'>('24h');
  const [routeIdText, setRouteIdText] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);

  const [data, setData] = useState<AutoAssignLogPage | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const query = useMemo<AutoAssignLogQuery>(() => {
    const now = Date.now();
    let fromUtc: string | undefined;
    if (range === '1h') fromUtc = new Date(now - 60 * 60 * 1000).toISOString();
    else if (range === '24h') fromUtc = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    else if (range === '7d') fromUtc = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    if (range === 'all') fromUtc = new Date('2000-01-01T00:00:00Z').toISOString();

    const routeId = routeIdText.trim() ? Number(routeIdText.trim()) : undefined;
    return {
      outcome: outcome || undefined,
      side: side || undefined,
      fromUtc,
      routeId: Number.isFinite(routeId) ? routeId : undefined,
      page,
      pageSize,
    };
  }, [outcome, side, range, routeIdText, page, pageSize]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await autoAssignLogService.getLog(query);
      setData(res.response);
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const applyFilters = () => {
    setPage(1);
    void load();
  };

  const exportCsv = () => {
    if (!data || data.entries.length === 0) return;
    const header = [
      'LogId', 'CreatedAtUtc', 'Side', 'JobId', 'JobBookingId', 'SpeedId',
      'PickupZip', 'PickupAtUtc', 'BookingKind', 'ResolvedRouteId',
      'ResolvedRouteName', 'ResolvedCourier', 'ResolvedAgent', 'ResolvedNpAgent',
      'Outcome', 'TriggerSource', 'PriorRouteId',
    ];
    const cell = (v: unknown) => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = data.entries.map((e) => [
      e.logId, e.createdAtUtc, e.side, e.jobId, e.jobBookingId, e.speedId,
      e.pickupZip, e.pickupAtUtc, e.bookingKindName, e.resolvedRouteId,
      e.resolvedRouteName, e.resolvedCourierName, e.resolvedAgentName,
      e.resolvedNpAgentName, e.outcome, e.triggerSource, e.priorRouteId,
    ].map(cell).join(','));
    const blob = new Blob([[header.join(','), ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `auto-assign-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / (data.pageSize || 50))) : 1;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-white border-b border-border text-xs">
        <span className="text-text-muted">
          {data ? `${data.total.toLocaleString()} entr${data.total === 1 ? 'y' : 'ies'} match` : 'loading…'}
        </span>
        <div className="flex-1" />
        <Button variant="neutral" size="sm" onClick={exportCsv}
          disabled={!data || data.entries.length === 0}>
          Copy filtered as CSV
        </Button>
        <Button variant="neutral" size="sm" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>

      <div className="flex-1 flex flex-col min-h-0 p-3 gap-3">
        <div className="shrink-0">
        <Panel title="Filters">
          <div className="flex flex-wrap items-end gap-3 text-xs p-3">
            <label className="flex-1 min-w-[12rem]">
              <span className="block text-text-secondary mb-1">Outcome</span>
              <select value={outcome} onChange={(e) => setOutcome(e.target.value)}
                className={INPUT_CLASS}>
                <option value="">All outcomes</option>
                <option value="AssignedToRoute">Assigned</option>
                <option value="AssignedToRouteViaCustomPolygon">Assigned via custom polygon</option>
                <option value="NoMatch">No match</option>
                <option value="NoWindowMatch">No window match</option>
                <option value="Ambiguous">Ambiguous</option>
              </select>
            </label>
            <label className="flex-1 min-w-[8rem]">
              <span className="block text-text-secondary mb-1">Side</span>
              <select value={side} onChange={(e) => setSide(e.target.value)} className={INPUT_CLASS}>
                <option value="">Both</option>
                <option value="Pickup">Pickup</option>
                <option value="Delivery">Delivery</option>
              </select>
            </label>
            <label className="flex-1 min-w-[10rem]">
              <span className="block text-text-secondary mb-1">Time range</span>
              <select value={range} onChange={(e) => setRange(e.target.value as typeof range)}
                className={INPUT_CLASS}>
                <option value="1h">Last 1 hour</option>
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
                <option value="all">All history</option>
              </select>
            </label>
            <label className="flex-1 min-w-[8rem]">
              <span className="block text-text-secondary mb-1">Route id</span>
              <input type="text" value={routeIdText} onChange={(e) => setRouteIdText(e.target.value)}
                className={INPUT_CLASS} placeholder="e.g. 1" />
            </label>
            <Button variant="secondary" onClick={applyFilters}>Apply</Button>
          </div>
        </Panel>
        </div>

        <div className="flex-1 min-h-0">
        <Panel title="Entries">
          <div className="overflow-x-auto p-3">
            <table className="w-full text-xs">
              <thead className="bg-surface-cream sticky top-0">
                <tr className="text-left text-text-muted">
                  <th className="px-2 py-1 w-40">Time (UTC)</th>
                  <th className="px-2 py-1 w-16">Side</th>
                  <th className="px-2 py-1 w-20">Zip</th>
                  <th className="px-2 py-1 w-44">Outcome</th>
                  <th className="px-2 py-1">Resolved Route</th>
                  <th className="px-2 py-1">Resolved Target</th>
                  <th className="px-2 py-1 w-20">Job Id</th>
                  <th className="px-2 py-1 w-32">Trigger</th>
                </tr>
              </thead>
              <tbody>
                {data?.entries.map((e) => (
                  <TableRow key={e.logId} entry={e}
                    expanded={expandedId === e.logId}
                    onToggle={() => setExpandedId((prev) => prev === e.logId ? null : e.logId)} />
                ))}
                {data && data.entries.length === 0 && (
                  <tr><td colSpan={8} className="px-2 py-6 text-center text-text-muted italic">
                    {loading ? 'Loading…' : 'No entries match the filters.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          {data && data.total > pageSize && (
            <div className="flex items-center gap-2 mt-3 text-xs text-text-muted px-3 pb-3">
              <span>Page {data.page} of {totalPages}</span>
              <div className="flex-1" />
              <Button variant="neutral" size="sm" onClick={() => { setPage(1); void load(); }} disabled={data.page === 1}>First</Button>
              <Button variant="neutral" size="sm" onClick={() => { setPage(data.page - 1); void load(); }} disabled={data.page === 1}>Prev</Button>
              <Button variant="neutral" size="sm" onClick={() => { setPage(data.page + 1); void load(); }} disabled={data.page >= totalPages}>Next</Button>
              <Button variant="neutral" size="sm" onClick={() => { setPage(totalPages); void load(); }} disabled={data.page >= totalPages}>Last</Button>
              <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); void load(); }}
                className={INPUT_CLASS + ' w-24'}>
                <option value="25">25 / page</option>
                <option value="50">50 / page</option>
                <option value="100">100 / page</option>
                <option value="200">200 / page</option>
              </select>
            </div>
          )}
        </Panel>
        </div>
      </div>
    </div>
  );
}

// ==========================================================================
// Tab 2: point-in-time list of recurring booking templates that don't have
// a RouteId. These are templates the create-time resolver never ran on
// (pre-2026-06-12 vintage or non-routed speeds that were later flipped to
// routed). Not driven off RouteAutoAssignLog since RAAL is only written
// when the resolver actually runs.
// ==========================================================================
function UnresolvedRecurringBookingsTab() {
  const toast = useToast();

  const [clientIdText, setClientIdText] = useState<string>('');
  const [scheduleIdText, setScheduleIdText] = useState<string>('');
  const [speedIdText, setSpeedIdText] = useState<string>('');
  const [missingCoordsOnly, setMissingCoordsOnly] = useState<boolean>(false);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);

  const [data, setData] = useState<UnresolvedBookingPage | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const query = useMemo<UnresolvedBookingQuery>(() => {
    const num = (s: string) => {
      const n = Number(s.trim());
      return Number.isFinite(n) && s.trim() !== '' ? n : undefined;
    };
    return {
      clientId: num(clientIdText),
      scheduleId: num(scheduleIdText),
      speedId: num(speedIdText),
      missingPickupCoords: missingCoordsOnly ? true : undefined,
      page,
      pageSize,
    };
  }, [clientIdText, scheduleIdText, speedIdText, missingCoordsOnly, page, pageSize]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await autoAssignLogService.getUnresolvedRecurringBookings(query);
      setData(res.response);
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const applyFilters = () => {
    setPage(1);
    void load();
  };

  const exportCsv = () => {
    if (!data || data.entries.length === 0) return;
    const header = [
      'UcbkId', 'JobNumber', 'ClientId', 'ClientName', 'SpeedId', 'SpeedName',
      'ScheduleId', 'ScheduleName', 'PickupZip', 'DeliveryZip',
      'MissingPickupCoords', 'MissingDeliveryCoords', 'NextDue', 'CreatedTime',
    ];
    const cell = (v: unknown) => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = data.entries.map((e) => [
      e.ucbkId, e.ucbkJobNumber, e.ucbkClientId, e.clientName, e.ucbkSpeed, e.speedName,
      e.scheduleId, e.scheduleName, e.pickupZip, e.deliveryZip,
      e.missingPickupCoords, e.missingDeliveryCoords, e.ucbkNextDue, e.createdTime,
    ].map(cell).join(','));
    const blob = new Blob([[header.join(','), ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `unresolved-recurring-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / (data.pageSize || 50))) : 1;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-white border-b border-border text-xs">
        <span className="text-text-muted">
          {data
            ? `${data.total.toLocaleString()} unresolved recurring booking${data.total === 1 ? '' : 's'}`
            : 'loading…'}
        </span>
        <div className="flex-1" />
        <Button variant="neutral" size="sm" onClick={exportCsv}
          disabled={!data || data.entries.length === 0}>
          Copy filtered as CSV
        </Button>
        <Button variant="neutral" size="sm" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>

      <div className="flex-1 flex flex-col min-h-0 p-3 gap-3">
        <div className="shrink-0">
        <Panel title="Filters">
          <div className="flex flex-wrap items-end gap-3 text-xs p-3">
            <label className="flex-1 min-w-[8rem]">
              <span className="block text-text-secondary mb-1">Client id</span>
              <input type="text" value={clientIdText} onChange={(e) => setClientIdText(e.target.value)}
                className={INPUT_CLASS} placeholder="e.g. 123" />
            </label>
            <label className="flex-1 min-w-[8rem]">
              <span className="block text-text-secondary mb-1">Schedule id</span>
              <input type="text" value={scheduleIdText} onChange={(e) => setScheduleIdText(e.target.value)}
                className={INPUT_CLASS} placeholder="e.g. 42" />
            </label>
            <label className="flex-1 min-w-[8rem]">
              <span className="block text-text-secondary mb-1">Speed id</span>
              <input type="text" value={speedIdText} onChange={(e) => setSpeedIdText(e.target.value)}
                className={INPUT_CLASS} placeholder="e.g. 128" />
            </label>
            <label className="flex items-center gap-2 mb-1">
              <input type="checkbox" checked={missingCoordsOnly}
                onChange={(e) => setMissingCoordsOnly(e.target.checked)} />
              <span className="text-text-secondary">Missing pickup coords only</span>
            </label>
            <Button variant="secondary" onClick={applyFilters}>Apply</Button>
          </div>
        </Panel>
        </div>

        <div className="flex-1 min-h-0">
        <Panel title="Bookings">
          <div className="overflow-x-auto p-3">
            <table className="w-full text-xs">
              <thead className="bg-surface-cream sticky top-0">
                <tr className="text-left text-text-muted">
                  <th className="px-2 py-1 w-20">Booking Id</th>
                  <th className="px-2 py-1 w-28">Job Number</th>
                  <th className="px-2 py-1">Client</th>
                  <th className="px-2 py-1">Speed</th>
                  <th className="px-2 py-1">Schedule</th>
                  <th className="px-2 py-1 w-20">Pickup Zip</th>
                  <th className="px-2 py-1 w-20">Delivery Zip</th>
                  <th className="px-2 py-1 w-32">Coords</th>
                  <th className="px-2 py-1 w-32">Next Due</th>
                  <th className="px-2 py-1 w-32">Created</th>
                </tr>
              </thead>
              <tbody>
                {data?.entries.map((e) => (
                  <UnresolvedRow key={e.ucbkId} entry={e} />
                ))}
                {data && data.entries.length === 0 && (
                  <tr><td colSpan={10} className="px-2 py-6 text-center text-text-muted italic">
                    {loading ? 'Loading…' : 'No unresolved recurring bookings match the filters.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          {data && data.total > pageSize && (
            <div className="flex items-center gap-2 mt-3 text-xs text-text-muted px-3 pb-3">
              <span>Page {data.page} of {totalPages}</span>
              <div className="flex-1" />
              <Button variant="neutral" size="sm" onClick={() => { setPage(1); void load(); }} disabled={data.page === 1}>First</Button>
              <Button variant="neutral" size="sm" onClick={() => { setPage(data.page - 1); void load(); }} disabled={data.page === 1}>Prev</Button>
              <Button variant="neutral" size="sm" onClick={() => { setPage(data.page + 1); void load(); }} disabled={data.page >= totalPages}>Next</Button>
              <Button variant="neutral" size="sm" onClick={() => { setPage(totalPages); void load(); }} disabled={data.page >= totalPages}>Last</Button>
              <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); void load(); }}
                className={INPUT_CLASS + ' w-24'}>
                <option value="25">25 / page</option>
                <option value="50">50 / page</option>
                <option value="100">100 / page</option>
                <option value="200">200 / page</option>
              </select>
            </div>
          )}
        </Panel>
        </div>
      </div>
    </div>
  );
}

function UnresolvedRow({ entry: e }: { entry: UnresolvedBookingEntry }) {
  const coordsBadge = e.missingPickupCoords || e.missingDeliveryCoords
    ? <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-warning/20 text-brand-dark"
        title={[e.missingPickupCoords ? 'Pickup coords missing' : null,
                e.missingDeliveryCoords ? 'Delivery coords missing' : null]
          .filter(Boolean).join(' + ')}>
        {e.missingPickupCoords && e.missingDeliveryCoords ? 'both missing'
          : e.missingPickupCoords ? 'pickup missing'
          : 'delivery missing'}
      </span>
    : <span className="text-text-muted">ok</span>;

  return (
    <tr className="border-t border-border-light hover:bg-surface-cream">
      <td className="px-2 py-1 text-text-muted">#{e.ucbkId}</td>
      <td className="px-2 py-1">{e.ucbkJobNumber ?? '-'}</td>
      <td className="px-2 py-1">
        {e.clientName
          ? <><span className="font-medium">{e.clientName}</span>
              {e.ucbkClientId != null && <span className="text-text-muted ml-1">#{e.ucbkClientId}</span>}</>
          : e.ucbkClientId != null ? <span className="text-text-muted">#{e.ucbkClientId}</span>
          : <span className="text-text-muted">-</span>}
      </td>
      <td className="px-2 py-1">
        {e.speedName ?? (e.ucbkSpeed != null ? `#${e.ucbkSpeed}` : '-')}
      </td>
      <td className="px-2 py-1 text-text-secondary truncate max-w-[16rem]" title={e.scheduleName ?? ''}>
        {e.scheduleName ?? (e.scheduleId != null ? `#${e.scheduleId}` : <span className="text-text-muted">none</span>)}
      </td>
      <td className="px-2 py-1">{e.pickupZip ?? '-'}</td>
      <td className="px-2 py-1">{e.deliveryZip ?? '-'}</td>
      <td className="px-2 py-1">{coordsBadge}</td>
      <td className="px-2 py-1 text-text-muted">{formatDateShort(e.ucbkNextDue)}</td>
      <td className="px-2 py-1 text-text-muted">{formatDateShort(e.createdTime)}</td>
    </tr>
  );
}

function formatDateShort(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch { return iso; }
}

const OUTCOME_COLOURS: Record<string, string> = {
  AssignedToRoute: 'bg-success-bg text-success',
  AssignedToRouteViaCustomPolygon: 'bg-brand-cyan/20 text-brand-dark',
  NoMatch: 'bg-error/15 text-error',
  NoWindowMatch: 'bg-warning/20 text-brand-dark',
  Ambiguous: 'bg-warning/40 text-brand-dark',
};

function TableRow({ entry: e, expanded, onToggle }: {
  entry: AutoAssignLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const target = e.resolvedCourierName
    ? `Courier: ${e.resolvedCourierName}`
    : e.resolvedAgentName
    ? `Agent: ${e.resolvedAgentName}`
    : e.resolvedNpAgentName
    ? `NP: ${e.resolvedNpAgentName}`
    : '-';
  const outcomeColour = OUTCOME_COLOURS[e.outcome] ?? 'bg-surface-light text-text-muted';
  return (
    <>
      <tr className="border-t border-border-light hover:bg-surface-cream cursor-pointer"
        onClick={onToggle}>
        <td className="px-2 py-1 text-text-muted whitespace-nowrap">
          {formatDate(e.createdAtUtc)}
        </td>
        <td className="px-2 py-1">{e.side}</td>
        <td className="px-2 py-1">{e.pickupZip ?? '-'}</td>
        <td className="px-2 py-1">
          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${outcomeColour}`}>
            {e.outcome}
          </span>
        </td>
        <td className="px-2 py-1">
          {e.resolvedRouteId != null
            ? <><span className="font-medium">{e.resolvedRouteName ?? '(unnamed)'}</span>
                <span className="text-text-muted ml-1">#{e.resolvedRouteId}</span></>
            : <span className="text-text-muted">-</span>}
        </td>
        <td className="px-2 py-1 text-text-secondary">{target}</td>
        <td className="px-2 py-1 text-text-muted">
          {e.jobId ?? e.jobBookingId ?? '-'}
        </td>
        <td className="px-2 py-1 text-text-muted truncate max-w-[8rem]" title={e.triggerSource}>
          {e.triggerSource}
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-border-light bg-surface-cream">
          <td colSpan={8} className="px-4 py-2">
            <pre className="text-[10px] bg-surface-white p-2 rounded border border-border-light overflow-x-auto">
              {JSON.stringify(e, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toISOString().replace('T', ' ').slice(0, 19);
  } catch { return iso; }
}

const INPUT_CLASS = 'w-full border border-border rounded-lg px-3 py-1.5 text-sm bg-surface-white text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-cyan/30 focus:border-brand-cyan';
