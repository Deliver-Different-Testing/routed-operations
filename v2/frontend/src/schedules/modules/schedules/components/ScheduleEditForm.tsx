// src/modules/schedules/components/ScheduleEditForm.tsx
import { useState, useMemo, useRef, useCallback } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Users } from 'lucide-react';
import { Toggle } from '../../../components/ui/Toggle';
import { Button } from '../../../components/ui/Button';
import { ChainBuilder } from './ChainBuilder';
import type { ChainBuilderHandle } from './ChainBuilder';
import { validateRoute } from '../utils/routeValidation';
import { DayPillsEditor } from './DayPillsEditor';
import { ClientsTab } from './ClientsTab';
import { DispatchTab } from './DispatchTab';
import { AttachClientsModal } from './AttachClientsModal';
import { Badge } from '../../../components/ui/Badge';
import { attachBlocker, clientLabel, overridesOf, withClientDetached, withClientsAttached, withVisibility } from '../utils/clientLinks';
import { getClientIds, getVisibility } from '../types';
import { sampleLinehaulRuns, sampleRecurringRoutes } from '../dispatch/dispatchData';
import { TimelinePreview } from './TimelinePreview';
import { BookingSimulator } from './BookingSimulator';
import { ClientOverridesTab } from './ClientOverridesTab';
import type { Schedule, ScheduleLeg, LegConfig, LegType, ClientReference } from '../types';
import { BOOKING_MODES, OVERRIDABLE_FIELDS } from '../types';
import {
  sampleDepots,
  sampleSpeeds,
  sampleZones,
  sampleClients,
} from '../data/sampleData';

/** config = Schedule Config · links = Clients (link rows) · clients = Client Overrides · dispatch = routes & runs */
export type EditFormTab = 'config' | 'links' | 'clients' | 'dispatch';
interface ScheduleEditFormProps {
  schedule: Schedule;
  allSchedules?: Schedule[];
  onSave: (schedule: Schedule) => void;
  onCancel: () => void;
  onTabChange?: (tab: EditFormTab) => void;
  isNew?: boolean;
  overrideMode?: boolean;
  baseSchedule?: Schedule;
  overrideClientName?: string;
  /** Routed Operations: clients available for linking (defaults to sample clients). */
  clients?: ClientReference[];
  /** Create an override of this schedule for one client (moves that client's link row). */
  onCreateOverride?: (base: Schedule, clientId: number) => void;
  /** Open an existing override of this schedule. */
  onOpenOverride?: (override: Schedule) => void;
}

function valuesDiffer(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

function readOverrideValue(schedule: Schedule, field: string): unknown {
  if (field === 'operatingSchedule.cutoffValue') return schedule.operatingSchedule.cutoffValue;
  if (field === 'operatingSchedule.days') return schedule.operatingSchedule.days;
  return schedule[field as keyof Schedule];
}

export function ScheduleEditForm({
  schedule: initialSchedule,
  allSchedules = [],
  onSave,
  onCancel,
  onTabChange,
  isNew = false,
  overrideMode = false,
  baseSchedule,
  overrideClientName,
  clients = sampleClients,
  onCreateOverride,
  onOpenOverride,
}: ScheduleEditFormProps) {
  const [attachOpen, setAttachOpen] = useState(false);
  const [formSchedule, setFormSchedule] = useState<Schedule>(initialSchedule);
  const [selectedLegId, setSelectedLegId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<EditFormTab>('config');
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle');
  const isOverrideMode = overrideMode || formSchedule.isOverride;
  const [showDescription, setShowDescription] = useState(isOverrideMode || Boolean(initialSchedule.description || initialSchedule.displayDescription));

  const chainBuilderRef = useRef<ChainBuilderHandle>(null);

  // SHOULD-FIX 14: Dirty-state tracking
  const isDirty = useMemo(() => {
    return JSON.stringify(formSchedule) !== JSON.stringify(initialSchedule);
  }, [formSchedule, initialSchedule]);

  const handleTabChange = (tab: EditFormTab) => {
    setActiveTab(tab);
    onTabChange?.(tab);
  };

  const clientOverrideCount = useMemo(
    () => overridesOf(allSchedules, formSchedule).length,
    [allSchedules, formSchedule],
  );
  const linkedClientIds = getClientIds(formSchedule);
  const visibility = getVisibility(formSchedule);

  const [expandedSections, setExpandedSections] = useState({
    chain: true,
    timeline: true,
    testSchedule: false,
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // Handlers
  const handleNameChange = (value: string) => {
    if (isOverrideMode) {
      setFormSchedule((prev) => ({ ...prev, displayName: value || undefined }));
      return;
    }
    setFormSchedule((prev) => ({ ...prev, name: value }));
  };
  const handleDescriptionChange = (value: string) => {
    if (isOverrideMode) {
      setFormSchedule((prev) => ({ ...prev, displayDescription: value || undefined }));
      return;
    }
    setFormSchedule((prev) => ({ ...prev, description: value }));
  };
  const handleActiveToggle = (checked: boolean) => {
    setFormSchedule((prev) => ({ ...prev, isActive: checked }));
  };
  const handleBookingModeChange = (mode: 'fixed_time' | 'window') => {
    setFormSchedule((prev) => ({ ...prev, bookingMode: mode }));
  };
  const handleLegUpdate = (legId: number, config: LegConfig) => {
    setFormSchedule((prev) => ({
      ...prev,
      legs: prev.legs.map((leg) => (leg.id === legId ? { ...leg, config } : leg)),
    }));
  };

  const handleSelectLeg = useCallback((legId: number) => {
    if (selectedLegId === legId) {
      setSelectedLegId(null);
    } else {
      setSelectedLegId(legId);
    }
  }, [selectedLegId]);

  const handleAddLeg = (afterLegId: number, type: LegType) => {
    const newLegId = Date.now();
    const afterLeg = formSchedule.legs.find((l) => l.id === afterLegId);
    const insertOrder = afterLegId === 0 ? 0 : afterLeg ? afterLeg.order + 1 : formSchedule.legs.length;

    let newConfig: LegConfig;
    switch (type) {
      case 'collection':
        newConfig = { type: 'collection', speedId: undefined, additionalItemChargingLogic: 'none', pickupZoneIds: [], pickupTimeMode: 'window', pickupWindowStart: '14:00', pickupWindowEnd: '16:00', bookFromClientAddress: false, createPickupJob: true, pickupSource: 'client_address' };
        break;
      case 'depot':
        newConfig = { type: 'depot', depotId: sampleDepots[0].id, dropoffLocationId: undefined, storageState: undefined };
        break;
      case 'linehaul':
        newConfig = { type: 'linehaul', speedId: undefined, additionalItemChargingLogic: 'none', runId: undefined, fromDepotId: undefined, toDepotId: undefined, dayOffset: 1, activeDays: ['mon', 'tue', 'wed', 'thu', 'fri'], transitMinutes: 600, insertToBulk: true };
        break;
      case 'delivery':
        newConfig = { type: 'delivery', speedId: undefined, additionalItemChargingLogic: 'none', deliveryZoneIds: [], deliveryState: undefined };
        break;
    }

    const shiftedLegs = formSchedule.legs.map((leg) =>
      leg.order >= insertOrder ? { ...leg, order: leg.order + 1 } : leg
    );
    const newLeg: ScheduleLeg = { id: newLegId, order: insertOrder, config: newConfig };
    const updatedLegs = [...shiftedLegs, newLeg]
      .sort((a, b) => a.order - b.order)
      .map((leg, index) => ({ ...leg, order: index }));

    setFormSchedule((prev) => ({ ...prev, legs: updatedLegs }));
    setSelectedLegId(newLegId);
  };

  const handleRemoveLeg = (legId: number) => {
    if (!window.confirm('Are you sure you want to delete this leg?')) return;
    const updatedLegs = formSchedule.legs
      .filter((leg) => leg.id !== legId)
      .map((leg, index) => ({ ...leg, order: index }));
    setFormSchedule((prev) => ({ ...prev, legs: updatedLegs }));
    if (selectedLegId === legId) {
      setSelectedLegId(null);
    }
  };

  const handleOperatingScheduleChange = (operatingSchedule: Schedule['operatingSchedule']) => {
    setFormSchedule((prev) => ({ ...prev, operatingSchedule }));
  };

  // MUST-FIX 6: Save success feedback
  const handleSave = () => {
    if (isOverrideMode && baseSchedule) {
      const changedFields = [
        ...OVERRIDABLE_FIELDS.map(({ field }) => field),
        'isActive',
        'bookingMode',
        'displayName',
        'displayDescription',
      ].filter((field) => valuesDiffer(readOverrideValue(formSchedule, field), readOverrideValue(baseSchedule, field)));

      onSave({
        ...formSchedule,
        overriddenFields: changedFields,
        updatedAt: new Date().toISOString(),
      });
    } else {
      onSave(formSchedule);
    }
    setSaveState('saved');
    setTimeout(() => setSaveState('idle'), 2000);
  };

  // Timeline back-calculation: editing cutoff day/time in timeline writes back to cutoffValue/cutoffUnit
  const handleTimelineFieldChange = useCallback((field: string, value: any) => {
    if (field === 'cutoffValue' || field === 'cutoffUnit') {
      setFormSchedule((prev) => ({
        ...prev,
        operatingSchedule: {
          ...prev.operatingSchedule,
          [field]: value,
        },
      }));
    }
  }, []);

  // Click-to-navigate from timeline — scroll to network map and open popover on correct node
  const handleTimelineStepClick = useCallback((legId: number) => {
    chainBuilderRef.current?.selectLeg(legId);
  }, []);

  const routeErrors = useMemo(() => validateRoute(formSchedule.legs), [formSchedule.legs]);

  const headerName = isOverrideMode
    ? formSchedule.displayName || baseSchedule?.displayName || baseSchedule?.name || formSchedule.name
    : formSchedule.name;
  const headerDescription = isOverrideMode
    ? formSchedule.displayDescription || baseSchedule?.displayDescription || baseSchedule?.description || ''
    : formSchedule.description || '';

  // Determine save button text
  const saveButtonText = saveState === 'saved'
    ? '✅ Saved'
    : isOverrideMode
      ? 'Save Override'
      : isNew
        ? 'Create Schedule'
        : isDirty
          ? 'Save Changes'
          : 'Saved';

  return (
    <div
      className={`space-y-4 ${!formSchedule.isActive ? 'opacity-60' : ''} ${
        isOverrideMode ? 'rounded-lg border-2 border-amber-300 bg-amber-50/30 p-3' : ''
      }`}
      data-testid="schedule-edit-form"
      aria-label="schedule edit form"
    >
      {isOverrideMode && (
        <div
          className="rounded-lg border border-amber-200 bg-[repeating-linear-gradient(135deg,rgba(251,191,36,0.16)_0,rgba(251,191,36,0.16)_8px,rgba(255,255,255,0.72)_8px,rgba(255,255,255,0.72)_16px)] p-1"
          data-testid="override-mode-banner"
        >
          <div className="flex items-start gap-3 rounded-md border-l-4 border-amber-500 bg-white/95 p-4">
            <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-amber-300 bg-amber-100 text-amber-700">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-amber-950">
                Editing client override · {overrideClientName || 'Client'}
              </h3>
              <p className="mt-1 text-sm font-medium text-text-secondary">
                Based on {baseSchedule?.name || formSchedule.baseScheduleName || formSchedule.name}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                Same delivery-route editor. Non-overridable fields are locked in place for this client override.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* MUST-FIX 1 & 3 & 5: Top header bar with name, active, day pills, booking mode */}
      <div className="bg-white rounded-lg border border-border p-4">
        <div className="flex items-start gap-4 flex-wrap">
          {/* Editable name — large inline input */}
          <div className="flex-1 min-w-[200px]">
            {isOverrideMode && (
              <div className="mb-1 flex items-center gap-2">
                <label htmlFor="schedule-display-name" className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Display Name
                </label>
                <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                  New
                </span>
              </div>
            )}
            <input
              id={isOverrideMode ? 'schedule-display-name' : undefined}
              aria-label={isOverrideMode ? 'Display Name' : 'Schedule Name'}
              type="text"
              value={headerName}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder={isOverrideMode ? baseSchedule?.name || 'Display Name' : 'Schedule Name'}
              className="text-2xl font-bold text-text-primary bg-transparent border-none outline-none w-full placeholder:text-text-muted focus:ring-0 p-0"
            />
            {/* Description — small expandable subtitle */}
            {showDescription || headerDescription ? (
              <div className={isOverrideMode ? 'mt-2' : ''}>
                {isOverrideMode && (
                  <div className="mb-1 flex items-center gap-2">
                    <label htmlFor="schedule-display-description" className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                      Display Description
                    </label>
                    <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                      New
                    </span>
                  </div>
                )}
                <textarea
                  id={isOverrideMode ? 'schedule-display-description' : undefined}
                  aria-label={isOverrideMode ? 'Display Description' : 'Schedule Description'}
                  value={headerDescription}
                  onChange={(e) => handleDescriptionChange(e.target.value)}
                  placeholder={isOverrideMode ? baseSchedule?.description || 'Display Description' : 'Add a description...'}
                  className="w-full mt-1 text-sm text-text-secondary bg-transparent border-none outline-none resize-none placeholder:text-text-muted focus:ring-0 p-0"
                  rows={isOverrideMode ? 2 : 1}
                  onBlur={() => {
                    if (!headerDescription && !isOverrideMode) setShowDescription(false);
                  }}
                />
              </div>
            ) : (
              <button
                onClick={() => setShowDescription(true)}
                className="text-xs text-text-muted hover:text-brand-cyan mt-1"
              >
                + Add description
              </button>
            )}
          </div>

          {/* Right side controls */}
          <div className="flex items-center gap-4 flex-wrap">
            <Toggle label="Active" checked={formSchedule.isActive} onChange={handleActiveToggle} />
            <div className="flex items-center gap-2">
              {BOOKING_MODES.map((mode) => (
                <label key={mode.value} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="bookingMode" value={mode.value} checked={formSchedule.bookingMode === mode.value} onChange={() => handleBookingModeChange(mode.value)} className="border-border text-brand-cyan focus:ring-brand-cyan w-3.5 h-3.5" />
                  <span className="text-xs text-text-secondary">{mode.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Day Pills — MUST-FIX 3: moved here from network map */}
        {activeTab === 'config' && (
          <div className="mt-3 pt-3 border-t border-border/50">
            <DayPillsEditor
              schedule={formSchedule.operatingSchedule}
              onChange={handleOperatingScheduleChange}
            />
          </div>
        )}
        {/* Routed Operations: CLIENTS row — who can book this schedule (link rows, never the day-row ClientId) */}
        {activeTab === 'config' && (
          <div className="mt-3 pt-3 border-t border-border/50 flex items-center gap-3 flex-wrap" data-testid="clients-row">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-muted w-[120px]">Clients</span>
            {isOverrideMode ? (
              <span className="text-xs text-text-secondary">
                Override for {linkedClientIds.map((id) => clientLabel(clients, id)).join(', ') || overrideClientName || '—'}
              </span>
            ) : (
              <>
                <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                  <input type="radio" name="visibility" className="border-border text-brand-cyan focus:ring-brand-cyan w-3.5 h-3.5" checked={visibility === 'all'} onChange={() => setFormSchedule((prev) => withVisibility(prev, 'all'))} />
                  All clients (default)
                </label>
                <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                  <input type="radio" name="visibility" className="border-border text-brand-cyan focus:ring-brand-cyan w-3.5 h-3.5" checked={visibility === 'specific'} onChange={() => setFormSchedule((prev) => withVisibility(prev, 'specific'))} />
                  Specific
                </label>
                {visibility === 'all' ? (
                  <Badge variant="green" size="sm">All clients</Badge>
                ) : (
                  <span className="flex items-center gap-1 flex-wrap">
                    {linkedClientIds.map((id) => (
                      <Badge key={id} variant="system" size="sm">
                        {clientLabel(clients, id)}
                        <button type="button" aria-label={`Remove ${clientLabel(clients, id)}`} className="ml-1 text-text-muted hover:text-error" onClick={() => setFormSchedule((prev) => withClientDetached(prev, id))}>×</button>
                      </Badge>
                    ))}
                    <button type="button" onClick={() => setAttachOpen(true)} className="text-xs text-brand-cyan hover:text-brand-dark font-medium">+ Attach clients</button>
                    {linkedClientIds.length === 0 && <span className="text-xs text-text-muted">no clients yet</span>}
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* MUST-FIX 5: "Delivery Route" (was "Network Map") */}
      <div className="bg-gradient-to-r from-surface-cream to-white rounded-lg border-2 border-brand-cyan/20">
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-text-primary">Delivery Route</h3>
              <span className="text-xs text-brand-cyan bg-brand-cyan/10 px-2 py-0.5 rounded">
                {formSchedule.legs.length} legs
              </span>
            </div>
          </div>

          <ChainBuilder
            ref={chainBuilderRef}
            schedule={formSchedule}
            selectedLegId={activeTab === 'config' ? selectedLegId : null}
            onSelectLeg={activeTab === 'config' ? handleSelectLeg : () => {}}
            onUpdateLeg={activeTab === 'config' ? handleLegUpdate : undefined}
            onAddLeg={activeTab === 'config' && !isOverrideMode ? handleAddLeg : undefined}
            onRemoveLeg={activeTab === 'config' && !isOverrideMode ? handleRemoveLeg : undefined}
            readOnly={activeTab === 'clients'}
            lockedStructure={isOverrideMode}
            overrideMode={isOverrideMode}
            depots={sampleDepots}
            speeds={sampleSpeeds}
            zones={sampleZones}
          />
          {routeErrors.length > 0 && (
            <div className="mt-3 space-y-1">
              {routeErrors.map((err, i) => (
                <div key={i} className={`text-xs px-3 py-1.5 rounded ${
                  err.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-yellow-50 text-yellow-700'
                }`}>
                  {err.type === 'error' ? '❌' : '⚠️'} {err.message}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      {!isOverrideMode && (
        <div className="flex border-b border-border bg-white rounded-lg overflow-hidden shadow-sm">
          <button
            onClick={() => handleTabChange('config')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'config'
                ? 'text-brand-cyan border-b-2 border-brand-cyan bg-brand-cyan/5'
                : 'text-text-muted hover:text-text-primary hover:bg-surface-cream'
            }`}
          >
            Schedule Config
          </button>
          <button
            onClick={() => handleTabChange('links')}
            data-testid="tab-links"
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'links'
                ? 'text-brand-cyan border-b-2 border-brand-cyan bg-brand-cyan/5'
                : 'text-text-muted hover:text-text-primary hover:bg-surface-cream'
            }`}
          >
            Clients
            {visibility === 'specific' && (
              <span className="px-1.5 py-0.5 text-xs rounded-full bg-brand-cyan/10 text-brand-dark">{linkedClientIds.length}</span>
            )}
          </button>
          <button
            onClick={() => !isNew && handleTabChange('clients')}
            disabled={isNew}
            title={isNew ? 'Available once the schedule is saved' : undefined}
            data-testid="tab-overrides"
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
              activeTab === 'clients'
                ? 'text-brand-purple border-b-2 border-brand-purple bg-brand-purple/5'
                : 'text-text-muted hover:text-text-primary hover:bg-surface-cream'
            }`}
          >
            <Users className="w-4 h-4" />
            Client Overrides
            {clientOverrideCount > 0 && (
              <span className="px-1.5 py-0.5 text-xs rounded-full bg-brand-purple/10 text-brand-purple">
                {clientOverrideCount}
              </span>
            )}
          </button>
          <button
            onClick={() => handleTabChange('dispatch')}
            data-testid="tab-dispatch"
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'dispatch'
                ? 'text-brand-cyan border-b-2 border-brand-cyan bg-brand-cyan/5'
                : 'text-text-muted hover:text-text-primary hover:bg-surface-cream'
            }`}
          >
            Dispatch
          </button>
        </div>
      )}

      {/* Config Tab Content */}
      {activeTab === 'config' && (
        <>
          {/* MUST-FIX 5: "Weekly Schedule" (was "Timeline Preview") */}
          <div className="bg-white rounded-lg border border-border">
            <button
              onClick={() => toggleSection('timeline')}
              className="w-full flex items-center justify-between p-4 text-left hover:bg-surface-cream transition-colors"
            >
              <h3 className="text-sm font-semibold text-text-primary">Weekly Schedule</h3>
              {expandedSections.timeline ? <ChevronUp className="w-5 h-5 text-text-muted" /> : <ChevronDown className="w-5 h-5 text-text-muted" />}
            </button>
            {expandedSections.timeline && (
              <div className="p-4 pt-0 space-y-4">
                <TimelinePreview
                  schedule={formSchedule}
                  onStepClick={handleTimelineStepClick}
                  onFieldChange={handleTimelineFieldChange}
                />
              </div>
            )}
          </div>

          {/* MUST-FIX 5: "Booking Tester" (was "Test Schedule") */}
          <div className="bg-white rounded-lg border border-border">
            <button
              onClick={() => toggleSection('testSchedule')}
              className="w-full flex items-center justify-between p-4 text-left hover:bg-surface-cream transition-colors"
            >
              <h3 className="text-sm font-semibold text-text-primary">Booking Tester</h3>
              {expandedSections.testSchedule ? <ChevronUp className="w-5 h-5 text-text-muted" /> : <ChevronDown className="w-5 h-5 text-text-muted" />}
            </button>
            {expandedSections.testSchedule && (
              <div className="p-4 pt-0">
                <BookingSimulator schedule={formSchedule} />
              </div>
            )}
          </div>
        </>
      )}

      {/* Routed Operations: Clients (link rows) */}
      {activeTab === 'links' && (
        <div className="bg-white rounded-lg border border-border p-4">
          <ClientsTab
            schedule={formSchedule}
            allSchedules={allSchedules}
            clients={clients}
            isNew={isNew}
            onChangeVisibility={(v) => setFormSchedule((prev) => withVisibility(prev, v))}
            onAttach={(ids) => setFormSchedule((prev) => withClientsAttached(prev, ids))}
            onDetach={(id) => setFormSchedule((prev) => withClientDetached(prev, id))}
            onCreateOverride={onCreateOverride ? (clientId) => onCreateOverride(formSchedule, clientId) : undefined}
            onOpenOverride={onOpenOverride}
          />
        </div>
      )}
      {/* Routed Operations: Dispatch (routes, runs, master job) */}
      {activeTab === 'dispatch' && (
        <div className="bg-white rounded-lg border border-border p-4">
          <DispatchTab schedule={formSchedule} allSchedules={allSchedules} routes={sampleRecurringRoutes} runs={sampleLinehaulRuns} />
        </div>
      )}
      <AttachClientsModal
        isOpen={attachOpen}
        title={`Attach clients to ${formSchedule.name || 'this schedule'}`}
        subtitle="Each client you tick gets a row in the schedule/client link table."
        clients={clients}
        blockerFor={(id) => attachBlocker(allSchedules, formSchedule, id)}
        onConfirm={(ids) => { setAttachOpen(false); setFormSchedule((prev) => withClientsAttached(prev, ids)); }}
        onClose={() => setAttachOpen(false)}
      />
      {/* Client Overrides Tab */}
      {activeTab === 'clients' && !isOverrideMode && (
        <div className="bg-white rounded-lg border border-border min-h-[400px]">
          <ClientOverridesTab baseSchedule={formSchedule} allSchedules={allSchedules} onSaveOverride={onSave} />
        </div>
      )}

      {/* Action Buttons — SHOULD-FIX 14: dirty state indicator */}
      <div className="flex items-center justify-end gap-3 p-4 bg-surface-cream rounded-lg border border-border">
        {isDirty && (
          <span className="text-sm text-orange-600 font-medium mr-auto">● Unsaved changes</span>
        )}
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={handleSave}>{saveButtonText}</Button>
      </div>
    </div>
  );
}
