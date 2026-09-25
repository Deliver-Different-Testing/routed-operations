import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BulkMoveDateModal } from './BulkMoveDateModal';

describe('BulkMoveDateModal', () => {
  it('renders nothing when open is false', () => {
    render(<BulkMoveDateModal open={false} jobCount={3} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('pluralises the header title for multiple jobs', () => {
    render(<BulkMoveDateModal open jobCount={5} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /Move 5 jobs to another date/ })).toBeInTheDocument();
  });

  it('uses singular in header for a single job', () => {
    render(<BulkMoveDateModal open jobCount={1} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /Move 1 job to another date/ })).toBeInTheDocument();
  });

  it('fires onConfirm with the chosen date and run name', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<BulkMoveDateModal open jobCount={2} onClose={vi.fn()} onConfirm={onConfirm} />);
    const dateInput = screen.getByLabelText(/New book date/) as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-08-20' } });
    const reasonInput = screen.getByLabelText(/Reason \/ run name/) as HTMLInputElement;
    fireEvent.change(reasonInput, { target: { value: 'Client reschedule' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move jobs' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('2026-08-20', 'Client reschedule'));
  });

  it('fires onClose when Cancel clicked', () => {
    const onClose = vi.fn();
    render(<BulkMoveDateModal open jobCount={2} onClose={onClose} onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows a busy label while the confirm promise is pending', async () => {
    let resolveFn: () => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((res) => { resolveFn = res; }));
    render(<BulkMoveDateModal open jobCount={1} onClose={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Move jobs' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Moving...' })).toBeInTheDocument());
    resolveFn();
  });
});
