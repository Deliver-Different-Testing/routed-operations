import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OptimizePreviewModal } from './OptimizePreviewModal';

const stops = [
  { bulkJobId: 1, jobNumber: 'A', originalOrder: 3, newOrder: 1 },
  { bulkJobId: 2, jobNumber: 'B', originalOrder: 1, newOrder: 2 },
  { bulkJobId: 3, jobNumber: null, originalOrder: null, newOrder: 3 },
];

describe('OptimizePreviewModal', () => {
  it('renders the run name in the header and stop count in the body', () => {
    render(<OptimizePreviewModal open runName="Run 9" stops={stops} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /Optimise "Run 9" - preview/ })).toBeInTheDocument();
    expect(screen.getByText(/for 3 deliveries/)).toBeInTheDocument();
  });

  it('renders a table row per stop with was/now/job columns', () => {
    const { container } = render(<OptimizePreviewModal open runName="R" stops={stops} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    // Null jobNumber falls back to bulkJobId, which is 3 here.
    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(3);
    expect(rows[2].textContent).toContain('3');
  });

  it('falls back to a dash when originalOrder is null', () => {
    render(<OptimizePreviewModal open runName="R" stops={stops} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText('-')).toBeInTheDocument();
  });

  it('fires onClose when Cancel clicked', () => {
    const onClose = vi.fn();
    render(<OptimizePreviewModal open runName="R" stops={stops} onClose={onClose} onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fires onConfirm when Apply new order clicked', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<OptimizePreviewModal open runName="R" stops={stops} onClose={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply new order' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });
});
