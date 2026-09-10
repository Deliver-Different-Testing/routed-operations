// src/modules/schedules/components/LegConfigPanel.tsx
import { Trash2, X } from 'lucide-react';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { Toggle } from '../../../components/ui/Toggle';
import { ZoneSelector } from './ZoneSelector';
import type { ScheduleLeg, LegConfig } from '../types';
import {
  sampleSpeeds,
  sampleZones,
  sampleDepots,
  sampleDropoffLocations,
  sampleLinehaulRuns,
} from '../data/sampleData';
import { ADDITIONAL_ITEM_CHARGING_OPTIONS, TEMPERATURE_STATES } from '../types';

interface LegConfigPanelProps {
  leg: ScheduleLeg | null;
  onUpdate: (legId: number, config: LegConfig) => void;
  onDelete?: (legId: number) => void;
  onClose: () => void;
  inline?: boolean;
  overrideMode?: boolean;
}

export function LegConfigPanel({ leg, onUpdate, onDelete, onClose, inline = false, overrideMode = false }: LegConfigPanelProps) {
  if (!leg) return null;

  const handleUpdate = (updates: Partial<LegConfig>) => {
    onUpdate(leg.id, { ...leg.config, ...updates } as LegConfig);
  };

  const isLocked = (field: string): boolean => {
    if (!overrideMode) return false;
    if (leg.config.type === 'collection') {
      return !['speedId', 'pickupZoneIds'].includes(field);
    }
    if (leg.config.type === 'linehaul') {
      return field !== 'speedId';
    }
    if (leg.config.type === 'delivery') {
      return !['speedId', 'deliveryZoneIds'].includes(field);
    }
    return true;
  };

  const lockHint = overrideMode ? (
    <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
      Lock icons and disabled controls show base schedule settings. Only client-overridable fields stay editable.
    </div>
  ) : null;

  const renderCollectionFields = () => {
    if (leg.config.type !== 'collection') return null;
    const config = leg.config;

    return (
      <div className="space-y-4" data-testid="collection-leg-config-fields" aria-label="collection leg config fields">
        {/* Pickup Source — answers: where does the freight come from? */}
        <div className="space-y-2" data-testid="collection-pickup-source">
          <label className="block text-sm font-medium text-text-primary">Pickup Source</label>
          <p className="text-xs text-text-muted">Where the freight is collected from when this pickup job runs.</p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {([
              { value: 'client_address', label: 'From customer', help: 'Use the customer address.' },
              { value: 'depot', label: 'From depot', help: 'Pick up from a depot or storage location.' },
              { value: 'booking', label: 'From booking', help: 'Use the booking/API pickup address.' },
            ] as const).map((opt) => (
              <label
                key={opt.value}
                className={`cursor-pointer rounded-lg border p-3 transition-colors ${
                  config.pickupSource === opt.value
                    ? 'border-brand-cyan bg-brand-cyan/10'
                    : 'border-border bg-white hover:bg-surface-cream'
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`pickupSource-${leg.id}`}
                    checked={config.pickupSource === opt.value}
                    disabled={isLocked('pickupSource')}
                    onChange={() => handleUpdate({
                      pickupSource: opt.value,
                      bookFromClientAddress: opt.value === 'client_address',
                      pickupDepotId: opt.value === 'depot' ? (config.pickupDepotId ?? sampleDepots[0]?.id) : undefined,
                    })}
                    className="border-border text-brand-cyan focus:ring-brand-cyan"
                  />
                  <span className="text-sm font-medium text-text-primary">{opt.label}</span>
                </span>
                <span className="mt-1 block text-xs text-text-muted">{opt.help}</span>
              </label>
            ))}
          </div>
          {config.pickupSource === 'depot' && (
            <Select
              label="Origin Depot"
              value={config.pickupDepotId ?? ''}
              onChange={(e) => handleUpdate({ pickupDepotId: e.target.value ? Number(e.target.value) : undefined })}
              disabled={isLocked('pickupDepotId')}
              options={[
                { value: '', label: 'Select depot...' },
                ...sampleDepots.map((d) => ({ value: d.id, label: `${d.name} (${d.code})` })),
              ]}
            />
          )}
        </div>

        {/* Pickup Time Mode */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-text-primary">Pickup Time</label>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="pickupTimeMode"
                checked={config.pickupTimeMode === 'window'}
                disabled={isLocked('pickupTimeMode')}
                onChange={() => handleUpdate({ pickupTimeMode: 'window' })}
                className="border-border text-brand-cyan focus:ring-brand-cyan"
              />
              <span className="text-sm text-text-secondary">Window</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="pickupTimeMode"
                checked={config.pickupTimeMode === 'fixed'}
                disabled={isLocked('pickupTimeMode')}
                onChange={() => handleUpdate({ pickupTimeMode: 'fixed' })}
                className="border-border text-brand-cyan focus:ring-brand-cyan"
              />
              <span className="text-sm text-text-secondary">Fixed Time</span>
            </label>
          </div>
          {config.pickupTimeMode === 'window' && (
            <div className="flex items-center gap-2">
              <Input
                type="time"
                value={config.pickupWindowStart || '14:00'}
                onChange={(e) => handleUpdate({ pickupWindowStart: e.target.value })}
                className="w-32"
                label="Start"
                disabled={isLocked('pickupTime')}
              />
              <Input
                type="time"
                value={config.pickupWindowEnd || '15:00'}
                onChange={(e) => handleUpdate({ pickupWindowEnd: e.target.value })}
                className="w-32"
                label="End"
                disabled={isLocked('pickupTime')}
              />
            </div>
          )}
          {config.pickupTimeMode === 'fixed' && (
            <Input
              type="time"
              value={config.lockedCollectionTime || '17:00'}
              onChange={(e) => handleUpdate({ lockedCollectionTime: e.target.value })}
              className="w-32"
              label="Fixed Time"
              disabled={isLocked('pickupTime')}
            />
          )}
        </div>

        <Select
          label="Speed"
          value={config.speedId || ''}
          onChange={(e) => handleUpdate({ speedId: e.target.value ? Number(e.target.value) : undefined })}
          disabled={isLocked('speedId')}
          options={[
            { value: '', label: 'Select speed...' },
            ...sampleSpeeds.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />

        <Select
          label="Additional Item Charging"
          value={config.additionalItemChargingLogic || 'none'}
          onChange={(e) => handleUpdate({ additionalItemChargingLogic: e.target.value as any })}
          disabled={isLocked('additionalItemChargingLogic')}
          options={ADDITIONAL_ITEM_CHARGING_OPTIONS}
        />

        <ZoneSelector
          label="Pickup Zones"
          selectedZoneIds={config.pickupZoneIds}
          onChange={(zoneIds) => handleUpdate({ pickupZoneIds: zoneIds })}
          helpText="Select zones where pickup is available"
          zones={sampleZones}
          disabled={isLocked('pickupZoneIds')}
        />

        <Toggle
          label="Create Pickup Job"
          checked={config.createPickupJob}
          onChange={(checked) => handleUpdate({ createPickupJob: checked })}
          disabled={isLocked('createPickupJob')}
        />
      </div>
    );
  };

  const renderDepotFields = () => {
    if (leg.config.type !== 'depot') return null;
    const config = leg.config;

    const depotDropoffs = sampleDropoffLocations.filter(
      (loc) => loc.depotId === config.depotId
    );

    return (
      <div className="space-y-4">
        <Select
          label="Depot"
          value={config.depotId}
          onChange={(e) => handleUpdate({ depotId: Number(e.target.value) })}
          disabled={isLocked('depotId')}
          options={sampleDepots.map((d) => ({ value: d.id, label: `${d.name} (${d.code})` }))}
        />

        {depotDropoffs.length > 0 && (
          <Select
            label="Dropoff Location"
            value={config.dropoffLocationId || ''}
            onChange={(e) => handleUpdate({ dropoffLocationId: e.target.value ? Number(e.target.value) : undefined })}
            disabled={isLocked('dropoffLocationId')}
            options={[
              { value: '', label: 'Select location...' },
              ...depotDropoffs.map((loc) => ({ value: loc.id, label: loc.name })),
            ]}
          />
        )}

        <Select
          label="Storage State"
          value={config.storageState || ''}
          onChange={(e) => handleUpdate({ storageState: e.target.value as any })}
          disabled={isLocked('storageState')}
          options={[
            { value: '', label: 'Select state...' },
            ...TEMPERATURE_STATES.map((t) => ({ value: t.value, label: t.label })),
          ]}
        />
      </div>
    );
  };

  const renderLinehaulFields = () => {
    if (leg.config.type !== 'linehaul') return null;
    const config = leg.config;

    // Planned improvement: auto-populate config from sampleLinehaulRuns when runId changes
    return (
      <div className="space-y-4">
        <Select
          label="Speed"
          value={config.speedId || ''}
          onChange={(e) => handleUpdate({ speedId: e.target.value ? Number(e.target.value) : undefined })}
          disabled={isLocked('speedId')}
          options={[
            { value: '', label: 'Select speed...' },
            ...sampleSpeeds.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />

        <Select
          label="Additional Item Charging"
          value={config.additionalItemChargingLogic || 'none'}
          onChange={(e) => handleUpdate({ additionalItemChargingLogic: e.target.value as any })}
          disabled={isLocked('additionalItemChargingLogic')}
          options={ADDITIONAL_ITEM_CHARGING_OPTIONS}
        />

        <Select
          label="Linehaul Run"
          value={config.runId || ''}
          onChange={(e) => handleUpdate({ runId: e.target.value ? Number(e.target.value) : undefined })}
          disabled={isLocked('runId')}
          options={[
            { value: '', label: 'Select run...' },
            ...sampleLinehaulRuns.map((r) => ({ value: r.id, label: r.name })),
          ]}
        />

        {config.runId && (
          <div className="space-y-3 p-3 bg-surface-cream rounded-lg border border-border">
            <p className="text-xs font-medium text-text-muted uppercase tracking-wide">Inherited from run</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-text-muted text-xs">Day Offset</span>
                <p className="text-text-primary font-medium">{config.dayOffset} day(s)</p>
              </div>
              <div>
                <span className="text-text-muted text-xs">Transit</span>
                <p className="text-text-primary font-medium">{config.transitMinutes} min</p>
              </div>
            </div>
            <div>
              <span className="text-text-muted text-xs">Active Days</span>
              <p className="text-text-primary font-medium">
                {config.activeDays.length > 0
                  ? config.activeDays.map(d => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(', ')
                  : 'None'}
              </p>
            </div>
          </div>
        )}

        {!config.runId && (
          <p className="text-sm text-text-muted italic p-3 bg-surface-cream rounded-lg">
            Select a linehaul run to auto-populate transit time, day offset, and active days.
          </p>
        )}

        <Toggle
          label="Insert to Bulk"
          checked={config.insertToBulk}
          onChange={(checked) => handleUpdate({ insertToBulk: checked })}
          disabled={isLocked('insertToBulk')}
        />
      </div>
    );
  };

  const renderDeliveryFields = () => {
    if (leg.config.type !== 'delivery') return null;
    const config = leg.config;

    return (
      <div className="space-y-4">
        <Select
          label="Speed"
          value={config.speedId || ''}
          onChange={(e) => handleUpdate({ speedId: e.target.value ? Number(e.target.value) : undefined })}
          disabled={isLocked('speedId')}
          options={[
            { value: '', label: 'Select speed...' },
            ...sampleSpeeds.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />

        <Select
          label="Additional Item Charging"
          value={config.additionalItemChargingLogic || 'none'}
          onChange={(e) => handleUpdate({ additionalItemChargingLogic: e.target.value as any })}
          disabled={isLocked('additionalItemChargingLogic')}
          options={ADDITIONAL_ITEM_CHARGING_OPTIONS}
        />

        <ZoneSelector
          label="Delivery Zones"
          selectedZoneIds={config.deliveryZoneIds}
          onChange={(zoneIds) => handleUpdate({ deliveryZoneIds: zoneIds })}
          helpText="Select zones where delivery is available"
          zones={sampleZones}
          disabled={isLocked('deliveryZoneIds')}
        />

        <Select
          label="Delivery State"
          value={config.deliveryState || ''}
          onChange={(e) => handleUpdate({ deliveryState: e.target.value as any })}
          disabled={isLocked('deliveryState')}
          options={[
            { value: '', label: 'Select state...' },
            ...TEMPERATURE_STATES.map((t) => ({ value: t.value, label: t.label })),
          ]}
        />

        <Select
          label="Assigned Driver (Temp)"
          value={config.courierId || ''}
          onChange={(e) => handleUpdate({ courierId: e.target.value ? Number(e.target.value) : undefined })}
          disabled={isLocked('courierId')}
          options={[
            { value: '', label: 'Auto-assign' },
            { value: 142, label: 'Driver #142 — J. Smith' },
            { value: 287, label: 'Driver #287 — A. Brown' },
            { value: 391, label: 'Driver #391 — M. Wilson' },
          ]}
        />
        <p className="text-xs text-text-muted italic">
          (Temp — until auto-dispatch)
        </p>
      </div>
    );
  };

  return (
    <div data-testid="leg-config-panel" aria-label="leg config panel">
      {/* Header */}
      {!inline && (
        <div className="flex items-center justify-between p-3 border-b border-border bg-surface-light">
          <h3 className="text-sm font-semibold text-text-primary">
            Configure {leg.config.type.charAt(0).toUpperCase() + leg.config.type.slice(1)}
          </h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {/* Content */}
      <div className={inline ? '' : 'p-3'}>
        {lockHint}
        {leg.config.type === 'collection' && renderCollectionFields()}
        {leg.config.type === 'depot' && renderDepotFields()}
        {leg.config.type === 'linehaul' && renderLinehaulFields()}
        {leg.config.type === 'delivery' && renderDeliveryFields()}
        {!inline && onDelete && (
          <div className="mt-4 pt-3 border-t border-border">
            <button
              onClick={() => onDelete(leg.id)}
              className="inline-flex items-center gap-2 text-sm font-medium text-red-600 hover:text-red-700"
            >
              <Trash2 className="w-4 h-4" />
              Delete leg
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
