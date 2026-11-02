import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '../../context/ToastContext';
import {
  linehaulRateService,
  type LinehaulBootstrap,
  type LinehaulRunRate,
  type LinehaulScheduleRate,
  type LinehaulSpeedCell,
} from '../../services/linehaulRateService';
import { ClientPicker } from '../../components/common/ClientPicker';

const money = (v: number | null | undefined) =>
  v == null ? '' : v.toFixed(2);

/** What the operator typed, parsed. Empty clears the price. `error` set means
 *  nothing was sent and the message is the one to show. */
function parseAmount(text: string): { value: number | null; error: string | null } {
  const t = text.trim();
  if (!t) return { value: null, error: null };
  const n = Number(t.replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) return { value: null, error: `"${text}" is not a number.` };
  if (n < 0) return { value: null, error: 'A linehaul price cannot be negative.' };
  return { value: n, error: null };
}

/**
 * Linehaul tab (spec 12.2). Rows are linehaul runs filtered by from and to
 * depot, with the run-level price per speed editable inline.
 *
 * One deliberate difference from the 15 Oct mock, which drew a flat grid of
 * runs by speeds with one price per cell. The shipped `BulkLinehaulRate`
 * carries `ScheduleId` as well, and every seeded row on Urgent uses it,
 * because the measurement found the schedule explains 1,985 of 2,005
 * contested triples. Run 1 alone holds 223 schedule prices from $0 to $41.20,
 * so a single run-by-speed cell would have to pick one of them and hide the
 * rest. The run-level prices stay in the grid the mock drew; the per-schedule
 * prices are listed under the run when it is expanded, and the row carries
 * their count and range so nobody has to expand it to know they exist.
 */
export function LinehaulTab() {
  const toast = useToast();
  const [boot, setBoot] = useState<LinehaulBootstrap | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);
  const [fromDepotId, setFromDepotId] = useState<number | null>(null);
  const [toDepotId, setToDepotId] = useState<number | null>(null);
  const [clientId, setClientId] = useState<number | null>(null);
  const [runs, setRuns] = useState<LinehaulRunRate[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');

  const [expanded, setExpanded] = useState<number | null>(null);
  const [scheduleRates, setScheduleRates] = useState<LinehaulScheduleRate[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);

  const [addingSpeedFor, setAddingSpeedFor] = useState<number | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const b = await linehaulRateService.bootstrap();
        setBoot(b.response);
      } catch (e) { toast.show((e as Error).message, 'error'); }
    })();
  }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await linehaulRateService.runs({ fromDepotId, toDepotId, clientId });
      setRuns(res.response ?? []);
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setLoading(false); }
  }, [fromDepotId, toDepotId, clientId, toast]);

  useEffect(() => { void load(); }, [load]);

  // Collapse on filter change: the open run may not be in the new list.
  useEffect(() => { setExpanded(null); setScheduleRates([]); }, [fromDepotId, toDepotId, clientId]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return runs;
    return runs.filter((r) =>
      r.runName.toLowerCase().includes(needle)
      || r.fromDepotName.toLowerCase().includes(needle)
      || r.toDepotName.toLowerCase().includes(needle));
  }, [runs, q]);

  /** Speed columns are the union across the visible runs, so a price added to
   *  one run gives every run that column rather than a ragged table. */
  const speedColumns = useMemo(() => {
    const seen = new Map<number, string>();
    for (const r of filtered) {
      for (const c of r.speedCells) {
        if (c.speedId != null && !seen.has(c.speedId)) seen.set(c.speedId, c.speedName);
      }
    }
    return [...seen.entries()].map(([speedId, name]) => ({ speedId, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered]);

  const clientLabel = clientName ?? 'Default';

  const toggleRun = async (runId: number) => {
    if (expanded === runId) { setExpanded(null); setScheduleRates([]); return; }
    setExpanded(runId);
    setScheduleLoading(true);
    try {
      const res = await linehaulRateService.scheduleRates(runId, clientId);
      setScheduleRates(res.response ?? []);
    } catch (e) { toast.show((e as Error).message, 'error'); setScheduleRates([]); }
    finally { setScheduleLoading(false); }
  };

  const commit = async (
    key: string,
    body: Parameters<typeof linehaulRateService.upsert>[0],
    text: string,
  ) => {
    const parsed = parseAmount(text);
    if (parsed.error) { toast.show(parsed.error, 'error'); return; }
    setBusyKey(key);
    try {
      await linehaulRateService.upsert({ ...body, amount: parsed.value, amountPercentage: null });
      await load();
      if (expanded != null && body.scheduleId != null) {
        const res = await linehaulRateService.scheduleRates(expanded, clientId);
        setScheduleRates(res.response ?? []);
      }
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setBusyKey(null); }
  };

  const addSpeed = async (runId: number, speedId: number) => {
    setBusyKey(`add-${runId}`);
    try {
      await linehaulRateService.addSpeedColumn(runId, speedId, clientId);
      setAddingSpeedFor(null);
      await load();
      toast.show('Speed column added, seeded from the any-speed price', 'success');
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setBusyKey(null); }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="text-text-secondary">From</label>
          <select
            value={fromDepotId ?? ''}
            data-testid="lh-from-depot"
            onChange={(e) => setFromDepotId(e.target.value ? Number(e.target.value) : null)}
            className="border border-border rounded-lg px-2 py-1.5 text-xs bg-surface-white"
          >
            <option value="">any</option>
            {(boot?.fromDepots ?? []).map((d) => (
              <option key={d.depotId} value={d.depotId}>{d.name}</option>
            ))}
          </select>
          <label className="text-text-secondary">To</label>
          <select
            value={toDepotId ?? ''}
            data-testid="lh-to-depot"
            onChange={(e) => setToDepotId(e.target.value ? Number(e.target.value) : null)}
            className="border border-border rounded-lg px-2 py-1.5 text-xs bg-surface-white"
          >
            <option value="">any</option>
            {(boot?.toDepots ?? []).map((d) => (
              <option key={d.depotId} value={d.depotId}>{d.name}</option>
            ))}
          </select>
          <label className="text-text-secondary">Client</label>
          <ClientPicker
            value={clientId}
            defaultLabel="Default"
            testId="lh-client"
            onChange={(id, label) => { setClientId(id); setClientName(label); }}
          />
        </div>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search runs..."
          className="border border-border rounded-lg px-3 py-1.5 text-xs w-48 bg-surface-white focus:outline-none focus:ring-1 focus:ring-brand-cyan"
        />
      </div>

      <p className="text-[11px] text-text-muted mb-2">
        {loading ? 'Loading...' : `${filtered.length} run${filtered.length === 1 ? '' : 's'}`}
        {' '}- prices shown for <span className="font-medium">{clientLabel}</span>. A run also carries
        per-schedule prices; open a run to see and edit them.
      </p>

      <div className="overflow-x-auto rounded-xl border border-border bg-white">
        <table className="min-w-[900px] w-full text-xs">
          <thead className="bg-surface-light">
            <tr className="text-left text-text-secondary">
              <th className="px-3 py-2 font-medium">Run</th>
              <th className="px-3 py-2 font-medium">From</th>
              <th className="px-3 py-2 font-medium">To</th>
              <th className="px-3 py-2 font-medium text-right">Any speed</th>
              {speedColumns.map((c) => (
                <th key={c.speedId} className="px-3 py-2 font-medium text-right">{c.name}</th>
              ))}
              <th className="px-3 py-2 font-medium">Schedule prices</th>
              <th className="px-3 py-2 font-medium">Used by</th>
              <th className="px-3 py-2 font-medium w-24" />
            </tr>
          </thead>
          <tbody>
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={8 + speedColumns.length} className="px-3 py-6 text-center text-text-muted italic">
                No linehaul runs match these filters.
              </td></tr>
            )}
            {filtered.map((r) => {
              const open = expanded === r.runId;
              return (
                <Fragment key={r.runId}>
                  <tr className="border-t border-border-light hover:bg-surface-cream">
                    <td className="px-3 py-1.5">
                      <button
                        type="button"
                        data-testid={`lh-run-toggle-${r.runId}`}
                        onClick={() => void toggleRun(r.runId)}
                        className="text-left font-medium text-text-primary hover:text-brand-cyan"
                      >
                        <span className="text-text-muted mr-1">{open ? '-' : '+'}</span>
                        {r.runName}
                      </button>
                      {(r.startTime || r.despatchTime) && (
                        <span className="ml-2 text-[10px] text-text-muted tabular-nums">
                          {r.startTime ?? '--:--'} / {r.despatchTime ?? '--:--'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-text-secondary">{r.fromDepotName}</td>
                    <td className="px-3 py-1.5 text-text-secondary">{r.toDepotName}</td>
                    <td className="px-3 py-1.5 text-right">
                      <RunCell run={r} cell={r.anySpeed} clientId={clientId}
                        busyKey={busyKey} onCommit={commit} />
                    </td>
                    {speedColumns.map((c) => {
                      const cell = r.speedCells.find((x) => x.speedId === c.speedId)
                        ?? { speedId: c.speedId, speedName: c.name, rateId: null, amount: null, amountPercentage: null };
                      return (
                        <td key={c.speedId} className="px-3 py-1.5 text-right">
                          <RunCell run={r} cell={cell} clientId={clientId}
                            busyKey={busyKey} onCommit={commit} />
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5 text-text-secondary tabular-nums">
                      {r.scheduleRateCount === 0 ? (
                        <span className="text-text-muted">none</span>
                      ) : (
                        <>
                          {r.scheduleRateCount}
                          {r.scheduleMinAmount != null && r.scheduleMaxAmount != null && (
                            <span className="ml-1 text-text-muted">
                              ({money(r.scheduleMinAmount)} to {money(r.scheduleMaxAmount)})
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-text-muted max-w-[18rem] truncate"
                      title={r.usedBySchedules.join(', ')}>
                      {r.usedBySchedules.length === 0 ? 'none' : r.usedBySchedules.join(', ')}
                      {r.scheduleRateCount > r.usedBySchedules.length && ' ...'}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {addingSpeedFor === r.runId ? (
                        <select
                          autoFocus
                          defaultValue=""
                          data-testid={`lh-add-speed-${r.runId}`}
                          disabled={busyKey === `add-${r.runId}`}
                          onChange={(e) => e.target.value && void addSpeed(r.runId, Number(e.target.value))}
                          onBlur={() => setAddingSpeedFor(null)}
                          className="border border-border rounded px-1 py-0.5 text-[11px] bg-surface-white"
                        >
                          <option value="">Speed...</option>
                          {(boot?.speeds ?? []).map((s) => (
                            <option key={s.speedId} value={s.speedId}>{s.name}</option>
                          ))}
                        </select>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setAddingSpeedFor(r.runId)}
                          className="text-[11px] text-brand-cyan hover:underline"
                        >
                          + Speed
                        </button>
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr className="bg-surface-cream/40">
                      <td colSpan={8 + speedColumns.length} className="px-3 py-2">
                        {scheduleLoading ? (
                          <p className="text-[11px] text-text-muted italic">Loading schedule prices...</p>
                        ) : scheduleRates.length === 0 ? (
                          <p className="text-[11px] text-text-muted italic">
                            No schedule carries its own price on this run, so every schedule using it
                            pays the run price above.
                          </p>
                        ) : (
                          <table className="w-full text-[11px]" data-testid={`lh-schedules-${r.runId}`}>
                            <thead>
                              <tr className="text-left text-text-muted">
                                <th className="py-1 font-medium">Schedule</th>
                                <th className="py-1 font-medium">Speed</th>
                                <th className="py-1 font-medium">Client</th>
                                <th className="py-1 font-medium text-right w-28">Price</th>
                              </tr>
                            </thead>
                            <tbody>
                              {scheduleRates.map((s) => (
                                <ScheduleRow
                                  key={s.rateId}
                                  row={s}
                                  runId={r.runId}
                                  clientId={clientId}
                                  busyKey={busyKey}
                                  onCommit={commit}
                                />
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] text-text-muted italic">
        A price resolves most specific first: the schedule's own price, then the run's price for that
        speed, then its any-speed price, and a client row beats the default at every level. Clearing a
        box removes that price and lets the next one up apply.
      </p>
    </div>
  );
}

/**
 * One editable run-level price. Hoisted out of LinehaulTab deliberately: a
 * component declared inside the render is a new type on every parent render,
 * so React unmounts and remounts it and the box loses focus mid-keystroke.
 */
function RunCell({ run, cell, clientId, busyKey, onCommit }: {
  run: LinehaulRunRate;
  cell: LinehaulSpeedCell;
  clientId: number | null;
  busyKey: string | null;
  onCommit: (
    key: string,
    body: Parameters<typeof linehaulRateService.upsert>[0],
    text: string,
  ) => Promise<void>;
}) {
  const key = `${run.runId}-${cell.speedId ?? 'any'}`;
  const [draft, setDraft] = useState(money(cell.amount));
  useEffect(() => { setDraft(money(cell.amount)); }, [cell.amount]);
  return (
    <input
      type="text"
      value={draft}
      disabled={busyKey === key}
      data-testid={`lh-cell-${key}`}
      aria-label={`${cell.speedName} price for ${run.runName}`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === money(cell.amount)) return;
        void onCommit(key, {
          linehaulRunId: run.runId, scheduleId: null,
          speedId: cell.speedId, clientId,
        }, draft);
      }}
      placeholder="-"
      className="w-20 text-right tabular-nums border border-border rounded px-1.5 py-0.5 text-xs bg-surface-white focus:outline-none focus:ring-1 focus:ring-brand-cyan disabled:opacity-40"
    />
  );
}

function ScheduleRow({ row, runId, clientId, busyKey, onCommit }: {
  row: LinehaulScheduleRate;
  runId: number;
  clientId: number | null;
  busyKey: string | null;
  onCommit: (
    key: string,
    body: Parameters<typeof linehaulRateService.upsert>[0],
    text: string,
  ) => Promise<void>;
}) {
  const key = `sched-${row.rateId}`;
  const [draft, setDraft] = useState(money(row.amount));
  useEffect(() => { setDraft(money(row.amount)); }, [row.amount]);
  return (
    <tr className="border-t border-border-light">
      <td className="py-1 text-text-primary">{row.scheduleName}</td>
      <td className="py-1 text-text-secondary">{row.speedName}</td>
      <td className="py-1 text-text-secondary">
        {row.clientId == null
          ? <span className="text-text-muted">Default</span>
          : (row.clientCode ?? `#${row.clientId}`)}
      </td>
      <td className="py-1 text-right">
        <input
          type="text"
          value={draft}
          disabled={busyKey === key}
          data-testid={`lh-schedule-cell-${row.rateId}`}
          aria-label={`Price for ${row.scheduleName}`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft === money(row.amount)) return;
            void onCommit(key, {
              linehaulRunId: runId,
              scheduleId: row.scheduleId,
              speedId: row.speedId,
              clientId: row.clientId ?? clientId,
            }, draft);
          }}
          placeholder="-"
          className="w-20 text-right tabular-nums border border-border rounded px-1.5 py-0.5 text-[11px] bg-surface-white focus:outline-none focus:ring-1 focus:ring-brand-cyan disabled:opacity-40"
        />
      </td>
    </tr>
  );
}
