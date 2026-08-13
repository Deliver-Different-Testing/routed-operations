import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LayoutMenu } from './LayoutMenu';
import type { CockpitLayout } from '@/lib/layouts';

const layouts: CockpitLayout[] = [
  { name: 'Dense', panels: {} as any } as unknown as CockpitLayout,
  { name: 'Wide', panels: {} as any } as unknown as CockpitLayout,
];

describe('LayoutMenu', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('renders the Layout toggle button', () => {
    render(<LayoutMenu layouts={layouts} onSave={vi.fn()} onLoad={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Layout' })).toBeInTheDocument();
  });

  it('does not show menu items until Layout is clicked', () => {
    render(<LayoutMenu layouts={layouts} onSave={vi.fn()} onLoad={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByText('Reset to default')).not.toBeInTheDocument();
  });

  it('opens the menu when the Layout button is clicked', () => {
    render(<LayoutMenu layouts={layouts} onSave={vi.fn()} onLoad={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Layout' }));
    expect(screen.getByText('Reset to default')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dense' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wide' })).toBeInTheDocument();
  });

  it('fires onLoad with DEFAULT_LAYOUT when Reset clicked', () => {
    const onLoad = vi.fn();
    render(<LayoutMenu layouts={layouts} onSave={vi.fn()} onLoad={onLoad} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Layout' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('fires onLoad with the picked layout when its row clicked', () => {
    const onLoad = vi.fn();
    render(<LayoutMenu layouts={layouts} onSave={vi.fn()} onLoad={onLoad} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Layout' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dense' }));
    expect(onLoad).toHaveBeenCalledWith(layouts[0]);
  });

  it('fires onDelete after confirm when the x button clicked', () => {
    const onDelete = vi.fn();
    render(<LayoutMenu layouts={layouts} onSave={vi.fn()} onLoad={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Layout' }));
    const deleteBtns = screen.getAllByTitle('Delete this layout');
    fireEvent.click(deleteBtns[0]);
    expect(onDelete).toHaveBeenCalledWith('Dense');
  });

  it('shows the save input when "+ Save current layout" clicked and commits on Save', () => {
    const onSave = vi.fn();
    render(<LayoutMenu layouts={layouts} onSave={onSave} onLoad={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Layout' }));
    fireEvent.click(screen.getByRole('button', { name: /Save current layout/ }));
    const input = screen.getByPlaceholderText('Layout name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'My Layout' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('My Layout');
  });

  it('does not save when the name is only whitespace', () => {
    const onSave = vi.fn();
    render(<LayoutMenu layouts={layouts} onSave={onSave} onLoad={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Layout' }));
    fireEvent.click(screen.getByRole('button', { name: /Save current layout/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
  });
});
