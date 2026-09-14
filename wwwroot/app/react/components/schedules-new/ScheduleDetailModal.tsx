import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../common/Modal';
import { useSchedulesV2Detail } from '../../hooks/queries/useSchedulesV2';
import { schedulesV2Service } from '../../services/schedulesV2Service';
import type { ScheduleGroup } from '../../services/scheduleService';

// Read-only edit modal for the Schedules NEW page (Steve's 2026-09-08
// brief section 2, Schedule modal). 4 tabs matching Dane's live
// prototype: Clients / Route / Operating days / Roster. Every control
// is disabled for Phase 1; writes land in Phase 3 alongside the
// BaseScheduleId + client-attach endpoints.
//
// Reuses ScheduleGroup DTO from scheduleService.ts because the shape
// is identical to the legacy /api/schedules/detail response - the v2
// controller wraps the same ScheduleService.GetDetailAsync.

type ModalTab = 'clients' | 'route' | 'days' | 'roster';

const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface Props {
  scheduleId: number | null;
  onClose: () => void;
}

export function ScheduleDetailModal({ scheduleId, onClose }: Props) {
  const [tab, setTab] = useState<ModalTab>('clients');
  const query = useSchedulesV2Detail(scheduleId);
  const data = query.data;

  const title = data
    ? data.name ?? `Schedule #${data.scheduleId}`
    : 'Schedule';

  return (
    <Modal
      open={scheduleId != null}
      onClose={onClose}
      title={title}
      size="6xl"
      loading={query.isLoading}
      loadingMessage="Loading schedule detail..."
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded border border-border hover:bg-surface-light"
          >
            Close
          </button>
          <button
            type="button"
            disabled
            title="Phase 1 is read-only. Writes land in Phase 3 per Steve's brief section 7."
            className="px-4 py-2 text-sm rounded bg-brand-cyan/40 text-brand-dark/60 cursor-not-allowed"
          >
            Save
          </button>
        </div>
      }
    >
      {query.isError && (
        <div className="text-sm text-error py-8 text-center">
          Failed to load schedule: {(query.error as Error).message}
        </div>
      )}

      {data && (
        <>
          <div className="mb-4 flex items-center gap-3">
            <span className="text-xs text-text-muted">Schedule #{data.scheduleId}</span>
            {data.legacyClientCode && (
              <span className="text-xs bg-warning-bg text-warning px-2 py-0.5 rounded">
                Legacy per-client: {data.legacyClientCode}
              </span>
            )}
          </div>

          <nav
            className="flex gap-6 -mb-px border-b border-border mb-4"
            aria-label="Schedule detail tabs"
          >
            <TabButton active={tab === 'clients'} onClick={() => setTab('clients')}>
              Clients
            </TabButton>
            <TabButton active={tab === 'route'} onClick={() => setTab('route')}>
              Route
            </TabButton>
            <TabButton active={tab === 'days'} onClick={() => setTab('days')}>
              Operating days
            </TabButton>
            <TabButton active={tab === 'roster'} onClick={() => setTab('roster')}>
              Roster
            </TabButton>
          </nav>

          {tab === 'clients' && <ClientsTab data={data} />}
          {tab === 'route' && <RouteTab data={data} />}
          {tab === 'days' && <DaysTab data={data} />}
          {tab === 'roster' && <RosterTab data={data} />}
        </>
      )}
    </Modal>
  );
}

// ─── Tabs ───────────────────────────────────────────────────────────

function ClientsTab({ data }: { data: ScheduleGroup }) {
  const qc = useQueryClient();
  const isDefault = data.legacyClientId == null && data.clientIds.length === 0;
  const detachMut = useMutation({
    mutationFn: (clientId: number) =>
      schedulesV2Service.detachClient(data.scheduleId, clientId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules-v2-list'] });
      qc.invalidateQueries({ queryKey: ['schedules-v2-detail', data.scheduleId] });
    },
  });
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <section>
        <h3 className="text-sm font-semibold text-text-primary mb-3">
          Who can book this schedule
        </h3>
        <div className="space-y-2">
          <RadioRow
            checked={isDefault}
            label="All clients (default)"
            hint="Available to every client with no schedule of its own for this run. No link rows."
          />
          <RadioRow
            checked={!isDefault}
            label="Specific clients"
            hint="Only the clients attached below. Each is a row in the schedule/client link table."
          />
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
          Attached clients
          <span className="text-xs text-text-muted font-normal">
            {data.clientCodes.length} linked
          </span>
        </h3>
        {data.clientCodes.length === 0 && data.legacyClientCode == null && (
          <p className="text-xs text-text-muted italic">
            No clients attached. This is a default schedule.
          </p>
        )}
        {data.legacyClientCode && (
          <div className="mb-2 text-xs px-3 py-2 border border-warning/40 bg-warning-bg/40 rounded">
            Legacy per-client group. Client <strong>{data.legacyClientCode}</strong> owns this
            row via the pre-junction ClientId column; migration to a link row happens on next
            save.
          </div>
        )}
        <ul className="space-y-1">
          {data.clientCodes.map((code, i) => (
            <li
              key={`${code}-${i}`}
              className="flex items-center justify-between text-sm px-3 py-2 border border-border rounded"
            >
              <span>
                <span className="font-medium text-text-primary">{code}</span>
                <span className="text-xs text-text-muted ml-2">
                  #{data.clientIds[i] ?? '?'}
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  const clientId = data.clientIds[i];
                  if (clientId) detachMut.mutate(clientId);
                }}
                disabled={detachMut.isPending}
                className="text-xs text-error hover:text-error-dark hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                title="Detach this client from the schedule."
              >
                {detachMut.isPending ? 'Removing...' : 'Remove'}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          disabled
          className="mt-3 text-sm text-text-muted cursor-not-allowed"
          title="Phase 1 is read-only. Attach lands in Phase 3."
        >
          + Attach clients
        </button>
      </section>
    </div>
  );
}

function RouteTab({ data }: { data: ScheduleGroup }) {
  const legs: Array<{
    type: 'collection' | 'depot' | 'linehaul' | 'delivery';
    title: string;
    subtitle: string;
  }> = [];

  // Pickup source. Steve's spec §A4: pickup source lives on the
  // Collection leg. If PickupDepotId is set, pickup is from that
  // depot; otherwise it's from the client's address.
  legs.push({
    type: 'collection',
    title: data.pickupDepotName ?? 'Collect from client address',
    subtitle: `Pickup speed ${data.pickupRatingSpeed ?? '-'}`,
  });

  if (data.pickupDepotName) {
    legs.push({
      type: 'depot',
      title: `${data.pickupDepotName} (region ${data.pickupDepotId})`,
      subtitle: temperatureLabel(data.storageState) ?? '-',
    });
  }

  for (const lh of data.linehauls) {
    legs.push({
      type: 'linehaul',
      title: lh.name ?? `Linehaul run ${lh.linehaulRunId ?? '?'}`,
      subtitle: `run ${lh.linehaulRunId ?? '?'}`,
    });
  }

  legs.push({
    type: 'delivery',
    title: `Deliver in ${data.regionName ?? `region ${data.regionId}`}`,
    subtitle: `Speed ${data.speedId ?? '-'} · zone group ${data.postcodeGroupId ?? '-'}`,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Route</h3>
        <span className="text-xs text-text-muted italic">
          Dane's vertical leg builder - read-only here
        </span>
      </div>
      <div className="space-y-2">
        {legs.map((leg, i) => (
          <LegCard key={i} type={leg.type} title={leg.title} subtitle={leg.subtitle} />
        ))}
      </div>

      <section className="pt-6 border-t border-border">
        <h4 className="text-xs uppercase tracking-wide text-text-muted mb-3">
          Production fields
        </h4>
        <dl className="grid grid-cols-2 gap-y-2 gap-x-8 text-sm">
          <ProdRow label="Origin depot" value={data.pickupDepotName ?? 'Client address'} />
          <ProdRow label="Destination region" value={data.regionName ?? `#${data.regionId}`} />
          <ProdRow label="Auto-book" value={data.autoBook ? 'On' : 'Off'} />
          <ProdRow label="Storage state" value={temperatureLabel(data.storageState) ?? '-'} />
          <ProdRow label="Delivery state" value={temperatureLabel(data.deliveryState) ?? '-'} />
          <ProdRow
            label="Pickup cutoff"
            value={
              data.applyPickupCutoff && data.pickupCutoff != null
                ? `${data.pickupCutoff}h`
                : 'Off'
            }
          />
        </dl>
      </section>
    </div>
  );
}

function DaysTab({ data }: { data: ScheduleGroup }) {
  const byDay = new Map(data.dayWindows.map((d) => [d.dayOfWeek, d]));
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Operating days</h3>
        <span className="text-xs text-text-muted italic">
          cut-off is per day, hours before the window
        </span>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {[1, 2, 3, 4, 5, 6, 7].map((n) => {
          const d = byDay.get(n);
          if (!d) {
            return (
              <div
                key={n}
                className="border border-border rounded p-3 text-center bg-surface-light"
              >
                <div className="text-xs font-medium text-text-muted mb-1">{DAY_NAMES[n]}</div>
                <div className="text-xs text-text-muted">-</div>
              </div>
            );
          }
          return (
            <div key={n} className="border border-brand-cyan/40 rounded p-3 text-center">
              <div className="text-xs font-medium text-text-primary mb-1">{DAY_NAMES[n]}</div>
              <div className="text-xs text-text-secondary">{d.startTime}</div>
              <div className="text-xs text-text-secondary">{d.endTime}</div>
              <div className="text-[10px] text-text-muted mt-1">cut-off {d.cutoffHours}h</div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-text-muted italic">
        Each enabled day is one tblBulkRunSchedule row carrying ScheduleId #{data.scheduleId}.
      </p>
    </div>
  );
}

function RosterTab({ data }: { data: ScheduleGroup }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Roster</h3>
        <span className="text-xs text-text-muted italic">
          Linehaul legs bound to this schedule
        </span>
      </div>

      {data.linehauls.length === 0 ? (
        <div className="border border-border rounded p-6 text-center text-sm text-text-muted">
          No linehaul legs bound to this schedule.
        </div>
      ) : (
        <div className="space-y-2">
          {data.linehauls.map((lh) => (
            <div
              key={lh.id}
              className="border border-border rounded p-4 flex items-start justify-between"
            >
              <div className="space-y-1">
                <div className="text-sm font-medium text-text-primary">
                  {lh.name ?? `Linehaul run ${lh.linehaulRunId ?? '?'}`}
                  {lh.active === false && (
                    <span className="ml-2 text-xs text-warning">(inactive)</span>
                  )}
                </div>
                <div className="text-xs text-text-muted">
                  Run #{lh.linehaulRunId ?? '?'} · depart offset {lh.departureAdvanceDays ?? 0}d ·{' '}
                  {lh.minutes ?? '?'} min
                </div>
                {lh.weekDay.length > 0 && (
                  <div className="text-xs text-text-secondary">
                    Days: {lh.weekDay.map((n) => DAY_NAMES[n]).join(' ')}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-text-muted italic max-w-2xl">
        Recurring routes bound to this schedule land once the v2 Recurring Routes read path
        adds the schedule-via-route join. Until then, jump to the Recurring Routes tab for the
        full route roster + master-job view.
      </p>
    </div>
  );
}

// ─── Bits ────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'text-text-primary border-brand-cyan'
          : 'text-text-secondary border-transparent hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  );
}

function RadioRow({
  checked,
  label,
  hint,
}: {
  checked: boolean;
  label: string;
  hint: string;
}) {
  return (
    <label
      className={`block px-4 py-3 border rounded cursor-not-allowed ${
        checked ? 'border-brand-cyan bg-brand-cyan/5' : 'border-border'
      }`}
    >
      <div className="flex items-center gap-2">
        <input type="radio" checked={checked} readOnly disabled className="accent-brand-cyan" />
        <span className="text-sm font-medium text-text-primary">{label}</span>
      </div>
      <div className="text-xs text-text-muted ml-6 mt-0.5">{hint}</div>
    </label>
  );
}

const LEG_STYLE: Record<
  'collection' | 'depot' | 'linehaul' | 'delivery',
  { tag: string; bg: string; border: string }
> = {
  collection: { tag: 'COLLECTION', bg: 'bg-blue-50', border: 'border-blue-300' },
  depot:      { tag: 'DEPOT',      bg: 'bg-slate-100', border: 'border-slate-300' },
  linehaul:   { tag: 'LINEHAUL',   bg: 'bg-orange-50', border: 'border-orange-300' },
  delivery:   { tag: 'DELIVERY',   bg: 'bg-green-50', border: 'border-green-300' },
};

function LegCard({
  type,
  title,
  subtitle,
}: {
  type: 'collection' | 'depot' | 'linehaul' | 'delivery';
  title: string;
  subtitle: string;
}) {
  const s = LEG_STYLE[type];
  return (
    <div className={`border ${s.border} ${s.bg} rounded p-3 flex items-center gap-4`}>
      <span
        className={`text-[10px] font-semibold tracking-wide px-2 py-1 rounded text-text-primary ${s.bg} border ${s.border}`}
      >
        {s.tag}
      </span>
      <div className="flex-1">
        <div className="text-sm font-medium text-text-primary">{title}</div>
        <div className="text-xs text-text-muted">{subtitle}</div>
      </div>
    </div>
  );
}

function ProdRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="text-text-primary">{value}</dd>
    </>
  );
}

function temperatureLabel(v: number | null | undefined): string | null {
  if (v == null) return null;
  return v === 1 ? 'Ambient' : v === 2 ? 'Chilled' : v === 3 ? 'Frozen' : `#${v}`;
}
