import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import {
  scheduleService,
  type ScheduleGroup,
  type ScheduleLookups,
} from '../../services/scheduleService';
import { RowActionsMenu } from '../../components/tenant/RowActionsMenu';
import { ScheduleEditModal } from '../../components/schedules/ScheduleEditModal';
import { ScheduleCopyModal } from '../../components/schedules/ScheduleCopyModal';
import { DataTable, type DataTableColumn } from '../../components/common/DataTable';

// One row per schedule GROUP (all tblBulkRunSchedule rows sharing Name +
// LegacyClientId). Day-of-week chip strip shows which days have windows
// on the group.

const DAY_LABELS_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

function DayChips({ activeDays }: { activeDays: Set<number> }) {
  return (
    <div className="flex gap-0.5">
      {DAY_LABELS_SHORT.map((d, i) => {
        const active = activeDays.has(i + 1);
        return (
          <span
            key={i}
            className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-semibold ${
              active ? 'bg-brand-cyan/15 text-brand-cyan' : 'bg-surface-cream text-text-muted'
            }`}
            title={active ? 'Active' : 'Inactive'}
          >
            {d}
          </span>
        );
      })}
    </div>
  );
}

export function SchedulesTab() {
  const toast = useToast();
  const askConfirm = useConfirm();
  const [groups, setGroups] = useState<ScheduleGroup[]>([]);
  const [lookups, setLookups] = useState<ScheduleLookups | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<ScheduleGroup | 'new' | null>(null);
  /** Copy modal source. Null = closed. Modal builds a new group named
   *  `<source> (copy)` bound to the source's clients by default; operator
   *  can rename + reassign before creating. */
  const [copying, setCopying] = useState<ScheduleGroup | null>(null);
  const [clientCodeFilter, setClientCodeFilter] = useState<string | undefined>(undefined);
  const [clientInput, setClientInput] = useState('');

  const load = async (clientCode?: string) => {
    setLoading(true);
    try {
      const [listRes, lookupRes] = await Promise.all([
        scheduleService.list({ clientCode }),
        scheduleService.lookups(),
      ]);
      setGroups(listRes.response ?? []);
      setLookups(lookupRes.response);
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(clientCodeFilter); }, [clientCodeFilter]);

  useEffect(() => {
    if (groups.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const editName = params.get('edit');
    if (!editName) return;
    const target = groups.find((g) => g.name === editName && g.legacyClientId == null)
      ?? groups.find((g) => g.name === editName);
    if (target) {
      setEditing(target);
      params.delete('edit');
      const nextQs = params.toString();
      const nextUrl = window.location.pathname + (nextQs ? `?${nextQs}` : '') + window.location.hash;
      window.history.replaceState(null, '', nextUrl);
    }
  }, [groups]);

  const applyClientFilter = () => {
    const trimmed = clientInput.trim();
    setClientCodeFilter(trimmed || undefined);
  };
  const clearClientFilter = () => { setClientInput(''); setClientCodeFilter(undefined); };

  const filtered = useMemo(() => {
    if (!q.trim()) return groups;
    const needle = q.trim().toLowerCase();
    return groups.filter((g) =>
      (g.name ?? '').toLowerCase().includes(needle) ||
      (g.description ?? '').toLowerCase().includes(needle) ||
      (g.regionName ?? '').toLowerCase().includes(needle) ||
      (g.speedName ?? '').toLowerCase().includes(needle));
  }, [groups, q]);

  const toggleAutoBook = async (g: ScheduleGroup) => {
    try {
      const res = await scheduleService.toggleAutoBook(g.name ?? '', g.legacyClientId);
      setGroups((prev) => prev.map((x) =>
        x.name === g.name && x.legacyClientId === g.legacyClientId
          ? { ...x, autoBook: res.response.autoBook } : x));
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  const removeGroup = async (g: ScheduleGroup) => {
    const ok = await askConfirm({
      title: 'Delete schedule group?',
      message: `Delete "${g.name}"? This removes all ${g.dayWindows.length} day-window row${g.dayWindows.length === 1 ? '' : 's'} plus zone activation, linehaul legs, and every client / postcode / polygon binding. Cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await scheduleService.remove(g.name ?? '', g.legacyClientId);
      setGroups((prev) => prev.filter((x) => !(x.name === g.name && x.legacyClientId === g.legacyClientId)));
      toast.show('Schedule deleted', 'success');
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  const onSaved = (row: ScheduleGroup) => {
    setGroups((prev) => {
      const idx = prev.findIndex((x) => x.name === row.name && x.legacyClientId === row.legacyClientId);
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = row;
        return next;
      }
      return [...prev, row];
    });
  };

  const columns: DataTableColumn<ScheduleGroup>[] = [
    {
      key: 'name', label: 'Name', sortable: true,
      sortValue: (g) => g.name ?? '',
      render: (g) => (
        <span className="font-medium text-text-primary">
          {g.name}
          {g.legacyClientId != null && (
            <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-brand-orange/15 text-brand-orange"
              title={`Legacy per-client override (client id ${g.legacyClientId})`}>
              {g.legacyClientCode ?? `#${g.legacyClientId}`}
            </span>
          )}
        </span>
      ),
    },
    { key: 'region', label: 'Destination', sortable: true, sortValue: (g) => g.regionName ?? '',
      render: (g) => <span className="text-text-secondary">{g.regionName ?? '-'}</span> },
    { key: 'speed', label: 'Speed', sortable: true, sortValue: (g) => g.speedName ?? '',
      render: (g) => <span className="text-text-secondary">{g.speedName ?? '-'}</span> },
    { key: 'days', label: 'Mon-Sun', sortable: true,
      // Sort by count of active days as a reasonable proxy - operators
      // grouping "which schedules run daily" find that useful.
      sortValue: (g) => g.dayWindows.length,
      render: (g) => <DayChips activeDays={new Set(g.dayWindows.map((w) => w.dayOfWeek))} /> },
    { key: 'clients', label: 'Clients', sortable: true, align: 'right',
      sortValue: (g) => g.clientIds.length,
      render: (g) => <span className="text-text-primary font-semibold">{g.clientIds.length}</span> },
    { key: 'postcodes', label: 'Postcodes', sortable: true, align: 'right',
      sortValue: (g) => g.postcodeIds.length,
      render: (g) => <span className="text-text-primary font-semibold">{g.postcodeIds.length}</span> },
    { key: 'polygons', label: 'Polygons', sortable: true, align: 'right',
      sortValue: (g) => g.polygonIds.length,
      render: (g) => <span className="text-text-primary font-semibold">{g.polygonIds.length}</span> },
    { key: 'zones', label: 'Zones', sortable: true, align: 'right',
      sortValue: (g) => g.zones.filter((z) => z.active === true).length,
      render: (g) => <span className="text-text-primary font-semibold">{g.zones.filter((z) => z.active === true).length}</span> },
    { key: 'autoBook', label: 'Auto Book', sortable: true,
      sortValue: (g) => g.autoBook ? 1 : 0,
      render: (g) => (
        <button
          type="button"
          title="Toggle Auto Book"
          onClick={(e) => { e.stopPropagation(); void toggleAutoBook(g); }}
          className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium hover:opacity-80 ${
            g.autoBook ? 'bg-green-100 text-green-800' : 'bg-surface-cream text-text-muted'
          }`}
        >
          {g.autoBook ? 'On' : 'Off'}
        </button>
      ),
    },
    { key: 'linehaul', label: 'Linehaul', sortable: true,
      sortValue: (g) => g.linehauls.some((l) => l.active === true) ? 1 : 0,
      render: (g) => {
        const has = g.linehauls.some((l) => l.active === true);
        return (
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
            has ? 'bg-brand-cyan/15 text-brand-cyan' : 'bg-surface-cream text-text-muted'
          }`}>
            {has ? 'Yes' : 'No'}
          </span>
        );
      },
    },
    { key: 'actions', label: 'Actions', align: 'right',
      render: (g) => (
        <RowActionsMenu
          actions={[
            { label: 'Edit', onClick: () => setEditing(g) },
            { label: 'Copy...', onClick: () => setCopying(g) },
            { label: g.autoBook ? 'Disable Auto Book' : 'Enable Auto Book', onClick: () => toggleAutoBook(g) },
            { label: 'Delete', onClick: () => removeGroup(g), danger: true },
          ]}
        />
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className="text-xs text-text-secondary">
          {loading ? 'Loading...' : `${filtered.length} schedule group${filtered.length === 1 ? '' : 's'}${q.trim() ? ` (filtered from ${groups.length})` : ' configured'}`}
          {clientCodeFilter !== undefined && (
            <span className="ml-2 text-text-muted">Client: <span className="font-semibold text-text-secondary">{clientCodeFilter}</span></span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={clientInput}
            onChange={(e) => setClientInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyClientFilter()}
            placeholder="Client Code"
            title="Filter by client code (blank = default schedules)"
            className="border border-border rounded-lg px-3 py-1.5 text-xs w-28 bg-surface-white focus:outline-none focus:ring-1 focus:ring-brand-cyan uppercase"
          />
          <button
            onClick={applyClientFilter}
            className="border border-border rounded-lg px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-cream"
            type="button"
          >
            Load
          </button>
          {clientCodeFilter !== undefined && (
            <button onClick={clearClientFilter} className="text-[11px] text-text-muted hover:text-text-primary underline" type="button">
              Clear
            </button>
          )}
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search schedules..."
            className="border border-border rounded-lg px-3 py-1.5 text-xs w-56 bg-surface-white focus:outline-none focus:ring-1 focus:ring-brand-cyan"
          />
          <button
            onClick={() => setEditing('new')}
            className="bg-brand-cyan text-[#0d0c2c] font-medium px-3 py-1.5 rounded-full text-xs hover:shadow-cyan-glow transition-shadow"
          >
            + Add Schedule
          </button>
        </div>
      </div>

      <DataTable
        rows={filtered}
        columns={columns}
        rowKey={(g) => `${g.name}::${g.legacyClientId ?? 'default'}`}
        onRowClick={(g) => setEditing(g)}
        loading={loading}
        emptyMessage={'No schedules yet. Click "+ Add Schedule" to create one.'}
        minWidth="min-w-[1000px]"
        defaultSort={{ key: 'name', dir: 'asc' }}
      />

      {editing !== null && (
        <ScheduleEditModal
          open={true}
          group={editing === 'new' ? null : editing}
          lookups={lookups}
          onClose={() => setEditing(null)}
          onSaved={(row) => { onSaved(row); setEditing(null); }}
        />
      )}

      {copying !== null && (
        <ScheduleCopyModal
          open={true}
          source={copying}
          lookups={lookups}
          onClose={() => setCopying(null)}
          onCopied={(row) => {
            // Insert the copy into the list, close copy modal, open the
            // new group in edit mode so the operator can review + tweak.
            onSaved(row);
            setCopying(null);
            setEditing(row);
          }}
        />
      )}
    </div>
  );
}
