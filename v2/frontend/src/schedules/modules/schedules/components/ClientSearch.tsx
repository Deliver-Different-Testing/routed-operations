// src/modules/schedules/components/ClientSearch.tsx
import { useState, useMemo } from 'react';
import { Search, Check } from 'lucide-react';
import type { ClientReference, Schedule } from '../types';

interface ClientSearchProps {
  clients: ClientReference[];
  schedules: Schedule[]; // To check which clients have overrides
  baseScheduleId: number;
  selectedClientId: number | null;
  onSelectClient: (clientId: number | null) => void;
}

export function ClientSearch({
  clients,
  schedules,
  baseScheduleId,
  selectedClientId,
  onSelectClient,
}: ClientSearchProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Find which clients have overrides for this base schedule
  const clientsWithOverrides = useMemo(() => {
    const overrideClientIds = new Set<number>();
    schedules.forEach((s) => {
      if (s.isOverride && s.id === baseScheduleId) {
        if (s.clientId != null) overrideClientIds.add(s.clientId);
      }
    });
    return overrideClientIds;
  }, [schedules, baseScheduleId]);

  // Filter clients by search
  const filteredClients = useMemo(() => {
    if (!searchQuery.trim()) return clients;
    const query = searchQuery.toLowerCase();
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        c.shortName?.toLowerCase().includes(query)
    );
  }, [clients, searchQuery]);

  return (
    <div className="space-y-3" data-testid="client-search" aria-label="client search">
      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search clients..."
          className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg
                     focus:outline-none focus:ring-2 focus:ring-brand-cyan focus:border-transparent
                     bg-white placeholder-text-muted"
        />
      </div>

      {/* Client list */}
      <div className="max-h-[200px] overflow-y-auto border border-border rounded-lg divide-y divide-border">
        {filteredClients.length === 0 ? (
          <div className="p-3 text-sm text-text-muted text-center">
            No clients found
          </div>
        ) : (
          filteredClients.map((client) => {
            const hasOverride = clientsWithOverrides.has(client.id);
            const isSelected = selectedClientId === client.id;

            return (
              <button
                key={client.id}
                onClick={() => onSelectClient(isSelected ? null : client.id)}
                className={`
                  w-full px-3 py-2.5 text-left text-sm transition-colors
                  flex items-center justify-between
                  ${isSelected
                    ? 'bg-brand-cyan/10 border-l-2 border-l-brand-cyan'
                    : 'hover:bg-surface-cream'
                  }
                `}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-text-primary truncate">
                    {client.name}
                  </span>
                  {client.shortName && (
                    <span className="text-text-muted text-xs">
                      ({client.shortName})
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {hasOverride ? (
                    <span className="flex items-center gap-1 text-xs text-brand-purple">
                      <Check className="w-3 h-3" />
                      Override
                    </span>
                  ) : (
                    <span className="text-xs text-text-muted">
                      No override
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Selected client info */}
      {selectedClientId && (
        <div className="text-xs text-text-muted">
          {clientsWithOverrides.has(selectedClientId)
            ? 'Click to edit existing override'
            : 'Click to create new override for this client'
          }
        </div>
      )}
    </div>
  );
}
