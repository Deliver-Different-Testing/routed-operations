// src/modules/schedules/components/SideBySideOverrideEditor.tsx
import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Lock } from 'lucide-react';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { Toggle } from '../../../components/ui/Toggle';
import { Button } from '../../../components/ui/Button';
import { ChainBuilder } from './ChainBuilder';
import { OperatingScheduleSection } from './OperatingScheduleSection';
import type { Schedule } from '../types';
import { BOOKING_MODES } from '../types';
import { sampleDepots, sampleSpeeds, sampleZones } from '../data/sampleData';

interface ClientReference {
  id: string;
  name: string;
  shortName?: string;
}

/** Props for the SideBySideOverrideEditor component. */
interface SideBySideOverrideEditorProps {
  baseSchedule: Schedule;
  clientId: string;
  client: ClientReference;
  existingOverride: Schedule | null;
  onSave: (schedule: Schedule) => void;
  onCancel: () => void;
}

/** Side-by-side comparison editor for base vs client override schedule settings. */
export function SideBySideOverrideEditor({
  baseSchedule,
  clientId,
  client,
  existingOverride,
  onSave,
  onCancel,
}: SideBySideOverrideEditorProps) {
  // Initialize form state from existing override or base schedule
  const [formSchedule, setFormSchedule] = useState<Schedule>(() => {
    if (existingOverride) {
      return { ...existingOverride };
    }
    // Create new override from base
    return {
      ...baseSchedule,
      id: Date.now(),
      name: `${baseSchedule.name} (${client.shortName || client.name})`,
      isOverride: true,
      baseScheduleId: baseSchedule.id,
      overriddenFields: [],
      clientVisibility: 'specific',
      clientIds: [Number(clientId)], clientId: Number(clientId),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  // Collapsible sections state
  const [expandedSections, setExpandedSections] = useState({
    details: true,
    overview: true,
    operating: true,
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // Reset form when client changes
  useEffect(() => {
    if (existingOverride) {
      setFormSchedule({ ...existingOverride });
    } else {
      setFormSchedule({
        ...baseSchedule,
        id: Date.now(),
        name: `${baseSchedule.name} (${client.shortName || client.name})`,
        isOverride: true,
        overriddenFields: [],
        clientIds: [Number(clientId)], clientId: Number(clientId),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }, [clientId, existingOverride, baseSchedule, client]);

  // Handlers
  const handleNameChange = (value: string) => {
    setFormSchedule((prev) => ({ ...prev, name: value }));
  };

  const handleDescriptionChange = (value: string) => {
    setFormSchedule((prev) => ({ ...prev, description: value }));
  };

  const handleActiveToggle = (checked: boolean) => {
    setFormSchedule((prev) => ({ ...prev, isActive: checked }));
  };

  const handleBookingModeChange = (mode: Schedule['bookingMode']) => {
    setFormSchedule((prev) => ({ ...prev, bookingMode: mode }));
  };

  const handleSpeedChange = (
    field: 'speedId' | 'pickupRatingSpeed' | 'parentSpeedId',
    value: string
  ) => {
    setFormSchedule((prev) => ({ ...prev, [field]: value || undefined }));
  };

  const handleOperatingScheduleChange = (operatingSchedule: Schedule['operatingSchedule']) => {
    setFormSchedule((prev) => ({ ...prev, operatingSchedule }));
  };

  const handleSave = () => {
    // Track which fields differ from base
    const overriddenFields: string[] = [];

    if (formSchedule.name !== baseSchedule.name) overriddenFields.push('name');
    if (formSchedule.description !== baseSchedule.description) overriddenFields.push('description');
    if (formSchedule.isActive !== baseSchedule.isActive) overriddenFields.push('isActive');
    if (formSchedule.bookingMode !== baseSchedule.bookingMode) overriddenFields.push('bookingMode');
    if (formSchedule.speedId !== baseSchedule.speedId) overriddenFields.push('speedId');
    if (formSchedule.pickupRatingSpeed !== baseSchedule.pickupRatingSpeed) overriddenFields.push('pickupRatingSpeed');
    if (formSchedule.parentSpeedId !== baseSchedule.parentSpeedId) overriddenFields.push('parentSpeedId');
    if (JSON.stringify(formSchedule.operatingSchedule) !== JSON.stringify(baseSchedule.operatingSchedule)) {
      overriddenFields.push('operatingSchedule');
    }

    onSave({
      ...formSchedule,
      updatedAt: new Date().toISOString(),
    });
  };

  const hasChanges = (
    formSchedule.name !== baseSchedule.name ||
    formSchedule.description !== baseSchedule.description ||
    formSchedule.isActive !== baseSchedule.isActive ||
    formSchedule.bookingMode !== baseSchedule.bookingMode ||
    formSchedule.speedId !== baseSchedule.speedId ||
    formSchedule.pickupRatingSpeed !== baseSchedule.pickupRatingSpeed ||
    formSchedule.parentSpeedId !== baseSchedule.parentSpeedId ||
    JSON.stringify(formSchedule.operatingSchedule) !== JSON.stringify(baseSchedule.operatingSchedule)
  );

  return (
    <div className="flex flex-col h-full" data-testid="side-by-side-override-editor" aria-label="side by side override editor">
      {/* Header */}
      <div className="p-4 border-b border-border bg-brand-purple/5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-brand-purple/20 flex items-center justify-center">
            <span className="text-sm font-semibold text-brand-purple">
              {client.shortName?.charAt(0) || client.name.charAt(0)}
            </span>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-text-primary">{client.name}</h3>
            <p className="text-xs text-text-muted">
              {existingOverride ? 'Edit Override' : 'Create Override'} • Based on "{baseSchedule.name}"
            </p>
          </div>
        </div>
      </div>

      {/* Form Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Network Map - LOCKED (cannot change per client) */}
        <div className="bg-gray-100 rounded-lg border border-gray-300 opacity-70">
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-gray-500" />
                <h3 className="text-sm font-semibold text-gray-500">Network Map</h3>
                <span className="text-xs text-gray-400 bg-gray-200 px-2 py-0.5 rounded">
                  {baseSchedule.legs.length} legs • Cannot change per client
                </span>
              </div>
            </div>
            <ChainBuilder
              schedule={baseSchedule}
              selectedLegId={null}
              onSelectLeg={() => {}}
              readOnly={true}
              depots={sampleDepots}
              speeds={sampleSpeeds}
              zones={sampleZones}
            />
          </div>
        </div>

        {/* Schedule Details - EDITABLE */}
        <div className="bg-white rounded-lg border border-border">
          <button
            onClick={() => toggleSection('details')}
            className="w-full flex items-center justify-between p-4 text-left hover:bg-surface-cream transition-colors"
          >
            <h3 className="text-sm font-semibold text-text-primary">Schedule Details</h3>
            {expandedSections.details ? (
              <ChevronUp className="w-5 h-5 text-text-muted" />
            ) : (
              <ChevronDown className="w-5 h-5 text-text-muted" />
            )}
          </button>
          {expandedSections.details && (
            <div className="p-4 pt-0 space-y-4">
              <Input
                label="Override Name"
                value={formSchedule.name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g., Next Day Standard (ACME)"
                required
              />
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Description
                </label>
                <textarea
                  value={formSchedule.description || ''}
                  onChange={(e) => handleDescriptionChange(e.target.value)}
                  placeholder="Custom description for this client..."
                  className="w-full px-3 py-2 rounded-lg border border-border bg-white text-text-primary
                           placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-purple
                           focus:border-brand-purple transition-colors resize-none"
                  rows={2}
                />
              </div>
              <Toggle
                label="Active"
                checked={formSchedule.isActive}
                onChange={handleActiveToggle}
              />
            </div>
          )}
        </div>

        {/* Overview Section - EDITABLE */}
        <div className="bg-white rounded-lg border border-border">
          <button
            onClick={() => toggleSection('overview')}
            className="w-full flex items-center justify-between p-4 text-left hover:bg-surface-cream transition-colors"
          >
            <h3 className="text-sm font-semibold text-text-primary">Booking & Speeds</h3>
            {expandedSections.overview ? (
              <ChevronUp className="w-5 h-5 text-text-muted" />
            ) : (
              <ChevronDown className="w-5 h-5 text-text-muted" />
            )}
          </button>
          {expandedSections.overview && (
            <div className="p-4 pt-0 space-y-4">
              <Select
                label="Booking Mode"
                value={formSchedule.bookingMode}
                onChange={(e) => handleBookingModeChange(e.target.value as Schedule['bookingMode'])}
                options={BOOKING_MODES.map((m) => ({ value: m.value, label: m.label }))}
              />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Select
                  label="Delivery Speed"
                  value={formSchedule.speedId || ''}
                  onChange={(e) => handleSpeedChange('speedId', e.target.value)}
                  options={[
                    { value: '', label: 'None' },
                    ...sampleSpeeds.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                />
                <Select
                  label="Pickup Speed"
                  value={formSchedule.pickupRatingSpeed || ''}
                  onChange={(e) => handleSpeedChange('pickupRatingSpeed', e.target.value)}
                  options={[
                    { value: '', label: 'None' },
                    ...sampleSpeeds.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                />
                <Select
                  label="Linehaul Speed"
                  value={formSchedule.parentSpeedId || ''}
                  onChange={(e) => handleSpeedChange('parentSpeedId', e.target.value)}
                  options={[
                    { value: '', label: 'None' },
                    ...sampleSpeeds.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                />
              </div>
            </div>
          )}
        </div>

        {/* Operating Schedule - EDITABLE */}
        <div className="bg-white rounded-lg border border-border">
          <button
            onClick={() => toggleSection('operating')}
            className="w-full flex items-center justify-between p-4 text-left hover:bg-surface-cream transition-colors"
          >
            <h3 className="text-sm font-semibold text-text-primary">Operating Schedule</h3>
            {expandedSections.operating ? (
              <ChevronUp className="w-5 h-5 text-text-muted" />
            ) : (
              <ChevronDown className="w-5 h-5 text-text-muted" />
            )}
          </button>
          {expandedSections.operating && (
            <div className="p-4 pt-0">
              <OperatingScheduleSection
                schedule={formSchedule.operatingSchedule}
                onChange={handleOperatingScheduleChange}
              />
            </div>
          )}
        </div>
      </div>

      {/* Footer Actions */}
      <div className="p-4 border-t border-border bg-surface-cream flex items-center justify-between">
        <div className="text-sm text-text-muted">
          {hasChanges ? (
            <span className="text-yellow-600 font-medium">
              ● Unsaved changes
            </span>
          ) : (
            <span className="text-text-muted">No changes from base schedule</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave}>
            {existingOverride ? 'Save Changes' : 'Create Override'}
          </Button>
        </div>
      </div>
    </div>
  );
}
