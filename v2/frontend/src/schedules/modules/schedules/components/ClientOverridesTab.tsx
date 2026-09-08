// src/modules/schedules/components/ClientOverridesTab.tsx
import { useState, useMemo, useEffect } from 'react';
import { Search, ArrowLeft } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { ScheduleEditForm } from './ScheduleEditForm';
import type { Schedule } from '../types';
import { sampleClients, sampleSpeeds } from '../data/sampleData';
import { detectOverrideConflicts } from '../utils/conflictDetection';

interface ClientOverridesTabProps {
  baseSchedule: Schedule;
  allSchedules: Schedule[];
  onSaveOverride: (schedule: Schedule) => void;
}

export function ClientOverridesTab({
  baseSchedule,
  allSchedules,
  onSaveOverride,
}: ClientOverridesTabProps) {
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [clientSearch, setClientSearch] = useState('');

  // Get existing overrides for this base schedule
  const existingOverrides = useMemo(() => {
    return allSchedules.filter(
      (s) => s.isOverride && s.baseScheduleName === baseSchedule.name
    );
  }, [allSchedules, baseSchedule.id]);

  // Map clientId to their override
  const clientOverrideMap = useMemo(() => {
    const map = new Map<number, Schedule>();
    existingOverrides.forEach((override) => {
      if (override.clientId != null) {
        map.set(override.clientId, override);
      }
    });
    return map;
  }, [existingOverrides]);

  // Filter and sort clients
  const filteredClients = useMemo(() => {
    let clients = sampleClients;
    if (clientSearch.trim()) {
      const search = clientSearch.toLowerCase();
      clients = clients.filter(
        (client) =>
          client.name.toLowerCase().includes(search) ||
          client.shortName?.toLowerCase().includes(search)
      );
    }
    // Sort: those with overrides first
    return [...clients].sort((a, b) => {
      const aHasOverride = clientOverrideMap.has(a.id);
      const bHasOverride = clientOverrideMap.has(b.id);
      if (aHasOverride && !bHasOverride) return -1;
      if (!aHasOverride && bHasOverride) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [clientSearch, clientOverrideMap]);

  const selectedClient = selectedClientId != null
    ? sampleClients.find((c) => c.id === selectedClientId)
    : null;

  const existingOverride = selectedClientId != null
    ? clientOverrideMap.get(selectedClientId) || null
    : null;

  // Form state for the override
  const [formSchedule, setFormSchedule] = useState<Schedule | null>(null);

  // Initialize/reset form when client changes
  useEffect(() => {
    if (selectedClientId == null || !selectedClient) {
      setFormSchedule(null);
      return;
    }

    if (existingOverride) {
      setFormSchedule({ ...existingOverride });
    } else {
      setFormSchedule({
        ...baseSchedule,
        id: Date.now(),
        name: `${baseSchedule.name} (${selectedClient.shortName || selectedClient.name})`,
        isOverride: true,
        baseScheduleName: baseSchedule.name,
        clientId: selectedClientId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }, [selectedClientId, selectedClient, existingOverride, baseSchedule]);

  return (
    <div className="flex flex-col h-full" data-testid="client-overrides-tab" aria-label="client overrides tab">
      {/* CONTENT */}
      {selectedClient && formSchedule ? (
        <>
        {/* Back button + header when editing */}
        <div className="bg-surface-light border-b border-border px-4 py-2 flex items-center gap-3">
          <button
            onClick={() => setSelectedClientId(null)}
            className="flex items-center gap-1 text-sm text-brand-cyan hover:text-brand-cyan/80"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to list
          </button>
          <span className="text-sm text-text-muted">
            Editing: <strong>{selectedClient.name}</strong>
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <ScheduleEditForm
            schedule={formSchedule}
            baseSchedule={baseSchedule}
            overrideMode
            overrideClientName={selectedClient.name}
            onSave={onSaveOverride}
            onCancel={() => setSelectedClientId(null)}
          />
        </div>
        </>
      ) : (
        /* Client list table view */
        <div className="flex-1 overflow-y-auto">
          {/* Search + Add Override header */}
          <div className="flex items-center justify-between p-3 border-b border-border bg-surface-light">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder="Search clients..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-cyan focus:border-brand-cyan"
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-text-muted">{existingOverrides.length} override{existingOverrides.length !== 1 ? 's' : ''}</span>
              <Button variant="primary" size="sm" onClick={() => { /* future: client picker modal */ }}>
                + Add Override
              </Button>
            </div>
          </div>

          {/* Client table */}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left bg-surface-light">
                <th className="py-2 px-3 text-xs uppercase text-text-muted font-medium">Client</th>
                <th className="py-2 px-3 text-xs uppercase text-text-muted font-medium">Cutoff</th>
                <th className="py-2 px-3 text-xs uppercase text-text-muted font-medium">Speed</th>
                <th className="py-2 px-3 text-xs uppercase text-text-muted font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.map(client => {
                const override = clientOverrideMap.get(client.id);
                const clientConflicts = override ? detectOverrideConflicts(baseSchedule, override) : [];
                const hasError = clientConflicts.some(c => c.severity === 'error');
                const hasWarning = clientConflicts.some(c => c.severity === 'warning');
                return (
                  <tr
                    key={client.id}
                    onClick={() => setSelectedClientId(client.id)}
                    className="border-b border-border cursor-pointer hover:bg-surface-cream transition-colors"
                  >
                    <td className="py-2 px-3 font-medium">
                      {override ? <span className="text-brand-cyan mr-1">●</span> : null}
                      {client.shortName || client.name}
                    </td>
                    <td className="py-2 px-3 text-text-secondary">
                      {override
                        ? `${override.operatingSchedule.cutoffValue} ${override.operatingSchedule.cutoffUnit}`
                        : 'Default'}
                    </td>
                    <td className="py-2 px-3 text-text-secondary">
                      {override?.speedId
                        ? sampleSpeeds.find(s => s.id === override.speedId)?.name || '—'
                        : 'Default'}
                    </td>
                    <td className="py-2 px-3">
                      {!override ? (
                        <span className="text-text-muted">—</span>
                      ) : hasError ? (
                        <span className="text-red-600">🔴 Conflict</span>
                      ) : hasWarning ? (
                        <span className="text-yellow-600">⚠️ Warning</span>
                      ) : (
                        <span className="text-green-600">✅ OK</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
