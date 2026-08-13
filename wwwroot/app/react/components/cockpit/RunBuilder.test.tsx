import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { RunBuilder } from './RunBuilder';
import type { Run, RunJob } from '@/types';

function makeRunJob(over: Partial<RunJob> = {}): RunJob {
  return {
    bulkJobId: 1,
    builderIndex: 1,
    jobNumber: 'JOB-1',
    isStart: false,
    isEnd: false,
    clientCode: 'ACME',
    deliveryDate: '2026-08-13',
    bookTime: '09:30:00',
    toAddress: '1 Recipient Rd',
    toSuburb: 'Ponsonby',
    toPostCode: 1011,
    courierName: 'Alice',
    speedName: 'Same Day',
    deliveryLatitude: '-36.86',
    amount: 100,
    ...over,
  };
}

function makeRun(over: Partial<Run> = {}): Run {
  return {
    id: 1,
    name: 'Run 1',
    mins: 60,
    kms: 12.5,
    courierId: null,
    courierName: 'Alice',
    status: 0,
    revenue: 200,
    payout: 100,
    courierPercentage: 0.5,
    googleRouteResponse: null,
    despatchDateTime: null,
    noReroute: false,
    routingMode: 0,
    finishAtBulkJobId: null,
    isVoidRun: false,
    fleet: null,
    jobs: [makeRunJob()],
    ...over,
  };
}

describe('RunBuilder', () => {
  it('renders empty state when no run is selected', () => {
    renderWithProviders(
      <RunBuilder run={null} onRemoveJob={vi.fn()} onOptimize={vi.fn()} />
    );
    expect(screen.getByText(/Select a run to see the jobs/)).toBeInTheDocument();
  });

  it('renders empty run row when the run has no jobs', () => {
    const run = makeRun({ jobs: [] });
    renderWithProviders(
      <RunBuilder run={run} onRemoveJob={vi.fn()} onOptimize={vi.fn()} />
    );
    expect(screen.getByText(/Run is empty/)).toBeInTheDocument();
  });

  it('renders one row per job with job number + client', () => {
    const run = makeRun({
      jobs: [
        makeRunJob({ bulkJobId: 1, jobNumber: 'JOB-1' }),
        makeRunJob({ bulkJobId: 2, jobNumber: 'JOB-2', builderIndex: 2 }),
      ],
    });
    renderWithProviders(
      <RunBuilder run={run} onRemoveJob={vi.fn()} onOptimize={vi.fn()} />
    );
    expect(screen.getByText('JOB-1')).toBeInTheDocument();
    expect(screen.getByText('JOB-2')).toBeInTheDocument();
  });

  it('renders totals strip when totals are computable', () => {
    const run = makeRun();
    renderWithProviders(
      <RunBuilder run={run} onRemoveJob={vi.fn()} onOptimize={vi.fn()} />
    );
    expect(screen.getByText('Mins')).toBeInTheDocument();
    expect(screen.getByText('Kms')).toBeInTheDocument();
    expect(screen.getByText('Drops')).toBeInTheDocument();
    expect(screen.getByText('Rate')).toBeInTheDocument();
    expect(screen.getByText('$25.00')).toBeInTheDocument();
  });

  it('does NOT render totals strip on void runs', () => {
    const run = makeRun({ isVoidRun: true });
    renderWithProviders(
      <RunBuilder run={run} onRemoveJob={vi.fn()} onOptimize={vi.fn()} />
    );
    expect(screen.queryByText('Mins')).not.toBeInTheDocument();
  });

  it('disables Optimise button when the run has <2 jobs', () => {
    const run = makeRun({ jobs: [makeRunJob()] });
    renderWithProviders(
      <RunBuilder run={run} onRemoveJob={vi.fn()} onOptimize={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: 'Optimise' })).toBeDisabled();
  });

  it('enables Optimise button and emits click', () => {
    const run = makeRun({
      jobs: [makeRunJob({ bulkJobId: 1 }), makeRunJob({ bulkJobId: 2, jobNumber: 'JOB-2' })],
    });
    const onOptimize = vi.fn();
    renderWithProviders(
      <RunBuilder run={run} onRemoveJob={vi.fn()} onOptimize={onOptimize} />
    );
    const btn = screen.getByRole('button', { name: 'Optimise' });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onOptimize).toHaveBeenCalledTimes(1);
  });

  it('emits onRemoveJob when the Remove button is clicked', () => {
    const onRemoveJob = vi.fn();
    const run = makeRun({ jobs: [makeRunJob({ bulkJobId: 77 })] });
    renderWithProviders(
      <RunBuilder run={run} onRemoveJob={onRemoveJob} onOptimize={vi.fn()} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemoveJob).toHaveBeenCalledWith(77);
  });

  it('emits onSelectJob when a row is clicked', () => {
    const onSelectJob = vi.fn();
    const run = makeRun({ jobs: [makeRunJob({ bulkJobId: 88, jobNumber: 'CLICKED' })] });
    renderWithProviders(
      <RunBuilder run={run} onSelectJob={onSelectJob} onRemoveJob={vi.fn()} onOptimize={vi.fn()} />
    );
    fireEvent.click(screen.getByText('CLICKED'));
    expect(onSelectJob).toHaveBeenCalledWith(88);
  });

  it('opens context menu with toggle start/end/remove/void on right-click for a regular run', () => {
    const onToggleStart = vi.fn();
    const onToggleEnd = vi.fn();
    const onVoidJob = vi.fn();
    const run = makeRun({ jobs: [makeRunJob({ bulkJobId: 1 })] });
    renderWithProviders(
      <RunBuilder
        run={run}
        onSelectJob={vi.fn()}
        onRemoveJob={vi.fn()}
        onOptimize={vi.fn()}
        onToggleStart={onToggleStart}
        onToggleEnd={onToggleEnd}
        onVoidJob={onVoidJob}
      />
    );
    fireEvent.contextMenu(screen.getByText('JOB-1'));
    expect(screen.getByText('Set as end point')).toBeInTheDocument();
    expect(screen.getByText('Set as start point')).toBeInTheDocument();
    expect(screen.getByText('Void job')).toBeInTheDocument();
  });

  it('opens context menu with Un-void on right-click for void run', () => {
    const onUnvoidJob = vi.fn();
    const run = makeRun({ isVoidRun: true, jobs: [makeRunJob()] });
    renderWithProviders(
      <RunBuilder
        run={run}
        onRemoveJob={vi.fn()}
        onOptimize={vi.fn()}
        onUnvoidJob={onUnvoidJob}
      />
    );
    fireEvent.contextMenu(screen.getByText('JOB-1'));
    expect(screen.getByText('Un-void job')).toBeInTheDocument();
  });

  it('shows missing-GPS marker when job has no deliveryLatitude', () => {
    const run = makeRun({
      jobs: [makeRunJob({ bulkJobId: 1, deliveryLatitude: null })],
    });
    renderWithProviders(
      <RunBuilder run={run} onRemoveJob={vi.fn()} onOptimize={vi.fn()} />
    );
    expect(screen.getByTitle('Missing GPS coordinates')).toBeInTheDocument();
  });

  it('shows the drag handle column when onReorderJobs is wired', () => {
    const run = makeRun();
    renderWithProviders(
      <RunBuilder
        run={run}
        onRemoveJob={vi.fn()}
        onOptimize={vi.fn()}
        onReorderJobs={vi.fn()}
      />
    );
    expect(screen.getByTitle('Drag to re-order')).toBeInTheDocument();
  });

  it('reorders jobs on drag drop between two rows', () => {
    const onReorderJobs = vi.fn();
    const run = makeRun({
      jobs: [
        makeRunJob({ bulkJobId: 1, jobNumber: 'ALPHA', builderIndex: 1 }),
        makeRunJob({ bulkJobId: 2, jobNumber: 'BETA', builderIndex: 2 }),
      ],
    });
    renderWithProviders(
      <RunBuilder
        run={run}
        onRemoveJob={vi.fn()}
        onOptimize={vi.fn()}
        onReorderJobs={onReorderJobs}
      />
    );
    const alphaHandle = screen.getAllByTitle('Drag to re-order')[0];
    fireEvent.dragStart(alphaHandle, {
      dataTransfer: { setData: vi.fn(), effectAllowed: '' },
    });
    const betaRow = screen.getByText('BETA').closest('tr')!;
    fireEvent.dragOver(betaRow, { dataTransfer: { dropEffect: '' } });
    fireEvent.drop(betaRow, { dataTransfer: { getData: () => '' } });
    expect(onReorderJobs).toHaveBeenCalled();
    const [runArg, orderedJobs] = onReorderJobs.mock.calls[0];
    expect(runArg.id).toBe(1);
    expect(orderedJobs.map((j: RunJob) => j.bulkJobId)).toEqual([2, 1]);
  });

  it('renders start / end indicator icons per row flag', () => {
    const run = makeRun({
      jobs: [
        makeRunJob({ bulkJobId: 1, isStart: true }),
        makeRunJob({ bulkJobId: 2, isEnd: true }),
      ],
    });
    renderWithProviders(
      <RunBuilder run={run} onRemoveJob={vi.fn()} onOptimize={vi.fn()} />
    );
    expect(screen.getByTitle('Start point')).toBeInTheDocument();
    expect(screen.getByTitle('End point')).toBeInTheDocument();
  });

  it('renders the Cour % label in the totals strip', () => {
    const run = makeRun({ courierPercentage: 0.5 });
    renderWithProviders(
      <RunBuilder run={run} onRemoveJob={vi.fn()} onOptimize={vi.fn()} />
    );
    expect(screen.getByText('Cour %')).toBeInTheDocument();
  });
});
