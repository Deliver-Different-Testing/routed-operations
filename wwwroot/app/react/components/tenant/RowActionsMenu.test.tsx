import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RowActionsMenu, type RowAction } from './RowActionsMenu';

describe('RowActionsMenu', () => {
  it('renders nothing when actions array is empty', () => {
    const { container } = render(<RowActionsMenu actions={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the kebab button with default aria-label', () => {
    const actions: RowAction[] = [{ label: 'Copy', onClick: vi.fn() }];
    render(<RowActionsMenu actions={actions} />);
    expect(screen.getByRole('button', { name: 'Row actions' })).toBeInTheDocument();
  });

  it('honours a custom aria-label', () => {
    const actions: RowAction[] = [{ label: 'Copy', onClick: vi.fn() }];
    render(<RowActionsMenu actions={actions} label="Route actions" />);
    expect(screen.getByRole('button', { name: 'Route actions' })).toBeInTheDocument();
  });

  it('does not show menu items until opened', () => {
    const actions: RowAction[] = [{ label: 'Copy', onClick: vi.fn() }];
    render(<RowActionsMenu actions={actions} />);
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });

  it('opens the menu on button click and shows every action', () => {
    const actions: RowAction[] = [
      { label: 'Copy', onClick: vi.fn() },
      { label: 'Delete', onClick: vi.fn(), danger: true },
    ];
    render(<RowActionsMenu actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: 'Row actions' }));
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('applies the danger class to danger actions', () => {
    const actions: RowAction[] = [{ label: 'Delete', onClick: vi.fn(), danger: true }];
    render(<RowActionsMenu actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: 'Row actions' }));
    expect(screen.getByRole('menuitem', { name: 'Delete' }).className).toContain('text-red-600');
  });

  it('invokes the action handler and closes the menu when picked', () => {
    const onClick = vi.fn();
    const actions: RowAction[] = [{ label: 'Copy', onClick }];
    render(<RowActionsMenu actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: 'Row actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });

  it('closes the menu when the toggle button is clicked twice', () => {
    const actions: RowAction[] = [{ label: 'Copy', onClick: vi.fn() }];
    render(<RowActionsMenu actions={actions} />);
    const btn = screen.getByRole('button', { name: 'Row actions' });
    fireEvent.click(btn);
    expect(screen.getByRole('menuitem')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });
});
