import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useAuth } from '../../context/AuthContext';
import { routeViewerService } from '../../services/routeViewerService';
import { request } from '../../services/api';

// Route Viewer Top Up dialog (master Section 7.16 + T.6). NZ tenant only
// today per T.6 tenant-decision (US TopUp SP not yet in place). The
// dialog still renders on US tenants to surface the friction to the
// operator + product; the Book button is disabled with a note when US.

interface Props {
  jobId: number;
  jobNumber?: string;
  onClose: () => void;
  onBooked: () => void;
}

type Charge = 'UCLTO' | 'UCLOC';

export function TopUpDialog({ jobId, jobNumber, onClose, onBooked }: Props) {
  const user = useAuth();
  const [charge, setCharge] = useState<Charge>('UCLTO');
  const [amount, setAmount] = useState<number>(1);
  const [serviceId, setServiceId] = useState<number | ''>('');
  const [courierId, setCourierId] = useState<number | null>(null);
  const [courierQuery, setCourierQuery] = useState('');
  const [yourName, setYourName] = useState(user.fullName ?? '');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const servicesQ = useQuery({
    queryKey: ['rv-topup-services'],
    queryFn: () => routeViewerService.getTopUpServices(),
    staleTime: 60_000,
  });

  const courierQ = useQuery({
    queryKey: ['rv-topup-couriers', courierQuery],
    queryFn: () => routeViewerService.searchCouriers(courierQuery),
    enabled: courierQuery.length >= 2,
    staleTime: 30_000,
  });

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await request('/runviewer/booking/top-up', {
        method: 'POST',
        body: JSON.stringify({
          BulkJobId: jobId,
          Charge: charge,
          Amount: amount,
          ServiceId: serviceId,
          CourierId: courierId,
          YourName: yourName,
          Notes: notes,
        }),
      });
      onBooked();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const inRange = amount >= 1 && amount <= 200;
  const disabled = !inRange || !serviceId || !courierId || !yourName || user.isUsTenant;

  return (
    <Modal
      open
      onClose={onClose}
      title="Top up"
      size="md"
      loading={submitting}
      loadingMessage="Booking top up..."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={disabled}>
            {submitting ? 'Booking...' : 'Book Top Up'}
          </Button>
        </div>
      }
    >
      {user.isUsTenant && (
        <div className="mb-2 text-xs bg-amber-50 border border-amber-200 rounded px-2 py-1 text-amber-900">
          Top Up is NZ-only today (per T.6). US booking path pending.
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <div className="text-xs text-text-muted">Job number</div>
          <div>{jobNumber ?? `#${jobId}`}</div>
        </div>

        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-text-muted">Charge</span>
          <select
            value={charge}
            onChange={(e) => setCharge(e.target.value as Charge)}
            className="border border-border rounded px-2 py-1"
          >
            <option value="UCLTO">UCLTO (Top Up)</option>
            <option value="UCLOC">UCLOC (On-Cost)</option>
          </select>
        </label>

        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-text-muted">Amount ($)</span>
          <input
            type="number"
            min={1}
            max={200}
            step="0.5"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className={`border rounded px-2 py-1 ${inRange ? 'border-border' : 'border-error'}`}
          />
          {!inRange && (
            <span className="text-[10px] text-error">Must be between 1 and 200</span>
          )}
        </label>

        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-text-muted">Top up service</span>
          <select
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value ? Number(e.target.value) : '')}
            className="border border-border rounded px-2 py-1"
          >
            <option value="">-- pick --</option>
            {servicesQ.data?.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-0.5 col-span-2">
          <span className="text-xs text-text-muted">Courier</span>
          <input
            type="text"
            placeholder="Type 2+ chars..."
            value={courierQuery}
            onChange={(e) => { setCourierQuery(e.target.value); setCourierId(null); }}
            className="border border-border rounded px-2 py-1"
          />
          {courierQ.data && courierQ.data.length > 0 && (
            <div className="max-h-32 overflow-auto border border-border rounded mt-1">
              {courierQ.data.map((c) => (
                <button
                  key={c.courierId}
                  type="button"
                  onClick={() => { setCourierId(c.courierId); setCourierQuery(`${c.name} (${c.code})`); }}
                  className={`w-full text-left px-2 py-1 text-xs ${
                    courierId === c.courierId ? 'bg-brand-cyan/20' : 'hover:bg-surface-cream'
                  }`}
                >
                  {c.name} ({c.code})
                </button>
              ))}
            </div>
          )}
        </label>

        <label className="flex flex-col gap-0.5 col-span-2">
          <span className="text-xs text-text-muted">Your name</span>
          <input
            type="text"
            value={yourName}
            onChange={(e) => setYourName(e.target.value)}
            className="border border-border rounded px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-0.5 col-span-2">
          <span className="text-xs text-text-muted">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="border border-border rounded px-2 py-1"
          />
        </label>
      </div>

      {error && <div className="mt-2 text-xs text-error">{error}</div>}
    </Modal>
  );
}
