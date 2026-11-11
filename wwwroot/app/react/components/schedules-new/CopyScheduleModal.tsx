import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../common/Modal';
import { schedulesV2Service } from '../../services/schedulesV2Service';
import type { ScheduleGroupSummary } from '../../services/scheduleService';
import { schedulesV2Keys } from '../../hooks/queries/useSchedulesV2';
import { useAuth } from '../../context/AuthContext';

// Copy Schedule modal. Replaces the previous window.prompt() flow that
// only surfaced a bare "new name" input. This modal shows the source
// (name + id + client codes preview), a validated New name input
// seeded from "{source} (copy)", and a Copy button that hits
// POST /api/v2/schedules/{id}/copy. On success the list query is
// invalidated so the new schedule shows up in the table.

interface Props {
  source: ScheduleGroupSummary | null;
  onClose: () => void;
  onSuccess?: () => void;
}

export function CopyScheduleModal({ source, onClose, onSuccess }: Props) {
  const qc = useQueryClient();
  const auth = useAuth();
  const tenantId = auth.currentTenantId ?? 0;
  const [newName, setNewName] = useState('');
  const [copyClientLinks, setCopyClientLinks] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (source) {
      setNewName(`${source.name ?? `Schedule #${source.scheduleId}`} (copy)`);
    } else {
      setNewName('');
    }
    setCopyClientLinks(false);
    setError(null);
  }, [source]);

  const copyMut = useMutation({
    mutationFn: (name: string) =>
      schedulesV2Service.copy(source!.scheduleId, name, [], { copyClientLinks }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: schedulesV2Keys.listAll(tenantId) });
      onSuccess?.();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const submit = () => {
    const trimmed = newName.trim();
    if (!trimmed) { setError('New name is required.'); return; }
    if (source && trimmed === (source.name ?? '').trim()) {
      setError('New name must differ from the source name.'); return;
    }
    copyMut.mutate(trimmed);
  };

  return (
    <Modal
      open={source != null}
      onClose={onClose}
      title={source ? `Copy schedule #${source.scheduleId}` : 'Copy schedule'}
      size="2xl"
      loading={copyMut.isPending}
      loadingMessage="Copying schedule..."
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          {error && <span className="text-xs text-error mr-auto">{error}</span>}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded border border-border hover:bg-surface-light"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!source || copyMut.isPending || !newName.trim()}
            className="px-4 py-2 text-sm rounded bg-brand-cyan text-brand-dark font-medium disabled:bg-brand-cyan/40 disabled:text-brand-dark/60 disabled:cursor-not-allowed"
          >
            Copy
          </button>
        </div>
      }
    >
      {source && (
        <div className="space-y-4">
          <section className="border border-border rounded p-3 bg-surface-light">
            <div className="text-xs uppercase tracking-wide text-text-muted mb-1">Source</div>
            <div className="text-sm text-text-primary font-medium">
              {source.name ?? `Schedule #${source.scheduleId}`}
            </div>
            <div className="text-xs text-text-muted mt-0.5">
              #{source.scheduleId}
              {source.regionName && <> · destination {source.regionName}</>}
              {source.clientCount > 0 && <> · {source.clientCount} client{source.clientCount === 1 ? '' : 's'}</>}
            </div>
          </section>

          <label className="block">
            <span className="text-xs uppercase tracking-wide text-text-muted">New name</span>
            <input
              type="text"
              autoFocus
              value={newName}
              onChange={(e) => { setNewName(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              className="mt-1 w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={copyClientLinks}
              disabled={source.clientCount === 0}
              onChange={(e) => setCopyClientLinks(e.target.checked)}
            />
            <span className={source.clientCount === 0 ? 'text-text-muted' : 'text-text-primary'}>
              Also link the source's {source.clientCount} client{source.clientCount === 1 ? '' : 's'}
            </span>
          </label>

          <p className="text-xs text-text-muted italic">
            The copy inherits the source's day windows, linehauls, zones, delivery route, display
            name and booking settings. It is created for specific clients, not as a default, so
            nobody can book it until you link a client or set it to all clients.
          </p>
        </div>
      )}
    </Modal>
  );
}
