import { useState } from 'react';
import { Modal } from '../common/Modal';
import { todayIso } from '../../lib/formatters';

interface Props {
  open: boolean;
  jobCount: number;
  onClose: () => void;
  onConfirm: (newDate: string, runName: string) => Promise<void>;
}

export function BulkMoveDateModal({ open, jobCount, onClose, onConfirm }: Props) {
  const [date, setDate] = useState(todayIso());
  const [runName, setRunName] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Move ${jobCount} job${jobCount === 1 ? '' : 's'} to another date`}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1 text-sm border border-border rounded">
            Cancel
          </button>
          <button
            type="button"
            data-primary="true"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await onConfirm(date, runName); } finally { setBusy(false); }
            }}
            className="px-3 py-1 text-sm bg-brand-purple text-white rounded disabled:opacity-50"
          >
            {busy ? 'Moving...' : 'Move jobs'}
          </button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="block text-text-secondary mb-1">New book date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border border-border rounded px-2 py-1 w-full"
          />
        </label>
        <label className="block">
          <span className="block text-text-secondary mb-1">Reason / run name (for the audit log)</span>
          <input
            type="text"
            value={runName}
            onChange={(e) => setRunName(e.target.value)}
            placeholder="e.g. Rescheduled - client request"
            className="border border-border rounded px-2 py-1 w-full"
          />
        </label>
      </div>
    </Modal>
  );
}
