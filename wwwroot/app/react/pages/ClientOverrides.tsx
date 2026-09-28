import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { scheduleService, type LookupItem } from '../services/scheduleService';
import { schedulesV2Service, type ClientOverrideRef } from '../services/schedulesV2Service';
import { ScheduleDetailModal, type OverrideEditContext } from '../components/schedules-new/ScheduleDetailModal';
import { AttachClientsModal } from '../components/schedules-new/AttachClientsModal';
import { useAuth } from '../context/AuthContext';

/**
 * Client-first overrides view (Steve F1 UI polish item H, 2026-09-24).
 *
 * The "differs from N schedules" surface ops actually wants. Pick a
 * client, see every schedule they own a delta on, jump into the
 * schedule's detail modal to inspect or edit the delta. Impossible
 * on the schedule-first Schedules NEW page because that would need
 * opening every one of ~2,725 schedules to spot the ones the client
 * has diverged from.
 *
 * Data:
 *   GET /api/v2/clients/{clientId}/overrides -> ClientOverrideRef[]
 *   (backed by ScheduleOverrideService.ListForClientAsync)
 *
 * Interaction:
 *   Row click -> open ScheduleDetailModal on that scheduleId; the
 *   Client Overrides tab surfaces the actual delta rows for editing.
 */

// Small in-memory cache of resolved LookupItem -> clientId so that
// re-selecting the same client from the picker doesn't re-hit search.
// LookupItem.id IS the LegacyClientId that the overrides endpoint
// wants (see ScheduleService.SearchClients projection).

const SCOPE_LABELS: Record<string, string> = {
  schedule: 'Schedule',
  collection: 'Collection',
  delivery: 'Delivery',
  depot: 'Depot',
};

function ScopeChip({ scope }: { scope: string }) {
  const label = SCOPE_LABELS[scope] ?? scope;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-brand-cyan/15 text-brand-cyan">
      {label}
    </span>
  );
}

function formatUpdated(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

interface ClientPickerProps {
  selected: LookupItem | null;
  onSelect: (client: LookupItem | null) => void;
}

/** Single-select client picker with debounced server-side search.
 *  Shares the search endpoint the multi-select picker uses so the
 *  server hit is identical; the local shape is simpler (no chips,
 *  no Set). */
function SingleClientPicker({ selected, onSelect }: ClientPickerProps) {
  const [filter, setFilter] = useState('');
  const [results, setResults] = useState<LookupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    debounceRef.current = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await scheduleService.searchClients(filter.trim());
        setResults(res.response ?? []);
      } catch (e) {
        setError((e as Error).message);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, [filter]);

  return (
    <div>
      <label className="block text-xs uppercase tracking-wide text-text-muted mb-1">
        Client
      </label>
      {selected ? (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-brand-cyan/10 text-sm">
            <span className="font-medium">{selected.name}</span>
          </span>
          <button
            type="button"
            onClick={() => { onSelect(null); setFilter(''); }}
            className="text-xs text-text-muted hover:text-text underline"
          >
            change
          </button>
        </div>
      ) : (
        <>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter clients by code / name..."
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface-white focus:outline-none focus:ring-1 focus:ring-brand-cyan"
            autoFocus
          />
          <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border bg-white">
            {loading && (
              <div className="p-3 text-[11px] text-text-muted italic">Searching...</div>
            )}
            {error && (
              <div className="p-3 text-[11px] text-red-600 italic">{error}</div>
            )}
            {!loading && !error && results.length === 0 && (
              <div className="p-3 text-[11px] text-text-muted italic">
                {filter.trim() ? 'No clients match.' : 'Type to search clients.'}
              </div>
            )}
            {!loading && !error && results.slice(0, 100).map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => onSelect(c)}
                className="w-full text-left px-3 py-1.5 text-xs border-b border-border-light last:border-b-0 hover:bg-surface-cream"
              >
                {c.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface RowProps {
  row: ClientOverrideRef;
  onOpen: (scheduleId: number) => void;
}

function OverrideRow({ row, onOpen }: RowProps) {
  const sortedScopes = useMemo(() => [...row.scopes].sort(), [row.scopes]);
  return (
    <tr
      onClick={() => onOpen(row.scheduleId)}
      className="cursor-pointer border-b border-border-light hover:bg-surface-cream"
    >
      <td className="px-3 py-2 text-sm font-medium">{row.scheduleName}</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {sortedScopes.map((s) => <ScopeChip key={s} scope={s} />)}
        </div>
      </td>
      <td className="px-3 py-2 text-xs text-text-muted">{formatUpdated(row.updatedUtc)}</td>
    </tr>
  );
}

export default function ClientOverrides() {
  const auth = useAuth();
  const tenantId = auth.currentTenantId ?? 0;
  const [selectedClient, setSelectedClient] = useState<LookupItem | null>(null);
  const [openScheduleId, setOpenScheduleId] = useState<number | null>(null);
  // Kevin 2026-09-25: this page's row-click opens the same
  // ScheduleDetailModal in override-edit mode for the currently selected
  // client (the whole point of the page IS a per-client override edit).
  const [openOverride, setOpenOverride] = useState<OverrideEditContext | null>(null);
  const [attachScheduleId, setAttachScheduleId] = useState<number | null>(null);

  const overridesQuery = useQuery({
    queryKey: ['client-overrides', tenantId, selectedClient?.id],
    queryFn: () => schedulesV2Service.clientOverrides(selectedClient!.id),
    enabled: selectedClient !== null,
    staleTime: 30_000,
  });

  const rows = overridesQuery.data ?? [];

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-4">
        <h1 className="text-lg font-semibold">Client overrides</h1>
        <p className="text-xs text-text-muted mt-0.5">
          Pick a client to see every schedule they have a delta on.
          Click a row to open the schedule and edit the delta.
        </p>
      </div>

      <div className="mb-6 p-4 border border-border rounded-lg bg-white">
        <SingleClientPicker selected={selectedClient} onSelect={setSelectedClient} />
      </div>

      {selectedClient && (
        <div className="border border-border rounded-lg bg-white overflow-hidden">
          {overridesQuery.isLoading && (
            <div className="p-6 text-sm text-text-muted italic">Loading...</div>
          )}
          {overridesQuery.isError && (
            <div className="p-6 text-sm text-red-600">
              Failed to load: {(overridesQuery.error as Error).message}
            </div>
          )}
          {!overridesQuery.isLoading && !overridesQuery.isError && rows.length === 0 && (
            <div className="p-6 text-sm text-text-muted italic">
              {selectedClient.name} doesn't have any overrides. Every one of their
              bookable schedules matches the shared shape.
            </div>
          )}
          {!overridesQuery.isLoading && !overridesQuery.isError && rows.length > 0 && (
            <>
              <div className="px-3 py-2 bg-surface-cream border-b border-border text-xs uppercase tracking-wide text-text-muted">
                {rows.length} schedule{rows.length === 1 ? '' : 's'} differ{rows.length === 1 ? 's' : ''} from base for {selectedClient.name}
              </div>
              <table className="w-full">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                    <th className="px-3 py-2 font-medium">Schedule</th>
                    <th className="px-3 py-2 font-medium">Differs on</th>
                    <th className="px-3 py-2 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <OverrideRow
                      key={r.scheduleId}
                      row={r}
                      onOpen={(scheduleId) => {
                        if (!selectedClient) return;
                        setOpenOverride({
                          clientId: selectedClient.id,
                          // Client picker exposes id + name only; no code
                          // available on this page, so reuse name for both
                          // fields (the info banner reads clientName first).
                          clientCode: selectedClient.name,
                          clientName: selectedClient.name,
                          deltaLabels: r.scopes,
                        });
                        setOpenScheduleId(scheduleId);
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      <ScheduleDetailModal
        scheduleId={openScheduleId}
        onClose={() => {
          setOpenScheduleId(null);
          setOpenOverride(null);
        }}
        onAttachClients={setAttachScheduleId}
        onOpenSchedule={(id) => {
          // Jumping to a different schedule from within the modal
          // (e.g. via a "Base schedule" link) exits override-edit mode.
          setOpenOverride(null);
          setOpenScheduleId(id);
        }}
        onOpenOverride={(id, client) => {
          setOpenOverride(client);
          setOpenScheduleId(id);
        }}
        overrideMode={openOverride}
      />
      <AttachClientsModal
        scheduleId={attachScheduleId}
        onClose={() => setAttachScheduleId(null)}
      />
    </div>
  );
}
