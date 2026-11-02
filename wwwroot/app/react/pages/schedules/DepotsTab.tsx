import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useAuth } from '../../context/AuthContext';
import {
  territoryService,
  type Depot,
  type DepotClientLimit,
} from '../../services/territoryService';
import { ClientPicker } from '../../components/common/ClientPicker';
import { depotLabel } from '../../lib/tenantLabels';
import { DataTable, type DataTableColumn } from '../../components/common/DataTable';

/**
 * Depots / Locations tab. Lists TblBulkRegion rows and lets operators
 * activate / deactivate a depot inline so the on/off toggle doesn't
 * require a hop to AdminManager. Full depot maintenance (name, address,
 * GPS, audit) still lives in AdminManager - it's the shared surface
 * across ClientManager + AdminManager + DespatchWeb and stays owned
 * there.
 *
 * Picking a client switches the table into the per-client limit editor
 * (`tblBulkRegion_ClientLimit`). That is a SEPARATE switch from the global
 * one: a depot can be on globally and off for one client, and a depot that is
 * off globally is unavailable to everybody whatever the client row says. Both
 * states are shown together rather than one replacing the other, because an
 * operator looking at "off" needs to know which of the two switches did it.
 *
 * Terminology: NZ operators call these "depots"; US operators call the
 * same records "locations". Header + button labels flip via tenantLabels.
 */
export function DepotsTab() {
  const toast = useToast();
  const askConfirm = useConfirm();
  const user = useAuth();
  const isUs = user.isUsTenant;
  const depotSingular = depotLabel(isUs, false);
  const depotPlural = depotLabel(isUs, true);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Per-client limits.
  const [clientLabel, setClientLabel] = useState('');
  const [clientId, setClientId] = useState<number | null>(null);
  const [limits, setLimits] = useState<DepotClientLimit[]>([]);
  const [limitsLoading, setLimitsLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await territoryService.depots();
      setDepots(res.response ?? []);
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const loadLimits = useCallback(async (id: number) => {
    setLimitsLoading(true);
    try {
      const res = await territoryService.depotClientLimits(id);
      setLimits(res.response ?? []);
    } catch (e) { toast.show((e as Error).message, 'error'); setLimits([]); }
    finally { setLimitsLoading(false); }
  }, [toast]);

  useEffect(() => {
    if (clientId == null) { setLimits([]); return; }
    void loadLimits(clientId);
  }, [clientId, loadLimits]);

  /** The rows the table renders: plain depots, or the limit view. */
  const rows = useMemo(() => {
    const source: DepotClientLimit[] = clientId == null
      ? depots.map((d) => ({ ...d, offForClient: false }))
      : limits;
    return source.filter((d) => {
      if (!showInactive && !d.active) return false;
      if (q.trim() && !(d.name ?? '').toLowerCase().includes(q.trim().toLowerCase())) return false;
      return true;
    });
  }, [clientId, depots, limits, q, showInactive]);

  const total = clientId == null ? depots.length : limits.length;
  const offCount = clientId == null ? 0 : limits.filter((l) => l.offForClient).length;

  const splice = (updated: Depot) => {
    setDepots((prev) => {
      const i = prev.findIndex((d) => d.id === updated.id);
      if (i < 0) return prev;
      const copy = prev.slice();
      copy[i] = updated;
      return copy;
    });
  };

  const deactivate = async (d: DepotClientLimit) => {
    const ok = await askConfirm({
      title: `Deactivate ${depotSingular.toLowerCase()}`,
      message: `Hide "${d.name}" from active dropdowns? Existing schedules, postcodes and linehaul runs referencing this ${depotSingular.toLowerCase()} keep working; you can reactivate later.`,
      confirmLabel: 'Deactivate',
      danger: true,
    });
    if (!ok) return;
    setBusyId(d.id);
    try {
      const res = await territoryService.deactivateDepot(d.id);
      splice(res.response);
      if (clientId != null) await loadLimits(clientId);
      toast.show(`${depotSingular} "${d.name}" deactivated`, 'success');
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setBusyId(null); }
  };

  const reactivate = async (d: DepotClientLimit) => {
    setBusyId(d.id);
    try {
      const res = await territoryService.reactivateDepot(d.id);
      splice(res.response);
      if (clientId != null) await loadLimits(clientId);
      toast.show(`${depotSingular} "${d.name}" reactivated`, 'success');
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setBusyId(null); }
  };

  const setLimit = async (d: DepotClientLimit, off: boolean) => {
    if (clientId == null) return;
    setBusyId(d.id);
    try {
      await territoryService.setDepotClientLimit(d.id, { clientId, off });
      setLimits((prev) => prev.map((l) => l.id === d.id ? { ...l, offForClient: off } : l));
      toast.show(
        off
          ? `"${d.name}" switched off for ${clientLabel}`
          : `"${d.name}" switched back on for ${clientLabel}`,
        'success');
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setBusyId(null); }
  };

  const columns: DataTableColumn<DepotClientLimit>[] = [
    { key: 'id', label: 'Id', sortable: true, sortValue: (d) => d.id,
      headerClassName: 'w-16',
      render: (d) => <span className="text-text-muted tabular-nums">{d.id}</span> },
    { key: 'name', label: 'Name', sortable: true, sortValue: (d) => d.name ?? '',
      render: (d) => <span className="font-medium text-text-primary">{d.name ?? '-'}</span> },
    { key: 'status', label: 'Status', sortable: true, sortValue: (d) => d.active ? 1 : 0,
      render: (d) => (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
          d.active ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-700'
        }`}>
          {d.active ? 'Active' : 'Inactive'}
        </span>
      ) },
  ];

  if (clientId != null) {
    columns.push({
      key: 'client', label: `For ${clientLabel}`, sortable: true,
      sortValue: (d) => d.offForClient ? 0 : 1,
      headerClassName: 'w-44',
      render: (d) => (
        <label className="inline-flex items-center gap-2 text-[11px]">
          <input
            type="checkbox"
            checked={!d.offForClient}
            disabled={busyId === d.id || !d.active}
            data-testid={`depot-client-toggle-${d.id}`}
            onChange={(e) => setLimit(d, !e.target.checked)}
            className="w-3.5 h-3.5"
          />
          {!d.active
            ? <span className="text-text-muted">Off everywhere</span>
            : d.offForClient
              ? <span className="text-red-600">Off for this client</span>
              : <span className="text-text-secondary">Available</span>}
        </label>
      ),
    });
  }

  columns.push({
    key: 'actions', label: '', headerClassName: 'w-28 text-right',
    render: (d) => (
      <div className="text-right">
        {d.active ? (
          <button
            type="button"
            disabled={busyId === d.id}
            className="text-[11px] text-red-600 hover:underline disabled:opacity-50"
            onClick={() => deactivate(d)}
          >
            {busyId === d.id ? 'Working...' : 'Deactivate'}
          </button>
        ) : (
          <button
            type="button"
            disabled={busyId === d.id}
            className="text-[11px] text-brand-cyan hover:underline disabled:opacity-50"
            onClick={() => reactivate(d)}
          >
            {busyId === d.id ? 'Working...' : 'Reactivate'}
          </button>
        )}
      </div>
    ),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className="text-xs text-text-secondary">
          {loading || limitsLoading
            ? 'Loading...'
            : `${rows.length} ${rows.length === 1 ? depotSingular.toLowerCase() : depotPlural.toLowerCase()}${q.trim() || !showInactive ? ` (filtered from ${total})` : ''}`}
          {clientId != null && !limitsLoading && (
            <span className="ml-2 text-text-muted">
              {offCount === 0
                ? `No ${depotPlural.toLowerCase()} switched off for ${clientLabel}.`
                : `${offCount} switched off for ${clientLabel}.`}
            </span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <ClientPicker
            value={clientId}
            defaultLabel="All clients (global on/off)"
            testId="depot-client-picker"
            onChange={(id, label) => { setClientId(id); setClientLabel(label ?? ''); }}
          />
          <label className="inline-flex items-center gap-1 text-[11px] text-text-secondary">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="w-3.5 h-3.5" />
            Show inactive
          </label>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search..."
            className="border border-border rounded-lg px-3 py-1.5 text-xs w-48 bg-surface-white focus:outline-none focus:ring-1 focus:ring-brand-cyan"
          />
        </div>
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(d) => d.id}
        loading={loading || limitsLoading}
        emptyMessage={`No ${depotPlural.toLowerCase()} match the current filter.`}
        minWidth="min-w-[500px]"
        defaultSort={{ key: 'name', dir: 'asc' }}
      />

      <p className="mt-2 text-[11px] text-text-muted italic">
        {clientId == null
          ? `Full ${depotSingular.toLowerCase()} maintenance (address, GPS, audit) stays in the AdminManager - this tab surfaces the on/off toggle only.`
          : `Unticking hides this ${depotSingular.toLowerCase()} from ${clientLabel} only. The global switch on the right hides it from everybody, and a ${depotSingular.toLowerCase()} that is off everywhere cannot be turned on for one client.`}
      </p>
    </div>
  );
}
