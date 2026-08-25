import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useAuth } from '../../context/AuthContext';
import {
  territoryService,
  type TerritoryBootstrap,
  type NzPostcode,
  type UsZipZone,
  type NzPostcodeUpsertBody,
  type UsZipZoneUpsertBody,
} from '../../services/territoryService';
import { RowActionsMenu } from '../../components/tenant/RowActionsMenu';
import { Modal } from '../../components/common/Modal';
import { Button } from '../../components/common/Button';
import { DataTable, type DataTableColumn } from '../../components/common/DataTable';
import { depotLabel, postcodeLabel, postcodeGroupLabel } from '../../lib/tenantLabels';

// Tenant-switched Zones tab. NZ path edits BulkZonePostcode rows; US path
// edits ZoneZip rows. The two sub-grids share the same shell (search,
// depot filter, table) but different columns + upsert forms.

export function ZonesTab() {
  const toast = useToast();
  const askConfirm = useConfirm();
  const user = useAuth();
  const tenantIsUs = user.isUsTenant;
  // Tenant-aware labels: "Postcode/Zip", "Depot/Location",
  // "Postcode Group / Zip Group". Table headers + buttons + placeholders
  // all read from these so the UI reads naturally on both tenants.
  const postcodeSingular = postcodeLabel(tenantIsUs, true);
  const depotSingular = depotLabel(tenantIsUs, false);
  const groupSingular = postcodeGroupLabel(tenantIsUs, false);
  const [bootstrap, setBootstrap] = useState<TerritoryBootstrap | null>(null);
  const [loading, setLoading] = useState(false);
  const [depotFilter, setDepotFilter] = useState<number | 'all'>('all');
  const [q, setQ] = useState('');
  const [editingNz, setEditingNz] = useState<NzPostcode | 'new' | null>(null);
  const [editingUs, setEditingUs] = useState<UsZipZone | 'new' | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await territoryService.bootstrap();
      setBootstrap(res.response);
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const isUs = bootstrap?.countryCode === 'US';

  const filteredNz = useMemo(() => {
    if (!bootstrap) return [];
    const needle = q.trim();
    return bootstrap.nzPostcodes.filter((p) => {
      if (depotFilter !== 'all' && p.depotId !== depotFilter) return false;
      if (needle && !String(p.postCode).includes(needle)) return false;
      return true;
    });
  }, [bootstrap, depotFilter, q]);

  const filteredUs = useMemo(() => {
    if (!bootstrap) return [];
    const needle = q.trim().toLowerCase();
    return bootstrap.usZipZones.filter((z) => {
      if (needle && !(z.zip ?? '').toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [bootstrap, q]);

  const deleteNz = async (p: NzPostcode) => {
    if (!(await askConfirm({ message: `Delete ${postcodeSingular.toLowerCase()} ${p.postCode}?`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await territoryService.removeNzPostcode(p.id);
      await load();
      toast.show(`${postcodeSingular} deleted`, 'success');
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };
  const deleteUs = async (z: UsZipZone) => {
    if (!(await askConfirm({ message: `Delete ${postcodeSingular.toLowerCase()} ${z.zip}?`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await territoryService.removeUsZipZone(z.id);
      await load();
      toast.show(`${postcodeSingular} deleted`, 'success');
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  const count = isUs ? filteredUs.length : filteredNz.length;
  const total = isUs ? (bootstrap?.usZipZones.length ?? 0) : (bootstrap?.nzPostcodes.length ?? 0);
  const noun = postcodeSingular.toLowerCase();

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className="text-xs text-text-secondary">
          {loading ? 'Loading...' : `${count} ${noun}${count === 1 ? '' : 's'}${q.trim() || depotFilter !== 'all' ? ` (filtered from ${total})` : ''}`}
          {bootstrap && <span className="ml-2 text-text-muted">Tenant: <span className="font-semibold text-text-secondary">{bootstrap.countryCode}</span></span>}
        </p>
        <div className="flex items-center gap-2">
          {!isUs && (
            <select
              value={depotFilter === 'all' ? '' : String(depotFilter)}
              onChange={(e) => setDepotFilter(e.target.value ? Number(e.target.value) : 'all')}
              className="border border-border rounded-lg px-2 py-1.5 text-xs bg-surface-white focus:outline-none focus:ring-1 focus:ring-brand-cyan"
            >
              <option value="">All {depotLabel(tenantIsUs, true).toLowerCase()}</option>
              {(bootstrap?.depots ?? []).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          )}
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${postcodeSingular.toLowerCase()}...`}
            className="border border-border rounded-lg px-3 py-1.5 text-xs w-48 bg-surface-white focus:outline-none focus:ring-1 focus:ring-brand-cyan"
          />
          <button
            onClick={() => (isUs ? setEditingUs('new') : setEditingNz('new'))}
            className="bg-brand-cyan text-[#0d0c2c] font-medium px-3 py-1.5 rounded-full text-xs hover:shadow-cyan-glow transition-shadow"
          >
            + Add {postcodeSingular}
          </button>
        </div>
      </div>

      {isUs ? (
        <DataTable
          rows={filteredUs}
          columns={[
            { key: 'zip', label: 'Zip', sortable: true, sortValue: (z) => z.zip ?? '',
              render: (z) => <span className="font-mono text-text-primary">{z.zip}</span> },
            { key: 'zone', label: 'Zone', sortable: true, align: 'right',
              sortValue: (z) => z.zoneNumber ?? 999999,
              render: (z) => <span className="text-text-secondary">{z.zoneNumber ?? '-'}</span> },
            { key: 'zoneName', label: 'Zone Name', sortable: true, sortValue: (z) => z.zoneName ?? '',
              render: (z) => <span className="text-text-secondary">{z.zoneName ?? '-'}</span> },
            { key: 'zoneGroup', label: 'Zone Group', sortable: true, sortValue: (z) => z.zoneGroupName ?? '',
              render: (z) => <span className="text-text-secondary">{z.zoneGroupName ?? '-'}</span> },
            { key: 'postcodeGroup', label: groupSingular, sortable: true, sortValue: (z) => z.postcodeGroupName ?? '',
              render: (z) => <span className="text-text-secondary">{z.postcodeGroupName ?? '-'}</span> },
            { key: 'congestion', label: 'Congestion', sortable: true,
              sortValue: (z) => z.applyCongestion ? 1 : 0,
              render: (z) => (
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                  z.applyCongestion ? 'bg-brand-orange/15 text-brand-orange' : 'bg-surface-cream text-text-muted'
                }`}>
                  {z.applyCongestion ? 'Yes' : 'No'}
                </span>
              ) },
            { key: 'actions', label: 'Actions', align: 'right',
              render: (z) => (
                <RowActionsMenu
                  actions={[
                    { label: 'Edit', onClick: () => setEditingUs(z) },
                    { label: 'Delete', onClick: () => deleteUs(z), danger: true },
                  ]}
                />
              ) },
          ] as DataTableColumn<UsZipZone>[]}
          rowKey={(z) => z.id}
          onRowClick={(z) => setEditingUs(z)}
          loading={loading}
          emptyMessage={`No ${postcodeSingular.toLowerCase()}s yet. Click "+ Add ${postcodeSingular}" to create one.`}
          minWidth="min-w-[800px]"
          defaultSort={{ key: 'zip', dir: 'asc' }}
        />
      ) : (
        <DataTable
          rows={filteredNz}
          columns={[
            { key: 'postcode', label: postcodeSingular, sortable: true, sortValue: (p) => p.postCode,
              render: (p) => <span className="font-mono text-text-primary">{String(p.postCode).padStart(4, '0')}</span> },
            { key: 'zone', label: 'Zone', sortable: true, align: 'right', sortValue: (p) => p.zone,
              render: (p) => <span className="text-text-secondary">{p.zone}</span> },
            { key: 'depot', label: depotSingular, sortable: true, sortValue: (p) => p.depotName ?? '',
              render: (p) => <span className="text-text-secondary">{p.depotName ?? '-'}</span> },
            { key: 'postcodeGroup', label: groupSingular, sortable: true, sortValue: (p) => p.postcodeGroupName ?? '',
              render: (p) => <span className="text-text-secondary">{p.postcodeGroupName ?? '-'}</span> },
            { key: 'name', label: 'Name', sortable: true, sortValue: (p) => p.name ?? '',
              render: (p) => <span className="text-text-secondary">{p.name ?? '-'}</span> },
            { key: 'actions', label: 'Actions', align: 'right',
              render: (p) => (
                <RowActionsMenu
                  actions={[
                    { label: 'Edit', onClick: () => setEditingNz(p) },
                    { label: 'Delete', onClick: () => deleteNz(p), danger: true },
                  ]}
                />
              ) },
          ] as DataTableColumn<NzPostcode>[]}
          rowKey={(p) => p.id}
          onRowClick={(p) => setEditingNz(p)}
          loading={loading}
          emptyMessage={`No ${postcodeSingular.toLowerCase()}s yet. Click "+ Add ${postcodeSingular}" to create one.`}
          minWidth="min-w-[700px]"
          defaultSort={{ key: 'postcode', dir: 'asc' }}
        />
      )}

      {editingNz !== null && (
        <NzPostcodeEditModal
          row={editingNz === 'new' ? null : editingNz}
          bootstrap={bootstrap}
          onClose={() => setEditingNz(null)}
          onSaved={async () => { setEditingNz(null); await load(); }}
        />
      )}
      {editingUs !== null && (
        <UsZipZoneEditModal
          row={editingUs === 'new' ? null : editingUs}
          bootstrap={bootstrap}
          onClose={() => setEditingUs(null)}
          onSaved={async () => { setEditingUs(null); await load(); }}
        />
      )}
    </div>
  );
}

// ─── NZ Postcode edit modal ─────────────────────────────────────────────

function NzPostcodeEditModal({
  row, bootstrap, onClose, onSaved,
}: {
  row: NzPostcode | null;
  bootstrap: TerritoryBootstrap | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const user = useAuth();
  const isUs = user.isUsTenant;
  const postcodeSingular = postcodeLabel(isUs, true);
  const depotSingular = depotLabel(isUs, false);
  const groupSingular = postcodeGroupLabel(isUs, false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<NzPostcodeUpsertBody>(() => ({
    postCode: row?.postCode ?? 0,
    zone: row?.zone ?? 0,
    depotId: row?.depotId ?? null,
    postcodeGroupId: row?.postcodeGroupId ?? null,
    fromSiteId: row?.fromSiteId ?? 0,
    name: row?.name ?? '',
    fromLatLng: row?.fromLatLng ?? '',
  }));

  const save = async () => {
    setSaving(true);
    try {
      if (row) await territoryService.updateNzPostcode(row.id, form);
      else await territoryService.createNzPostcode(form);
      toast.show(row ? 'Postcode updated' : 'Postcode created', 'success');
      onSaved();
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setSaving(false); }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={row ? `Edit ${postcodeSingular.toLowerCase()} ${row.postCode}` : `New ${postcodeSingular.toLowerCase()}`}
      size="2xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="secondary" data-primary="true" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : (row ? 'Save' : 'Create')}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Fld label={postcodeSingular} required>
          <input type="number" className={INPUT_CLASS} value={form.postCode || ''}
            onChange={(e) => setForm({ ...form, postCode: Number(e.target.value) })} />
        </Fld>
        <Fld label="Zone">
          <input type="number" className={INPUT_CLASS} value={form.zone}
            onChange={(e) => setForm({ ...form, zone: Number(e.target.value) })} />
        </Fld>
        <Fld label={depotSingular}>
          <select className={INPUT_CLASS} value={form.depotId ?? ''}
            onChange={(e) => setForm({ ...form, depotId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">-</option>
            {(bootstrap?.depots ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Fld>
        <Fld label={groupSingular}>
          <select className={INPUT_CLASS} value={form.postcodeGroupId ?? ''}
            onChange={(e) => setForm({ ...form, postcodeGroupId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">-</option>
            {(bootstrap?.postcodeGroups ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Fld>
        <Fld label="Name">
          <input className={INPUT_CLASS} value={form.name ?? ''}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Fld>
        {/* FromSiteId + FromLatLng are geocoding-pipeline-owned fields
            on BulkZonePostcode (the mapping worker sets them from the
            depot's warehouse coords). Not operator-editable in the
            legacy ClientManager modal either - preserve existing
            values on save via the form state but hide the inputs. */}
      </div>
    </Modal>
  );
}

// ─── US Zip Zone edit modal ─────────────────────────────────────────────

function UsZipZoneEditModal({
  row, bootstrap, onClose, onSaved,
}: {
  row: UsZipZone | null;
  bootstrap: TerritoryBootstrap | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const user = useAuth();
  const groupSingular = postcodeGroupLabel(user.isUsTenant, false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<UsZipZoneUpsertBody>(() => ({
    zip: row?.zip ?? '',
    zoneNumber: row?.zoneNumber ?? null,
    zoneNameId: row?.zoneNameId ?? null,
    zoneZipGroupId: row?.postcodeGroupId ?? null,
    applyCongestion: row?.applyCongestion ?? null,
    clientId: null,
  }));

  const save = async () => {
    setSaving(true);
    try {
      if (row) await territoryService.updateUsZipZone(row.id, form);
      else await territoryService.createUsZipZone(form);
      toast.show(row ? 'Zip updated' : 'Zip created', 'success');
      onSaved();
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setSaving(false); }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={row ? `Edit zip ${row.zip}` : 'New zip'}
      size="2xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="secondary" data-primary="true" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : (row ? 'Save' : 'Create')}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Fld label="Zip" required>
          <input className={INPUT_CLASS} value={form.zip}
            onChange={(e) => setForm({ ...form, zip: e.target.value })} />
        </Fld>
        <Fld label="Zone Number">
          <input type="number" className={INPUT_CLASS} value={form.zoneNumber ?? ''}
            onChange={(e) => setForm({ ...form, zoneNumber: e.target.value ? Number(e.target.value) : null })} />
        </Fld>
        <Fld label="Zone Name">
          <select className={INPUT_CLASS} value={form.zoneNameId ?? ''}
            onChange={(e) => setForm({ ...form, zoneNameId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">-</option>
            {(bootstrap?.zoneNames ?? []).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        </Fld>
        <Fld label={groupSingular}>
          <select className={INPUT_CLASS} value={form.zoneZipGroupId ?? ''}
            onChange={(e) => setForm({ ...form, zoneZipGroupId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">-</option>
            {(bootstrap?.postcodeGroups ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Fld>
        <Fld label="Apply Congestion">
          <label className="inline-flex items-center gap-2 text-sm py-1.5">
            <input type="checkbox" checked={form.applyCongestion ?? false}
              onChange={(e) => setForm({ ...form, applyCongestion: e.target.checked })} />
            Enabled
          </label>
        </Fld>
      </div>
    </Modal>
  );
}

// ─── shared small bits ─────────────────────────────────────────────────

const INPUT_CLASS =
  'w-full border border-border rounded-lg px-2 py-1.5 text-sm bg-surface-white focus:outline-none focus:ring-1 focus:ring-brand-cyan';

function Fld({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-text-muted mb-0.5">
        {label}{required && <span className="text-red-600"> *</span>}
      </div>
      {children}
    </div>
  );
}
