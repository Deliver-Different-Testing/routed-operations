import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssignTargetPicker } from './AssignTargetPicker';
import type { AssignableTargets } from '@/services/recurringRouteService';

const TARGETS: AssignableTargets = {
  couriers: [
    { id: 1, name: 'Alpha Courier', hint: 'AK' },
    { id: 2, name: 'Beta Courier', hint: 'WL' },
  ],
  agents: [
    { id: 10, name: 'Gamma Agent', hint: 'CH' },
  ],
  nps: [
    { id: 20, name: 'Delta NP', hint: 'AU' },
  ],
};

describe('AssignTargetPicker', () => {
  it('renders three type toggle buttons', () => {
    render(<AssignTargetPicker targets={TARGETS} value={null} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Courier' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agent' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'NP' })).toBeInTheDocument();
  });

  it('defaults to Courier type with the courier placeholder', () => {
    render(<AssignTargetPicker targets={TARGETS} value={null} onChange={() => {}} />);
    expect(screen.getByPlaceholderText('Search courier...')).toBeInTheDocument();
  });

  it('switches placeholder when Agent type is picked', () => {
    render(<AssignTargetPicker targets={TARGETS} value={null} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
    expect(screen.getByPlaceholderText('Search agent...')).toBeInTheDocument();
  });

  it('switches placeholder when NP type is picked', () => {
    render(<AssignTargetPicker targets={TARGETS} value={null} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'NP' }));
    expect(screen.getByPlaceholderText('Search Network Partner...')).toBeInTheDocument();
  });

  it('emits null onChange when switching type away from the current selection', () => {
    const onChange = vi.fn();
    render(
      <AssignTargetPicker
        targets={TARGETS}
        value={{ type: 'Courier', id: 1 }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('does not emit onChange when picking the already-active type', () => {
    const onChange = vi.fn();
    render(<AssignTargetPicker targets={TARGETS} value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Courier' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the option list on input focus', () => {
    render(<AssignTargetPicker targets={TARGETS} value={null} onChange={() => {}} />);
    fireEvent.focus(screen.getByPlaceholderText('Search courier...'));
    expect(screen.getByRole('button', { name: /Alpha Courier/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Beta Courier/ })).toBeInTheDocument();
  });

  it('filters options as the user types in the search input', async () => {
    const user = userEvent.setup();
    render(<AssignTargetPicker targets={TARGETS} value={null} onChange={() => {}} />);
    const input = screen.getByPlaceholderText('Search courier...');
    await user.type(input, 'Beta');
    expect(screen.getByRole('button', { name: /Beta Courier/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Alpha Courier/ })).not.toBeInTheDocument();
  });

  it('filters options by hint text too', async () => {
    const user = userEvent.setup();
    render(<AssignTargetPicker targets={TARGETS} value={null} onChange={() => {}} />);
    const input = screen.getByPlaceholderText('Search courier...');
    await user.type(input, 'WL');
    expect(screen.getByRole('button', { name: /Beta Courier/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Alpha Courier/ })).not.toBeInTheDocument();
  });

  it('fires onChange with type + id when an option is picked', () => {
    const onChange = vi.fn();
    render(<AssignTargetPicker targets={TARGETS} value={null} onChange={onChange} />);
    fireEvent.focus(screen.getByPlaceholderText('Search courier...'));
    fireEvent.click(screen.getByRole('button', { name: /Alpha Courier/ }));
    expect(onChange).toHaveBeenCalledWith({ type: 'Courier', id: 1 });
  });

  it('shows the clear button when a value is selected', () => {
    render(
      <AssignTargetPicker
        targets={TARGETS}
        value={{ type: 'Courier', id: 1 }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTitle('Clear')).toBeInTheDocument();
  });

  it('fires onChange(null) and empties the input when clear is clicked', () => {
    const onChange = vi.fn();
    render(
      <AssignTargetPicker
        targets={TARGETS}
        value={{ type: 'Courier', id: 1 }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTitle('Clear'));
    expect(onChange).toHaveBeenCalledWith(null);
    expect((screen.getByPlaceholderText('Search courier...') as HTMLInputElement).value).toBe('');
  });

  it('pre-fills the input with the selected item name', () => {
    render(
      <AssignTargetPicker
        targets={TARGETS}
        value={{ type: 'Courier', id: 1 }}
        onChange={() => {}}
      />,
    );
    expect((screen.getByPlaceholderText('Search courier...') as HTMLInputElement).value).toBe('Alpha Courier');
  });

  it('shows a No <type> match message when the filter matches nothing', async () => {
    const user = userEvent.setup();
    render(<AssignTargetPicker targets={TARGETS} value={null} onChange={() => {}} />);
    const input = screen.getByPlaceholderText('Search courier...');
    await user.type(input, 'zzz');
    expect(screen.getByText('No couriers match.')).toBeInTheDocument();
  });

  it('renders no target list when targets prop is null', () => {
    render(<AssignTargetPicker targets={null} value={null} onChange={() => {}} />);
    fireEvent.focus(screen.getByPlaceholderText('Search courier...'));
    expect(screen.queryByRole('button', { name: /Alpha Courier/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/match\./)).not.toBeInTheDocument();
  });
});
