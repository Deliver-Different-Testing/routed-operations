// src/modules/schedules/components/ClientsTab.tsx
//
// "Who can book this schedule" — the link-row view of a schedule.
//   • visibility: All clients (default, no link rows) vs Specific clients (link rows)
//   • attached clients with Remove
//   • overrides of this base (same route, different values), and create-override
// Rules live in utils/clientLinks; this component only renders and calls back.

import { useState } from 'react';
import { UserPlus, Users } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { AttachClientsModal } from './AttachClientsModal';
import type { ClientReference, Schedule } from '../types';
import { getClientIds, getVisibility } from '../types';
import { attachBlocker, baseOf, clientLabel, overridesOf, overrideForClient } from '../utils/clientLinks';

export interface ClientsTabProps {
  schedule: Schedule;
  allSchedules: Schedule[];
  clients: ClientReference[];
  /** Unsaved (new) schedule: overrides are not available yet. */
  isNew?: boolean;
  onChangeVisibility: (visibility: 'all' | 'specific') => void;
  onAttach: (clientIds: number[]) => void;
  onDetach: (clientId: number) => void;
  /** Create an override of this schedule for one client (moves the client's link). */
  onCreateOverride?: (clientId: number) => void;
  onOpenOverride?: (override: Schedule) => void;
}

export function ClientsTab({
  schedule,
  allSchedules,
  clients,
  isNew = false,
  onChangeVisibility,
  onAttach,
  onDetach,
  onCreateOverride,
  onOpenOverride,
}: ClientsTabProps) {
  const [attachOpen, setAttachOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const visibility = getVisibility(schedule);
  const linked = getClientIds(schedule);
  const isOverride = schedule.isOverride;
  const base = isOverride ? baseOf(allSchedules, schedule) : null;
  const overrides = isOverride ? [] : overridesOf(allSchedules, schedule);

  return (
    <div className="space-y-6" data-testid="clients-tab" aria-label="clients tab">
      {/* Visibility */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Who can book this schedule</h3>
        <div className="grid gap-2">
          <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${visibility === 'all' ? 'border-brand-cyan bg-brand-cyan/5' : 'border-border'} ${isOverride ? 'opacity-50 cursor-not-allowed' : ''}`}>
            <input
              type="radio"
              name="schedule-visibility"
              className="mt-0.5 border-border text-brand-cyan focus:ring-brand-cyan"
              checked={visibility === 'all'}
              disabled={isOverride}
              onChange={() => onChangeVisibility('all')}
            />
            <span>
              <span className="block text-sm font-medium text-text-primary">All clients (default)</span>
              <span className="block text-xs text-text-secondary">Available to every client with no schedule of its own for this run. No link rows.</span>
            </span>
          </label>
          <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${visibility === 'specific' ? 'border-brand-cyan bg-brand-cyan/5' : 'border-border'}`}>
            <input
              type="radio"
              name="schedule-visibility"
              className="mt-0.5 border-border text-brand-cyan focus:ring-brand-cyan"
              checked={visibility === 'specific'}
              onChange={() => onChangeVisibility('specific')}
            />
            <span>
              <span className="block text-sm font-medium text-text-primary">Specific clients</span>
              <span className="block text-xs text-text-secondary">Only the clients attached below. Each is a row in the schedule/client link table.</span>
            </span>
          </label>
        </div>
      </section>

      {/* Attached clients */}
      {visibility === 'specific' && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Attached clients <span className="font-normal normal-case tracking-normal">· {linked.length} linked</span>
            </h3>
            <Button variant="secondary" size="sm" onClick={() => setAttachOpen(true)}>
              <Users className="w-4 h-4 mr-1" /> Attach clients
            </Button>
          </div>
          <div className="border border-border rounded-lg divide-y divide-border">
            {linked.map((id) => {
              const c = clients.find((x) => x.id === id);
              return (
                <div key={id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="font-medium text-text-primary">{c?.name ?? `Client ${id}`}</span>
                  <span className="text-xs text-text-muted">{c?.shortName} · {id}</span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={() => onDetach(id)}
                    className="text-xs text-text-muted hover:text-error px-2 py-1 rounded hover:bg-error/10"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
            {linked.length === 0 && (
              <div className="px-3 py-5 text-center text-sm text-text-muted">
                No clients attached yet. Attach at least one, or make it available to all clients.
              </div>
            )}
          </div>
        </section>
      )}

      {/* Override context */}
      {isOverride && base && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          This is an override of <span className="font-medium">{base.name}</span> (#{base.id}). Its clients are
          linked here, not on the base — a client is never on both.
        </section>
      )}

      {/* Overrides of this base */}
      {!isOverride && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Client overrides <span className="font-normal normal-case tracking-normal">· same route, different values</span>
            </h3>
            <Button
              variant="secondary"
              size="sm"
              disabled={isNew || !onCreateOverride}
              title={isNew ? 'Save the schedule first' : undefined}
              onClick={() => setOverrideOpen(true)}
            >
              <UserPlus className="w-4 h-4 mr-1" /> Create override for a client…
            </Button>
          </div>
          <div className="border border-border rounded-lg divide-y divide-border">
            {overrides.map((o) => (
              <button
                type="button"
                key={o.id}
                onClick={() => onOpenOverride?.(o)}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm text-left hover:bg-surface-cream"
              >
                <Badge variant="system" size="sm">O</Badge>
                <span className="font-medium text-text-primary">#{o.id}</span>
                <span className="text-xs text-text-secondary">
                  {getClientIds(o).map((id) => clientLabel(clients, id)).join(', ') || 'no clients'}
                </span>
                <span className="flex-1" />
                <span className="text-xs text-text-muted">
                  cut-off {o.operatingSchedule.cutoffValue} {o.operatingSchedule.cutoffUnit}
                  {o.isActive ? '' : ' · inactive'}
                </span>
              </button>
            ))}
            {overrides.length === 0 && (
              <div className="px-3 py-5 text-center text-sm text-text-muted">
                No overrides. Every attached client uses these exact values.
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-text-muted">
            An override is a new ScheduleId with BaseScheduleId = #{schedule.id}. The client's link row moves from
            this schedule to the override.
          </p>
        </section>
      )}

      <AttachClientsModal
        isOpen={attachOpen}
        title={`Attach clients to #${schedule.id}`}
        subtitle={`"${schedule.name}" — each client you tick gets a link row.`}
        clients={clients}
        blockerFor={(id) => attachBlocker(allSchedules, schedule, id)}
        onConfirm={(ids) => {
          setAttachOpen(false);
          onAttach(ids);
        }}
        onClose={() => setAttachOpen(false)}
      />
      <AttachClientsModal
        isOpen={overrideOpen}
        single
        title={`Create override of #${schedule.id}`}
        subtitle={`Pick the client that needs different values on "${schedule.name}". A new ScheduleId is created, based on this one.`}
        confirmLabel="Create override"
        clients={clients}
        blockerFor={(id) => {
          const ov = overrideForClient(allSchedules, schedule, id);
          return ov ? `already has override #${ov.id}` : null;
        }}
        noteFor={(id) => (linked.includes(id) ? 'on the base — will move to the override' : null)}
        onConfirm={(ids) => {
          setOverrideOpen(false);
          if (ids[0] != null) onCreateOverride?.(ids[0]);
        }}
        onClose={() => setOverrideOpen(false)}
      />
    </div>
  );
}
