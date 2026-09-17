import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../common/Modal';
import { scheduleService } from '../../services/scheduleService';
import { schedulesV2Service } from '../../services/schedulesV2Service';
import { schedulesV2Keys } from '../../hooks/queries/useSchedulesV2';
import { useAuth } from '../../context/AuthContext';

// Attach Clients modal - Steve's mockup (screenshot 10 in Kevin's
// 2026-09-14 review). Opened from the "attach clients" action icon
// on a Schedules row.
//
// Wired end-to-end: Attach button POSTs to /api/v2/schedules/{id}/clients
// and invalidates the list + detail queries so the row re-renders with
// the new client chips.
//
// Per-row status semantics:
//   - "already attached"  = client is in this schedule's clientIds.
//     Checkbox is pre-checked and disabled (they're already on it).
//   - "has own override #<id>" = client owns an override of this
//     schedule. Attaching would be ambiguous. Disabled.
//   - otherwise attachable - checkbox available.

interface Props {
  scheduleId: number | null;
  onClose: () => void;
}

export function AttachClientsModal({ scheduleId, onClose }: Props) {
  const qc = useQueryClient();
  const auth = useAuth();
  const tenantId = auth.currentTenantId ?? 0;
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Reset the selection each time the modal opens for a different
  // schedule so leftovers don't leak between rows.
  useEffect(() => {
    setSelected([]);
    setSearch('');
    setDebounced('');
    setError(null);
  }, [scheduleId]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  // Detail fetch - gives us the schedule's name + currently-attached
  // client ids (for the "already attached" indicator). Only fires
  // when the modal is open.
  const detailQuery = useQuery({
    queryKey: schedulesV2Keys.detail(tenantId, scheduleId ?? 0),
    queryFn: () => schedulesV2Service.getById(scheduleId!),
    enabled: scheduleId != null && scheduleId > 0,
    staleTime: 60_000,
    retry: false,
  });

  // Client search - 50 rows per response, live server-side match.
  const clientsQuery = useQuery({
    queryKey: ['schedules-v2-attach-search', tenantId, debounced],
    queryFn: () => scheduleService.searchClients(debounced, 50).then((r) => r.response),
    enabled: scheduleId != null,
    staleTime: 30_000,
  });

  const attachedIds = useMemo(
    () => new Set(detailQuery.data?.clientIds ?? []),
    [detailQuery.data],
  );

  // For Phase 1 we don't yet know which clients have overrides of the
  // current base (needs a new endpoint). We render the field as a
  // placeholder so Steve can see the intent; when the "list clients
  // with override of base X" endpoint lands it drops in.
  const overrideByClient = new Map<number, string>();

  const options = clientsQuery.data ?? [];
  const selectedSet = new Set(selected);
  const toggle = (id: number) => {
    if (attachedIds.has(id)) return; // already-attached rows are non-toggleable
    if (overrideByClient.has(id)) return;
    if (selectedSet.has(id)) setSelected(selected.filter((v) => v !== id));
    else setSelected([...selected, id]);
  };

  const attachMut = useMutation({
    mutationFn: (clientIds: number[]) =>
      schedulesV2Service.attachClients(scheduleId!, clientIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: schedulesV2Keys.listAll(tenantId) });
      if (scheduleId != null) {
        qc.invalidateQueries({ queryKey: schedulesV2Keys.detail(tenantId, scheduleId) });
      }
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const title = detailQuery.data
    ? `Attach clients to #${detailQuery.data.scheduleId}`
    : 'Attach clients';
  const subtitle = detailQuery.data
    ? `"${detailQuery.data.name}" - each client you tick gets a link row.`
    : '';

  return (
    <Modal
      open={scheduleId != null}
      onClose={onClose}
      title={title}
      size="lg"
      loading={detailQuery.isLoading || attachMut.isPending}
      loadingMessage={attachMut.isPending ? 'Attaching...' : 'Loading schedule...'}
      footer={
        <div className="flex items-center justify-between w-full">
          <span className="text-xs text-text-muted">
            {error
              ? <span className="text-error">{error}</span>
              : selected.length === 0 ? 'Nothing selected' : `${selected.length} to attach`}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded border border-border hover:bg-surface-light"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => attachMut.mutate(selected)}
              disabled={selected.length === 0 || attachMut.isPending}
              className="px-4 py-2 text-sm rounded bg-brand-cyan text-brand-dark font-medium disabled:bg-brand-cyan/40 disabled:text-brand-dark/60 disabled:cursor-not-allowed"
            >
              {attachMut.isPending ? 'Attaching...' : 'Attach'}
            </button>
          </div>
        </div>
      }
    >
      {subtitle && (
        <p className="text-xs text-text-secondary mb-3">{subtitle}</p>
      )}

      <div className="mb-2">
        <input
          type="search"
          autoFocus
          placeholder="Search clients by name or code..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
        />
      </div>

      <div className="max-h-96 overflow-y-auto border border-border rounded">
        {clientsQuery.isLoading && (
          <div className="p-4 text-xs text-text-muted text-center">Loading clients...</div>
        )}
        {clientsQuery.isError && (
          <div className="p-4 text-xs text-error text-center">
            Failed to load clients: {(clientsQuery.error as Error).message}
          </div>
        )}
        {options.length === 0 && !clientsQuery.isLoading && (
          <div className="p-4 text-xs text-text-muted text-center">No clients match.</div>
        )}
        {options.map((c) => {
          const isAttached = attachedIds.has(c.id);
          const overrideOf = overrideByClient.get(c.id);
          const isDisabled = isAttached || !!overrideOf;
          const isChecked = isAttached || selectedSet.has(c.id);
          return (
            <label
              key={c.id}
              className={`flex items-center gap-3 px-3 py-2 text-sm border-b border-border-light last:border-b-0 ${
                isDisabled ? 'opacity-60 cursor-not-allowed' : 'hover:bg-surface-light cursor-pointer'
              }`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                disabled={isDisabled}
                onChange={() => toggle(c.id)}
                className="accent-brand-cyan"
              />
              <span className="flex-1 font-medium text-text-primary">{c.name}</span>
              {isAttached && (
                <span className="text-[10px] text-text-muted italic">already attached</span>
              )}
              {overrideOf && (
                <span className="text-[10px] text-warning italic">has own override {overrideOf}</span>
              )}
            </label>
          );
        })}
      </div>
    </Modal>
  );
}
