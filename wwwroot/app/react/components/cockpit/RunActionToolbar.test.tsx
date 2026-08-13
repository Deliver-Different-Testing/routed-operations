import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RunActionToolbar } from './RunActionToolbar';

function props(overrides: Partial<Parameters<typeof RunActionToolbar>[0]> = {}) {
  return {
    selectedRunCount: 2,
    hasLockedInSelection: true,
    hasUnlockedInSelection: true,
    onLockAll: vi.fn(),
    onUnlockAll: vi.fn(),
    onDeleteAll: vi.fn(),
    onDispatchAll: vi.fn(),
    onClearSelection: vi.fn(),
    ...overrides,
  };
}

describe('RunActionToolbar', () => {
  it('renders nothing when selectedRunCount is 0', () => {
    const { container } = render(<RunActionToolbar {...props({ selectedRunCount: 0 })} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders singular label for one selected run', () => {
    render(<RunActionToolbar {...props({ selectedRunCount: 1 })} />);
    expect(screen.getByText('1 run selected')).toBeInTheDocument();
  });

  it('renders plural label for multiple runs', () => {
    render(<RunActionToolbar {...props({ selectedRunCount: 3 })} />);
    expect(screen.getByText('3 runs selected')).toBeInTheDocument();
  });

  it('disables Lock all when there are no unlocked runs', () => {
    render(<RunActionToolbar {...props({ hasUnlockedInSelection: false })} />);
    expect(screen.getByRole('button', { name: 'Lock all' })).toBeDisabled();
  });

  it('disables Unlock all + Dispatch locked when there are no locked runs', () => {
    render(<RunActionToolbar {...props({ hasLockedInSelection: false })} />);
    expect(screen.getByRole('button', { name: 'Unlock all' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dispatch locked' })).toBeDisabled();
  });

  it('wires every action to its handler', () => {
    const p = props();
    render(<RunActionToolbar {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Lock all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unlock all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dispatch locked' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(p.onLockAll).toHaveBeenCalledTimes(1);
    expect(p.onUnlockAll).toHaveBeenCalledTimes(1);
    expect(p.onDispatchAll).toHaveBeenCalledTimes(1);
    expect(p.onDeleteAll).toHaveBeenCalledTimes(1);
    expect(p.onClearSelection).toHaveBeenCalledTimes(1);
  });
});
