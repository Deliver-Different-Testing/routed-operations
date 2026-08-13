import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterPresetsMenu } from './FilterPresetsMenu';

function preset(name: string) {
  return {
    name,
    filters: { regionIds: [], clientIds: [], speeds: [], ourRefs: [] },
  } as any;
}

describe('FilterPresetsMenu', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('renders the Presets toggle button', () => {
    render(<FilterPresetsMenu presets={[]} onSave={vi.fn()} onLoad={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Presets' })).toBeInTheDocument();
  });

  it('does not show menu contents until Presets clicked', () => {
    render(<FilterPresetsMenu presets={[preset('Foo')]} onSave={vi.fn()} onLoad={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByText('Foo')).not.toBeInTheDocument();
  });

  it('shows the empty-state note when there are no presets', () => {
    render(<FilterPresetsMenu presets={[]} onSave={vi.fn()} onLoad={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Presets' }));
    expect(screen.getByText('No presets saved yet.')).toBeInTheDocument();
  });

  it('lists every preset when opened', () => {
    render(<FilterPresetsMenu presets={[preset('A'), preset('B')]} onSave={vi.fn()} onLoad={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Presets' }));
    expect(screen.getByRole('button', { name: 'A' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'B' })).toBeInTheDocument();
  });

  it('fires onLoad with the picked preset', () => {
    const onLoad = vi.fn();
    const p = preset('X');
    render(<FilterPresetsMenu presets={[p]} onSave={vi.fn()} onLoad={onLoad} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Presets' }));
    fireEvent.click(screen.getByRole('button', { name: 'X' }));
    expect(onLoad).toHaveBeenCalledWith(p);
  });

  it('fires onDelete after confirm when the delete button clicked', () => {
    const onDelete = vi.fn();
    render(<FilterPresetsMenu presets={[preset('X')]} onSave={vi.fn()} onLoad={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Presets' }));
    fireEvent.click(screen.getByTitle('Delete this preset'));
    expect(onDelete).toHaveBeenCalledWith('X');
  });

  it('saves a preset when name typed and Save clicked', () => {
    const onSave = vi.fn();
    render(<FilterPresetsMenu presets={[]} onSave={onSave} onLoad={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Presets' }));
    fireEvent.click(screen.getByRole('button', { name: /Save current filters/ }));
    fireEvent.change(screen.getByPlaceholderText('Preset name'), { target: { value: 'My preset' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('My preset');
  });

  it('ignores empty name submissions', () => {
    const onSave = vi.fn();
    render(<FilterPresetsMenu presets={[]} onSave={onSave} onLoad={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Presets' }));
    fireEvent.click(screen.getByRole('button', { name: /Save current filters/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
  });
});
