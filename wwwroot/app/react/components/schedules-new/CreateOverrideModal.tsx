import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../common/Modal';
import { scheduleService } from '../../services/scheduleService';
import { schedulesV2Service } from '../../services/schedulesV2Service';

// Create Client Override modal per Steve's brief §2 Schedule modal /
// edit form item 3 "Create override for a client":
//   > picks one client, creates a new ScheduleId with BaseScheduleId
//   > set, copies the base's rows, and moves that client's link row
//   > from the base to the override so a client is never on both.
//
// Single-pick (unlike AttachClientsModal which is multi-pick). Only
// clients currently attached to the base or clients not on any
// override of this base are attachable - anything else would collide
// with the "client on base OR one override, never both" invariant.

interface Props {
  baseScheduleId: number | null;
  baseName?: string | null;
  attachedClientIds?: number[];
  /** Called with the newly-created override's scheduleId so the parent
   *  can open it in the detail modal. Only fires on success. */
  onCreated: (newScheduleId: number) => void;
  onClose: () => void;
}

export function CreateOverrideModal({
  baseScheduleId,
  baseName,
  attachedClientIds,
  onCreated,
  onClose,
}: Props) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isOpen = baseScheduleId != null && baseScheduleId > 0;

  useEffect(() => {
    setSearch('');
    setDebounced('');
    setPickedId(null);
    setError(null);
  }, [baseScheduleId]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  const clientsQuery = useQuery({
    queryKey: ['create-override-search', debounced],
    queryFn: () => scheduleService.searchClients(debounced, 50).then((r) => r.response),
    enabled: isOpen,
    staleTime: 30_000,
  });

  // Clients that already own an override of this base cannot be picked
  // (their link row is on the existing override, not the base). Fetch
  // the override list so we can grey those out.
  const overridesQuery = useQuery({
    queryKey: ['schedules-v2-overrides', baseScheduleId ?? 0],
    queryFn: () => schedulesV2Service.listOverrides(baseScheduleId!),
    enabled: isOpen,
    staleTime: 30_000,
  });

  const overrideClientIds = useMemo(
    () => new Set((overridesQuery.data ?? []).map((o) => o.clientId)),
    [overridesQuery.data],
  );
  const attachedSet = useMemo(
    () => new Set(attachedClientIds ?? []),
    [attachedClientIds],
  );

  const createMut = useMutation({
    mutationFn: (clientId: number) =>
      schedulesV2Service.createOverride(baseScheduleId!, clientId),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['schedules-v2-list'] });
      qc.invalidateQueries({ queryKey: ['schedules-v2-detail', baseScheduleId] });
      qc.invalidateQueries({ queryKey: ['schedules-v2-overrides', baseScheduleId] });
      onCreated(res.scheduleId);
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const canCreate = pickedId != null && !createMut.isPending;

  const handleCreate = () => {
    if (!canCreate) return;
    setError(null);
    createMut.mutate(pickedId!);
  };

  return (
    <Modal
      open={isOpen}
      onClose={createMut.isPending ? () => {} : onClose}
      title={baseName ? `Create override of "${baseName}" #${baseScheduleId}` : 'Create override'}
      size="2xl"
    >
      <div className="space-y-3">
        <p className="text-xs text-text-muted">
          Pick one client. The new schedule inherits every field from the base,
          points back via <span className="font-mono">BaseScheduleId</span>, and
          moves that client's link row off the base so they see only the override.
        </p>

        <input
          type="search"
          placeholder="Search clients by code or name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={createMut.isPending}
          autoFocus
          className="w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
        />

        <div className="max-h-72 overflow-y-auto border border-border rounded">
          {clientsQuery.isLoading && (
            <div className="p-3 text-xs text-text-muted italic">Loading...</div>
          )}
          {!clientsQuery.isLoading && (clientsQuery.data ?? []).length === 0 && (
            <div className="p-3 text-xs text-text-muted italic">No clients match.</div>
          )}
          {(clientsQuery.data ?? []).map((c) => {
            const alreadyOverride = overrideClientIds.has(c.id);
            const notAttached = attachedSet.size > 0 && !attachedSet.has(c.id);
            const disabled = alreadyOverride;
            return (
              <label
                key={c.id}
                className={`flex items-center gap-3 px-3 py-2 border-b border-border/60 text-sm ${
                  disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-surface-light'
                }`}
              >
                <input
                  type="radio"
                  name="override-client"
                  value={c.id}
                  checked={pickedId === c.id}
                  disabled={disabled || createMut.isPending}
                  onChange={() => setPickedId(c.id)}
                />
                <span className="font-medium text-text-primary flex-1">{c.name}</span>
                <span className="text-xs text-text-muted font-mono">#{c.id}</span>
                {alreadyOverride && (
                  <span className="text-[10px] text-warning">already has an override</span>
                )}
                {notAttached && !alreadyOverride && (
                  <span className="text-[10px] text-text-muted italic">not currently attached</span>
                )}
              </label>
            );
          })}
        </div>

        {error && (
          <div className="text-xs text-error bg-error-bg/40 border border-error/30 px-3 py-2 rounded">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            disabled={createMut.isPending}
            className="px-3 py-1.5 text-sm border border-border rounded hover:bg-surface-light disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate}
            className="px-3 py-1.5 text-sm rounded bg-brand-cyan text-white hover:bg-brand-cyan-dark disabled:opacity-40"
          >
            {createMut.isPending ? 'Creating...' : 'Create override'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
