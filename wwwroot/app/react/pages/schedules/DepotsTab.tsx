import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useAuth } from '../../context/AuthContext';
import { territoryService, type Depot } from '../../services/territoryService';
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

  const load = async () => {
    setLoading(true);
    try {
      const res = await territoryService.depots();
      setDepots(res.response ?? []);
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    return depots.filter((d) => {
      if (!showInactive && !d.active) return false;
      if (q.trim() && !(d.name ?? '').toLowerCase().includes(q.trim().toLowerCase())) return false;
      return true;
    });
  }, [depots, q, showInactive]);

  const splice = (updated: Depot) => {
    setDepots((prev) => {
      const i = prev.findIndex((d) => d.id === updated.id);
      if (i < 0) return prev;
      const copy = prev.slice();
      copy[i] = updated;
      return copy;
    });
  };

  const deactivate = async (d: Depot) => {
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
      toast.show(`${depotSingular} "${d.name}" deactivated`, 'success');
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setBusyId(null); }
  };

  const reactivate = async (d: Depot) => {
    setBusyId(d.id);
    try {
      const res = await territoryService.reactivateDepot(d.id);
      splice(res.response);
      toast.show(`${depotSingular} "${d.name}" reactivated`, 'success');
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setBusyId(null); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className="text-xs text-text-secondary">
          {loading ? 'Loading...' : `${filtered.length} ${filtered.length === 1 ? depotSingular.toLowerCase() : depotPlural.toLowerCase()}${q.trim() || !showInactive ? ` (filtered from ${depots.length})` : ''}`}
        </p>
        <div className="flex items-center gap-2">
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
        rows={filtered}
        columns={[
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
          { key: 'actions', label: '', headerClassName: 'w-28 text-right',
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
            ) },
        ] as DataTableColumn<Depot>[]}
        rowKey={(d) => d.id}
        loading={loading}
        emptyMessage={`No ${depotPlural.toLowerCase()} match the current filter.`}
        minWidth="min-w-[500px]"
        defaultSort={{ key: 'name', dir: 'asc' }}
      />

      <p className="mt-2 text-[11px] text-text-muted italic">
        Full {depotSingular.toLowerCase()} maintenance (address, GPS, audit) stays in the AdminManager - this tab surfaces the on/off toggle only.
      </p>
    </div>
  );
}
