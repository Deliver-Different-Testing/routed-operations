import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { FiltersBar } from './FiltersBar';
import type { JobFilters, Region, Speed } from '@/types';

const regions: Region[] = [
  { id: 1, label: 'North' },
  { id: 2, label: 'South' },
];
const speeds: Speed[] = [
  { id: 10, label: 'Same Day' },
  { id: 11, label: 'Overnight' },
];
const clients = [
  { id: 100, label: 'Acme' },
  { id: 200, label: 'Beta' },
];
const filters: JobFilters = {
  date: '2026-08-13',
  clientIds: [],
  regionIds: [],
  ourRefs: [],
  speeds: [],
};

function renderBar(over: Partial<Parameters<typeof FiltersBar>[0]> = {}) {
  return render(
    <FiltersBar
      filters={filters}
      regions={regions}
      speeds={speeds}
      clients={clients}
      ourRefs={['REF1', 'REF2']}
      onChange={over.onChange ?? vi.fn()}
      onRefresh={over.onRefresh ?? vi.fn()}
      onSyncHd={over.onSyncHd ?? vi.fn()}
      {...over}
    />
  );
}

describe('FiltersBar', () => {
  it('renders every filter trigger + the two action buttons', () => {
    renderBar();
    expect(screen.getByLabelText(/Date/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Regions/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Speeds/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clients/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Our Ref/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync EH/HD' })).toBeInTheDocument();
  });

  it('emits a date patch when the date input changes', () => {
    const onChange = vi.fn();
    renderBar({ onChange });
    fireEvent.change(screen.getByLabelText(/Date/), { target: { value: '2026-09-01' } });
    expect(onChange).toHaveBeenCalledWith({ date: '2026-09-01' });
  });

  it('fires onRefresh and onSyncHd when the action buttons are clicked', () => {
    const onRefresh = vi.fn();
    const onSyncHd = vi.fn();
    renderBar({ onRefresh, onSyncHd });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sync EH/HD' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onSyncHd).toHaveBeenCalledTimes(1);
  });

  it('opens the Regions panel and toggles an option', () => {
    const onChange = vi.fn();
    renderBar({ onChange });
    fireEvent.click(screen.getByRole('button', { name: /Regions/ }));
    // The popup uses <label><input><span>North</span></label>. Click the span
    // (label bubbling toggles the checkbox).
    fireEvent.click(screen.getByText('North'));
    expect(onChange).toHaveBeenCalledWith({ regionIds: [1] });
  });

  it('opens Clients and shows every client option', () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: /Clients/ }));
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('narrows the option list by search input', () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: /Clients/ }));
    const searchInput = screen.getByPlaceholderText(/Search clients/);
    fireEvent.change(searchInput, { target: { value: 'acm' } });
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();
  });

  it('supports Select all inside a multiselect panel', () => {
    const onChange = vi.fn();
    renderBar({ onChange });
    fireEvent.click(screen.getByRole('button', { name: /Speeds/ }));
    fireEvent.click(screen.getByRole('button', { name: /Select all/ }));
    expect(onChange).toHaveBeenCalledWith({ speeds: [10, 11] });
  });
});
