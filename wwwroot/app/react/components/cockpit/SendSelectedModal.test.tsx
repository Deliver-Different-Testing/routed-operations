import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SendSelectedModal } from './SendSelectedModal';
import type { Courier } from '@/types';

const couriers: Courier[] = [
  { courierId: 1, code: 'A1', firstName: 'A', displayName: 'Alice Adams', fleet: 'F1' },
  { courierId: 2, code: 'B1', firstName: 'B', displayName: 'Bob Brown', fleet: null },
  { courierId: 3, code: 'C1', firstName: 'C', displayName: 'Cara Chan', fleet: 'F1' },
];

describe('SendSelectedModal', () => {
  it('renders header with singular/plural job count', () => {
    const { rerender } = render(
      <SendSelectedModal open jobCount={1} couriers={couriers} onClose={vi.fn()} onConfirm={vi.fn()} />
    );
    expect(screen.getByRole('heading', { name: 'Send 1 job to Live' })).toBeInTheDocument();
    rerender(
      <SendSelectedModal open jobCount={4} couriers={couriers} onClose={vi.fn()} onConfirm={vi.fn()} />
    );
    expect(screen.getByRole('heading', { name: 'Send 4 jobs to Live' })).toBeInTheDocument();
  });

  it('lists all couriers in the select when unfiltered', () => {
    render(
      <SendSelectedModal open jobCount={1} couriers={couriers} onClose={vi.fn()} onConfirm={vi.fn()} />
    );
    expect(screen.getByRole('option', { name: 'Alice Adams' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Bob Brown' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Cara Chan' })).toBeInTheDocument();
  });

  it('narrows the list when a filter is typed', () => {
    render(
      <SendSelectedModal open jobCount={1} couriers={couriers} onClose={vi.fn()} onConfirm={vi.fn()} />
    );
    fireEvent.change(screen.getByPlaceholderText(/Type to narrow/), { target: { value: 'alice' } });
    expect(screen.getByRole('option', { name: 'Alice Adams' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Bob Brown' })).not.toBeInTheDocument();
  });

  it('shows the "no couriers match" warning when filter has no hits', () => {
    render(
      <SendSelectedModal open jobCount={1} couriers={couriers} onClose={vi.fn()} onConfirm={vi.fn()} />
    );
    fireEvent.change(screen.getByPlaceholderText(/Type to narrow/), { target: { value: 'zzz' } });
    expect(screen.getByText(/No couriers match "zzz"/)).toBeInTheDocument();
  });

  it('confirms with null when no courier picked', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <SendSelectedModal open jobCount={1} couriers={couriers} onClose={vi.fn()} onConfirm={onConfirm} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send to Live' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(null));
  });

  it('confirms with the picked courier id', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <SendSelectedModal open jobCount={1} couriers={couriers} onClose={vi.fn()} onConfirm={onConfirm} />
    );
    fireEvent.change(screen.getByLabelText('Courier'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Live' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(2));
  });

  it('fires onClose when Cancel clicked', () => {
    const onClose = vi.fn();
    render(
      <SendSelectedModal open jobCount={1} couriers={couriers} onClose={onClose} onConfirm={vi.fn()} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
