import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { territoryService, type Depot } from '../../services/territoryService';
import { depotLabel } from '../../lib/tenantLabels';
import { DataTable, type DataTableColumn } from '../../components/common/DataTable';

/**
 * Depots / Locations tab. Read-only listing of TblBulkRegion rows.
 * Depot CRUD lives in the legacy ClientManager UI (region management is
 * a shared concern across ClientManager + AdminManager + DespatchWeb -
 * the handover doc scopes this module to schedules + zones + zone groups
 * territory, so we surface depots here for reference only).
 *
 * Terminology: NZ operators call these "depots"; US operators call the
 * same records "locations". Header uses both.
 */
export function DepotsTab() {
  const toast = useToast();
  const user = useAuth();
  const isUs = user.isUsTenant;
  const depotSingular = depotLabel(isUs, false);
  const depotPlural = depotLabel(isUs, true);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await territoryService.depots();
        setDepots(res.response ?? []);
      } catch (e) { toast.show((e as Error).message, 'error'); }
      finally { setLoading(false); }
    })();
  }, []);

  const filtered = useMemo(() => {
    return depots.filter((d) => {
      if (!showInactive && !d.active) return false;
      if (q.trim() && !(d.name ?? '').toLowerCase().includes(q.trim().toLowerCase())) return false;
      return true;
    });
  }, [depots, q, showInactive]);

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
        ] as DataTableColumn<Depot>[]}
        rowKey={(d) => d.id}
        loading={loading}
        emptyMessage={`No ${depotPlural.toLowerCase()} match the current filter.`}
        minWidth="min-w-[500px]"
        defaultSort={{ key: 'name', dir: 'asc' }}
      />

      <p className="mt-2 text-[11px] text-text-muted italic">
        {depotPlural} are read-only here. Add or edit {depotPlural.toLowerCase()} in the legacy ClientManager (region maintenance is shared across apps).
      </p>
    </div>
  );
}
