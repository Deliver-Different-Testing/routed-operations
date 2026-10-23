import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../common/Modal';
import { StatusBadge } from '../common/StatusBadge';
import { ClientMultiPicker, type ClientHint } from './ClientMultiPicker';
import { DropdownPortal } from '../common/DropdownPortal';
import { schedulesV2Service, type ScheduleBundleMember } from '../../services/schedulesV2Service';
import { schedulesV2Keys, useSchedulesV2Bundle } from '../../hooks/queries/useSchedulesV2';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';

// Bundle modal - Steve 2026-10-16 (SCHEDULE-BUNDLES-UI-2026-10-16).
//
// A bundle is the same idea as a rate card in Settings: a named set of
// schedules that a new client of a given profile is dropped onto in one
// go. The bundle never holds clients itself; adding one writes a
// tblScheduleClient row per non-default member and skips defaults
// because every client already books those.
//
// Layout: schedules on the left (searchable add, no ids typed), clients
// on the right with coverage ("On n of m" when a client joined before a
// member did) plus Complete / Remove. Rename + description edit inline.
//
// Replaces the expand-in-place card + window.prompt flows that shipped
// with the Phase 4 bundle writes.

const DAY_LABELS: Array<{ n: number; label: string }> = [
  { n: 1, label: 'M' }, { n: 2, label: 'T' }, { n: 3, label: 'W' }, { n: 4, label: 'T' },
  { n: 5, label: 'F' }, { n: 6, label: 'S' }, { n: 7, label: 'S' },
];

interface Props {
  bundleId: number | null;
  onClose: () => void;
  /** Opens the schedule detail modal for a member row (SchedulesNew openBase). */
  onScheduleClick: (scheduleId: number) => void;
}

export function BundleModal({ bundleId, onClose, onScheduleClick }: Props) {
  const qc = useQueryClient();
  const auth = useAuth();
  const tenantId = auth.currentTenantId ?? 0;
  const toast = useToast();
  const confirm = useConfirm();
  const detail = useSchedulesV2Bundle(bundleId);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [addingSchedule, setAddingSchedule] = useState(false);
  const [pickedClients, setPickedClients] = useState<number[]>([]);

  // Reset the transient state whenever a different bundle opens.
  useEffect(() => {
    setEditing(false);
    setAddingSchedule(false);
    setPickedClients([]);
  }, [bundleId]);

  // Link rows change under the Schedules tab too, so refresh everything
  // under the schedules-v2 root rather than just this bundle.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: schedulesV2Keys.bundles(tenantId) });
    if (bundleId != null) qc.invalidateQueries({ queryKey: schedulesV2Keys.bundle(tenantId, bundleId) });
    qc.invalidateQueries({ queryKey: schedulesV2Keys.listAll(tenantId) });
    qc.invalidateQueries({ queryKey: schedulesV2Keys.detailAll(tenantId) });
  };
  const fail = (what: string) => (e: Error) => toast.show(`${what} failed: ${e.message}`, 'error');

  const renameMut = useMutation({
    mutationFn: () => schedulesV2Service.updateBundle(bundleId!, { name: name.trim(), description: description.trim() }),
    onSuccess: () => { invalidate(); setEditing(false); toast.show('Bundle updated.', 'success'); },
    onError: fail('Rename'),
  });
  const addMemberMut = useMutation({
    mutationFn: (args: { scheduleId: number; linkExistingClients: boolean }) =>
      schedulesV2Service.addBundleMembers(bundleId!, [args.scheduleId], args.linkExistingClients),
    onSuccess: (_r, args) => {
      invalidate();
      toast.show(args.linkExistingClients ? 'Schedule added and the bundle\'s clients linked to it.' : 'Schedule added.', 'success');
    },
    onError: fail('Add schedule'),
  });
  const removeMemberMut = useMutation({
    mutationFn: (scheduleId: number) => schedulesV2Service.removeBundleMember(bundleId!, scheduleId),
    onSuccess: () => { invalidate(); toast.show('Schedule removed from the bundle.', 'success'); },
    onError: fail('Remove schedule'),
  });
  const attachMut = useMutation({
    mutationFn: (clientIds: number[]) => schedulesV2Service.attachClientsToBundle(bundleId!, clientIds),
    onSuccess: (r) => {
      invalidate();
      setPickedClients([]);
      toast.show(`Linked: ${r.added} schedule link${r.added === 1 ? '' : 's'} added.`, 'success');
    },
    onError: fail('Add client'),
  });
  const detachMut = useMutation({
    mutationFn: (clientId: number) => schedulesV2Service.detachClientFromBundle(bundleId!, clientId),
    onSuccess: (r) => { invalidate(); toast.show(`Removed from ${r.removed} schedule${r.removed === 1 ? '' : 's'}.`, 'success'); },
    onError: fail('Remove client'),
  });
  const deleteMut = useMutation({
    mutationFn: () => schedulesV2Service.deleteBundle(bundleId!),
    onSuccess: () => { invalidate(); toast.show('Bundle deleted.', 'success'); onClose(); },
    onError: fail('Delete'),
  });

  const d = detail.data;
  const members = d?.members ?? [];
  const clients = d?.clients ?? [];
  const nonDefaultCount = members.filter((m) => !m.isDefault).length;
  const memberIds = useMemo(() => new Set(members.map((m) => m.scheduleId)), [members]);
  const clientHints = useMemo(() => {
    const map = new Map<number, ClientHint>();
    for (const c of clients) {
      if (c.onMembers >= c.ofMembers) map.set(c.clientId, { disabled: true, hint: 'already on this bundle' });
      else map.set(c.clientId, { hint: `on ${c.onMembers} of ${c.ofMembers}` });
    }
    return map;
  }, [clients]);

  const startEdit = () => {
    setName(d?.name ?? '');
    setDescription(d?.description ?? '');
    setEditing(true);
  };

  const handleAddSchedule = async (row: SchedulePickRow) => {
    setAddingSchedule(false);
    let link = false;
    if (clients.length > 0) {
      link = await confirm({
        title: 'Link the bundle\'s clients?',
        message: `${clients.length} client${clients.length === 1 ? ' is' : 's are'} on this bundle. Link ${clients.length === 1 ? 'it' : 'them'} to "${row.name}" as well? (A default schedule needs no link; answering No leaves the clients showing "on n of m" until you press Complete.)`,
        confirmLabel: 'Yes, link them',
        cancelLabel: 'No, just add the schedule',
      });
    }
    addMemberMut.mutate({ scheduleId: row.scheduleId, linkExistingClients: link });
  };

  const handleRemoveSchedule = async (m: ScheduleBundleMember) => {
    const ok = await confirm({
      title: 'Remove from bundle?',
      message: `Remove "${m.name}" from this bundle? The schedule and its client links are not touched.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (ok) removeMemberMut.mutate(m.scheduleId);
  };

  const handleRemoveClient = async (clientId: number, code: string) => {
    const ok = await confirm({
      title: 'Remove client from bundle?',
      message: `Remove ${code} from every schedule in this bundle? This deletes its link rows on the ${nonDefaultCount} client-specific member${nonDefaultCount === 1 ? '' : 's'}; default members are unaffected because every client books them anyway.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (ok) detachMut.mutate(clientId);
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete bundle?',
      message: `Delete "${d?.name}" (${members.length} schedule${members.length === 1 ? '' : 's'})? The underlying schedules and their link rows are NOT touched - only the bundle is removed.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) deleteMut.mutate();
  };

  const busy = renameMut.isPending || addMemberMut.isPending || removeMemberMut.isPending
    || attachMut.isPending || detachMut.isPending || deleteMut.isPending;

  return (
    <Modal
      open={bundleId != null}
      onClose={onClose}
      title={d ? d.name : 'Schedule bundle'}
      size="6xl"
      loading={detail.isLoading}
      loadingMessage="Loading bundle..."
    >
      {detail.isError && (
        <div className="text-sm text-error py-6 text-center">
          Failed to load bundle: {(detail.error as Error).message}
        </div>
      )}
      {d && (
        <div className="space-y-4">
          {/* Header strip: description + actions, or the inline editor. */}
          <div className="flex items-start gap-3">
            {editing ? (
              <div className="flex-1 space-y-2">
                <input
                  type="text"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm font-semibold border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
                  placeholder="Bundle name"
                />
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
                  placeholder="What a new client of this profile gets on day one..."
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!name.trim() || renameMut.isPending}
                    onClick={() => renameMut.mutate()}
                    className="px-3 py-1 text-xs rounded bg-brand-cyan text-brand-dark font-medium disabled:bg-brand-cyan/40"
                  >
                    Save
                  </button>
                  <button type="button" onClick={() => setEditing(false)} className="px-3 py-1 text-xs rounded border border-border hover:bg-surface-light">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusBadge label={d.isActive ? 'Active' : 'Inactive'} kind={d.isActive ? 'success' : 'default'} />
                    <span className="text-xs text-text-muted">Bundle #{d.bundleId}</span>
                  </div>
                  <p className="text-sm text-text-muted mt-1">
                    {d.description || <span className="italic">No description.</span>}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button type="button" onClick={startEdit} className="px-3 py-1 text-xs rounded border border-border hover:bg-surface-light">
                    Rename
                  </button>
                  <button type="button" onClick={handleDelete} disabled={busy} className="px-3 py-1 text-xs rounded border border-error/40 text-error hover:bg-error-bg/40">
                    Delete bundle
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="grid grid-cols-5 gap-4">
            {/* Schedules */}
            <section className="col-span-3">
              <div className="flex items-center justify-between mb-2 min-h-[2rem]">
                <h4 className="text-sm font-semibold text-text-primary">
                  Schedules in this bundle <span className="text-text-muted font-normal">- {members.length}</span>
                </h4>
                {addingSchedule ? (
                  <SchedulePicker
                    excludeIds={memberIds}
                    onPick={handleAddSchedule}
                    onCancel={() => setAddingSchedule(false)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingSchedule(true)}
                    className="px-3 py-1 text-xs font-medium rounded bg-brand-cyan text-brand-dark hover:bg-brand-cyan/90"
                  >
                    + Schedule
                  </button>
                )}
              </div>
              <table className="w-full text-sm border border-border rounded">
                <thead className="text-xs text-text-muted bg-surface-cream">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-medium">Schedule</th>
                    <th className="text-left px-2 py-1.5 font-medium">Who can book</th>
                    <th className="text-left px-2 py-1.5 font-medium">Depot</th>
                    <th className="text-left px-2 py-1.5 font-medium">Speed</th>
                    <th className="text-left px-2 py-1.5 font-medium">Days</th>
                    <th className="px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.scheduleId} className="border-t border-border-light">
                      <td className="px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => onScheduleClick(m.scheduleId)}
                          className="font-medium text-text-primary hover:text-brand-cyan text-left"
                          title={`Open schedule #${m.scheduleId}`}
                        >
                          {m.name}
                        </button>
                      </td>
                      <td className="px-2 py-1.5 text-xs">
                        {m.isDefault
                          ? <StatusBadge label="All clients" kind="success" />
                          : <span className="text-text-muted">{m.clientCount} linked</span>}
                      </td>
                      <td className="px-2 py-1.5 text-xs">{m.regionName ?? '-'}</td>
                      <td className="px-2 py-1.5 text-xs">{m.speedName ?? '-'}</td>
                      <td className="px-2 py-1.5"><DayStrip active={m.activeDays} /></td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleRemoveSchedule(m)}
                          disabled={busy}
                          className="text-xs text-error hover:underline"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                  {members.length === 0 && (
                    <tr><td colSpan={6} className="px-2 py-4 text-xs text-text-muted italic">No schedules yet. Use + Schedule.</td></tr>
                  )}
                </tbody>
              </table>
              <p className="text-[11px] text-text-muted mt-2">
                Removing a schedule from the bundle does not touch the schedule or its client links.
              </p>
            </section>

            {/* Clients */}
            <section className="col-span-2">
              <div className="flex items-center justify-between mb-2 min-h-[2rem]">
                <h4 className="text-sm font-semibold text-text-primary">
                  Clients on this bundle <span className="text-text-muted font-normal">- {clients.length}</span>
                </h4>
              </div>
              <div className="flex gap-2 mb-2">
                <ClientMultiPicker
                  selected={pickedClients}
                  onChange={setPickedClients}
                  placeholder={nonDefaultCount === 0 ? 'No client-specific members' : 'Add clients...'}
                  hintsById={clientHints}
                  triggerWidth="flex-1"
                  panelTitle="Clients to add"
                  compact
                />
                <button
                  type="button"
                  disabled={pickedClients.length === 0 || nonDefaultCount === 0 || attachMut.isPending}
                  onClick={() => attachMut.mutate(pickedClients)}
                  title={nonDefaultCount === 0 ? 'Every member is a default; there is nothing to link a client to.' : undefined}
                  className="px-3 py-1 text-xs font-medium rounded bg-brand-cyan text-brand-dark hover:bg-brand-cyan/90 disabled:bg-brand-cyan/40 disabled:text-brand-dark/60 disabled:cursor-not-allowed"
                >
                  {attachMut.isPending ? 'Adding...' : `Add${pickedClients.length > 0 ? ` ${pickedClients.length}` : ''}`}
                </button>
              </div>
              <ul className="border border-border rounded divide-y divide-border-light">
                {clients.map((c) => {
                  const full = c.onMembers >= c.ofMembers;
                  return (
                    <li key={c.clientId} className="px-2 py-1.5 flex items-center gap-2">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-brand-dark text-white">{c.code}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{c.name ?? c.code}</div>
                        <div className={`text-[11px] ${full ? 'text-text-muted' : 'text-warning'}`}>
                          {full ? `On all ${c.ofMembers} client schedule${c.ofMembers === 1 ? '' : 's'}` : `On ${c.onMembers} of ${c.ofMembers} client schedules`}
                        </div>
                      </div>
                      {!full && (
                        <button
                          type="button"
                          onClick={() => attachMut.mutate([c.clientId])}
                          disabled={busy}
                          title="Link to the members this client is missing"
                          className="text-xs text-brand-cyan hover:underline"
                        >
                          Complete
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveClient(c.clientId, c.code)}
                        disabled={busy}
                        className="text-xs text-error hover:underline"
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
                {clients.length === 0 && (
                  <li className="px-2 py-4 text-xs text-text-muted italic">
                    {nonDefaultCount === 0
                      ? 'All members are defaults, so every client books them already.'
                      : 'No clients linked yet.'}
                  </li>
                )}
              </ul>
              <p className="text-[11px] text-text-muted mt-2">
                Adding a client links it to each of the {nonDefaultCount} client-specific schedule{nonDefaultCount === 1 ? '' : 's'} here;
                the {members.length - nonDefaultCount} default{members.length - nonDefaultCount === 1 ? '' : 's'} need no link.
                "On n of m" means the client was added before a schedule joined the bundle.
              </p>
            </section>
          </div>
        </div>
      )}
    </Modal>
  );
}

function DayStrip({ active }: { active: number[] }) {
  const set = new Set(active);
  return (
    <div className="flex gap-px">
      {DAY_LABELS.map(({ n, label }) => (
        <span
          key={n}
          className={`w-4 h-4 rounded-sm text-[9px] font-semibold flex items-center justify-center ${
            set.has(n) ? 'bg-brand-cyan text-brand-dark border border-brand-cyan' : 'bg-transparent text-text-muted border border-border'
          }`}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

export interface SchedulePickRow {
  scheduleId: number;
  name: string;
}

/** Searchable schedule picker for "+ Schedule". Server-side name search
 *  against /api/v2/schedules (25 rows), members already in the bundle
 *  filtered out. Picks one schedule per use. */
export function SchedulePicker({ excludeIds, onPick, onCancel }: {
  excludeIds: Set<number>;
  onPick: (row: SchedulePickRow) => void;
  onCancel: () => void;
}) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);
  const q = useQuery({
    queryKey: ['schedules-v2-bundle-schedule-picker', debounced],
    queryFn: () => schedulesV2Service.list({ type: 'all', q: debounced, page: 0, pageSize: 25 }),
    staleTime: 30_000,
  });
  const rows = (q.data?.rows ?? []).filter((r) => !excludeIds.has(r.scheduleId));
  // Anchor for the portaled results list. Rendering it as an absolute
  // sibling put it inside Modal's `overflow-auto` body, which clipped
  // everything past the modal edge - the original report.
  const anchorRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={anchorRef} className="relative w-80">
      <input
        type="text"
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
        placeholder="Search schedules by name..."
        className="w-full px-2 py-1 text-xs border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
      />
      <DropdownPortal
        anchorRef={anchorRef}
        open={true}
        onDismiss={onCancel}
        width="anchor"
        data-testid="bundle-schedule-picker-panel"
      >
      <ul className="flex-1 min-h-0 overflow-auto text-xs">
        {q.isLoading && <li className="px-2 py-2 text-text-muted">Searching...</li>}
        {rows.map((r) => (
          <li key={r.scheduleId}>
            <button
              type="button"
              onClick={() => onPick({ scheduleId: r.scheduleId, name: r.name ?? `#${r.scheduleId}` })}
              className="w-full text-left px-2 py-1.5 hover:bg-surface-light flex justify-between gap-2"
            >
              <span className="font-medium truncate">{r.name ?? `#${r.scheduleId}`}</span>
              <span className="text-text-muted shrink-0">
                {[r.regionName, r.speedName].filter(Boolean).join(' - ')}
                {r.clientCount === 0 ? ' - all clients' : ` - ${r.clientCount} linked`}
              </span>
            </button>
          </li>
        ))}
        {!q.isLoading && rows.length === 0 && <li className="px-2 py-2 text-text-muted">No schedules match.</li>}
        <li className="border-t border-border-light">
          <button type="button" onClick={onCancel} className="w-full text-left px-2 py-1.5 text-text-muted hover:bg-surface-light">Cancel</button>
        </li>
      </ul>
      </DropdownPortal>
    </div>
  );
}
