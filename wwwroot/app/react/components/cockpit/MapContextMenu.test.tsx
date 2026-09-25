import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MapContextMenu, type MapContextTarget } from './MapContextMenu';
import type { Run } from '@/types';

function makeRun(id: number, name: string, jobs = 0): Run {
  return {
    id,
    name,
    mins: null,
    kms: null,
    courierId: null,
    courierName: null,
    status: null,
    revenue: null,
    payout: null,
    courierPercentage: null,
    googleRouteResponse: null,
    despatchDateTime: null,
    noReroute: false,
    routingMode: 0,
    finishAtBulkJobId: null,
    isVoidRun: false,
    fleet: null,
    jobs: Array.from({ length: jobs }, (_, i) => ({ bulkJobId: i, builderIndex: i } as any)),
  } as Run;
}

function makeTarget(overrides: Partial<MapContextTarget> = {}): MapContextTarget {
  return {
    bulkJobId: 42,
    jobNumber: 'JOB-42',
    kind: 'pickup',
    runId: null,
    clientX: 100,
    clientY: 200,
    ...overrides,
  };
}

const handlers = {
  onClose: vi.fn(),
  onSelectJob: vi.fn(),
  onAddToRun: vi.fn(),
  onRemoveFromRun: vi.fn(),
  onTransferToRun: vi.fn(),
};

describe('MapContextMenu', () => {
  it('renders nothing when target is null', () => {
    const { container } = render(
      <MapContextMenu target={null} runs={[]} {...handlers} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the header with job number and kind', () => {
    render(
      <MapContextMenu target={makeTarget()} runs={[]} {...handlers} />
    );
    expect(screen.getByText('JOB-42')).toBeInTheDocument();
    expect(screen.getByText('(pickup)')).toBeInTheDocument();
  });

  it('falls back to Job {id} when jobNumber is null', () => {
    render(
      <MapContextMenu target={makeTarget({ jobNumber: null })} runs={[]} {...handlers} />
    );
    expect(screen.getByText('Job 42')).toBeInTheDocument();
  });

  it('shows "Add to run" section when runId is null', () => {
    render(
      <MapContextMenu target={makeTarget({ runId: null })} runs={[]} {...handlers} />
    );
    expect(screen.getByText('Add to run')).toBeInTheDocument();
    expect(screen.queryByText('Transfer to run')).not.toBeInTheDocument();
  });

  it('shows Remove + Transfer sections when runId is set', () => {
    render(
      <MapContextMenu target={makeTarget({ runId: 5 })} runs={[makeRun(5, 'X')]} {...handlers} />
    );
    expect(screen.getByRole('button', { name: 'Remove from current run' })).toBeInTheDocument();
    expect(screen.getByText('Transfer to run')).toBeInTheDocument();
  });

  it('renders "Set as end point" only when onSetEnd is provided AND runId is set', () => {
    const onSetEnd = vi.fn();
    render(
      <MapContextMenu
        target={makeTarget({ runId: 5 })}
        runs={[]}
        {...handlers}
        onSetEnd={onSetEnd}
      />
    );
    expect(screen.getByRole('button', { name: 'Set as end point' })).toBeInTheDocument();
  });

  it('does not render "Set as end point" when target has no runId', () => {
    const onSetEnd = vi.fn();
    render(
      <MapContextMenu
        target={makeTarget({ runId: null })}
        runs={[]}
        {...handlers}
        onSetEnd={onSetEnd}
      />
    );
    expect(screen.queryByRole('button', { name: 'Set as end point' })).not.toBeInTheDocument();
  });

  it('lists other runs (excluding the current runId)', () => {
    const runs = [makeRun(5, 'Current', 1), makeRun(6, 'Other', 3)];
    render(
      <MapContextMenu target={makeTarget({ runId: 5 })} runs={runs} {...handlers} />
    );
    expect(screen.getByRole('button', { name: 'Other (3 jobs)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Current/ })).not.toBeInTheDocument();
  });

  it('fires onSelectJob and closes when Select this job clicked', () => {
    const onSelectJob = vi.fn();
    const onClose = vi.fn();
    render(
      <MapContextMenu
        target={makeTarget()}
        runs={[]}
        {...handlers}
        onSelectJob={onSelectJob}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select this job' }));
    expect(onSelectJob).toHaveBeenCalledWith(42);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fires onAddToRun with (jobId, runId) when target has no run and a run is picked', () => {
    const onAddToRun = vi.fn();
    render(
      <MapContextMenu
        target={makeTarget({ runId: null })}
        runs={[makeRun(9, 'Nine', 2)]}
        {...handlers}
        onAddToRun={onAddToRun}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Nine (2 jobs)' }));
    expect(onAddToRun).toHaveBeenCalledWith(42, 9);
  });

  it('fires onTransferToRun when target already belongs to a run', () => {
    const onTransferToRun = vi.fn();
    render(
      <MapContextMenu
        target={makeTarget({ runId: 5 })}
        runs={[makeRun(5, 'Current', 1), makeRun(9, 'Nine', 2)]}
        {...handlers}
        onTransferToRun={onTransferToRun}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Nine (2 jobs)' }));
    expect(onTransferToRun).toHaveBeenCalledWith(42, 5, 9);
  });

  it('shows an empty-list message when there are no other runs', () => {
    render(
      <MapContextMenu target={makeTarget({ runId: null })} runs={[]} {...handlers} />
    );
    expect(screen.getByText('No other runs available.')).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <MapContextMenu target={makeTarget()} runs={[]} {...handlers} onClose={onClose} />
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
