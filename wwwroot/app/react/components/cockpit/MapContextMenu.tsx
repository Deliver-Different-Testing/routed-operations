import { useEffect } from 'react';
import type { Run } from '../../types';

export interface MapContextTarget {
  bulkJobId: number;
  jobNumber: string | null;
  kind: 'pickup' | 'delivery';
  runId: number | null;
  clientX: number;
  clientY: number;
}

interface Props {
  target: MapContextTarget | null;
  runs: Run[];
  onClose: () => void;
  onSelectJob: (jobId: number) => void;
  onAddToRun: (jobId: number, runId: number) => void;
  onRemoveFromRun: (jobId: number) => void;
  onTransferToRun: (jobId: number, fromRunId: number | null, toRunId: number) => void;
  // Optional Set End - only shown when the pin belongs to a real run (runId
  // is non-null). Legacy analogue: setJobEndFromMap in HereMap.tpl:144-148.
  onSetEnd?: (jobId: number, runId: number) => void;
}

/**
 * Right-click context menu on the HERE map. Direct port of the legacy
 * addToRunFromMap / removeJobFromMap / transferToAnotherRunFromMap /
 * selectJobFromMap actions. Rendered in a fixed-position overlay at the
 * mouse pointer; auto-closes on outside click or Escape.
 */
export function MapContextMenu({
  target,
  runs,
  onClose,
  onSelectJob,
  onAddToRun,
  onRemoveFromRun,
  onTransferToRun,
  onSetEnd,
}: Props) {
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onClick = () => onClose();
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    // See RowContextMenu note: no document-level contextmenu listener - it
    // would self-close on the same event that opened the menu due to React 18
    // batching. Marker right-clicks REPLACE target atomically via GoogleMap's
    // marker rightclick handler.
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, [target, onClose]);

  if (!target) return null;

  const otherRuns = runs.filter((r) => r.id !== target.runId);

  return (
    <ul
      className="fixed z-50 bg-surface-white border border-border rounded shadow-lg text-xs min-w-56"
      style={{ top: target.clientY, left: target.clientX }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      <li className="px-3 py-2 bg-surface-cream border-b border-border-light font-medium text-text-primary">
        {target.jobNumber ?? `Job ${target.bulkJobId}`}
        <span className="ml-2 text-text-muted font-normal">({target.kind})</span>
      </li>

      <MenuItem
        label="Select this job"
        onClick={() => { onSelectJob(target.bulkJobId); onClose(); }}
      />

      {target.runId != null ? (
        <>
          {onSetEnd && (
            <MenuItem
              label="Set as end point"
              onClick={() => { onSetEnd(target.bulkJobId, target.runId!); onClose(); }}
            />
          )}
          <MenuItem
            label="Remove from current run"
            danger
            onClick={() => { onRemoveFromRun(target.bulkJobId); onClose(); }}
          />
          <li className="border-t border-border-light px-3 py-1 bg-surface-cream text-text-muted uppercase tracking-wide text-[10px]">
            Transfer to run
          </li>
        </>
      ) : (
        <li className="border-t border-border-light px-3 py-1 bg-surface-cream text-text-muted uppercase tracking-wide text-[10px]">
          Add to run
        </li>
      )}

      {otherRuns.length === 0 && (
        <li className="px-3 py-2 text-text-muted italic">No other runs available.</li>
      )}
      {otherRuns.map((r) => (
        <MenuItem
          key={r.id}
          label={`${r.name} (${r.jobs.length} jobs)`}
          onClick={() => {
            if (target.runId != null) {
              onTransferToRun(target.bulkJobId, target.runId, r.id);
            } else {
              onAddToRun(target.bulkJobId, r.id);
            }
            onClose();
          }}
        />
      ))}
    </ul>
  );
}

function MenuItem({
  label,
  onClick,
  danger,
}: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`w-full text-left px-3 py-1.5 hover:bg-surface-cream ${
          danger ? 'text-error' : 'text-text-primary'
        }`}
      >
        {label}
      </button>
    </li>
  );
}
