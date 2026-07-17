import { useState, useEffect } from 'react';
import type { Run } from '../../types';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';

interface Props {
  open: boolean;
  source: Run | null;
  candidates: Run[];
  onClose: () => void;
  onConfirm: (targetRunId: number) => void;
}

/**
 * Picker for "Merge run into..." from runListMenu. Shows unlocked, non-self
 * runs. Refuses if there is no valid target (all runs locked, or only one
 * run exists).
 */
export function MergeRunModal({ open, source, candidates, onClose, onConfirm }: Props) {
  const [targetId, setTargetId] = useState<number | null>(null);

  useEffect(() => {
    if (open) setTargetId(candidates[0]?.id ?? null);
  }, [open, candidates]);

  if (!source) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Merge "${source.name}" (${source.jobs.length} jobs) into...`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose}>Cancel</Button>
          <Button
            variant="secondary"
            onClick={() => { if (targetId != null) onConfirm(targetId); }}
            disabled={targetId == null}
            data-primary="true"
          >
            Merge
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        {candidates.length === 0 ? (
          <div className="text-warning">
            No valid merge target - every other run is either locked or the same run.
            Unlock a run first, then try again.
          </div>
        ) : (
          <>
            <div className="text-text-muted text-xs">
              Choose the destination run. Jobs move over, the source run is deleted.
            </div>
            <select
              value={targetId ?? ''}
              onChange={(e) => setTargetId(e.target.value ? Number(e.target.value) : null)}
              className="w-full border border-border rounded-lg px-3 py-1.5 text-sm"
              autoFocus
            >
              {candidates.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.jobs.length} jobs{r.courierName ? `, ${r.courierName}` : ''})
                </option>
              ))}
            </select>
          </>
        )}
      </div>
    </Modal>
  );
}
