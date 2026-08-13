import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CourierCombobox } from './CourierCombobox';
import type { Courier } from '@/types';

const couriers: Courier[] = [
  { courierId: 1, code: 'ALI', firstName: 'Alice', displayName: 'Alice Adams', fleet: 'N' },
  { courierId: 2, code: 'BOB', firstName: 'Bob', displayName: 'Bob Brown', fleet: 'N' },
  { courierId: 3, code: 'CAR', firstName: 'Cara', displayName: 'Cara Chan', fleet: 'S' },
];

describe('CourierCombobox', () => {
  function getInput(container: HTMLElement): HTMLInputElement {
    return container.querySelector('input[type="text"]') as HTMLInputElement;
  }

  it('renders the selected courier display name in the input', () => {
    const { container } = render(<CourierCombobox value={2} couriers={couriers} onChange={vi.fn()} />);
    expect(getInput(container).value).toBe('Bob Brown');
  });

  it('shows a placeholder dash when nothing is selected', () => {
    const { container } = render(<CourierCombobox value={null} couriers={couriers} onChange={vi.fn()} />);
    const input = getInput(container);
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('-');
  });

  it('opens the listbox on focus', () => {
    const { container } = render(<CourierCombobox value={null} couriers={couriers} onChange={vi.fn()} />);
    fireEvent.focus(getInput(container));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByText('- unassign')).toBeInTheDocument();
  });

  it('filters the option list by typed query', () => {
    const { container } = render(<CourierCombobox value={null} couriers={couriers} onChange={vi.fn()} />);
    const input = getInput(container);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ali' } });
    expect(screen.getByText('Alice Adams')).toBeInTheDocument();
    expect(screen.queryByText('Bob Brown')).not.toBeInTheDocument();
  });

  it('shows a no-matches note when the filter has no results', () => {
    const { container } = render(<CourierCombobox value={null} couriers={couriers} onChange={vi.fn()} />);
    const input = getInput(container);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(screen.getByText('No matching couriers.')).toBeInTheDocument();
  });

  it('commits null when unassign row clicked', () => {
    const onChange = vi.fn();
    const { container } = render(<CourierCombobox value={2} couriers={couriers} onChange={onChange} />);
    fireEvent.focus(getInput(container));
    fireEvent.mouseDown(screen.getByText('- unassign'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('commits the courier id when a courier row is clicked', () => {
    const onChange = vi.fn();
    const { container } = render(<CourierCombobox value={null} couriers={couriers} onChange={onChange} />);
    fireEvent.focus(getInput(container));
    fireEvent.mouseDown(screen.getByText('Cara Chan'));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('respects the disabled prop', () => {
    const { container } = render(<CourierCombobox value={null} couriers={couriers} onChange={vi.fn()} disabled />);
    expect(getInput(container)).toBeDisabled();
  });

  it('closes on Escape without change', () => {
    const onChange = vi.fn();
    const { container } = render(<CourierCombobox value={2} couriers={couriers} onChange={onChange} />);
    const input = getInput(container);
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
