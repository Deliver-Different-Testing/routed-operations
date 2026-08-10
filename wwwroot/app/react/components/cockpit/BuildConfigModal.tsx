import { useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useAlert } from '../../context/ConfirmContext';
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
  const alert = useAlert();

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
      void alert({ title: 'Invalid value', message: 'Minutes per stop must be a non-negative number.' });
      return;
    }
    if (draft.vehicleCapacityEnabled) {
      const cap = Number(draft.vehicleCubicCap);
      if (isNaN(cap) || cap <= 0) {
        void alert({ title: 'Invalid value', message: 'Vehicle cubic capacity must be greater than 0.' });
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
          <Button variant="neutral" onClick={onClose}>Cancel</Button>
          <Button
            variant="secondary"
            onClick={commit}
            disabled={!!onConfirm && selectedJobCount === 0}
            title={onConfirm && selectedJobCount === 0 ? 'Select at least one job first' : 'OK'}
          >
            {onConfirm ? 'Build' : 'Save'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <div>
          <div className="font-semibold mb-2">Build Parameter</div>
          <PillRadio
            name="bp"
            value={draft.buildParameter}
            options={[
              { key: 'maxBoxes', label: 'Max Boxes' },
              { key: 'deliveryWindow', label: 'Delivery Window' },
            ]}
            onChange={(v) => setDraft({ ...draft, buildParameter: v as BuildConfig['buildParameter'] })}
          />
        </div>

        <div>
          <div className="font-semibold mb-2">Minutes per stop / drop</div>
          <input
            type="number"
            min={0}
            step={1}
            value={draft.minutesPerStop}
            onChange={(e) => setDraft({ ...draft, minutesPerStop: Number(e.target.value) })}
            className={INPUT_CLASS + ' w-24 text-center'}
          />
          <span className="ml-2 text-text-muted">min</span>
        </div>

        <div className="border-t border-border-light pt-3">
          <div className="font-semibold mb-2">Routing mode</div>
          <PillRadio
            name="rm"
            value={draft.routingMode}
            options={ROUTING_MODE_OPTIONS}
            onChange={(v) => setDraft({ ...draft, routingMode: v as RoutingMode })}
          />
          {/* Visible helper below the pills - the tooltip only shows on hover,
              which is easy to miss. Legacy legend text always visible so the
              operator can see what the current mode does at a glance. */}
          <div className="mt-1 text-xs text-text-muted italic">
            {ROUTING_MODE_OPTIONS.find((o) => o.key === draft.routingMode)?.title}
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
                className={SELECT_CLASS + ' flex-1'}
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
          {/* Full-width `flex` (not inline-flex) forces both checkboxes onto
              their own lines instead of trailing the routing-mode pill row. */}
          <label
            className="mt-3 flex items-center gap-2 text-xs"
            title="When ticked, the driver app cannot recalculate the sequence after dispatch."
          >
            <input
              type="checkbox"
              checked={draft.noReroute}
              onChange={(e) => setDraft({ ...draft, noReroute: e.target.checked })}
            />
            Fix route (driver app cannot reroute)
          </label>
          <label
            className="mt-1 flex items-center gap-2 text-xs"
            title="Cap each run so its pickup leg clears within the schedule's PickupCutoff hours."
          >
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
                className={SELECT_CLASS}
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
                    className={INPUT_CLASS + ' w-24 text-center'}
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

/**
 * Shared input / select styling for this modal. Same border weight, padding,
 * radius and text size as the FiltersBar dropdown trigger and the RunList
 * "New run name" input so the whole surface feels like one control family.
 * SELECT_CLASS extends INPUT_CLASS with extra right padding so the browser's
 * native dropdown arrow doesn't overlap the option text.
 */
const INPUT_CLASS = 'border border-border rounded-lg px-3 py-1.5 text-sm bg-surface-white text-text-primary hover:bg-surface-cream focus:outline-none focus:ring-2 focus:ring-brand-cyan/30 focus:border-brand-cyan';
const SELECT_CLASS = INPUT_CLASS + ' pr-8 min-w-[8rem]';

/**
 * Routing mode option definitions - single source of truth so the PillRadio,
 * the visible helper text below the pills, and the tooltip on hover all stay
 * in sync when the labels or descriptions change.
 */
const ROUTING_MODE_OPTIONS: { key: RoutingMode; label: string; title: string }[] = [
  { key: 'aToB', label: 'A-B', title: 'Depot to furthest point (HERE default)' },
  { key: 'aToA', label: 'A-A circuit', title: 'Circuit route - starts at depot and finishes back at depot' },
  { key: 'finishAtStop', label: 'Finish at stop', title: 'Depot to a nominated stop as the final destination' },
];

/**
 * Segmented radio group with a shared visual language for both Build Parameter
 * and Routing mode. Selected pill uses the same cyan tint as every other
 * "active" affordance across the cockpit (Auto Zoom, filter dropdown pills,
 * >100 m3 toggle) - operators shouldn't have to learn a second meaning for
 * purple vs cyan in the same panel.
 */
function PillRadio<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: { key: T; label: string; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex border border-border rounded-lg overflow-hidden whitespace-nowrap">
      {options.map((opt) => (
        <label
          key={opt.key}
          title={opt.title}
          className={`px-3 py-1.5 cursor-pointer text-sm transition-all ${
            value === opt.key
              ? 'bg-brand-cyan text-brand-dark font-medium'
              : 'bg-surface-white text-text-secondary hover:bg-surface-cream'
          }`}
        >
          <input
            type="radio"
            name={name}
            value={opt.key}
            checked={value === opt.key}
            onChange={() => onChange(opt.key)}
            className="sr-only"
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}
