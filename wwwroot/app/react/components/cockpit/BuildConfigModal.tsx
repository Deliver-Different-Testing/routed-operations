import { useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import type { BuildConfig, BulkJob, RoutingMode, VehicleSize } from '../../types';

interface Props {
  open: boolean;
  config: BuildConfig;
  vehicleSizes: VehicleSize[];
  selectedJobCount: number;
  // For the Finish-at-stop dropdown (Plan §Phase 2 §6.3): only the currently
  // multi-selected jobs are candidates, otherwise picking a stop that isn't
  // going into the build makes no sense.
  selectedJobs: BulkJob[];
  onClose: () => void;
  onSave: (next: BuildConfig) => void;
  onConfirm?: () => void; // when triggered from Build Runs (not the mode indicator)
}

/**
 * Build Runs configuration modal. Direct port of the AngularJS
 * `openBuildRunsConfig` from RunBuilder homeControl.js, adapted to React state.
 */
export function BuildConfigModal({
  open,
  config,
  vehicleSizes,
  selectedJobCount,
  selectedJobs,
  onClose,
  onSave,
  onConfirm,
}: Props) {
  const [draft, setDraft] = useState<BuildConfig>(config);

  // Reset draft whenever modal reopens.
  useEffect(() => { if (open) setDraft(config); }, [open, config]);

  const onSizeChanged = (id: number | 'custom') => {
    setDraft((d) => {
      if (id === 'custom') return { ...d, vehicleSizeId: 'custom' };
      const row = vehicleSizes.find((v) => v.vehicleSizeId === id);
      const cap = row?.cubicCapacity ? Number(row.cubicCapacity) : d.vehicleCubicCap;
      return { ...d, vehicleSizeId: id, vehicleCubicCap: cap };
    });
  };

  const commit = () => {
    if (isNaN(draft.minutesPerStop) || draft.minutesPerStop < 0) {
      alert('Minutes per stop must be a non-negative number.');
      return;
    }
    if (draft.vehicleCapacityEnabled) {
      const cap = Number(draft.vehicleCubicCap);
      if (isNaN(cap) || cap <= 0) {
        alert('Vehicle cubic capacity must be greater than 0.');
        return;
      }
    }
    onSave(draft);
    onConfirm?.();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Build Runs Configuration"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1 text-sm border border-border rounded">
            Cancel
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={!!onConfirm && selectedJobCount === 0}
            className="px-3 py-1 text-sm bg-brand-purple text-white rounded disabled:opacity-50"
            title={onConfirm && selectedJobCount === 0 ? 'Select at least one job first' : 'OK'}
          >
            {onConfirm ? 'Build' : 'Save'}
          </button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <div>
          <div className="font-semibold mb-2">Build Parameter</div>
          <div className="inline-flex border border-border rounded overflow-hidden">
            {(['maxBoxes', 'deliveryWindow'] as const).map((mode) => (
              <label
                key={mode}
                className={`px-4 py-1.5 cursor-pointer text-sm ${
                  draft.buildParameter === mode
                    ? 'bg-brand-cyan text-brand-dark font-medium'
                    : 'bg-surface-white text-text-secondary hover:bg-surface-cream'
                }`}
              >
                <input
                  type="radio"
                  name="bp"
                  value={mode}
                  checked={draft.buildParameter === mode}
                  onChange={() => setDraft({ ...draft, buildParameter: mode })}
                  className="sr-only"
                />
                {mode === 'maxBoxes' ? 'Max Boxes' : 'Delivery Window'}
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="font-semibold mb-2">Minutes per stop / drop</div>
          <div className="inline-flex items-stretch border border-border rounded overflow-hidden w-36">
            <input
              type="number"
              min={0}
              step={1}
              value={draft.minutesPerStop}
              onChange={(e) => setDraft({ ...draft, minutesPerStop: Number(e.target.value) })}
              className="flex-1 border-0 px-2 py-1 text-center text-sm outline-none"
            />
            <span className="px-3 flex items-center bg-surface-cream text-xs text-text-muted border-l border-border">min</span>
          </div>
        </div>

        <div className="border-t border-border-light pt-3">
          <div className="font-semibold mb-2">Routing mode</div>
          <div className="inline-flex border border-border rounded overflow-hidden">
            {([
              { key: 'aToB', label: 'A-B (depot -> furthest)' },
              { key: 'aToA', label: 'A-A (circuit back to depot)' },
              { key: 'finishAtStop', label: 'Finish at nominated stop' },
            ] as { key: RoutingMode; label: string }[]).map((mode) => (
              <label
                key={mode.key}
                className={`px-3 py-1.5 cursor-pointer text-xs ${
                  draft.routingMode === mode.key
                    ? 'bg-brand-purple text-white font-medium'
                    : 'bg-surface-white text-text-secondary hover:bg-surface-cream'
                }`}
              >
                <input
                  type="radio"
                  name="rm"
                  value={mode.key}
                  checked={draft.routingMode === mode.key}
                  onChange={() => setDraft({ ...draft, routingMode: mode.key })}
                  className="sr-only"
                />
                {mode.label}
              </label>
            ))}
          </div>
          {draft.routingMode === 'finishAtStop' && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-text-secondary text-xs">Finish at:</span>
              <select
                value={draft.finishAtBulkJobId ?? ''}
                onChange={(e) => setDraft({
                  ...draft,
                  finishAtBulkJobId: e.target.value ? Number(e.target.value) : null,
                })}
                className="border border-border rounded px-2 py-1 text-xs flex-1"
              >
                <option value="">- pick a stop -</option>
                {selectedJobs.map((j) => (
                  <option key={j.bulkJobId} value={j.bulkJobId}>
                    {j.jobNumber ?? j.bulkJobId} {j.toSuburb ? `- ${j.toSuburb}` : ''}
                  </option>
                ))}
              </select>
              {selectedJobs.length === 0 && (
                <span className="text-xs text-warning">Select jobs first</span>
              )}
            </div>
          )}
          <label className="mt-2 inline-flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={draft.noReroute}
              onChange={(e) => setDraft({ ...draft, noReroute: e.target.checked })}
            />
            Fix route (driver app cannot reroute)
          </label>
          <label className="mt-1 block inline-flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={draft.respectPickupCutoff}
              onChange={(e) => setDraft({ ...draft, respectPickupCutoff: e.target.checked })}
            />
            Respect pickup cutoff (schedule.PickupCutoff)
          </label>
        </div>

        <div className="border-t border-border-light pt-3">
          <label className="inline-flex items-center gap-2 font-semibold">
            <input
              type="checkbox"
              checked={draft.vehicleCapacityEnabled}
              onChange={(e) => setDraft({ ...draft, vehicleCapacityEnabled: e.target.checked })}
            />
            Vehicle Capacity
          </label>

          {draft.vehicleCapacityEnabled && (
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span className="text-text-secondary">Vehicle:</span>
              <select
                value={String(draft.vehicleSizeId)}
                onChange={(e) => {
                  const v = e.target.value;
                  onSizeChanged(v === 'custom' ? 'custom' : Number(v));
                }}
                className="border border-border rounded px-2 py-1 text-sm"
              >
                {vehicleSizes.map((v) => (
                  <option key={v.vehicleSizeId} value={v.vehicleSizeId}>
                    {v.vehicleName} ({v.cubicCapacity} m3)
                  </option>
                ))}
                <option value="custom">Custom</option>
              </select>
              {draft.vehicleSizeId === 'custom' ? (
                <>
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={draft.vehicleCubicCap}
                    onChange={(e) => setDraft({ ...draft, vehicleCubicCap: Number(e.target.value) })}
                    className="w-20 border border-border rounded px-2 py-1 text-sm text-center"
                  />
                  <span className="text-text-secondary">m3</span>
                </>
              ) : (
                <span>Cubic: <strong>{draft.vehicleCubicCap}</strong> m3</span>
              )}
            </div>
          )}
        </div>

        {onConfirm && selectedJobCount === 0 && (
          <div className="mt-2 p-3 bg-warning-bg border-l-4 border-warning text-xs text-text-secondary">
            <strong>Select at least one job</strong> in the Jobs pane before building.
          </div>
        )}
      </div>
    </Modal>
  );
}
