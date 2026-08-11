import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { useAutoPoll } from '../../hooks/useAutoPoll';
import { routeViewerService } from '../../services/routeViewerService';
import { tenantDateFromSpString, tenantTimeFromSpString, tenantTodayYmd } from '../../lib/tenantDate';
import { Button } from '../../components/common/Button';
import { RvBox } from '../../components/route-viewer/RvBox';
import { RvOverviewBox } from '../../components/route-viewer/RvOverviewBox';

// Route Viewer Scan Manager page (master Section 10). Two swappable
// modes: Bulk (parent-child-item tree with tri-state Sort/Run icons
// + binary Pick/InvalidPick/Transfer/Transit) and Routed (shipment
// rows with X-of-Y reconciliation + leg progress + exception badges).
//
// Features:
//   - Filter bar (date + client-internal toggle + Remove Missing Boxes
//     admin bulk action)
//   - Bulk/Routed mode toggle; US defaults to Routed per master spec
//   - Sortable primary table with tri-state icon cells + binary dots
//   - Routed mode: expandable rows via FragmentRow with parsed Legs
//     chip strip + lazy item-progress panel grouped by item barcode
//   - Scan-detail side panel loads on row click; 25s auto-poll

type Mode = 'Bulk' | 'Routed';

// Expandable routed-shipment row + lazy item-progress panel. Extracted
// to its own component so the useQuery hook count stays stable across
// row list mutations. Loads /api/runviewer/scans/item-progress only
// when the row is expanded (matches legacy lazy-load pattern).
function FragmentRow({
  row, legs, active, expanded, onSelect, onToggle,
}: {
  row: any;
  legs: any[];
  active: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const itemsQ = useQuery({
    queryKey: ['sm-item-progress', row.jobId],
    queryFn: () => routeViewerService.getItemProgress(row.jobId),
    enabled: expanded,
    staleTime: 15_000,
  });
  const items = itemsQ.data ?? [];
  // Group per-item barcode so the leg-track mini display shows one
  // row per package with a state chip per leg.
  const grouped = new Map<string, typeof items>();
  for (const it of items) {
    const k = it.itemBarcode ?? 'unknown';
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(it);
  }

  return (
    <>
      <tr
        onClick={onSelect}
        className={`cursor-pointer border-b border-border/50 ${
          active ? 'bg-brand-cyan/20' : 'hover:bg-surface-cream/60'
        }`}
      >
        <td className="px-2 py-1 text-center">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="w-4 h-4 flex items-center justify-center text-text-muted hover:text-text-primary"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
                 className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}>
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </button>
        </td>
        <td className="px-2 py-1">{row.clientCode ?? '-'}</td>
        <td className="px-2 py-1 font-mono">{row.jobNumber ?? '-'}</td>
        <td className="px-2 py-1 truncate max-w-[14rem]" title={row.toAddress ?? undefined}>{row.toAddress ?? '-'}</td>
        <td className="px-2 py-1">{row.suburb ?? '-'}</td>
        <td className="px-2 py-1 text-text-muted">{row.stage ?? '-'}</td>
        <td className="px-2 py-1">
          <div className="flex flex-wrap gap-0.5">
            {legs.map((l: any, i: number) => (
              <span
                key={i}
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${legTint(l.State)}`}
                title={l.LinehaulRunName ? `${l.Leg}: ${l.LinehaulRunName} (${l.State ?? '?'})` : `${l.Leg}: ${l.State ?? '?'}`}
              >
                {l.Leg}
              </span>
            ))}
            {legs.length === 0 && <span className="text-text-muted">-</span>}
          </div>
        </td>
        <td className="px-2 py-1 text-center">
          {row.scannedItems}/{row.expectedItems}
        </td>
        <td className="px-2 py-1 text-center">
          {row.hasShort && <span className="inline-block px-1 rounded bg-red-100 text-red-800 mr-1">SHORT</span>}
          {row.isDivergent && <span className="inline-block px-1 rounded bg-amber-100 text-amber-800">DIV</span>}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={9} className="px-3 py-2 bg-slate-50/60 border-b border-border">
            {itemsQ.isLoading && <div className="text-text-muted text-[11px]">Loading item progress...</div>}
            {!itemsQ.isLoading && grouped.size === 0 && (
              <div className="text-text-muted text-[11px]">No item-progress rows yet.</div>
            )}
            {grouped.size > 0 && (
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-text-muted">
                    <th className="px-1 py-0.5">Item</th>
                    <th className="px-1 py-0.5">Legs</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(grouped.entries()).map(([barcode, its]) => (
                    <tr key={barcode}>
                      <td className="px-1 py-0.5 font-mono">{barcode}</td>
                      <td className="px-1 py-0.5">
                        <div className="flex flex-wrap gap-0.5">
                          {its.map((it, i) => (
                            <span
                              key={i}
                              className={`inline-flex items-center px-1 py-0.5 rounded text-[9px] font-medium ${legTint(it.state)} ${
                                it.isCurrent ? 'ring-1 ring-brand-cyan' : ''
                              }`}
                              title={it.tote ? `${it.leg}: ${it.state ?? '?'} (${it.tote})` : `${it.leg}: ${it.state ?? '?'}`}
                            >
                              {it.leg}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// Legs JSON payload shape (per DTO note: SP emits Legs as a JSON string
// that clients must parse per-row).
interface LegChip {
  Leg: string;
  LinehaulRunId?: number | null;
  LinehaulRunName?: string | null;
  ToDepot?: string | null;
  State?: string | null;
  PackedRole?: string | null;
}

// State -> Tailwind background. Palette mirrors legacy .leg-state.<code>.
function legTint(state: string | null | undefined): string {
  const s = (state ?? '').toUpperCase();
  if (s === 'DONE' || s === 'COMPLETE') return 'bg-emerald-100 text-emerald-800';
  if (s === 'PARTIAL' || s === 'IN_TRANSIT' || s === 'INTRANSIT') return 'bg-amber-100 text-amber-800';
  if (s === 'SHORT' || s === 'FAIL' || s === 'FAILED') return 'bg-red-100 text-red-800';
  if (s === 'PENDING' || s === 'WAITING') return 'bg-slate-100 text-slate-700';
  return 'bg-slate-100 text-slate-700';
}

function parseLegs(json: string | null): LegChip[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

// Tri-state cell: 0 = pending (empty), 1 = complete (green tick),
// 2 = exception (red x). Sort + Run only per T.4 correction.
function TriStateCell({ v }: { v: number }) {
  if (v === 1) {
    return (
      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 text-white text-[10px]">
        ✓
      </span>
    );
  }
  if (v === 2) {
    return (
      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[10px]">
        ✗
      </span>
    );
  }
  return <span className="inline-block w-4 h-4 rounded-full border border-slate-300" />;
}

// Binary cell: 0 = pending, 1 = complete. Pick / InvalidPick /
// Transfer / Transit only per T.4.
function BinaryCell({ v, tone = 'ok' }: { v: number; tone?: 'ok' | 'warn' }) {
  if (v === 1) {
    return (
      <span
        className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[10px] ${
          tone === 'warn' ? 'bg-amber-500' : 'bg-emerald-500'
        }`}
      >
        ✓
      </span>
    );
  }
  return <span className="inline-block w-4 h-4 rounded-full border border-slate-300" />;
}

export default function ScanManager() {
  const user = useAuth();
  const initialDate = tenantTodayYmd({ isUsTenant: user.isUsTenant, timeZone: user.timeZone });
  const [runDate, setRunDate] = useState(initialDate);
  // Default to Bulk in NZ and Routed in US per master spec preferences;
  // operator can toggle. Not persisted since Scan Manager is a
  // read-mostly surface (persistence adds noise here).
  const [mode, setMode] = useState<Mode>(user.isUsTenant ? 'Routed' : 'Bulk');
  const [clientInternal, setClientInternal] = useState(false);
  const [selectedRootJobId, setSelectedRootJobId] = useState<number | null>(null);
  // Track which routed rows are expanded so we can lazy-load item-
  // progress + render the per-item leg-track mini display beneath
  // the row (v2 polish).
  const [expandedIds, setExpandedIds] = useState<number[]>([]);
  const toggleExpanded = (id: number) => setExpandedIds((prev) =>
    prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
  );

  const bulkQ = useQuery({
    queryKey: ['sm-bulk', runDate, clientInternal],
    queryFn: () => routeViewerService.getBulkScanJobs(runDate, clientInternal),
    enabled: mode === 'Bulk' && !!runDate,
    staleTime: 5_000,
  });

  const routedQ = useQuery({
    queryKey: ['sm-routed', runDate],
    queryFn: () => routeViewerService.getRoutedScanJobs(runDate),
    enabled: mode === 'Routed' && !!runDate,
    staleTime: 5_000,
  });

  const detailQ = useQuery({
    queryKey: ['sm-detail', runDate, selectedRootJobId],
    queryFn: () => routeViewerService.getScanDetailRows(runDate, undefined, selectedRootJobId ?? undefined),
    enabled: selectedRootJobId != null && !!runDate,
    staleTime: 5_000,
  });

  useAutoPoll(() => {
    if (mode === 'Bulk') bulkQ.refetch(); else routedQ.refetch();
    if (selectedRootJobId != null) detailQ.refetch();
  }, 25, true);

  const bulkRows = bulkQ.data ?? [];
  const routedRows = routedQ.data ?? [];
  const detailRows = detailQ.data ?? [];

  const totals = useMemo(() => {
    if (mode === 'Bulk') {
      const total = bulkRows.length;
      const sortDone = bulkRows.filter((r) => r.sortScanned === 1).length;
      const runDone = bulkRows.filter((r) => r.runScanned === 1).length;
      return { total, sortDone, runDone };
    }
    return { total: routedRows.length, sortDone: 0, runDone: 0 };
  }, [mode, bulkRows, routedRows]);

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
        <div className="flex items-center gap-1">
          <span className="text-xs text-text-muted mr-1">Mode:</span>
          {(['Bulk', 'Routed'] as Mode[]).map((m) => (
            <Button
              key={m}
              variant="neutral"
              size="sm"
              active={mode === m}
              onClick={() => setMode(m)}
            >
              {m}
            </Button>
          ))}
        </div>
        {mode === 'Bulk' && !user.isNetworkPartner && (
          <label className="flex items-center gap-1 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={clientInternal}
              onChange={(e) => setClientInternal(e.target.checked)}
              className="accent-brand-cyan"
            />
            Client internal
          </label>
        )}
        {mode === 'Bulk' && !user.isNetworkPartner && (
          // Admin-only bulk purge of missing LHP/DEL scan children for
          // the current date + filter slice. Fires legacy
          // RVW_stpRemoveMissingScanJobs; confirm before firing since
          // it's not undoable.
          <Button
            variant="neutral"
            size="sm"
            onClick={async () => {
              const ok = window.confirm(
                `Remove all missing-scan boxes for ${runDate}? This clears LHP/DEL child rows and cannot be undone.`,
              );
              if (!ok) return;
              try {
                await routeViewerService.removeMissingScanJobs({
                  runDate,
                });
              } catch (e) { /* refetch will surface any residual */ }
              bulkQ.refetch();
            }}
          >
            Remove missing boxes
          </Button>
        )}
        <div className="ml-auto text-xs text-text-muted">
          {mode === 'Bulk'
            ? `${totals.total} jobs, ${totals.sortDone} sort scanned, ${totals.runDone} run scanned`
            : `${totals.total} shipments`}
        </div>
      </div>

      {/* Legacy `scans/tpls/overview.tpl` per-region roll-up. Fixed
          height so RvBox's `h-full` doesn't consume the viewport and
          push the primary table below the fold. */}
      <div className="h-40 flex-shrink-0 border-b border-border overflow-hidden">
        <RvOverviewBox runDate={runDate} />
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 overflow-auto">
          <RvBox title={mode === 'Bulk' ? 'Bulk Scans' : 'Routed Scans'}>
            {mode === 'Bulk' && (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface-white border-b border-border">
                  <tr className="text-left text-text-muted">
                    <th className="px-2 py-1">Client</th>
                    <th className="px-2 py-1">Job #</th>
                    <th className="px-2 py-1">D Date</th>
                    <th className="px-2 py-1">R Time</th>
                    <th className="px-2 py-1">Address</th>
                    <th className="px-2 py-1 text-center">Items</th>
                    <th className="px-2 py-1 text-center" title="Sort">S</th>
                    <th className="px-2 py-1 text-center" title="Run">R</th>
                    <th className="px-2 py-1 text-center" title="Pickup">P</th>
                    <th className="px-2 py-1 text-center" title="Invalid Pickup">iP</th>
                    <th className="px-2 py-1 text-center" title="Transfer">T</th>
                    <th className="px-2 py-1 text-center" title="In Transit">iT</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkRows.map((r) => {
                    const active = selectedRootJobId === r.bulkJobId;
                    return (
                      <tr
                        key={r.bulkJobId}
                        onClick={() => setSelectedRootJobId(r.bulkJobId)}
                        className={`cursor-pointer border-b border-border/50 ${
                          active ? 'bg-brand-cyan/20' : 'hover:bg-surface-cream/60'
                        }`}
                      >
                        <td className="px-2 py-1">{r.clientCode ?? '-'}</td>
                        <td className="px-2 py-1 font-mono">{r.jobNumber ?? '-'}</td>
                        <td className="px-2 py-1">{tenantDateFromSpString(r.deliveryDate, user.isUsTenant) || '-'}</td>
                        <td className="px-2 py-1">{tenantTimeFromSpString(r.readyTime, user.isUsTenant) || '-'}</td>
                        <td className="px-2 py-1 truncate max-w-[14rem]" title={r.toAddress ?? undefined}>{r.toAddress ?? '-'}</td>
                        <td className="px-2 py-1 text-center">{r.items}</td>
                        <td className="px-2 py-1 text-center"><TriStateCell v={r.sortScanned} /></td>
                        <td className="px-2 py-1 text-center"><TriStateCell v={r.runScanned} /></td>
                        <td className="px-2 py-1 text-center"><BinaryCell v={r.pickScanned} /></td>
                        <td className="px-2 py-1 text-center"><BinaryCell v={r.invalidPickScanned} tone="warn" /></td>
                        <td className="px-2 py-1 text-center"><BinaryCell v={r.transferScanned} /></td>
                        <td className="px-2 py-1 text-center"><BinaryCell v={r.transitScanned} /></td>
                      </tr>
                    );
                  })}
                  {bulkRows.length === 0 && !bulkQ.isLoading && (
                    <tr><td className="px-3 py-6 text-center text-text-muted" colSpan={12}>No scan rows for this date.</td></tr>
                  )}
                  {bulkQ.isLoading && (
                    <tr><td className="px-3 py-6 text-center text-text-muted" colSpan={12}>Loading...</td></tr>
                  )}
                </tbody>
              </table>
            )}
            {mode === 'Routed' && (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface-white border-b border-border">
                  <tr className="text-left text-text-muted">
                    <th className="px-2 py-1 w-6"></th>
                    <th className="px-2 py-1">Client</th>
                    <th className="px-2 py-1">Job #</th>
                    <th className="px-2 py-1">Address</th>
                    <th className="px-2 py-1">Suburb</th>
                    <th className="px-2 py-1">Stage</th>
                    <th className="px-2 py-1 text-center">Legs</th>
                    <th className="px-2 py-1 text-center">Items</th>
                    <th className="px-2 py-1 text-center">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {routedRows.map((r) => {
                    const active = selectedRootJobId === r.jobId;
                    const expanded = expandedIds.includes(r.jobId);
                    const legs = parseLegs(r.legs);
                    return (
                      <FragmentRow
                        key={r.jobId}
                        row={r}
                        legs={legs}
                        active={active}
                        expanded={expanded}
                        onSelect={() => setSelectedRootJobId(r.jobId)}
                        onToggle={() => toggleExpanded(r.jobId)}
                      />
                    );
                  })}
                  {routedRows.length === 0 && !routedQ.isLoading && (
                    <tr><td className="px-3 py-6 text-center text-text-muted" colSpan={9}>No routed shipments for this date.</td></tr>
                  )}
                  {routedQ.isLoading && (
                    <tr><td className="px-3 py-6 text-center text-text-muted" colSpan={9}>Loading...</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </RvBox>
        </div>

        <div className="w-96 border-l border-border overflow-auto">
          <RvBox title="Scan Detail">
            {selectedRootJobId == null && (
              <div className="p-3 text-xs text-text-muted">Pick a row to see its scan history.</div>
            )}
            {selectedRootJobId != null && (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface-white border-b border-border">
                  <tr className="text-left text-text-muted">
                    <th className="px-2 py-1">Time</th>
                    <th className="px-2 py-1">Scan</th>
                    <th className="px-2 py-1">By</th>
                  </tr>
                </thead>
                <tbody>
                  {detailRows.map((s) => (
                    <tr key={s.scanId} className="border-b border-border/50">
                      <td className="px-2 py-1 whitespace-nowrap font-mono text-[11px]">
                        {s.scanDateTime ? new Date(s.scanDateTime).toLocaleTimeString() : '-'}
                      </td>
                      <td className="px-2 py-1">{s.scanDetail ?? '-'}</td>
                      <td className="px-2 py-1">
                        {s.courier ?? '-'}
                        {s.isNpAgent && (
                          <span className="ml-1 inline-block bg-brand-orange text-white text-[10px] px-1 rounded">NP</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {detailRows.length === 0 && !detailQ.isLoading && (
                    <tr><td className="px-3 py-4 text-center text-text-muted" colSpan={3}>No scans on file.</td></tr>
                  )}
                  {detailQ.isLoading && (
                    <tr><td className="px-3 py-4 text-center text-text-muted" colSpan={3}>Loading...</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </RvBox>
        </div>
      </div>
    </div>
  );
}
