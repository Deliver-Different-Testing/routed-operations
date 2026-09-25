import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActionToolbar } from './ActionToolbar';

function makeProps(overrides: Partial<Parameters<typeof ActionToolbar>[0]> = {}) {
  return {
    selectedJobCount: 3,
    onVoid: vi.fn(),
    onUnvoid: vi.fn(),
    onBulkMoveDate: vi.fn(),
    onSendSelected: vi.fn(),
    onClearSelection: vi.fn(),
    ...overrides,
  };
}

describe('ActionToolbar', () => {
  it('renders nothing when selectedJobCount is 0', () => {
    const { container } = render(<ActionToolbar {...makeProps({ selectedJobCount: 0 })} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows a pluralised count when more than one job is selected', () => {
    render(<ActionToolbar {...makeProps({ selectedJobCount: 3 })} />);
    expect(screen.getByText('3 jobs selected')).toBeInTheDocument();
  });

  it('shows a singular count when exactly one job is selected', () => {
    render(<ActionToolbar {...makeProps({ selectedJobCount: 1 })} />);
    expect(screen.getByText('1 job selected')).toBeInTheDocument();
  });

  it('wires every action button to its handler', () => {
    const props = makeProps();
    render(<ActionToolbar {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Void' }));
    fireEvent.click(screen.getByRole('button', { name: 'Un-void' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bulk move date...' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send selected to Live' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(props.onVoid).toHaveBeenCalledTimes(1);
    expect(props.onUnvoid).toHaveBeenCalledTimes(1);
    expect(props.onBulkMoveDate).toHaveBeenCalledTimes(1);
    expect(props.onSendSelected).toHaveBeenCalledTimes(1);
    expect(props.onClearSelection).toHaveBeenCalledTimes(1);
  });
});
