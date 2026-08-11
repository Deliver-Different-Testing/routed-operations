import { useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { request } from '../../services/api';

// Route Viewer Create Client Intel dialog (master Section 7.16). Wraps
// tucClientIntel + tucClientIntelPhoto - stores per-mobile delivery
// intel like "Dangerous Dog", access notes, photos. Photo capture
// deferred to P7b (needs File API + S3 upload pipe); P7 core supports
// notes + dangerous-dog flag which cover the two most common CS
// scenarios.

interface Props {
  mobile: string;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateIntelDialog({ mobile, onClose, onCreated }: Props) {
  const [dangerousDog, setDangerousDog] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      // Endpoint lives on the events controller because ClientIntel
      // is a CS-module concern that ships with the event surface.
      await request('/runviewer/events/client-intel', {
        method: 'POST',
        body: JSON.stringify({
          mobile,
          dog: dangerousDog,
          hasPhoto: false,
          notes,
          photoDescription: null,
          isNew: true,
        }),
      });
      onCreated();
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
      title="Create client intel"
      size="md"
      loading={submitting}
      loadingMessage="Saving intel..."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!notes || submitting}>
            {submitting ? 'Saving...' : 'Save'}
          </Button>
        </div>
      }
    >
      <div className="text-sm text-text-muted mb-2">
        Intel for mobile: <span className="font-mono text-text-primary">{mobile}</span>
      </div>

      <label className="flex items-center gap-2 cursor-pointer text-sm mb-2">
        <input
          type="checkbox"
          checked={dangerousDog}
          onChange={(e) => setDangerousDog(e.target.checked)}
          className="accent-brand-cyan"
        />
        Dangerous Dog
      </label>

      <label className="flex flex-col gap-0.5 text-sm">
        <span className="text-xs text-text-muted">Additional delivery notes *</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          className="border border-border rounded px-2 py-1"
        />
      </label>

      <div className="mt-2 text-[10px] text-text-muted">
        Photo upload lands in P7b (S3 upload pipe not yet wired to the intel endpoint).
      </div>

      {error && <div className="mt-2 text-xs text-error">{error}</div>}
    </Modal>
  );
}
