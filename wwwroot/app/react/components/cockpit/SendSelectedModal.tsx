import { useEffect, useMemo, useState } from 'react';
import type { Courier } from '../../types';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';

interface Props {
  open: boolean;
  jobCount: number;
  couriers: Courier[];
  onClose: () => void;
  onConfirm: (courierId: number | null) => Promise<void> | void;
}

/**
 * P2.7 Send-Selected courier picker modal. Replaces the legacy `window.prompt`
 * (see homeControl.js:746-764 dispatchJobsForm) with a proper searchable
 * `<select>` matching MergeRunModal / BulkMoveDateModal style. Empty selection
 * means the jobs dispatch to Live without a courier attached (legacy also
 * allowed a blank prompt).
 *
 * Note: the courier list is the same one RunList uses (state.allCouriers,
 * loaded once at cockpit mount). If the operator needs a courier that isn't
 * listed, they should refresh the cockpit or use the couriers admin page.
 */
export function SendSelectedModal({ open, jobCount, couriers, onClose, onConfirm }: Props) {
  const [courierId, setCourierId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  // Reset the picker when the modal reopens so a stale selection from the
  // previous fire doesn't accidentally get reused.
  useEffect(() => {
    if (open) {
      setCourierId(null);
      setFilter('');
      setBusy(false);
    }
  }, [open]);

  const filteredCouriers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return couriers;
    return couriers.filter((c) => (c.displayName ?? '').toLowerCase().includes(q));
  }, [couriers, filter]);

  const submit = async () => {
    setBusy(true);
    try { await onConfirm(courierId); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Send ${jobCount} job${jobCount === 1 ? '' : 's'} to Live`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="warning"
            data-primary="true"
            onClick={submit}
            disabled={busy}
            title={courierId == null
              ? 'Dispatch without attaching a courier (unassigned)'
              : `Dispatch to courier #${courierId}`}
          >
            {busy ? 'Dispatching...' : 'Send to Live'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="text-text-muted text-xs">
          Pick a courier to attach the jobs to on dispatch, or leave blank to
          send them unassigned. The jobs will be wrapped in a fresh run named
          after today's date.
        </div>
        <label className="block">
          <span className="block text-text-secondary text-xs mb-1">Filter couriers</span>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Type to narrow the list..."
            className="w-full border border-border rounded px-2 py-1"
            autoFocus
          />
        </label>
        <label className="block">
          <span className="block text-text-secondary text-xs mb-1">Courier</span>
          <select
            value={courierId ?? ''}
            onChange={(e) => setCourierId(e.target.value ? Number(e.target.value) : null)}
            className="w-full border border-border rounded-lg px-3 py-1.5 text-sm"
            size={Math.min(10, Math.max(3, filteredCouriers.length + 1))}
          >
            <option value="">(no courier - dispatch unassigned)</option>
            {filteredCouriers.map((c) => (
              <option key={c.courierId} value={c.courierId}>
                {c.displayName}
              </option>
            ))}
          </select>
        </label>
        {filter.trim() && filteredCouriers.length === 0 && (
          <div className="text-warning text-xs">
            No couriers match "{filter.trim()}". Clear the filter to see all {couriers.length}.
          </div>
        )}
      </div>
    </Modal>
  );
}
