import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { useAutoPoll } from '../../hooks/useAutoPoll';
import { useRouteViewerLookups } from '../../hooks/queries/useRouteViewerLookups';
import { routeViewerService } from '../../services/routeViewerService';
import { tenantDateFromSpString, tenantTimeFromSpString, tenantTodayYmd } from '../../lib/tenantDate';
import { Button } from '../../components/common/Button';
import { MultiSelect } from '../../components/common/MultiSelect';
import { RvBox } from '../../components/route-viewer/RvBox';
import { RvOverviewBox } from '../../components/route-viewer/RvOverviewBox';
import { RowContextMenu } from '../../components/cockpit/RowContextMenu';

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
//   - Client / Region / Speed multi-select filters + 200ms-debounced
//     free-text search across the loaded rows (client-side)
//   - 100-per-page pager on Bulk mode (matches legacy pageSize=100 in
//     RunViewer/wwwroot/app/components/scans/tpls/jobList.tpl)

type Mode = 'Bulk' | 'Routed';

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

// Stage-swatch tone map (task #47.1). The Stage column now wraps its text
// in a small pill whose colour is derived from keywords in the server-side
// human-readable stage string (RVW_stpScanJobsRouted emits phrases like
// "Awaiting LHP pickup" / "LH1 - in transit" / "Item -3 short (LH1)" per
// ScanDto.cs). We match legacy scanControl.js SM_STAGE_COLOR intent:
// green = done, orange = in-flight, red = exception, grey = default.
function stageTint(stage: string | null | undefined): string {
  const s = (stage ?? '').toLowerCase();
  if (!s) return 'bg-slate-100 text-slate-700';
  if (s.includes('short') || s.includes('missing')) return 'bg-red-100 text-red-800';
  if (s.includes('complete') || s.includes('delivered')) return 'bg-emerald-100 text-emerald-800';
  if (s.includes('in transit') || s.includes('in-transit') || s.includes('pickup') || s.includes('awaiting')) {
    return 'bg-amber-100 text-amber-800';
  }
  return 'bg-slate-100 text-slate-700';
}

// Item-progress row shape used for the Tote-column derivation (task #47.2).
// Mirrors routeViewerService.getItemProgress return shape so the FragmentRow
// can compute a "current tote" summary without a service-type import.
type ItemProgressRow = {
  jobId: number;
  itemBarcode: string | null;
  leg: string | null;
  state: string | null;
  tote: string | null;
  isCurrent: boolean;
  scanTime: string | null;
};

// Derive the shipment's "current tote" display from loaded item-progress
// rows (legacy currentToteFor in scanControl.js reads job.totes which the
// RoutedScanJobDto does NOT surface, so we fall back to the per-item tote
// column exposed by RVW_stpScanManagerItemProgress). Single unique tote
// renders verbatim; multiple render as "N totes". Empty / unloaded -> "-".
function currentToteFor(rows: ItemProgressRow[]): string {
  if (!rows || rows.length === 0) return '-';
  const uniq = new Set<string>();
  for (const r of rows) {
    const t = (r.tote ?? '').trim();
    if (t) uniq.add(t);
  }
  if (uniq.size === 0) return '-';
  if (uniq.size === 1) return Array.from(uniq)[0];
  return `${uniq.size} totes`;
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

// Sortable header cell. Click toggles asc -> desc -> asc for the same
// column, or resets to asc when a different column is clicked. Matches
// the RvRunList sort-indicator style so the two grids feel identical.
function SortableTh({
  label, active, dir, onClick, align = 'left', title,
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
  align?: 'left' | 'center' | 'right';
  title?: string;
}) {
  const alignCls = align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left';
  return (
    <th
      className={`px-2 py-1 font-medium cursor-pointer select-none hover:text-text-primary ${alignCls}`}
      onClick={onClick}
      title={title}
    >
      {label}
      {active && <span className="ml-0.5 text-[10px]">{dir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );
}

// Expandable routed-shipment row + lazy item-progress panel. Extracted
// to its own component so the useQuery hook count stays stable across
// row list mutations. Loads /api/runviewer/scans/item-progress only
// when the row is expanded (matches legacy lazy-load pattern).
function FragmentRow({
  row, legs, active, expanded, onSelect, onToggle, onContextMenu,
}: {
  row: any;
  legs: any[];
  active: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onContextMenu: (e: React.MouseEvent, row: any) => void;
}) {
  const itemsQ = useQuery({
    queryKey: ['sm-item-progress', row.jobId],
    queryFn: () => routeViewerService.getItemProgress(row.jobId),
    enabled: expanded,
    staleTime: 15_000,
  });
  const items = itemsQ.data ?? [];
  const toteLabel = currentToteFor(items as ItemProgressRow[]);
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
        onContextMenu={(e) => onContextMenu(e, row)}
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
        {/* Stage swatch (task #47.1) - pill tinted by keyword parse of the
            server-side human-readable stage string. */}
        <td className="px-2 py-1">
          {row.stage
            ? (
              <span
                data-testid="sm-stage-swatch"
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${stageTint(row.stage)}`}
              >
                {row.stage}
              </span>
            )
            : <span className="text-text-muted">-</span>}
        </td>
        {/* Tote column (task #47.2) - derived from loaded item-progress
            (RoutedScanJobDto does not expose totes; we fall back to the
            per-item tote column). Renders "-" until the row is expanded
            and the item-progress fetch has resolved. */}
        <td className="px-2 py-1 text-center text-text-muted" data-testid="sm-tote-cell">
          {toteLabel}
        </td>
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
        {/* Item badge (task #47.3) - count pill with a warning triangle
            appended when the shipment has any short items. Mirrors legacy
            sm-itembadge / sm-alert styling from jobList.tpl:238-244. */}
        <td className="px-2 py-1 text-center">
          <span
            data-testid="sm-item-badge"
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
              row.hasShort ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700'
            }`}
            title={`${row.scannedItems ?? 0}/${row.expectedItems ?? 0} scanned`}
          >
            <span>{row.scannedItems}/{row.expectedItems}</span>
            {row.hasShort && (
              <span aria-label="Short items warning" title="Short items" data-testid="sm-item-badge-warn">
                &#9888;
              </span>
            )}
          </span>
        </td>
        <td className="px-2 py-1 text-center">
          {row.hasShort && <span className="inline-block px-1 rounded bg-red-100 text-red-800 mr-1">SHORT</span>}
          {row.isDivergent && <span className="inline-block px-1 rounded bg-amber-100 text-amber-800">DIV</span>}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={10} className="px-3 py-2 bg-slate-50/60 border-b border-border">
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

// Per-item barcode row shape returned by getBulkJobItems (mirrors
// JobItemDto exactly). Local alias so the tree component doesn't have
// to import the service type just to spell out the shape.
type BulkItemRow = {
  bulkJobItemId: number;
  bulkJobId: number;
  barcode: string | null;
  itemName: string | null;
  weight: number | null;
  length: number | null;
  height: number | null;
  depth: number | null;
  sortScanned: boolean;
  runScanned: boolean;
  pickScanned: boolean;
  invalidPickScanned: boolean;
  transferScanned: boolean;
  transitScanned: boolean;
};

// Chevron affordance used on every expandable Bulk row (parent / child).
// Extracted so parent-row and child-row markup stays skinny + the icon
// direction stays consistent across levels.
function ExpandChevron({ expanded, onClick, hidden = false }: {
  expanded: boolean;
  onClick: () => void;
  hidden?: boolean;
}) {
  if (hidden) return <span className="inline-block w-3" aria-hidden />;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="w-3 h-3 inline-flex items-center justify-center text-red-500 hover:text-red-700 align-middle"
      aria-label={expanded ? 'Collapse' : 'Expand'}
    >
      <svg
        width="9"
        height="9"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
      >
        <polyline points="9 6 15 12 9 18" />
      </svg>
    </button>
  );
}

// Bulk-mode parent row with lazy-loaded child + item sub-rows.
// Level 1 = parent, Level 2 = child jobs (already in the parent's payload
// courtesy of RVW_stpScanJobs which returns both parent + child rows via
// BulkParentID linkage), Level 3 = per-item barcodes (lazy fetch through
// /api/runviewer/jobs/items, wraps RVW_stpJobItems).
//
// Matches legacy scans/tpls/jobList.tpl parent/child/item structure
// (lines 43-203) and scanControl.js toggleExpand/getChildItems flow
// (lines 770-790). Item lazy-fetch pattern mirrors the Routed FragmentRow
// item-progress lazy-load already established above.
function BulkFragmentRow({
  parent, childRows, active, expanded, expandedItemsFor, selectedRootJobId,
  runDate, onSelect, onToggle, onToggleItems, onContextMenu,
  dateFormatter, timeFormatter,
}: {
  parent: any;
  childRows: any[];
  active: boolean;
  expanded: boolean;
  expandedItemsFor: number[];
  selectedRootJobId: number | null;
  runDate: string;
  onSelect: (id: number) => void;
  onToggle: () => void;
  onToggleItems: (bulkJobId: number) => void;
  onContextMenu: (e: React.MouseEvent, row: any) => void;
  dateFormatter: (s: string | null) => string;
  timeFormatter: (s: string | null) => string;
}) {
  // Legacy chevron rule: show when the row has real child jobs OR the
  // items count is > 1 (single-item jobs can't be drilled). Same rule at
  // parent + child level.
  const parentHasDrill = childRows.length > 0 || parent.items > 1;

  // Parent-level items expansion. Legacy `toggleExpand` (scanControl.js:770)
  // routes a single chevron click: if the parent has children, expand the
  // child sub-tree; if it has no children BUT items > 1, load per-item
  // barcodes directly. Mirror that: for a childless parent, `expanded`
  // gates the item fetch by itself; for a parent-with-children, item
  // fetching happens at the child level instead.
  const parentItemsQ = useQuery({
    queryKey: ['sm-bulk-items', parent.bulkJobId, runDate],
    queryFn: () => routeViewerService.getBulkJobItems(parent.bulkJobId, runDate),
    enabled: expanded && childRows.length === 0 && parent.items > 1,
    staleTime: 15_000,
  });

  return (
    <>
      {/* PARENT ROW */}
      <tr
        onClick={() => onSelect(parent.bulkJobId)}
        onContextMenu={(e) => onContextMenu(e, parent)}
        className={`cursor-pointer border-b border-border/50 ${
          active ? 'bg-brand-cyan/20' : 'hover:bg-surface-cream/60'
        }`}
      >
        <td className="px-2 py-1">{parent.clientCode ?? '-'}</td>
        <td className="px-2 py-1 font-mono">{parent.jobNumber ?? '-'}</td>
        <td className="px-2 py-1">{dateFormatter(parent.deliveryDate) || '-'}</td>
        <td className="px-2 py-1">{timeFormatter(parent.readyTime) || '-'}</td>
        <td className="px-2 py-1 truncate max-w-[14rem]" title={parent.toAddress ?? undefined}>
          {parent.toAddress ?? '-'}
        </td>
        <td className="px-2 py-1 text-center whitespace-nowrap">
          {parent.items}
          {parentHasDrill && (
            <span className="ml-1"><ExpandChevron expanded={expanded} onClick={onToggle} /></span>
          )}
        </td>
        <td className="px-2 py-1 text-center"><TriStateCell v={parent.sortScanned} /></td>
        <td className="px-2 py-1 text-center"><TriStateCell v={parent.runScanned} /></td>
        <td className="px-2 py-1 text-center"><BinaryCell v={parent.pickScanned} /></td>
        <td className="px-2 py-1 text-center"><BinaryCell v={parent.invalidPickScanned} tone="warn" /></td>
        <td className="px-2 py-1 text-center"><BinaryCell v={parent.transferScanned} /></td>
        <td className="px-2 py-1 text-center"><BinaryCell v={parent.transitScanned} /></td>
      </tr>

      {/* CHILD ROWS (Level 2) */}
      {expanded && childRows.map((child) => (
        <BulkChildRow
          key={child.bulkJobId}
          child={child}
          active={selectedRootJobId === child.bulkJobId}
          itemsExpanded={expandedItemsFor.includes(child.bulkJobId)}
          runDate={runDate}
          onSelect={() => onSelect(child.bulkJobId)}
          onToggleItems={() => onToggleItems(child.bulkJobId)}
          onContextMenu={onContextMenu}
          dateFormatter={dateFormatter}
          timeFormatter={timeFormatter}
        />
      ))}

      {/* ITEM ROWS for parent directly (Level 3, no children path) */}
      {expanded && childRows.length === 0 && parent.items > 1 && (
        <BulkItemRows
          isLoading={parentItemsQ.isLoading}
          items={parentItemsQ.data ?? []}
          indentPx={16}
          jobNumber={parent.jobNumber ?? ''}
        />
      )}
    </>
  );
}

// Level-2 child row + optional Level-3 item sub-rows. Kept as its own
// component so the useQuery hook count stays stable when the operator
// expands/collapses siblings.
function BulkChildRow({
  child, active, itemsExpanded, runDate, onSelect, onToggleItems, onContextMenu,
  dateFormatter, timeFormatter,
}: {
  child: any;
  active: boolean;
  itemsExpanded: boolean;
  runDate: string;
  onSelect: () => void;
  onToggleItems: () => void;
  onContextMenu: (e: React.MouseEvent, row: any) => void;
  dateFormatter: (s: string | null) => string;
  timeFormatter: (s: string | null) => string;
}) {
  const childHasDrill = child.items > 1;
  const itemsQ = useQuery({
    queryKey: ['sm-bulk-items', child.bulkJobId, runDate],
    queryFn: () => routeViewerService.getBulkJobItems(child.bulkJobId, runDate),
    enabled: itemsExpanded,
    staleTime: 15_000,
  });

  return (
    <>
      <tr
        onClick={onSelect}
        onContextMenu={(e) => onContextMenu(e, child)}
        className={`cursor-pointer border-b border-border/50 ${
          active ? 'bg-brand-cyan/20' : 'hover:bg-slate-100/70'
        } bg-slate-50/60`}
      >
        <td className="px-2 py-1"></td>
        <td className="px-2 py-1 font-mono" style={{ paddingLeft: '20px' }}>
          {child.jobNumber ?? '-'}
        </td>
        <td className="px-2 py-1">{dateFormatter(child.deliveryDate) || '-'}</td>
        <td className="px-2 py-1">{timeFormatter(child.readyTime) || '-'}</td>
        <td className="px-2 py-1 truncate max-w-[14rem]" title={child.toAddress ?? undefined}>
          {child.toAddress ?? '-'}
        </td>
        <td className="px-2 py-1 text-center whitespace-nowrap">
          {child.items}
          {childHasDrill && (
            <span className="ml-1"><ExpandChevron expanded={itemsExpanded} onClick={onToggleItems} /></span>
          )}
        </td>
        <td className="px-2 py-1 text-center"><TriStateCell v={child.sortScanned} /></td>
        <td className="px-2 py-1 text-center"><TriStateCell v={child.runScanned} /></td>
        <td className="px-2 py-1 text-center"><BinaryCell v={child.pickScanned} /></td>
        <td className="px-2 py-1 text-center"><BinaryCell v={child.invalidPickScanned} tone="warn" /></td>
        <td className="px-2 py-1 text-center"><BinaryCell v={child.transferScanned} /></td>
        <td className="px-2 py-1 text-center"><BinaryCell v={child.transitScanned} /></td>
      </tr>
      {itemsExpanded && (
        <BulkItemRows
          isLoading={itemsQ.isLoading}
          items={itemsQ.data ?? []}
          indentPx={36}
          jobNumber={child.jobNumber ?? ''}
        />
      )}
    </>
  );
}

// Level-3 per-item barcode rows. Rendered as one <tr> per item barcode
// with binary tick/cross cells (per-item flags are bool on JobItemDto,
// not tri-state - T.4 correction). Loading + empty states surface a
// single spanned cell.
function BulkItemRows({
  isLoading, items, indentPx, jobNumber,
}: {
  isLoading: boolean;
  items: BulkItemRow[];
  indentPx: number;
  jobNumber: string;
}) {
  if (isLoading) {
    return (
      <tr>
        <td colSpan={12} className="px-3 py-2 text-center text-text-muted text-[11px] bg-emerald-50/60">
          Loading items...
        </td>
      </tr>
    );
  }
  if (items.length === 0) {
    return (
      <tr>
        <td colSpan={12} className="px-3 py-2 text-center text-text-muted text-[11px] bg-emerald-50/60">
          No items on file.
        </td>
      </tr>
    );
  }
  return (
    <>
      {items.map((it) => {
        // Legacy label pattern: for child rows the barcode is displayed
        // as "{jobNumber}-{lastSegmentOfBarcode}" (jobList.tpl:141).
        const displayLabel = jobNumber && it.barcode?.includes('-')
          ? `${jobNumber}-${it.barcode.split('-').pop()}`
          : (it.barcode ?? '-');
        return (
          <tr key={it.bulkJobItemId} className="border-b border-border/40 bg-emerald-50/60">
            <td className="px-2 py-1"></td>
            <td className="px-2 py-1 font-mono text-[11px]" style={{ paddingLeft: `${indentPx}px` }}>
              {displayLabel}
            </td>
            <td colSpan={3} className="px-2 py-1 text-[11px] text-text-muted">
              W:{it.weight ?? '-'} L:{it.length ?? '-'} H:{it.height ?? '-'} D:{it.depth ?? '-'}
            </td>
            <td className="px-2 py-1"></td>
            <td className="px-2 py-1 text-center"><BinaryCell v={it.sortScanned ? 1 : 0} /></td>
            <td className="px-2 py-1 text-center"><BinaryCell v={it.runScanned ? 1 : 0} /></td>
            <td className="px-2 py-1 text-center"><BinaryCell v={it.pickScanned ? 1 : 0} /></td>
            <td className="px-2 py-1 text-center"><BinaryCell v={it.invalidPickScanned ? 1 : 0} tone="warn" /></td>
            <td className="px-2 py-1 text-center"><BinaryCell v={it.transferScanned ? 1 : 0} /></td>
            <td className="px-2 py-1 text-center"><BinaryCell v={it.transitScanned ? 1 : 0} /></td>
          </tr>
        );
      })}
    </>
  );
}

// Column keys we sort by. Kept as a union so a typo becomes a compile
// error instead of a silent null sort.
type BulkSortKey =
  | 'clientCode' | 'jobNumber' | 'deliveryDate' | 'readyTime' | 'toAddress'
  | 'items' | 'sortScanned' | 'runScanned' | 'pickScanned' | 'invalidPickScanned'
  | 'transferScanned' | 'transitScanned';

type RoutedSortKey =
  | 'clientCode' | 'jobNumber' | 'toAddress' | 'suburb' | 'stage'
  | 'legs' | 'items' | 'flags';

// 200ms text-input debounce, inlined so we don't add a global hook for
// a single caller. Debounce fires from a leading-edge clear so an
// operator typing "abc" only triggers the filter after they pause.
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

// Simple numbered pager. Kept local since neither Route Builder nor
// Route Viewer have a shared paginator component (the only paged surface
// is AutoAssignLog which paginates server-side via a different shape).
function Pager({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (p: number) => void }) {
  if (pageCount <= 1) return null;
  // Elide long page runs into: 1 ... p-1 p p+1 ... last. Matches the
  // legacy AngularJS $scope.pages window used by scans/tpls/jobList.tpl.
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
      <Button variant="neutral" size="sm" onClick={() => onChange(page - 1)} disabled={page <= 1}>Prev</Button>
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
      <Button variant="neutral" size="sm" onClick={() => onChange(page + 1)} disabled={page >= pageCount}>Next</Button>
    </div>
  );
}

const BULK_PAGE_SIZE = 100;

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

  // Bulk mode: separate expand state trees.
  // - expandedBulkParents: parent bulkJobIds where the child-jobs sub-tree
  //   is currently open. Mirrors legacy `job.expanded`.
  // - expandedBulkItemsFor: bulkJobIds (parent or child) whose per-item
  //   barcode sub-rows are open. Mirrors legacy `job.expanded`/`child.expanded`
  //   as it applies to the item-fetch layer.
  const [expandedBulkParents, setExpandedBulkParents] = useState<number[]>([]);
  const [expandedBulkItemsFor, setExpandedBulkItemsFor] = useState<number[]>([]);
  const toggleBulkParent = (id: number) => setExpandedBulkParents((prev) =>
    prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
  );
  const toggleBulkItems = (id: number) => setExpandedBulkItemsFor((prev) =>
    prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
  );

  // Sort / filter / search / pagination state. Each grid keeps its own
  // sort state so a user toggling modes does not lose the other grid's
  // arrangement. Search + filters are shared across both modes since the
  // task is filtering the same operational job set.
  const [bulkSort, setBulkSort] = useState<{ key: BulkSortKey; dir: 'asc' | 'desc' }>({ key: 'jobNumber', dir: 'asc' });
  const [routedSort, setRoutedSort] = useState<{ key: RoutedSortKey; dir: 'asc' | 'desc' }>({ key: 'jobNumber', dir: 'asc' });
  // Filter state now stores IDs (matches MultiSelect's default) so we can
  // forward directly to the SP via ClientIds / RegionIds / SpeedIds
  // query-string filters. Server-side narrows the rowset at source rather
  // than the client dropping rows post-fetch.
  const [clientIds, setClientIds] = useState<string[]>([]);
  const [regionIds, setRegionIds] = useState<string[]>([]);
  const [speedIds, setSpeedIds] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput, 200);
  const [bulkPage, setBulkPage] = useState(1);

  // Reset the pager when the operative row set changes (mode / filters
  // / search / date all reshuffle the pool, so page 4 of the old view
  // rarely maps to a useful page 4 of the new view).
  useEffect(() => { setBulkPage(1); }, [mode, runDate, clientIds, regionIds, speedIds, search, clientInternal]);

  // Row context-menu wiring (task #48). Section Z has not yet confirmed
  // which actions this menu should carry (legacy jobList.tpl:46 binds
  // `jobListMenu` but the menu body was left empty in the pre-migration
  // scan branch too). Wire the handler + mount an empty `RowContextMenu`
  // shell so the plumbing is in place; actions are added once
  // stakeholders sign off. Right-clicks on Bulk parent, Bulk child, and
  // Routed rows all open the same shell.
  const [rowCtx, setRowCtx] = useState<{ x: number; y: number; title: string } | null>(null);
  const openContextMenu = (e: React.MouseEvent, r: any) => {
    e.preventDefault();
    const title = r?.jobNumber ? `Job ${r.jobNumber}` : 'Job';
    setRowCtx({ x: e.clientX, y: e.clientY, title });
  };
  const closeContextMenu = () => setRowCtx(null);

  const lookups = useRouteViewerLookups(runDate);

  const clientIdsNum = useMemo(
    () => (clientIds.length ? clientIds.map(Number) : undefined),
    [clientIds],
  );
  const regionIdsNum = useMemo(
    () => (regionIds.length ? regionIds.map(Number) : undefined),
    [regionIds],
  );
  const speedIdsNum = useMemo(
    () => (speedIds.length ? speedIds.map(Number) : undefined),
    [speedIds],
  );

  const bulkQ = useQuery({
    queryKey: ['sm-bulk', runDate, clientInternal, clientIds, regionIds, speedIds],
    queryFn: () => routeViewerService.getBulkScanJobs(
      runDate, clientInternal, clientIdsNum, regionIdsNum, speedIdsNum,
    ),
    enabled: mode === 'Bulk' && !!runDate,
    staleTime: 5_000,
  });

  const routedQ = useQuery({
    queryKey: ['sm-routed', runDate, clientIds, regionIds, speedIds],
    queryFn: () => routeViewerService.getRoutedScanJobs(
      runDate, clientIdsNum, regionIdsNum, speedIdsNum,
    ),
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

  // Client-side narrowing. Region + Speed filters currently no-op on the
  // scan rows because RVW_stpScanJobs / RVW_stpScanJobs_Routed don't
  // expose RegionId / SpeedId per row. The dropdowns still render (per
  // spec) so the UI is complete; wiring the filter body is a one-line
  // change once the backend surfaces those fields.
  const searchLower = search.trim().toLowerCase();
  const searchNeedle = (fields: Array<string | null | undefined>) => {
    if (!searchLower) return true;
    return fields.some((f) => (f ?? '').toString().toLowerCase().includes(searchLower));
  };

  // Legacy `processJobData` (scanControl.js:751) split the flat SP rowset
  // into parents (bulkParentId == null) + a child map keyed by
  // bulkJobId -> child rows. Same split here so pagination + sort +
  // search operate on parents only, with children looked up on demand
  // by the tree component.
  const bulkChildMap = useMemo(() => {
    const map = new Map<number, typeof bulkRows>();
    for (const r of bulkRows) {
      if (r.bulkParentId != null) {
        const arr = map.get(r.bulkParentId) ?? [];
        arr.push(r);
        map.set(r.bulkParentId, arr);
      }
    }
    return map;
  }, [bulkRows]);

  const filteredBulk = useMemo(() => {
    // Client-side layer: search only. Client/Region/Speed already
    // narrowed at the SP layer via the queryKey above; children ride
    // along with their parent in the tree render regardless of match.
    return bulkRows.filter((r) =>
      r.bulkParentId == null
      && searchNeedle([r.clientCode, r.jobNumber, r.toAddress, r.readyTime, r.deliveryDate])
    );
  }, [bulkRows, searchLower]);

  const filteredRouted = useMemo(() => {
    return routedRows.filter((r) =>
      searchNeedle([r.clientCode, r.jobNumber, r.toAddress, r.suburb, r.stage, r.companyName])
    );
  }, [routedRows, searchLower]);

  const sortedBulk = useMemo(() => {
    const mult = bulkSort.dir === 'asc' ? 1 : -1;
    const copy = filteredBulk.slice();
    copy.sort((a, b) => {
      const av = (a as any)[bulkSort.key];
      const bv = (b as any)[bulkSort.key];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
      return String(av ?? '').localeCompare(String(bv ?? '')) * mult;
    });
    return copy;
  }, [filteredBulk, bulkSort]);

  const sortedRouted = useMemo(() => {
    const mult = routedSort.dir === 'asc' ? 1 : -1;
    const copy = filteredRouted.slice();
    copy.sort((a, b) => {
      let av: any = '';
      let bv: any = '';
      switch (routedSort.key) {
        case 'legs': av = parseLegs(a.legs).length; bv = parseLegs(b.legs).length; break;
        case 'items': av = a.scannedItems; bv = b.scannedItems; break;
        case 'flags':
          av = (a.hasShort ? 2 : 0) + (a.isDivergent ? 1 : 0);
          bv = (b.hasShort ? 2 : 0) + (b.isDivergent ? 1 : 0);
          break;
        default:
          av = (a as any)[routedSort.key];
          bv = (b as any)[routedSort.key];
      }
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
      return String(av ?? '').localeCompare(String(bv ?? '')) * mult;
    });
    return copy;
  }, [filteredRouted, routedSort]);

  const pageCount = Math.max(1, Math.ceil(sortedBulk.length / BULK_PAGE_SIZE));
  const currentPage = Math.min(bulkPage, pageCount);
  const pagedBulk = useMemo(
    () => sortedBulk.slice((currentPage - 1) * BULK_PAGE_SIZE, currentPage * BULK_PAGE_SIZE),
    [sortedBulk, currentPage],
  );

  const toggleBulkSort = (key: BulkSortKey) => setBulkSort((prev) =>
    prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
  );
  const toggleRoutedSort = (key: RoutedSortKey) => setRoutedSort((prev) =>
    prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
  );

  const totals = useMemo(() => {
    if (mode === 'Bulk') {
      const total = sortedBulk.length;
      const sortDone = sortedBulk.filter((r) => r.sortScanned === 1).length;
      const runDone = sortedBulk.filter((r) => r.runScanned === 1).length;
      return { total, sortDone, runDone };
    }
    return { total: sortedRouted.length, sortDone: 0, runDone: 0 };
  }, [mode, sortedBulk, sortedRouted]);

  // Option values are IDs so the MultiSelect selection maps 1:1 to the
  // SP query-string filter without a label-to-ID lookup step.
  const clientOptions = useMemo(
    () => lookups.clients.map((c) => ({ value: String(c.id), label: c.label ?? '(unnamed)' })),
    [lookups.clients],
  );
  const regionOptions = useMemo(
    () => lookups.regions.map((r) => ({ value: String(r.id), label: r.label })),
    [lookups.regions],
  );
  const speedOptions = useMemo(
    () => lookups.speeds.map((s) => ({ value: String(s.id), label: s.label })),
    [lookups.speeds],
  );

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

        {/* Client / Region / Speed multi-selects. Reuses the shared
            MultiSelect from RvFilterBar. Selections forward to the SP
            via ClientIds / RegionIds / SpeedIds query-string filters
            so the WHERE clause tightens at source rather than dropping
            rows post-fetch. */}
        <MultiSelect
          label="Clients"
          options={clientOptions}
          selected={clientIds}
          onChange={setClientIds}
        />
        <MultiSelect
          label="Regions"
          options={regionOptions}
          selected={regionIds}
          onChange={setRegionIds}
        />
        <MultiSelect
          label="Speeds"
          options={speedOptions}
          selected={speedIds}
          onChange={setSpeedIds}
        />

        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search jobs..."
          className="border border-border rounded px-2 py-0.5 text-xs bg-surface-white min-w-[10rem]"
          aria-label="Search jobs"
        />

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
        <div className="flex-1 overflow-auto flex flex-col">
          <RvBox title={mode === 'Bulk' ? 'Bulk Scans' : 'Routed Scans'}>
            {mode === 'Bulk' && (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface-white border-b border-border">
                  <tr className="text-left text-text-muted">
                    <SortableTh label="Client" active={bulkSort.key === 'clientCode'} dir={bulkSort.dir} onClick={() => toggleBulkSort('clientCode')} />
                    <SortableTh label="Job #" active={bulkSort.key === 'jobNumber'} dir={bulkSort.dir} onClick={() => toggleBulkSort('jobNumber')} />
                    <SortableTh label="D Date" active={bulkSort.key === 'deliveryDate'} dir={bulkSort.dir} onClick={() => toggleBulkSort('deliveryDate')} />
                    <SortableTh label="R Time" active={bulkSort.key === 'readyTime'} dir={bulkSort.dir} onClick={() => toggleBulkSort('readyTime')} />
                    <SortableTh label="Address" active={bulkSort.key === 'toAddress'} dir={bulkSort.dir} onClick={() => toggleBulkSort('toAddress')} />
                    <SortableTh label="Items" align="center" active={bulkSort.key === 'items'} dir={bulkSort.dir} onClick={() => toggleBulkSort('items')} />
                    <SortableTh label="S" align="center" title="Sort" active={bulkSort.key === 'sortScanned'} dir={bulkSort.dir} onClick={() => toggleBulkSort('sortScanned')} />
                    <SortableTh label="R" align="center" title="Run" active={bulkSort.key === 'runScanned'} dir={bulkSort.dir} onClick={() => toggleBulkSort('runScanned')} />
                    <SortableTh label="P" align="center" title="Pickup" active={bulkSort.key === 'pickScanned'} dir={bulkSort.dir} onClick={() => toggleBulkSort('pickScanned')} />
                    <SortableTh label="iP" align="center" title="Invalid Pickup" active={bulkSort.key === 'invalidPickScanned'} dir={bulkSort.dir} onClick={() => toggleBulkSort('invalidPickScanned')} />
                    <SortableTh label="T" align="center" title="Transfer" active={bulkSort.key === 'transferScanned'} dir={bulkSort.dir} onClick={() => toggleBulkSort('transferScanned')} />
                    <SortableTh label="iT" align="center" title="In Transit" active={bulkSort.key === 'transitScanned'} dir={bulkSort.dir} onClick={() => toggleBulkSort('transitScanned')} />
                  </tr>
                </thead>
                <tbody>
                  {pagedBulk.map((r) => {
                    const active = selectedRootJobId === r.bulkJobId;
                    const children = bulkChildMap.get(r.bulkJobId) ?? [];
                    const expanded = expandedBulkParents.includes(r.bulkJobId);
                    return (
                      <BulkFragmentRow
                        key={r.bulkJobId}
                        parent={r}
                        childRows={children}
                        active={active}
                        expanded={expanded}
                        expandedItemsFor={expandedBulkItemsFor}
                        selectedRootJobId={selectedRootJobId}
                        runDate={runDate}
                        onSelect={setSelectedRootJobId}
                        onToggle={() => toggleBulkParent(r.bulkJobId)}
                        onToggleItems={toggleBulkItems}
                        onContextMenu={openContextMenu}
                        dateFormatter={(s) => tenantDateFromSpString(s, user.isUsTenant)}
                        timeFormatter={(s) => tenantTimeFromSpString(s, user.isUsTenant)}
                      />
                    );
                  })}
                  {sortedBulk.length === 0 && !bulkQ.isLoading && (
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
                    <SortableTh label="Client" active={routedSort.key === 'clientCode'} dir={routedSort.dir} onClick={() => toggleRoutedSort('clientCode')} />
                    <SortableTh label="Job #" active={routedSort.key === 'jobNumber'} dir={routedSort.dir} onClick={() => toggleRoutedSort('jobNumber')} />
                    <SortableTh label="Address" active={routedSort.key === 'toAddress'} dir={routedSort.dir} onClick={() => toggleRoutedSort('toAddress')} />
                    <SortableTh label="Suburb" active={routedSort.key === 'suburb'} dir={routedSort.dir} onClick={() => toggleRoutedSort('suburb')} />
                    <SortableTh label="Stage" active={routedSort.key === 'stage'} dir={routedSort.dir} onClick={() => toggleRoutedSort('stage')} />
                    {/* Tote column header (task #47.2). Not sortable - value
                        is derived client-side from item-progress on expand. */}
                    <th className="px-2 py-1 font-medium text-center" title="Current tote (derived from item progress)">Tote</th>
                    <SortableTh label="Legs" align="center" active={routedSort.key === 'legs'} dir={routedSort.dir} onClick={() => toggleRoutedSort('legs')} />
                    <SortableTh label="Items" align="center" active={routedSort.key === 'items'} dir={routedSort.dir} onClick={() => toggleRoutedSort('items')} />
                    <SortableTh label="Flags" align="center" active={routedSort.key === 'flags'} dir={routedSort.dir} onClick={() => toggleRoutedSort('flags')} />
                  </tr>
                </thead>
                <tbody>
                  {sortedRouted.map((r) => {
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
                        onContextMenu={openContextMenu}
                      />
                    );
                  })}
                  {sortedRouted.length === 0 && !routedQ.isLoading && (
                    <tr><td className="px-3 py-6 text-center text-text-muted" colSpan={10}>No routed shipments for this date.</td></tr>
                  )}
                  {routedQ.isLoading && (
                    <tr><td className="px-3 py-6 text-center text-text-muted" colSpan={10}>Loading...</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </RvBox>
          {mode === 'Bulk' && (
            <Pager page={currentPage} pageCount={pageCount} onChange={setBulkPage} />
          )}
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

      {/* Empty context-menu placeholder (task #48). Section Z has not yet
          selected any actions - once confirmed, populate the items array
          with real handlers (assign courier, mark short, etc.). */}
      <RowContextMenu
        clientX={rowCtx?.x ?? null}
        clientY={rowCtx?.y ?? null}
        title={rowCtx?.title}
        items={[]}
        onClose={closeContextMenu}
      />
    </div>
  );
}
