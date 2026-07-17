import { Modal } from '../common/Modal';

export interface OptimizeStop {
  bulkJobId: number;
  jobNumber: string | null;
  originalOrder: number | null;
  newOrder: number;
}

interface Props {
  open: boolean;
  runName: string;
  stops: OptimizeStop[];
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function OptimizePreviewModal({ open, runName, stops, onClose, onConfirm }: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Optimise "${runName}" - preview`}
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-sm border border-border rounded"
          >
            Cancel
          </button>
          <button
            type="button"
            data-primary="true"
            onClick={async () => { await onConfirm(); }}
            className="px-3 py-1 text-sm bg-brand-purple text-white rounded"
          >
            Apply new order
          </button>
        </div>
      }
    >
      <div className="text-xs text-text-secondary mb-2">
        RouteSavvy returned this stop order for {stops.length} deliveries.
        Confirm to persist onto <code>tblBulkJobRun.PickRunOrder</code>.
      </div>
      <table className="w-full text-xs">
        <thead className="bg-surface-cream">
          <tr className="text-left text-text-muted">
            <th className="px-2 py-1 w-16">Was</th>
            <th className="px-2 py-1 w-16">Now</th>
            <th className="px-2 py-1">Job #</th>
          </tr>
        </thead>
        <tbody>
          {stops.map((s) => (
            <tr key={s.bulkJobId} className="border-t border-border-light">
              <td className="px-2 py-1 text-text-muted">{s.originalOrder ?? '-'}</td>
              <td className="px-2 py-1 font-medium text-brand-purple">{s.newOrder}</td>
              <td className="px-2 py-1">{s.jobNumber ?? s.bulkJobId}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
