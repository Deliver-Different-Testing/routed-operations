import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import {
  pricingService,
  type OfferedSpeed,
  type PackageRates,
  type PricingBootstrap,
  type RateCell,
  type Surcharge,
  type ZoneRateGrid,
} from '../../services/pricingService';
import { ClientPicker } from '../../components/common/ClientPicker';

type SubView = 'rates' | 'dimensions' | 'surcharges' | 'speeds';
const SUB_VIEWS: { key: SubView; label: string }[] = [
  { key: 'rates', label: 'Zone rates' },
  { key: 'dimensions', label: 'Dimensions' },
  { key: 'surcharges', label: 'Surcharges' },
  { key: 'speeds', label: 'Speeds' },
];

const money = (v: number | null | undefined) => (v == null ? '' : v.toFixed(2));

function parseMoney(text: string): { value: number | null; error: string | null } {
  const t = text.trim();
  if (!t) return { value: null, error: null };
  const n = Number(t.replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) return { value: null, error: `"${text}" is not a number.` };
  if (n < 0) return { value: null, error: 'A rate cannot be negative.' };
  return { value: n, error: null };
}

/**
 * Pricing tab (spec 3.3). A zone group and a client at the top, then four
 * sub-views: the zone rates grid, dimension bands, surcharges and which
 * speeds are offered.
 *
 * Two things on this screen are easy to misread, so both are stated on it
 * rather than left to be inferred.
 *
 *  * Zone rates inherit per cell: a client cell shows its own price in black,
 *    or the default greyed when it has none. Typing into a grey cell creates
 *    the override; clearing a black one removes it and the default shows
 *    through again.
 *  * Dimension bands do NOT inherit that way. A client with any bands of its
 *    own uses only its own, with no merge against the default. That is the
 *    legacy behaviour and changing it would silently reprice, so the sub-view
 *    says which set is in force.
 */
export function PricingTab() {
  const toast = useToast();
  const askConfirm = useConfirm();
  const [boot, setBoot] = useState<PricingBootstrap | null>(null);
  const [clientLabel, setClientLabel] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [clientId, setClientId] = useState<number | null>(null);
  const [view, setView] = useState<SubView>('rates');

  useEffect(() => {
    (async () => {
      try {
        const b = await pricingService.bootstrap();
        setBoot(b.response);
        if (b.response.groups.length > 0) setGroupId(b.response.groups[0].id);
      } catch (e) { toast.show((e as Error).message, 'error'); }
    })();
  }, [toast]);

  const group = boot?.groups.find((g) => g.id === groupId) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="text-text-secondary">Zone group</label>
        <select
          value={groupId ?? ''}
          data-testid="pricing-group"
          onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : null)}
          className="border border-border rounded-lg px-2 py-1.5 text-xs bg-surface-white max-w-[20rem]"
        >
          <option value="">Pick a zone group...</option>
          {(boot?.groups ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}{g.depotName ? ` (${g.depotName})` : ''}
            </option>
          ))}
        </select>
        <label className="text-text-secondary ml-2">Client</label>
        <ClientPicker
          value={clientId}
          defaultLabel="Default"
          testId="pricing-client"
          onChange={(id, label) => { setClientId(id); setClientLabel(label); }}
        />
      </div>

      <div className="flex gap-0.5 rounded-xl border border-border bg-white p-0.5 shadow-sm w-fit">
        {SUB_VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            data-testid={`pricing-view-${v.key}`}
            onClick={() => setView(v.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              view === v.key
                ? 'bg-brand-cyan text-brand-dark shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === 'rates' && (
        groupId == null
          ? <p className="text-xs text-text-muted italic">Pick a zone group to see its rates.</p>
          : <ZoneRatesView groupId={groupId} clientId={clientId} groupHasDepot={group?.depotId != null} />
      )}
      {view === 'dimensions' && <DimensionsView clientId={clientId} />}
      {view === 'surcharges' && <SurchargesView clientId={clientId} />}
      {view === 'speeds' && <SpeedsView clientId={clientId} />}
    </div>
  );
}

// ─── ZONE RATES ────────────────────────────────────────────────────────────

function ZoneRatesView({ groupId, clientId, groupHasDepot }: {
  groupId: number; clientId: number | null; groupHasDepot: boolean;
}) {
  const toast = useToast();
  const askConfirm = useConfirm();
  const [grid, setGrid] = useState<ZoneRateGrid | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await pricingService.zoneRates(groupId, clientId);
      setGrid(res.response);
    } catch (e) { toast.show((e as Error).message, 'error'); setGrid(null); }
    finally { setLoading(false); }
  }, [groupId, clientId, toast]);

  useEffect(() => { void load(); }, [load]);

  const cellAt = useMemo(() => {
    const m = new Map<string, RateCell>();
    for (const c of grid?.cells ?? []) m.set(`${c.zone}-${c.speedId}`, c);
    return m;
  }, [grid]);

  const commit = async (zone: number, speedId: number, text: string) => {
    const parsed = parseMoney(text);
    if (parsed.error) { toast.show(parsed.error, 'error'); return; }
    const key = `${zone}-${speedId}`;
    setBusy(key);
    try {
      await pricingService.upsertZoneRate({
        postcodeGroupId: groupId, zone, speedId, clientId,
        amount: parsed.value,
        courierPercentage: cellAt.get(key)?.courierPercentage ?? null,
      });
      await load();
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setBusy(null); }
  };

  const resetAll = async () => {
    if (clientId == null || grid == null) return;
    const ok = await askConfirm({
      title: 'Reset to default',
      message: `Remove all ${grid.overriddenCellCount} of ${grid.clientLabel}'s own prices in "${grid.postcodeGroupName}"? They will fall back to the default prices.`,
      confirmLabel: 'Reset',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await pricingService.resetOverrides(groupId, clientId);
      toast.show(`${res.response} price${res.response === 1 ? '' : 's'} reset to default`, 'success');
      await load();
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  if (loading) return <p className="text-xs text-text-muted italic">Loading rates...</p>;
  if (!grid) return null;

  if (grid.speeds.length === 0) {
    return (
      <p className="text-xs text-text-muted italic">
        No prices on "{grid.postcodeGroupName}" yet.
        {!groupHasDepot && ' This group has no depot, and prices are still found by depot, so nothing can resolve to it until Phase 2 moves them onto the group.'}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] text-text-secondary">
          {grid.postcodeGroupName}
          {grid.depotName && <span className="text-text-muted"> - {grid.depotName}</span>}
          {' '}- prices for <span className="font-medium">{grid.clientLabel}</span>
        </p>
        {clientId != null && (
          <>
            <span
              data-testid="pricing-override-chip"
              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-brand-cyan/15 text-brand-cyan"
            >
              {grid.overriddenCellCount === 0
                ? 'No prices of their own'
                : `Differs from default: ${grid.overriddenCellCount} cell${grid.overriddenCellCount === 1 ? '' : 's'}`}
            </span>
            {grid.overriddenCellCount > 0 && (
              <button type="button" onClick={resetAll}
                className="text-[11px] text-red-600 hover:underline">
                Reset all to default
              </button>
            )}
          </>
        )}
      </div>

      {grid.resolvedByDepot && (
        <p className="text-[11px] text-brand-orange">
          These prices are still stored against the{' '}
          {grid.depotName ? `${grid.depotName} depot` : 'depot'} rather than against this zone
          group. Editing one moves it onto the group.
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-white">
        <table className="w-full text-xs" data-testid="pricing-grid">
          <thead className="bg-surface-light">
            <tr className="text-left text-text-secondary">
              <th className="px-3 py-2 font-medium sticky left-0 bg-surface-light">Zone</th>
              {grid.speeds.map((s) => (
                <th key={s.speedId} className="px-3 py-2 font-medium text-right whitespace-nowrap">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.zones.map((zone) => (
              <tr key={zone} className="border-t border-border-light">
                <td className="px-3 py-1.5 font-medium text-text-primary sticky left-0 bg-white">
                  Zone {zone}
                </td>
                {grid.speeds.map((s) => {
                  const cell = cellAt.get(`${zone}-${s.speedId}`);
                  return (
                    <td key={s.speedId} className="px-3 py-1.5 text-right">
                      <RateInput
                        zone={zone}
                        speedId={s.speedId}
                        speedName={s.name}
                        cell={cell ?? null}
                        showingClient={clientId != null}
                        busy={busy === `${zone}-${s.speedId}`}
                        onCommit={commit}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="border-t-2 border-border bg-surface-light/60">
              <td className="px-3 py-1.5 text-text-secondary sticky left-0 bg-surface-light/60">
                Courier %
              </td>
              {grid.speeds.map((s) => {
                // One figure per column: the courier percentage is set per
                // cell in the data but is in practice the same down a column,
                // so a footer reading several different values says so rather
                // than picking one.
                const inColumn = grid.zones
                  .map((z) => cellAt.get(`${z}-${s.speedId}`)?.courierPercentage)
                  .filter((v): v is number => v != null);
                const distinct = [...new Set(inColumn)];
                return (
                  <td key={s.speedId} className="px-3 py-1.5 text-right tabular-nums text-text-secondary">
                    {distinct.length === 0 ? '-'
                      : distinct.length === 1 ? `${distinct[0]}%`
                        : <span title={distinct.join(', ')}>{distinct.length} values</span>}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {clientId != null && (
        <p className="text-[11px] text-text-muted italic">
          Grey is the default price this client inherits. Typing over it creates their own price;
          clearing the box removes it and the default applies again.
        </p>
      )}
    </div>
  );
}

function RateInput({ zone, speedId, speedName, cell, showingClient, busy, onCommit }: {
  zone: number;
  speedId: number;
  speedName: string;
  cell: RateCell | null;
  showingClient: boolean;
  busy: boolean;
  onCommit: (zone: number, speedId: number, text: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(money(cell?.amount));
  useEffect(() => { setDraft(money(cell?.amount)); }, [cell?.amount]);
  const inherited = showingClient && (cell?.inherited ?? true);
  return (
    <span className="inline-flex items-center gap-1">
      {showingClient && !inherited && cell?.amount != null && (
        <span className="w-1.5 h-1.5 rounded-full bg-brand-cyan" title="This client's own price" />
      )}
      <input
        type="text"
        value={draft}
        disabled={busy}
        data-testid={`rate-${zone}-${speedId}`}
        aria-label={`${speedName} price for zone ${zone}`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft === money(cell?.amount)) return;
          void onCommit(zone, speedId, draft);
        }}
        placeholder="-"
        className={`w-20 text-right tabular-nums border border-border rounded px-1.5 py-0.5 text-xs bg-surface-white focus:outline-none focus:ring-1 focus:ring-brand-cyan disabled:opacity-40 ${
          inherited ? 'text-text-muted' : 'text-text-primary font-medium'
        }`}
      />
    </span>
  );
}

// ─── DIMENSIONS ────────────────────────────────────────────────────────────

function DimensionsView({ clientId }: { clientId: number | null }) {
  const toast = useToast();
  const askConfirm = useConfirm();
  const [data, setData] = useState<PackageRates | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await pricingService.packageRates(clientId);
      setData(res.response);
    } catch (e) { toast.show((e as Error).message, 'error'); setData(null); }
    finally { setLoading(false); }
  }, [clientId, toast]);
  useEffect(() => { void load(); }, [load]);

  const remove = async (id: number) => {
    const ok = await askConfirm({
      title: 'Delete band',
      message: 'Delete this dimension band? Jobs falling in it will then use whichever band does cover them, or none.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await pricingService.deletePackageRate(id);
      toast.show('Band deleted', 'success');
      await load();
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  if (loading) return <p className="text-xs text-text-muted italic">Loading bands...</p>;
  if (!data) return null;

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-text-secondary" data-testid="dimensions-rule">
        {clientId == null
          ? 'The default bands. Every client without bands of its own uses these.'
          : data.usingOwnRows
            ? `${data.clientLabel} has its own bands and uses only these. The default bands do not apply to them at all.`
            : `${data.clientLabel} has no bands of its own, so the default bands below apply. Adding one here means only their own bands apply from then on, with no merge.`}
      </p>

      <div className="overflow-x-auto rounded-xl border border-border bg-white">
        <table className="w-full text-xs">
          <thead className="bg-surface-light">
            <tr className="text-left text-text-secondary">
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Set</th>
              <th className="px-3 py-2 font-medium text-right">Cubic from</th>
              <th className="px-3 py-2 font-medium text-right">Cubic to</th>
              <th className="px-3 py-2 font-medium text-right">Weight from</th>
              <th className="px-3 py-2 font-medium text-right">Weight to</th>
              <th className="px-3 py-2 font-medium text-right">Cubic rate</th>
              <th className="px-3 py-2 font-medium w-20" />
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-text-muted italic">
                No dimension bands.
              </td></tr>
            )}
            {data.rows.map((r) => (
              <tr key={r.id} className="border-t border-border-light">
                <td className="px-3 py-1.5 text-text-primary">{r.name ?? '-'}</td>
                <td className="px-3 py-1.5 text-text-secondary">{r.setName ?? '-'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.fromCubic ?? '-'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.toCubic ?? '-'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.fromWeight ?? '-'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.toWeight ?? '-'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-medium">{r.cubicRate}</td>
                <td className="px-3 py-1.5 text-right">
                  {(clientId == null || data.usingOwnRows) && (
                    <button type="button" onClick={() => remove(r.id)}
                      className="text-[11px] text-red-600 hover:underline">
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── SURCHARGES ────────────────────────────────────────────────────────────

function SurchargesView({ clientId }: { clientId: number | null }) {
  const toast = useToast();
  const askConfirm = useConfirm();
  const [rows, setRows] = useState<Surcharge[]>([]);
  const [loading, setLoading] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await pricingService.surcharges(clientId);
      setRows(res.response ?? []);
    } catch (e) { toast.show((e as Error).message, 'error'); setRows([]); }
    finally { setLoading(false); }
  }, [clientId, toast]);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    const parsed = parseMoney(newAmount);
    if (parsed.error) { toast.show(parsed.error, 'error'); return; }
    setAdding(true);
    try {
      await pricingService.upsertSurcharge({
        postcode: newCode, clientId, surcharge: parsed.value,
      });
      setNewCode(''); setNewAmount('');
      await load();
      toast.show('Surcharge saved', 'success');
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setAdding(false); }
  };

  const remove = async (s: Surcharge) => {
    const ok = await askConfirm({
      title: 'Delete surcharge',
      message: `Remove the surcharge on ${s.code}?`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await pricingService.deleteSurcharge(s.id);
      await load();
      toast.show('Surcharge deleted', 'success');
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={newCode}
          onChange={(e) => setNewCode(e.target.value)}
          placeholder="Postcode"
          data-testid="surcharge-code"
          className="w-28 border border-border rounded px-2 py-1 text-xs bg-surface-white"
        />
        <input
          type="text"
          value={newAmount}
          onChange={(e) => setNewAmount(e.target.value)}
          placeholder="Surcharge"
          data-testid="surcharge-amount"
          className="w-28 text-right border border-border rounded px-2 py-1 text-xs bg-surface-white"
        />
        <button
          type="button"
          disabled={adding || !newCode.trim()}
          onClick={add}
          data-testid="surcharge-add"
          className="px-3 py-1 text-xs font-medium rounded bg-brand-cyan text-brand-dark disabled:opacity-40"
        >
          {adding ? 'Saving...' : 'Add'}
        </button>
        <span className="text-[11px] text-text-muted">
          {loading ? 'Loading...' : `${rows.length} surcharge${rows.length === 1 ? '' : 's'}`}
        </span>
      </div>

      <div className="rounded-xl border border-border bg-white">
        <table className="w-full text-xs">
          <thead className="bg-surface-light">
            <tr className="text-left text-text-secondary">
              <th className="px-3 py-2 font-medium">Postcode</th>
              <th className="px-3 py-2 font-medium text-right">Surcharge</th>
              <th className="px-3 py-2 font-medium w-20" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={3} className="px-3 py-6 text-center text-text-muted italic">
                No surcharges.
              </td></tr>
            )}
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-border-light">
                <td className="px-3 py-1.5 font-mono text-text-primary">{s.code}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(s.surcharge)}</td>
                <td className="px-3 py-1.5 text-right">
                  <button type="button" onClick={() => remove(s)}
                    className="text-[11px] text-red-600 hover:underline">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── SPEEDS ────────────────────────────────────────────────────────────────

function SpeedsView({ clientId }: { clientId: number | null }) {
  const toast = useToast();
  const [rows, setRows] = useState<OfferedSpeed[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await pricingService.speeds(clientId);
      setRows(res.response ?? []);
    } catch (e) { toast.show((e as Error).message, 'error'); setRows([]); }
    finally { setLoading(false); }
  }, [clientId, toast]);
  useEffect(() => { void load(); }, [load]);

  const toggle = async (s: OfferedSpeed, offered: boolean) => {
    setBusy(s.speedId);
    try {
      const res = await pricingService.setSpeedOffered(s.speedId, offered, clientId);
      setRows((prev) => prev.map((x) => x.speedId === s.speedId ? res.response : x));
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setBusy(null); }
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
  }, [rows, q]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-text-secondary">
          {loading ? 'Loading...' : `${filtered.length} speed${filtered.length === 1 ? '' : 's'}`}
          {clientId != null && ' - ticked means offered on this client\'s scheduled jobs.'}
        </p>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search speeds..."
          className="border border-border rounded-lg px-3 py-1.5 text-xs w-48 bg-surface-white"
        />
      </div>

      <div className="rounded-xl border border-border bg-white max-h-[60vh] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-surface-light sticky top-0">
            <tr className="text-left text-text-secondary">
              <th className="px-3 py-2 font-medium w-16">Offered</th>
              <th className="px-3 py-2 font-medium">Speed</th>
              {clientId != null && <th className="px-3 py-2 font-medium">Globally</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.speedId} className="border-t border-border-light">
                <td className="px-3 py-1.5">
                  <input
                    type="checkbox"
                    checked={s.offeredForClient}
                    disabled={busy === s.speedId}
                    data-testid={`speed-offered-${s.speedId}`}
                    aria-label={`Offer ${s.name}`}
                    onChange={(e) => toggle(s, e.target.checked)}
                    className="w-3.5 h-3.5"
                  />
                </td>
                <td className="px-3 py-1.5 text-text-primary">{s.name}</td>
                {clientId != null && (
                  <td className="px-3 py-1.5 text-text-muted">
                    {s.offeredGlobally ? 'offered' : '-'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {clientId != null && (
        <p className="text-[11px] text-text-muted italic">
          A client with any speeds of its own is offered exactly those, so the global column is
          context rather than a second answer.
        </p>
      )}
    </div>
  );
}
