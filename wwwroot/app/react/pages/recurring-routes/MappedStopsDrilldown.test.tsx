import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { MappedStopsDrilldown } from './MappedStopsDrilldown';

const run = {
  id: 42,
  runName: 'AKL-HAM AM',
  fromDepotName: 'AKL',
  toDepotName: 'HAM',
};

const stubRunJobs = (jobs: unknown[]) =>
  http.get('/api/recurring-linehaul-runs/42/jobs', () =>
    HttpResponse.json({ response: jobs }));

const stubRouteJobs = (jobs: unknown[]) =>
  http.get('/api/recurring-routes/42/jobs', () =>
    HttpResponse.json({ response: jobs }));

const job = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1, jobNumber: 'JOB-1', pickup: '1 Queen St', drop: '2 K Rd',
  speedId: 128, speedShortName: 'CORT', speedName: 'Courier',
  speedGroupingId: null, speedGroupingName: null,
  bookDate: '2026-08-13', bookTime: '10:00', statusName: 'Booked',
  ...over,
});

describe('MappedStopsDrilldown', () => {
  it('renders the run heading and depot pair', async () => {
    server.use(stubRunJobs([]));
    renderWithProviders(<MappedStopsDrilldown run={run} onClose={() => {}} />);
    expect(await screen.findByRole('heading', { name: /Mapped Stops - AKL-HAM AM/ }))
      .toBeInTheDocument();
    expect(screen.getByText(/AKL to HAM/)).toBeInTheDocument();
  });

  it('shows the loading state, then the empty-state prompt', async () => {
    server.use(stubRunJobs([]));
    renderWithProviders(<MappedStopsDrilldown run={run} onClose={() => {}} />);
    expect(screen.getByText(/Loading jobs.../)).toBeInTheDocument();
    expect(await screen.findByText(/No jobs mapped to this run yet./))
      .toBeInTheDocument();
  });

  it('lists jobs when the API returns rows', async () => {
    server.use(stubRunJobs([job(), job({ id: 2, jobNumber: 'JOB-2' })]));
    renderWithProviders(<MappedStopsDrilldown run={run} onClose={() => {}} />);
    expect(await screen.findByText('JOB-1')).toBeInTheDocument();
    expect(screen.getByText('JOB-2')).toBeInTheDocument();
  });

  it('filters jobs by the search term', async () => {
    server.use(stubRunJobs([
      job({ id: 1, jobNumber: 'AAA' }),
      job({ id: 2, jobNumber: 'BBB' }),
    ]));
    renderWithProviders(<MappedStopsDrilldown run={run} onClose={() => {}} />);
    await screen.findByText('AAA');
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Search job/), 'BBB');
    await waitFor(() => expect(screen.queryByText('AAA')).not.toBeInTheDocument());
    expect(screen.getByText('BBB')).toBeInTheDocument();
  });

  it('uses the route API path when source="route"', async () => {
    let hit = 0;
    server.use(
      http.get('/api/recurring-routes/42/jobs', () => {
        hit++;
        return HttpResponse.json({ response: [] });
      }),
    );
    renderWithProviders(
      <MappedStopsDrilldown run={run} source="route" onClose={() => {}} />,
    );
    await waitFor(() => expect(hit).toBe(1));
  });

  it('surfaces the error message when the API fails', async () => {
    server.use(
      http.get('/api/recurring-linehaul-runs/42/jobs', () =>
        new HttpResponse(JSON.stringify({ message: 'jobs boom' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })),
    );
    renderWithProviders(<MappedStopsDrilldown run={run} onClose={() => {}} />);
    expect(await screen.findByText(/jobs boom/)).toBeInTheDocument();
  });

  it('closes when the backdrop is clicked', async () => {
    const onClose = vi.fn();
    server.use(stubRunJobs([]));
    renderWithProviders(<MappedStopsDrilldown run={run} onClose={onClose} />);
    await screen.findByText(/No jobs mapped to this run yet./);
    const user = userEvent.setup();
    // Backdrop is the fixed inset-0 wrapper.
    const backdrop = document.querySelector('.absolute.inset-0.bg-black\\/30');
    expect(backdrop).not.toBeNull();
    await user.click(backdrop as Element);
    expect(onClose).toHaveBeenCalled();
  });

  it('opens the JobDetailModal when a job row is clicked', async () => {
    server.use(
      stubRunJobs([job()]),
      http.get('/api/recurring-jobs/1', () =>
        HttpResponse.json({
          response: {
            id: 1, jobNumber: 'JOB-1', customer: 'ACME', statusName: 'Booked',
            pickupAddress: '1 Q', dropAddress: '2 K',
            bookDate: '2026-08-13', bookTime: '10:00',
            linehaulRunName: 'AKL-HAM AM',
            speedId: 128, speedShortName: 'CORT', speedName: 'Courier',
            speedGroupingId: null, speedGroupingName: null,
            speedEditable: true, notes: null,
          },
        })),
      http.get('/api/speeds/grouped', () => HttpResponse.json({ response: [] })),
    );
    renderWithProviders(<MappedStopsDrilldown run={run} onClose={() => {}} />);
    const cell = await screen.findByText('JOB-1');
    const user = userEvent.setup();
    await user.click(cell);
    expect(await screen.findByRole('heading', { name: 'Job JOB-1' }))
      .toBeInTheDocument();
  });
});
