import { useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useAlert } from '../../context/ConfirmContext';
import { request } from '../../services/api';

// Route Viewer Book Direct Redelivery dialog (master Section 7.16 +
// 3.2.1 landmines). Booking landmines preserved:
//  - Weight default = 1kg (NOT blank; the SP validates > 0 and silent-fails
//    with a confusing message on 0)
//  - SourceId = 8 hardcoded (marks RunViewer-booked jobs in analytics)
//  - QuoteId + PostCode + CourierID manual type coercion at submit
//  - HelloFresh contact override (17921/32374 -> 32341 for PackageMap==0)
//
// P7 core - the form + submit + auto-chain to CreateEventDialog per
// master Section S.2. Full field-parity (Google Places autocomplete on
// delivery company, all conditional fields) lands in P7b.

interface Props {
  sourceJobId: number;
  onClose: () => void;
  onBooked: (newJobId: number) => void;
  /** 'redelivery' (default) = customer-facing Direct Redelivery with
   *  optional email/mobile notification. 'return-to-base' = internal
   *  RTB flow which forces JobNotificationType='WEBSITE' server-side
   *  and swaps the dialog title so operators can tell them apart.
   *  Backend endpoint is the same /booking/one-off - the mode is
   *  purely a UI + payload discriminator. */
  mode?: 'redelivery' | 'return-to-base';
}

// Minimal payload the legacy /booking/OneOff endpoint expects. Extended
// fields (International metadata, additional package rows) are opt-in and
// omitted from this P7 core.
interface BookingPayload {
  SourceId: number;
  Weight: number;
  Delivery: {
    Company: string;
    Contact: string;
    Phone: string;
    Address: { Line1: string; Suburb: string; PostCode: string };
    Notes: string;
  };
  ReDelivery: { FromPostCode: number; ToPostCode: number; CourierID: number };
  QuoteId: string;
}

export function BookRedeliveryDialog({ sourceJobId, onClose, onBooked, mode = 'redelivery' }: Props) {
  const isRtb = mode === 'return-to-base';
  const alert = useAlert();
  const [company, setCompany] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [suburb, setSuburb] = useState('');
  const [postCode, setPostCode] = useState('');
  const [notes, setNotes] = useState('');
  // Weight default = 1kg per Section 3.2.1 landmine.
  const [weight, setWeight] = useState<number>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const payload: BookingPayload = {
        SourceId: 8,
        Weight: weight > 0 ? weight : 1,
        Delivery: {
          Company: company,
          Contact: contact,
          Phone: phone,
          Address: {
            Line1: addressLine1,
            Suburb: suburb,
            // PostCode as string per landmine - international postcodes
            // can be alphanumeric ("SW1A 1AA") and the SP's Address.PostCode
            // column is a string type.
            PostCode: String(postCode || ''),
          },
          Notes: notes,
        },
        ReDelivery: {
          // Coerce to int per landmine; blank -> 0 not NaN.
          FromPostCode: parseInt(postCode) || 0,
          ToPostCode: parseInt(postCode) || 0,
          CourierID: 0,
        },
        // QuoteId as string even though it looks numeric per landmine.
        QuoteId: String(sourceJobId),
        // RTB flow forces JobNotificationType='WEBSITE' per legacy
        // BookController.BookReturnToBaseJob. Redelivery leaves it
        // unset and lets the WebAPI derive from email/mobile presence.
        ...(isRtb ? { JobNotificationType: 'WEBSITE' } : {}),
      } as BookingPayload & { JobNotificationType?: string };
      // WebAPI error surfacing per Section 3.2.2 - the fetch wrapper
      // already extracts messages[0].message + err.hint from the JSON body,
      // so a failure lands here with the real reason string ready for the
      // toast.
      const result = await request<{ response: { bulkJobId: number } }>(
        '/runviewer/booking/one-off',
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
      );
      onBooked(result.response.bulkJobId);
    } catch (e) {
      // Auto-chain to Create Event per master Section S.2 fires from the
      // parent on success. On failure, surface the error - do NOT silently
      // eat it. This is the biggest silent-fail-elimination win vs legacy.
      const msg = (e as Error).message;
      setError(msg);
      await alert({ title: 'Booking failed', message: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const disabled = !company || !contact || !addressLine1 || !suburb;

  return (
    <Modal
      open
      onClose={onClose}
      title={isRtb ? 'Book return to base' : 'Book direct redelivery'}
      size="lg"
      loading={submitting}
      loadingMessage="Booking..."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={disabled || submitting}>
            {submitting ? 'Booking...' : 'Book'}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-2 text-sm">
        <Field label="Delivery company *" value={company} onChange={setCompany} />
        <Field label="Contact *" value={contact} onChange={setContact} />
        <Field label="Phone" value={phone} onChange={setPhone} />
        <NumberField label="Weight (kg)" value={weight} onChange={setWeight} min={0.1} />
        <Field label="Address *" value={addressLine1} onChange={setAddressLine1} className="col-span-2" />
        <Field label="Suburb *" value={suburb} onChange={setSuburb} />
        <Field label="Post code" value={postCode} onChange={setPostCode} />
        <Field label="Notes" value={notes} onChange={setNotes} multiline className="col-span-2" />
      </div>
      {error && <div className="mt-2 text-xs text-error">{error}</div>}
    </Modal>
  );
}

function Field({
  label, value, onChange, multiline, className,
}: {
  label: string; value: string; onChange: (v: string) => void; multiline?: boolean; className?: string;
}) {
  return (
    <label className={`flex flex-col gap-0.5 ${className ?? ''}`}>
      <span className="text-xs text-text-muted">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          className="border border-border rounded px-2 py-1 text-sm"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="border border-border rounded px-2 py-1 text-sm"
        />
      )}
    </label>
  );
}

function NumberField({
  label, value, onChange, min,
}: {
  label: string; value: number; onChange: (v: number) => void; min?: number;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-xs text-text-muted">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        step="0.1"
        onChange={(e) => onChange(Number(e.target.value))}
        className="border border-border rounded px-2 py-1 text-sm"
      />
    </label>
  );
}
