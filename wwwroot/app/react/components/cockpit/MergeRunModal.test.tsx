import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MergeRunModal } from './MergeRunModal';
import type { Run } from '@/types';

function makeRun(id: number, name: string, jobs: number = 0, courier: string | null = null): Run {
  return {
    id,
    name,
    mins: null,
    kms: null,
    courierId: null,
    courierName: courier,
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
  };
}

describe('MergeRunModal', () => {
  it('renders nothing when source is null', () => {
    const { container } = render(
      <MergeRunModal open source={null} candidates={[]} onClose={vi.fn()} onConfirm={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the source run name and job count in the header', () => {
    const src = makeRun(1, 'Auckland North', 4);
    render(<MergeRunModal open source={src} candidates={[]} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /Merge "Auckland North" \(4 jobs\) into/ })).toBeInTheDocument();
  });

  it('shows the empty warning when candidates is empty', () => {
    const src = makeRun(1, 'Src');
    render(<MergeRunModal open source={src} candidates={[]} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText(/No valid merge target/)).toBeInTheDocument();
  });

  it('lists every candidate as an option', () => {
    const src = makeRun(1, 'Src', 2);
    const candidates = [makeRun(2, 'North', 3, 'Kev'), makeRun(3, 'South', 5)];
    render(<MergeRunModal open source={src} candidates={candidates} onClose={vi.fn()} onConfirm={vi.fn()} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.textContent);
    expect(opts).toEqual(['North (3 jobs, Kev)', 'South (5 jobs)']);
  });

  it('confirms with the picked target id', () => {
    const src = makeRun(1, 'Src', 2);
    const candidates = [makeRun(2, 'A', 1), makeRun(7, 'B', 2)];
    const onConfirm = vi.fn();
    render(<MergeRunModal open source={src} candidates={candidates} onClose={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    expect(onConfirm).toHaveBeenCalledWith(7);
  });

  it('fires onClose when Cancel is clicked', () => {
    const src = makeRun(1, 'Src', 1);
    const candidates = [makeRun(2, 'A', 1)];
    const onClose = vi.fn();
    render(<MergeRunModal open source={src} candidates={candidates} onClose={onClose} onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables the Merge button when there is no target id', () => {
    const src = makeRun(1, 'Src', 1);
    render(<MergeRunModal open source={src} candidates={[]} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Merge' })).toBeDisabled();
  });
});
