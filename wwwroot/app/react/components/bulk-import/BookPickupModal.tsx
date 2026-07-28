import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { currencyCode } from '../../lib/tenantLabels';
import {
  bulkImportService,
  type PickupJobRequest,
  type PickupJobToCreateDto,
} from '../../services/bulkImportService';
import type { WizardState } from './wizardState';

interface Props {
  open: boolean;
  state: WizardState;
  onClose: () => void;
  onBooked: () => void;
}

/**
 * BookPickupModal - Step 8 (optional). Presented after the depot loop
 * completes when the client has `CreateBulkHomeDeliveryPickup === true` AND
 * at least one per-depot import returned a `pickupJob` payload. Collapses
 * into one pickup call regardless of how many depots the batch spanned
 * (matches BulkImportHyper's one-pickup-covers-all reduction at
 * homeControl.js:3226-3229).
 *
 * Form fields:
 *   - Vehicle Size dropdown (from response.pickupJob.vehicleSizes)
 *   - Number of Vehicles dropdown (from response.pickupJob.numberOfVehicles)
 *   - Pickup Time (datetime-local, defaults to pickupJob.time)
 *   - Weight (kg / lb - editable, defaults to pickupJob.weight)
 *   - Quantity (defaults to pickupJob.quantity)
 *
 * Debounced getPickupRate() fires 500ms after any change once both
 * dropdowns are set. "Book Pickup" fires bookPickup; on success the modal
 * closes and reports back through onBooked.
 */
export function BookPickupModal({ open, state, onClose, onBooked }: Props) {
  const toast = useToast();
  const auth = useAuth();
  const isUsTenant = auth.isUsTenant || state.client?.isUsTenant || false;
  const payload = state.pickupJobPayload;
  const seed = payload?.pickupJob ?? null;

  const [vehicleSize, setVehicleSize] = useState('');
  const [numberOfVehicle, setNumberOfVehicle] = useState<number>(1);
  const [pickupTime, setPickupTime] = useState('');
  const [weight, setWeight] = useState('');
  const [quantity, setQuantity] = useState<number>(1);
  const [amount, setAmount] = useState<number | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookedJobIds, setBookedJobIds] = useState<number[] | null>(null);

  // Hydrate defaults when the modal opens or the payload changes.
  useEffect(() => {
    if (!open || !seed || !payload) return;
    setVehicleSize(payload.vehicleSizes?.[0]?.value ?? '');
    const firstCount = payload.numberOfVehicles?.[0]?.value ?? '1';
    setNumberOfVehicle(Number(firstCount) || 1);
    // Time - server returns an ISO / TimeSpan-ish string. Slice to the
    // datetime-local shape (yyyy-MM-ddTHH:mm).
    const t = seed.time ?? '';
    setPickupTime(t.length >= 16 ? t.slice(0, 16) : t);
    setWeight(seed.weight ?? '');
    setQuantity(seed.quantity ?? 1);
    setAmount(null);
    setError(null);
    setBookedJobIds(null);
  }, [open, seed, payload]);

  // Debounced rate fetch. Fires 500ms after any change once both dropdowns
  // and pickupTime are set. Cancels in-flight requests via ref-guarded
  // ignore flag (StrictMode-safe).
  const timerRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const buildRequest = useCallback((): PickupJobRequest | null => {
    if (!seed) return null;
    if (!vehicleSize || !numberOfVehicle || !pickupTime) return null;
    const job: PickupJobToCreateDto = {
      ...seed,
      time: pickupTime,
      weight: weight,
      quantity: quantity,
    };
    return { vehicleSize, numberOfVehicle, pickupJob: job };
  }, [seed, vehicleSize, numberOfVehicle, pickupTime, weight, quantity]);

  useEffect(() => {
    if (!open) return;
    const req = buildRequest();
    if (!req) {
      setAmount(null);
      return;
    }
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(async () => {
      const id = ++requestIdRef.current;
      setRateLoading(true);
      setError(null);
      try {
        const { response } = await bulkImportService.getPickupRate(req);
        if (id !== requestIdRef.current) return;
        setAmount(response.amount ?? null);
        if (!response.success) {
          setError(response.messages?.[0]?.message ?? 'Could not price this pickup.');
        }
      } catch (e) {
        if (id !== requestIdRef.current) return;
        setError((e as Error).message);
        setAmount(null);
      } finally {
        if (id === requestIdRef.current) setRateLoading(false);
      }
    }, 500);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [open, buildRequest]);

  async function handleBook() {
    const req = buildRequest();
    if (!req) return;
    setBooking(true);
    setError(null);
    try {
      const { response } = await bulkImportService.bookPickup(req);
      if (!response.success) {
        setError(response.messages?.[0]?.message ?? 'Pickup booking failed.');
        return;
      }
      setBookedJobIds(response.jobId ?? []);
      toast.show(
        `Pickup booked (${response.jobId?.length ?? 0} vehicle${
          (response.jobId?.length ?? 0) === 1 ? '' : 's'
        }).`,
        'success'
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBooking(false);
    }
  }

  function handleFinish() {
    onBooked();
  }

  const showForm = bookedJobIds === null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Book Pickup"
      size="xl"
      loading={booking}
      loadingMessage="Booking the pickup..."
      footer={
        showForm ? (
          <div className="flex justify-between items-center">
            <Button variant="neutral" onClick={onClose} disabled={booking}>
              No pickup required
            </Button>
            <Button
              variant="primary"
              onClick={handleBook}
              disabled={booking || !vehicleSize || !numberOfVehicle || !pickupTime}
            >
              {booking ? 'Booking...' : 'Book pickup'}
            </Button>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button variant="primary" onClick={handleFinish}>
              Finish
            </Button>
          </div>
        )
      }
    >
      {showForm ? (
        <div className="space-y-4">
          {!seed && (
            <p className="text-xs text-text-muted">No pickup data available.</p>
          )}
          {seed && (
            <>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Vehicle Size
                </label>
                <select
                  value={vehicleSize}
                  onChange={(e) => setVehicleSize(e.target.value)}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-surface-white"
                >
                  <option value="">Select...</option>
                  {payload?.vehicleSizes?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Number of Vehicles
                </label>
                <select
                  value={String(numberOfVehicle)}
                  onChange={(e) => setNumberOfVehicle(Number(e.target.value) || 1)}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-surface-white"
                >
                  {payload?.numberOfVehicles?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Pickup Date &amp; Time
                </label>
                <input
                  type="datetime-local"
                  value={pickupTime}
                  onChange={(e) => setPickupTime(e.target.value)}
                  className="w-full text-sm border border-border rounded px-2 py-1.5"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    Weight
                  </label>
                  <input
                    type="number"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    className="w-full text-sm border border-border rounded px-2 py-1.5"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    Quantity
                  </label>
                  <input
                    type="number"
                    value={quantity}
                    min={1}
                    onChange={(e) => setQuantity(Number(e.target.value) || 1)}
                    className="w-full text-sm border border-border rounded px-2 py-1.5"
                  />
                </div>
              </div>
              <div className="border border-border rounded p-3 bg-surface-cream">
                <div className="text-xs font-medium text-text-secondary">Estimated Rate</div>
                <div className="text-lg font-semibold text-text-primary mt-1">
                  {rateLoading
                    ? 'Calculating...'
                    : amount != null
                      ? amount.toLocaleString(undefined, {
                          style: 'currency',
                          currency: currencyCode(isUsTenant),
                        })
                      : '-'}
                </div>
              </div>
              {error && (
                <div className="border border-error/40 bg-error/5 rounded p-2 text-xs text-error">
                  {error}
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="border border-success/40 bg-success/5 rounded p-3 text-sm text-success">
            Pickup booked. Job IDs: {bookedJobIds!.join(', ') || 'none'}
          </div>
        </div>
      )}
    </Modal>
  );
}
