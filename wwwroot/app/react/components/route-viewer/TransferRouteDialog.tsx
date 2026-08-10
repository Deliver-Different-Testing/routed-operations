import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { routeViewerService } from '../../services/routeViewerService';

// Route Viewer Transfer Route dialog (master Section 13.2 + P6). Two-step
// flow: (1) pick a target route from the tenant's active-route list
// (current run's route excluded) + choose whether to cascade the transfer
// to the recurring booking and to the route's zipcode polygon; (2)
// confirm banner with from -> to counts.
//
// Success rollup surfaces the number of jobs / bookings / zipcodes moved
// (master Section S.5 J7 - legacy only console.logs this, Route Viewer
// toasts it).
interface Props {
  runId: number;
  onClose: () => void;
  onSuccess: (summary: string) => void;
}

type Step = 'pick' | 'confirm';

export function TransferRouteDialog({ runId, onClose, onSuccess }: Props) {
  const [step, setStep] = useState<Step>('pick');
  const [routes, setRoutes] = useState<Array<{ routeId: number; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [toRouteId, setToRouteId] = useState<number | ''>('');
  const [transferBooking, setTransferBooking] = useState(false);
  const [transferZipcodes, setTransferZipcodes] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    routeViewerService.getTransferContext(undefined).then((rows) => {
      // Exclude the current run so the operator cannot transfer a run to
      // itself. In legacy this was also filtered by tenant scope inside
      // the SP - the endpoint honours the same rule.
      setRoutes(rows.filter((r) => r.routeId !== runId));
    }).catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [runId]);

  const toRoute = useMemo(
    () => routes.find((r) => r.routeId === toRouteId) ?? null,
    [routes, toRouteId],
  );

  const doTransfer = async () => {
    if (!toRoute) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await routeViewerService.transferRoute({
        jobIds: [],   // run-scoped: server derives from run
        toRouteId: toRoute.routeId,
        transferBooking,
        transferZipcodes,
      });
      const bits: string[] = [`${result.transferred} jobs`];
      if (transferBooking && result.bookings > 0) bits.push(`${result.bookings} bookings`);
      if (transferZipcodes && result.zipcodes > 0) bits.push(`${result.zipcodes} zipcodes`);
      onSuccess(`Transferred ${bits.join(', ')} from run #${runId} to ${toRoute.label}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Transfer route"
      size="md"
      footer={
        <div className="flex justify-between w-full">
          <div>
            {step === 'confirm' && (
              <Button variant="ghost" onClick={() => setStep('pick')}>← Back</Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="neutral" onClick={onClose}>Cancel</Button>
            {step === 'pick' ? (
              <Button
                variant="primary"
                onClick={() => setStep('confirm')}
                disabled={!toRoute}
              >
                Next
              </Button>
            ) : (
              <Button variant="warning" onClick={doTransfer} disabled={submitting}>
                {submitting ? 'Transferring...' : 'Transfer'}
              </Button>
            )}
          </div>
        </div>
      }
    >
      {step === 'pick' && (
        <>
          <div className="text-sm text-text-primary mb-2">
            Target route
          </div>
          {loading && <div className="text-xs text-text-muted">Loading routes...</div>}
          {!loading && (
            <select
              value={toRouteId}
              onChange={(e) => setToRouteId(e.target.value ? Number(e.target.value) : '')}
              className="w-full border border-border rounded px-2 py-1 text-sm"
            >
              <option value="">-- pick a route --</option>
              {routes.map((r) => (
                <option key={r.routeId} value={r.routeId}>{r.label}</option>
              ))}
            </select>
          )}

          <div className="mt-3 space-y-1 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={transferBooking}
                onChange={(e) => setTransferBooking(e.target.checked)}
                className="accent-brand-cyan"
              />
              <span>
                Also transfer the recurring booking template
                <span className="text-text-muted"> (cascade parent + children)</span>
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={transferZipcodes}
                onChange={(e) => setTransferZipcodes(e.target.checked)}
                className="accent-brand-cyan"
              />
              <span>
                Also transfer the zipcode polygon
                <span className="text-text-muted"> (RouteZipcodes rows)</span>
              </span>
            </label>
          </div>
        </>
      )}

      {step === 'confirm' && toRoute && (
        <div>
          <div className="border border-border rounded p-3 bg-surface-cream mb-2 text-sm">
            <div className="text-text-muted text-xs">From</div>
            <div className="font-medium">Run #{runId}</div>
            <div className="my-1 text-center text-text-muted">↓</div>
            <div className="text-text-muted text-xs">To</div>
            <div className="font-medium">{toRoute.label}</div>
          </div>
          <div className="text-xs text-text-muted">
            {transferBooking ? '- Recurring booking template will move with the jobs.' : '- Recurring booking stays on the source route.'}
            <br />
            {transferZipcodes ? '- Zipcode polygon moves with the route.' : '- Zipcode polygon stays on the source route.'}
          </div>
        </div>
      )}

      {error && <div className="mt-2 text-xs text-error">{error}</div>}
    </Modal>
  );
}
