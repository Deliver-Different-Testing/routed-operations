import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FleetsPanel } from './FleetsPanel';
import type { Fleet } from '@/types';

const fleets: Fleet[] = [
  {
    fleet: 'North',
    couriers: [
      { courierId: 1, code: 'A', firstName: 'Alice', displayName: 'Alice Adams', fleet: 'North' },
      { courierId: 2, code: 'B', firstName: 'Bob', displayName: 'Bob Brown', fleet: 'North' },
    ],
  },
  {
    fleet: 'South',
    couriers: [
      { courierId: 3, code: 'C', firstName: 'Cara', displayName: 'Cara Chan', fleet: 'South' },
    ],
  },
];

describe('FleetsPanel', () => {
  it('renders the Fleets title with active count', () => {
    render(<FleetsPanel fleets={fleets} search="" onSetSearch={vi.fn()} />);
    expect(screen.getByText(/Fleets \(2\)/)).toBeInTheDocument();
  });

  it('lists every fleet with courier headcount and every courier', () => {
    render(<FleetsPanel fleets={fleets} search="" onSetSearch={vi.fn()} />);
    expect(screen.getByText('North')).toBeInTheDocument();
    expect(screen.getByText('South')).toBeInTheDocument();
    expect(screen.getByText('Alice Adams')).toBeInTheDocument();
    expect(screen.getByText('Bob Brown')).toBeInTheDocument();
    expect(screen.getByText('Cara Chan')).toBeInTheDocument();
  });

  it('filters by courier display name via the search prop', () => {
    render(<FleetsPanel fleets={fleets} search="alice" onSetSearch={vi.fn()} />);
    expect(screen.getByText('Alice Adams')).toBeInTheDocument();
    expect(screen.queryByText('Bob Brown')).not.toBeInTheDocument();
    expect(screen.queryByText('Cara Chan')).not.toBeInTheDocument();
  });

  it('fires onSetSearch when the filter input changes', () => {
    const onSetSearch = vi.fn();
    render(<FleetsPanel fleets={fleets} search="" onSetSearch={onSetSearch} />);
    fireEvent.change(screen.getByPlaceholderText('Filter...'), { target: { value: 'north' } });
    expect(onSetSearch).toHaveBeenCalledWith('north');
  });

  it('collapses a fleet when its header is clicked', () => {
    render(<FleetsPanel fleets={fleets} search="" onSetSearch={vi.fn()} />);
    // Click the North fleet header to collapse
    fireEvent.click(screen.getByRole('button', { name: /North/ }));
    expect(screen.queryByText('Alice Adams')).not.toBeInTheDocument();
  });

  it('shows a no-couriers message when fleets is empty', () => {
    render(<FleetsPanel fleets={[]} search="" onSetSearch={vi.fn()} />);
    expect(screen.getByText('No active couriers.')).toBeInTheDocument();
  });

  it('shows a filter-mismatch message when search yields nothing', () => {
    render(<FleetsPanel fleets={fleets} search="zzz-no-match" onSetSearch={vi.fn()} />);
    expect(screen.getByText('No fleets match the filter.')).toBeInTheDocument();
  });
});
