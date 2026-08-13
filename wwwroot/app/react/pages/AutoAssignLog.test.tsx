import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import AutoAssignLog from './AutoAssignLog';

const emptyLogPage = { total: 0, page: 1, pageSize: 50, entries: [] };
const emptyUnresolvedPage = { total: 0, page: 1, pageSize: 50, entries: [] };

const stubLog = (payload = emptyLogPage) =>
  http.get('/api/diagnostics/auto-assign-log', () =>
    HttpResponse.json({ response: payload }));

const stubUnresolved = (payload = emptyUnresolvedPage) =>
  http.get('/api/diagnostics/auto-assign-log/unresolved-recurring-bookings', () =>
    HttpResponse.json({ response: payload }));

describe('AutoAssignLog page', () => {
  it('renders both tabs with default Auto-Assign Log active', async () => {
    server.use(stubLog(), stubUnresolved());
    renderWithProviders(<AutoAssignLog />);
    expect(screen.getByRole('heading', { name: /Route Auto-Assign Diagnostics/i }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Auto-Assign Log' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unresolved Recurring Bookings' }))
      .toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/0 entries match/)).toBeInTheDocument()
    );
  });

  it('renders entries when the log API returns rows', async () => {
    const page = {
      total: 1, page: 1, pageSize: 50,
      entries: [{
        logId: 42,
        createdAtUtc: '2026-08-13T10:00:00Z',
        jobId: 555,
        jobBookingId: null,
        speedId: 128,
        pickupZip: '1010',
        pickupAtUtc: null,
        bookingKind: 0,
        bookingKindName: 'Ad hoc',
        resolvedRouteId: 7,
        resolvedRouteName: 'AKL CBD',
        resolvedCourierId: 3,
        resolvedCourierName: 'Kev',
        resolvedAgentId: null,
        resolvedAgentName: null,
        resolvedNpAgentId: null,
        resolvedNpAgentName: null,
        outcome: 'AssignedToRoute',
        triggerSource: 'stpJobBooking_Insert',
        priorRouteId: null,
        side: 'Pickup',
      }],
    };
    server.use(stubLog(page), stubUnresolved());
    renderWithProviders(<AutoAssignLog />);
    expect(await screen.findByText('AssignedToRoute')).toBeInTheDocument();
    expect(screen.getByText('AKL CBD')).toBeInTheDocument();
    expect(screen.getByText('Courier: Kev')).toBeInTheDocument();
    expect(screen.getByText('1 entry match')).toBeInTheDocument();
  });

  it('expands a log row on click and shows raw JSON', async () => {
    const entry = {
      logId: 1, createdAtUtc: '2026-08-13T09:00:00Z', jobId: null, jobBookingId: 11,
      speedId: 128, pickupZip: '0632', pickupAtUtc: null, bookingKind: null,
      bookingKindName: 'Recurring', resolvedRouteId: null, resolvedRouteName: null,
      resolvedCourierId: null, resolvedCourierName: null, resolvedAgentId: null,
      resolvedAgentName: null, resolvedNpAgentId: null, resolvedNpAgentName: null,
      outcome: 'NoMatch', triggerSource: 'stpJob_Insert',
      priorRouteId: null, side: 'Delivery',
    };
    server.use(stubLog({ total: 1, page: 1, pageSize: 50, entries: [entry] }),
              stubUnresolved());
    renderWithProviders(<AutoAssignLog />);
    const outcomeCell = await screen.findByText('NoMatch');
    const row = outcomeCell.closest('tr')!;
    const user = userEvent.setup();
    await user.click(row);
    // Expanded row renders a <pre> with the full JSON.
    await waitFor(() => {
      const pres = document.querySelectorAll('pre');
      const found = Array.from(pres).some((p) => p.textContent?.includes('"outcome"'));
      expect(found).toBe(true);
    });
  });

  it('applies filter and re-fetches', async () => {
    let call = 0;
    const seenOutcomes: (string | null)[] = [];
    server.use(
      http.get('/api/diagnostics/auto-assign-log', ({ request }) => {
        call++;
        const url = new URL(request.url);
        seenOutcomes.push(url.searchParams.get('outcome'));
        return HttpResponse.json({
          response: { total: call, page: 1, pageSize: 50, entries: [] },
        });
      }),
      stubUnresolved(),
    );
    renderWithProviders(<AutoAssignLog />);
    await waitFor(() => expect(screen.getByText(/1 entry match/)).toBeInTheDocument());
    const user = userEvent.setup();
    // The Outcome select is the one that has an 'AssignedToRoute' <option>.
    const allSelects = Array.from(document.querySelectorAll('select'));
    const outcomeSelByLabel = allSelects.find((s) =>
      Array.from(s.options).some((o) => o.value === 'AssignedToRoute')
    ) as HTMLSelectElement;
    await user.selectOptions(outcomeSelByLabel, 'NoMatch');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(call).toBeGreaterThan(1));
    expect(seenOutcomes.some((o) => o === 'NoMatch')).toBe(true);
  });

  it('switches to Unresolved tab and shows the unresolved list', async () => {
    server.use(
      stubLog(),
      stubUnresolved({
        total: 1, page: 1, pageSize: 50,
        entries: [{
          ucbkId: 99, ucbkJobNumber: 'JOB-99', ucbkClientId: 3, clientName: 'ACME',
          ucbkSpeed: 128, speedName: 'CORT', scheduleId: 4, scheduleName: 'Sched-A',
          pickupZip: '1010', deliveryZip: '2020',
          missingPickupCoords: true, missingDeliveryCoords: false,
          ucbkNextDue: '2026-08-14T00:00:00Z', createdTime: '2026-01-01T00:00:00Z',
        }],
      }),
    );
    renderWithProviders(<AutoAssignLog />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Unresolved Recurring Bookings' }));
    expect(await screen.findByText('ACME')).toBeInTheDocument();
    expect(screen.getByText('JOB-99')).toBeInTheDocument();
    expect(screen.getByText('pickup missing')).toBeInTheDocument();
    expect(screen.getByText(/1 unresolved recurring booking/)).toBeInTheDocument();
  });

  it('shows Refresh button and re-triggers a fetch on click', async () => {
    let count = 0;
    server.use(
      http.get('/api/diagnostics/auto-assign-log', () => {
        count++;
        return HttpResponse.json({ response: emptyLogPage });
      }),
      stubUnresolved(),
    );
    renderWithProviders(<AutoAssignLog />);
    await waitFor(() => expect(count).toBe(1));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(count).toBe(2));
  });

  it('shows an error toast when the log fetch fails', async () => {
    server.use(
      http.get('/api/diagnostics/auto-assign-log', () =>
        new HttpResponse(JSON.stringify({ message: 'boom' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })),
      stubUnresolved(),
    );
    renderWithProviders(<AutoAssignLog />);
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });

  it('shows the empty-state message on the unresolved tab when the list is empty', async () => {
    server.use(stubLog(), stubUnresolved());
    renderWithProviders(<AutoAssignLog />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Unresolved Recurring Bookings' }));
    expect(await screen.findByText(/No unresolved recurring bookings match the filters./))
      .toBeInTheDocument();
  });

  it('unresolved: checkbox for missing coords toggles filter param', async () => {
    let seenParam: string | null = null;
    server.use(
      stubLog(),
      http.get('/api/diagnostics/auto-assign-log/unresolved-recurring-bookings',
        ({ request }) => {
          const url = new URL(request.url);
          seenParam = url.searchParams.get('missingPickupCoords');
          return HttpResponse.json({ response: emptyUnresolvedPage });
        }),
    );
    renderWithProviders(<AutoAssignLog />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Unresolved Recurring Bookings' }));
    await waitFor(() => expect(seenParam).toBeNull());
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(seenParam).toBe('true'));
  });
});
