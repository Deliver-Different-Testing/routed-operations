import { useEffect, useState } from 'react';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useAuth } from '../../context/AuthContext';
import { depotLabel, postcodeGroupLabel } from '../../lib/tenantLabels';
import {
  territoryService,
  postcodeGroupScope,
  type TerritoryBootstrap,
  type PostcodeGroup,
  type ZoneNameRow,
  type ZoneGroupRow,
  type PostcodeGroupUpsertBody,
  type ZoneNameUpsertBody,
  type ZoneGroupUpsertBody,
  type ZoneZipPasteResult,
} from '../../services/territoryService';
import { RowActionsMenu } from '../../components/tenant/RowActionsMenu';
import { Modal } from '../../components/common/Modal';
import { Button } from '../../components/common/Button';
import { StatusBadge } from '../../components/common/StatusBadge';
import { DataTable, type DataTableColumn } from '../../components/common/DataTable';
import { BindPolygonsModal } from '../../components/territory/BindPolygonsModal';
import { PostcodeGroupDetailModal, type ScheduleSide } from '../../components/territory/PostcodeGroupDetailModal';

// Zone Groups tab. Three sub-grids. Same shell as SchedulesTab /
// ZonesTab: white rounded-xl container, surface-cream header row,
// kebab-menu row actions, cyan pill "Add" buttons.

export function ZoneGroupsTab() {
  const toast = useToast();
  const askConfirm = useConfirm();
  const user = useAuth();
  const tenantIsUs = user.isUsTenant;
  // Tenant-aware labels. "Postcode Group" (NZ) vs "Zip Group" (US),
  // "Depot" (NZ) vs "Location" (US). US Zone Groups + Zone Names are
  // US-only concepts so their labels don't switch.
  const groupPlural = postcodeGroupLabel(tenantIsUs, true);
  const groupSingular = postcodeGroupLabel(tenantIsUs, false);
  const depotSingular = depotLabel(tenantIsUs, false);
  const [bootstrap, setBootstrap] = useState<TerritoryBootstrap | null>(null);
  const [loading, setLoading] = useState(false);

  const [editingPg, setEditingPg] = useState<PostcodeGroup | 'new' | null>(null);
  const [editingZn, setEditingZn] = useState<ZoneNameRow | 'new' | null>(null);
  const [editingZg, setEditingZg] = useState<ZoneGroupRow | 'new' | null>(null);
  // Bulk ZIP add. The Zones tab adds one per request, which is 602 form
  // submissions for Cheetah's Hub Group file (US coverage spec 5.3).
  const [pastingZips, setPastingZips] = useState<ZoneNameRow | null>(null);
  // Row click opens the DETAIL view; the small identity editor stays on
  // the kebab menu. Clicking a row used to open the 3-field editor, which
  // told an operator nothing about what the group was actually doing.
  //
  // `side` carries which number was clicked, so a Delivery count opens the
  // delivery list and a Pickup count opens the pickup list (Steve, 22 Oct:
  // "the count and the list agree"). Clicking the row itself shows both.
  const [detailPg, setDetailPg] = useState<{ id: number; side: ScheduleSide } | null>(null);
  const openDetail = (id: number, side: ScheduleSide = 'all') => setDetailPg({ id, side });

  const [bindingTarget, setBindingTarget] = useState<
    | { kind: 'zoneName'; id: number; label: string }
    | { kind: 'postcodeGroup'; id: number; label: string }
    | null
  >(null);

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

  const deletePg = async (g: PostcodeGroup) => {
    if (!(await askConfirm({ message: `Delete "${g.name}"?`, confirmLabel: 'Delete', danger: true }))) return;
    try { await territoryService.removePostcodeGroup(g.id); await load(); toast.show(`${groupSingular} deleted`, 'success'); }
    catch (e) { toast.show((e as Error).message, 'error'); }
  };
  const deleteZn = async (n: ZoneNameRow) => {
    if (!(await askConfirm({ message: `Delete zone name "${n.name}"?`, confirmLabel: 'Delete', danger: true }))) return;
    try { await territoryService.removeZoneName(n.id); await load(); toast.show('Deleted', 'success'); }
    catch (e) { toast.show((e as Error).message, 'error'); }
  };
  const deleteZg = async (g: ZoneGroupRow) => {
    if (!(await askConfirm({ message: `Delete zone group "${g.name}"?`, confirmLabel: 'Delete', danger: true }))) return;
    try { await territoryService.removeZoneGroup(g.id); await load(); toast.show('Deleted', 'success'); }
    catch (e) { toast.show((e as Error).message, 'error'); }
  };

  return (
    <div className="space-y-4">
      {/* ── Postcode groups (NZ only) ───────────────────────────────────
             Hidden on US, per Steve 23 Oct. A US schedule resolves
             zip -> ZoneName -> LocationId and never reads
             BulkZonePostcodeGroup, so the section manages nothing there
             and its Add button invites a group that would do nothing.

             Gated on the TENANT, not on the row count, which is the part
             that matters: a fresh NZ tenant with no groups yet has to
             keep the section so it can create its first one. Reading
             `tenantIsUs` (the CountryCode claim, delivered with the page)
             rather than the bootstrap's countryCode so the section never
             renders and then vanishes once territory loads. Both derive
             from the same claim; see HomeController and TerritoryService. */}
      {!tenantIsUs && (
      <section>
        <div className="flex items-center justify-between mb-2 gap-2">
          <div>
            <p className="text-xs text-text-secondary">
              <span className="font-semibold text-text-primary">{groupPlural}</span>
              <span className="mx-2 text-text-muted">·</span>
              {loading ? 'Loading...' : `${bootstrap?.postcodeGroups.length ?? 0} group${(bootstrap?.postcodeGroups.length ?? 0) === 1 ? '' : 's'}`}
            </p>
            <p className="text-[11px] text-text-muted mt-0.5">
              Named clusters shared by schedules + rating. Same rows the Zones tab's "{groupSingular}" column references.
              A schedule can point at a group for its delivery coverage, its pickup coverage, or both, which is why the two are counted apart.
            </p>
          </div>
          <button
            onClick={() => setEditingPg('new')}
            className="bg-brand-cyan text-[#0d0c2c] font-medium px-3 py-1.5 rounded-full text-xs hover:shadow-cyan-glow transition-shadow"
          >
            + Add {groupSingular}
          </button>
        </div>
        <DataTable
          rows={bootstrap?.postcodeGroups ?? []}
          columns={[
            { key: 'name', label: 'Name', sortable: true, sortValue: (g) => g.name ?? '',
              render: (g) => <span className="font-medium text-text-primary">{g.name}</span> },
            // Derived, not stored. There is no Type column on the table;
            // which of client and depot is set is the only distinction the
            // data carries, and it is the one operators ask about.
            { key: 'type', label: 'Type', sortable: true, sortValue: (g) => postcodeGroupScope(g),
              render: (g) => postcodeGroupScope(g) === 'client'
                ? <StatusBadge label="Client" kind="info" />
                : <StatusBadge label="Default" kind="default" /> },
            { key: 'depot', label: depotSingular, sortable: true, sortValue: (g) => g.depotName ?? '',
              render: (g) => <span className="text-text-secondary">{g.depotName ?? 'any'}</span> },
            { key: 'client', label: 'Client', sortable: true, sortValue: (g) => g.clientCode ?? '',
              render: (g) => (
                <span className="text-text-secondary" title={g.clientId ? `Client id ${g.clientId}` : ''}>
                  {g.clientCode ?? (g.clientId ? `#${g.clientId}` : '-')}
                </span>
              ) },
            { key: 'zones', label: 'Zones', sortable: true, align: 'right', sortValue: (g) => g.zoneCount,
              render: (g) => <span className="text-text-primary">{g.zoneCount}</span> },
            { key: 'codes', label: 'Codes', sortable: true, align: 'right', sortValue: (g) => g.postcodeCount,
              render: (g) => <span className="text-text-primary font-semibold">{g.postcodeCount}</span> },
            { key: 'polygons', label: 'Polygons', sortable: true, align: 'right', sortValue: (g) => g.polygonCount,
              render: (g) => (
                <span className={g.polygonCount === 0 ? 'text-text-muted' : 'text-text-primary'}>
                  {g.polygonCount}
                </span>
              ) },
            // Two columns, not one total. Plenty of groups are pickup-only
            // ("PU Regional Tauranga Z1" is 0 delivery / 329 pickup day
            // rows on Urgent production) and a single figure shows them as
            // unused, which invites someone to change or delete them.
            { key: 'delSchedules', label: 'Delivery', sortable: true, align: 'right',
              sortValue: (g) => g.deliveryScheduleCount,
              render: (g) => (
                <CountLink
                  value={g.deliveryScheduleCount}
                  title={`Delivery schedules using ${g.name ?? 'this group'}`}
                  onClick={() => openDetail(g.id, 'delivery')}
                />
              ) },
            { key: 'pickSchedules', label: 'Pickup', sortable: true, align: 'right',
              sortValue: (g) => g.pickupScheduleCount,
              render: (g) => (
                <CountLink
                  value={g.pickupScheduleCount}
                  title={`Pickup schedules using ${g.name ?? 'this group'}`}
                  onClick={() => openDetail(g.id, 'pickup')}
                />
              ) },
            { key: 'actions', label: 'Actions', align: 'right',
              render: (g) => (
                <RowActionsMenu
                  actions={[
                    { label: 'Open', onClick: () => openDetail(g.id) },
                    { label: 'Edit', onClick: () => setEditingPg(g) },
                    { label: 'Bind Polygons', onClick: () => setBindingTarget({ kind: 'postcodeGroup', id: g.id, label: g.name ?? '' }) },
                    { label: 'Delete', onClick: () => deletePg(g), danger: true },
                  ]}
                />
              ) },
          ] as DataTableColumn<PostcodeGroup>[]}
          rowKey={(g) => g.id}
          onRowClick={(g) => openDetail(g.id)}
          loading={loading}
          emptyMessage={`No ${groupPlural.toLowerCase()} yet. Click "+ Add ${groupSingular}" to create one.`}
          minWidth="min-w-[1000px]"
          defaultSort={{ key: 'name', dir: 'asc' }}
        />
      </section>
      )}

      {/* ── Zone Groups (US only) - the ZoneGroup entity, different from
             postcode groups above. Groups multiple Zone Names into a
             rating tier. ─────────────────────────────────────────────── */}
      {isUs && (
        <section>
          <div className="flex items-center justify-between mb-2 gap-2">
            <div>
              <p className="text-xs text-text-secondary">
                <span className="font-semibold text-text-primary">US Zone Groups</span>
                <span className="mx-2 text-text-muted">·</span>
                {bootstrap?.zoneGroups.length ?? 0} group{(bootstrap?.zoneGroups.length ?? 0) === 1 ? '' : 's'}
              </p>
              <p className="text-[11px] text-text-muted mt-0.5">
                US-only, and it does NOT affect booking. Groups <em>zone names</em> (below)
                for despatch views and clear lists. The groups above are the ones that
                decide which schedules a client is offered.
              </p>
            </div>
            <button
              onClick={() => setEditingZg('new')}
              className="bg-brand-cyan text-[#0d0c2c] font-medium px-3 py-1.5 rounded-full text-xs hover:shadow-cyan-glow transition-shadow"
            >
              + Add Zone Group
            </button>
          </div>
          <DataTable
            rows={bootstrap?.zoneGroups ?? []}
            columns={[
              { key: 'name', label: 'Name', sortable: true, sortValue: (g) => g.name ?? '',
                render: (g) => <span className="font-medium text-text-primary">{g.name}</span> },
              { key: 'zoneNames', label: 'Zone Names', sortable: true, align: 'right',
                sortValue: (g) => g.zoneNameCount,
                render: (g) => <span className="text-text-primary font-semibold">{g.zoneNameCount}</span> },
              { key: 'clearList', label: 'Clear-List Area', sortable: true, sortValue: (g) => g.clearListAreaId ?? 0,
                render: (g) => <span className="text-text-secondary">{g.clearListAreaId ?? '-'}</span> },
              { key: 'actions', label: 'Actions', align: 'right',
                render: (g) => (
                  <RowActionsMenu
                    actions={[
                      { label: 'Edit', onClick: () => setEditingZg(g) },
                      { label: 'Delete', onClick: () => deleteZg(g), danger: true },
                    ]}
                  />
                ) },
            ] as DataTableColumn<ZoneGroupRow>[]}
            rowKey={(g) => g.id}
            onRowClick={(g) => setEditingZg(g)}
            loading={loading}
            emptyMessage="No zone groups yet."
            minWidth="min-w-[600px]"
            defaultSort={{ key: 'name', dir: 'asc' }}
          />
        </section>
      )}

      {/* ── Zone Names (US only) ───────────────────────────────────────── */}
      {isUs && (
        <section>
          <div className="flex items-center justify-between mb-2 gap-2">
            <div>
              <p className="text-xs text-text-secondary">
                <span className="font-semibold text-text-primary">US Zone Names</span>
                <span className="mx-2 text-text-muted">·</span>
                {bootstrap?.zoneNames.length ?? 0} name{(bootstrap?.zoneNames.length ?? 0) === 1 ? '' : 's'}
              </p>
              <p className="text-[11px] text-text-muted mt-0.5">
                US-only. The named containers zips bind to (Zones tab → "Zone Name" column). Each zone name may belong to a US Zone Group above.
              </p>
            </div>
            <button
              onClick={() => setEditingZn('new')}
              className="bg-brand-cyan text-[#0d0c2c] font-medium px-3 py-1.5 rounded-full text-xs hover:shadow-cyan-glow transition-shadow"
            >
              + Add Zone Name
            </button>
          </div>
          <DataTable
            rows={bootstrap?.zoneNames ?? []}
            columns={[
              { key: 'name', label: 'Name', sortable: true, sortValue: (n) => n.name ?? '',
                render: (n) => <span className="font-medium text-text-primary">{n.name}</span> },
              { key: 'zoneGroup', label: 'Zone Group', sortable: true, sortValue: (n) => n.zoneGroupName ?? '',
                render: (n) => <span className="text-text-secondary">{n.zoneGroupName ?? '-'}</span> },
              { key: 'location', label: 'Location', sortable: true, sortValue: (n) => n.locationName ?? '',
                render: (n) => <span className="text-text-secondary">{n.locationName ?? '-'}</span> },
              { key: 'zips', label: 'Zips', sortable: true, align: 'right', sortValue: (n) => n.zipCount,
                render: (n) => <span className="text-text-primary font-semibold">{n.zipCount}</span> },
              { key: 'actions', label: 'Actions', align: 'right',
                render: (n) => (
                  <RowActionsMenu
                    actions={[
                      { label: 'Edit', onClick: () => setEditingZn(n) },
                      { label: 'Paste ZIPs', onClick: () => setPastingZips(n) },
                      { label: 'Bind Polygons', onClick: () => setBindingTarget({ kind: 'zoneName', id: n.id, label: n.name ?? '' }) },
                      { label: 'Delete', onClick: () => deleteZn(n), danger: true },
                    ]}
                  />
                ) },
            ] as DataTableColumn<ZoneNameRow>[]}
            rowKey={(n) => n.id}
            onRowClick={(n) => setEditingZn(n)}
            loading={loading}
            emptyMessage="No zone names yet."
            minWidth="min-w-[700px]"
            defaultSort={{ key: 'name', dir: 'asc' }}
          />
        </section>
      )}

      {detailPg !== null && (
        <PostcodeGroupDetailModal
          groupId={detailPg.id}
          initialSide={detailPg.side}
          onClose={() => setDetailPg(null)}
          onEdit={() => {
            const row = (bootstrap?.postcodeGroups ?? []).find((g) => g.id === detailPg.id);
            setDetailPg(null);
            if (row) setEditingPg(row);
          }}
          onBindPolygons={() => {
            const row = (bootstrap?.postcodeGroups ?? []).find((g) => g.id === detailPg.id);
            setDetailPg(null);
            if (row) setBindingTarget({ kind: 'postcodeGroup', id: row.id, label: row.name ?? '' });
          }}
        />
      )}
      {editingPg !== null && (
        <PostcodeGroupEditModal
          row={editingPg === 'new' ? null : editingPg}
          bootstrap={bootstrap}
          onClose={() => setEditingPg(null)}
          onSaved={async () => { setEditingPg(null); await load(); }}
        />
      )}
      {editingZn !== null && (
        <ZoneNameEditModal
          row={editingZn === 'new' ? null : editingZn}
          bootstrap={bootstrap}
          onClose={() => setEditingZn(null)}
          onSaved={async () => { setEditingZn(null); await load(); }}
        />
      )}
      {editingZg !== null && (
        <ZoneGroupEditModal
          row={editingZg === 'new' ? null : editingZg}
          onClose={() => setEditingZg(null)}
          onSaved={async () => { setEditingZg(null); await load(); }}
        />
      )}
      {pastingZips !== null && (
        <ZoneZipPasteModal
          row={pastingZips}
          bootstrap={bootstrap}
          onClose={() => setPastingZips(null)}
          onSaved={async () => { await load(); }}
        />
      )}
      {bindingTarget !== null && (
        <BindPolygonsModal
          open={true}
          onClose={() => setBindingTarget(null)}
          target={bindingTarget}
        />
      )}
    </div>
  );
}

// ─── Edit modals (small) ────────────────────────────────────────────────

function PostcodeGroupEditModal({
  row, bootstrap, onClose, onSaved,
}: { row: PostcodeGroup | null; bootstrap: TerritoryBootstrap | null; onClose: () => void; onSaved: () => void; }) {
  const toast = useToast();
  const user = useAuth();
  const groupSingular = postcodeGroupLabel(user.isUsTenant, false);
  const depotSingular = depotLabel(user.isUsTenant, false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<PostcodeGroupUpsertBody>(() => ({
    name: row?.name ?? '',
    depotId: row?.depotId ?? null,
    // Prefer the client CODE from the loaded group (operator-facing);
    // clientId is kept null so the server uses the resolved code.
    clientCode: row?.clientCode ?? null,
    clientId: null,
  }));
  const save = async () => {
    setSaving(true);
    try {
      if (row) await territoryService.updatePostcodeGroup(row.id, form);
      else await territoryService.createPostcodeGroup(form);
      toast.show(row ? 'Group updated' : 'Group created', 'success');
      onSaved();
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setSaving(false); }
  };
  return (
    <Modal
      open={true}
      onClose={onClose}
      title={row ? `Edit "${row.name}"` : `New ${groupSingular.toLowerCase()}`}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="secondary" data-primary="true" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : (row ? 'Save' : 'Create')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <Fld label="Name" required>
          <input className={INPUT_CLASS} value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Fld>
        <Fld label={depotSingular}>
          <select className={INPUT_CLASS} value={form.depotId ?? ''}
            onChange={(e) => setForm({ ...form, depotId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">-</option>
            {(bootstrap?.depots ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Fld>
        <Fld label="Client Code (optional)">
          <input type="text" className={INPUT_CLASS + ' uppercase'} value={form.clientCode ?? ''}
            placeholder="e.g. ACME - blank = shared across all clients"
            onChange={(e) => setForm({ ...form, clientCode: e.target.value || null })} />
        </Fld>
      </div>
    </Modal>
  );
}

function ZoneNameEditModal({
  row, bootstrap, onClose, onSaved,
}: { row: ZoneNameRow | null; bootstrap: TerritoryBootstrap | null; onClose: () => void; onSaved: () => void; }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ZoneNameUpsertBody>(() => ({
    name: row?.name ?? '',
    zoneGroupId: row?.zoneGroupId ?? null,
    locationId: row?.locationId ?? null,
  }));
  const save = async () => {
    setSaving(true);
    try {
      if (row) await territoryService.updateZoneName(row.id, form);
      else await territoryService.createZoneName(form);
      toast.show(row ? 'Zone name updated' : 'Zone name created', 'success');
      onSaved();
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setSaving(false); }
  };
  return (
    <Modal
      open={true}
      onClose={onClose}
      title={row ? `Edit "${row.name}"` : 'New zone name'}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="secondary" data-primary="true" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : (row ? 'Save' : 'Create')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <Fld label="Name" required>
          <input className={INPUT_CLASS} value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Fld>
        <Fld label="Zone Group">
          <select className={INPUT_CLASS} value={form.zoneGroupId ?? ''}
            onChange={(e) => setForm({ ...form, zoneGroupId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">-</option>
            {(bootstrap?.zoneGroups ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Fld>
        <Fld label="Location (Depot)">
          <select className={INPUT_CLASS} value={form.locationId ?? ''}
            onChange={(e) => setForm({ ...form, locationId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">-</option>
            {(bootstrap?.depots ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Fld>
      </div>
    </Modal>
  );
}

function ZoneGroupEditModal({
  row, onClose, onSaved,
}: { row: ZoneGroupRow | null; onClose: () => void; onSaved: () => void; }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ZoneGroupUpsertBody>(() => ({
    name: row?.name ?? '',
    clearListAreaId: row?.clearListAreaId ?? null,
  }));
  const save = async () => {
    setSaving(true);
    try {
      if (row) await territoryService.updateZoneGroup(row.id, form);
      else await territoryService.createZoneGroup(form);
      toast.show(row ? 'Zone group updated' : 'Zone group created', 'success');
      onSaved();
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setSaving(false); }
  };
  return (
    <Modal
      open={true}
      onClose={onClose}
      title={row ? `Edit "${row.name}"` : 'New zone group'}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="secondary" data-primary="true" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : (row ? 'Save' : 'Create')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <Fld label="Name" required>
          <input className={INPUT_CLASS} value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Fld>
        <Fld label="Clear-List Area Id">
          <input type="number" className={INPUT_CLASS} value={form.clearListAreaId ?? ''}
            onChange={(e) => setForm({ ...form, clearListAreaId: e.target.value ? Number(e.target.value) : null })} />
        </Fld>
      </div>
    </Modal>
  );
}

/** A schedule count that opens the detail filtered to that side. Zero is
 *  plain text: there is no list behind it, and a link that opens an empty
 *  panel is worse than no link. stopPropagation keeps the row's own
 *  click (which opens BOTH sides) from firing as well. */
function CountLink({ value, title, onClick }: { value: number; title: string; onClick: () => void }) {
  if (value === 0) return <span className="text-text-muted">0</span>;
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="text-text-primary underline decoration-dotted underline-offset-2 hover:text-brand-cyan"
    >
      {value}
    </button>
  );
}

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

/**
 * Bulk ZIP add into one US zone (US coverage spec 5.3).
 *
 * The Zones tab adds one ZIP per request, so Ruth's Cheetah file is 602 form
 * submissions across eight zones. This is the one-sitting path.
 *
 * The zone number is required and is not a formality: it is the key a
 * schedule leg tick resolves by, so a row written without one can never be
 * reached by a tick. It prefills when the zone's existing rows all agree.
 */
function ZoneZipPasteModal({
  row, bootstrap, onClose, onSaved,
}: {
  row: ZoneNameRow;
  bootstrap: TerritoryBootstrap | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  // Prefill only when every existing row of this zone carries the same
  // number. Two different numbers on one zone is a finding worth seeing
  // rather than papering over with a guess.
  const existingNumbers = Array.from(new Set(
    (bootstrap?.usZipZones ?? [])
      .filter((z) => z.zoneNameId === row.id && z.zoneNumber != null)
      .map((z) => z.zoneNumber as number),
  ));
  const [text, setText] = useState('');
  const [zoneNumber, setZoneNumber] = useState<string>(
    existingNumbers.length === 1 ? String(existingNumbers[0]) : '',
  );
  const [allowShared, setAllowShared] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ZoneZipPasteResult | null>(null);

  const submit = async () => {
    const n = Number(zoneNumber);
    if (!Number.isInteger(n) || n <= 0) {
      toast.show('A zone number is required.', 'error');
      return;
    }
    setSaving(true);
    try {
      // Sent as typed. The server splits, pads and de-duplicates so the
      // stored spelling is decided in one place.
      const res = await territoryService.pasteZoneZips(row.id, {
        zips: [text],
        zoneNumber: n,
        allowSharedNumber: allowShared,
      });
      setResult(res.response);
      toast.show(
        `${res.response.added.length} zip${res.response.added.length === 1 ? '' : 's'} added`,
        'success',
      );
      onSaved();
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setSaving(false); }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Paste ZIPs into "${row.name}"`}
      size="2xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose} disabled={saving}>Close</Button>
          <Button variant="secondary" data-primary="true" onClick={submit} disabled={saving}>
            {saving ? 'Adding...' : 'Add ZIPs'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <Fld label="Zone number" required>
          <input
            type="number"
            className={INPUT_CLASS}
            value={zoneNumber}
            onChange={(e) => setZoneNumber(e.target.value)}
            placeholder={existingNumbers.length > 1
              ? `This zone already uses ${existingNumbers.join(', ')}`
              : 'The number a schedule leg ticks'}
          />
          <p className="text-[11px] text-text-muted mt-1">
            {existingNumbers.length === 1
              ? `Prefilled from this zone's existing rows.`
              : existingNumbers.length > 1
                ? `This zone's rows carry more than one number (${existingNumbers.join(', ')}), so there is nothing to prefill.`
                : 'This zone has no numbered rows yet.'}
          </p>
        </Fld>

        <Fld label="ZIPs">
          <textarea
            className={INPUT_CLASS + ' h-32 font-mono'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'64030, 65201\n63501 64429'}
          />
          <p className="text-[11px] text-text-muted mt-1">
            Commas, spaces, semicolons or new lines. Four digits are padded to five,
            duplicates are dropped, and a ZIP already in another zone is added here as
            well rather than moved.
          </p>
        </Fld>

        <label className="flex items-start gap-2 text-[11px] text-text-secondary">
          <input
            type="checkbox"
            checked={allowShared}
            onChange={(e) => setAllowShared(e.target.checked)}
            className="mt-0.5 accent-brand-cyan"
          />
          <span>
            Allow a number another zone at this depot already uses. A schedule ticking it
            would then serve both zones, which is legitimate but widens coverage, so it is
            off unless you ask for it.
          </span>
        </label>

        {result && (
          <div className="rounded-lg border border-border p-2 text-[11px] space-y-1">
            <div className="text-text-primary font-semibold">Result</div>
            <div>Added: {result.added.length === 0 ? 'none' : result.added.join(', ')}</div>
            <div className="text-text-muted">
              Already in this zone: {result.alreadyInThisZone.length === 0
                ? 'none' : result.alreadyInThisZone.join(', ')}
            </div>
            {result.ignored.length > 0 && (
              <div className="text-brand-orange">
                Not a ZIP, so skipped: {result.ignored.join(', ')}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
