import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MultiSelectPill } from './MultiSelectPill';
import type { Lookup } from '../../services/routeViewerService';

const opts: Lookup[] = [
  { id: 1, label: 'AKL' },
  { id: 2, label: 'WLG' },
  { id: 3, label: 'CHC' },
];

describe('MultiSelectPill', () => {
  it('renders label + default empty text when nothing selected', () => {
    render(
      <MultiSelectPill
        label="Depot"
        options={opts}
        selected={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Depot:')).toBeInTheDocument();
    expect(screen.getByText('All')).toBeInTheDocument();
  });

  it('renders custom emptyText when provided', () => {
    render(
      <MultiSelectPill
        label="Depot"
        options={opts}
        selected={[]}
        onChange={vi.fn()}
        emptyText="Any"
      />,
    );
    expect(screen.getByText('Any')).toBeInTheDocument();
  });

  it('shows the label of the single selected option', () => {
    render(
      <MultiSelectPill
        label="Depot"
        options={opts}
        selected={[2]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('WLG')).toBeInTheDocument();
  });

  it('falls back to "1 selected" when the sole id has no matching option', () => {
    render(
      <MultiSelectPill
        label="Depot"
        options={opts}
        selected={[99]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('shows N selected when 2+ picked', () => {
    render(
      <MultiSelectPill
        label="Depot"
        options={opts}
        selected={[1, 2]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('opens the popover on button click and closes on backdrop click', async () => {
    render(
      <MultiSelectPill
        label="Depot"
        options={opts}
        selected={[]}
        onChange={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    const btn = screen.getByRole('button', { name: /Depot:/ });
    await user.click(btn);
    expect(screen.getByText('AKL')).toBeInTheDocument();
    expect(screen.getByText('Clear')).toBeInTheDocument();
    // Backdrop is the fixed inset-0 div; find it by class and click.
    const backdrop = document.querySelector('.fixed.inset-0') as HTMLElement;
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop);
    // After close the option labels disappear from the DOM.
    expect(screen.queryByText('Clear')).toBeNull();
  });

  it('toggles the arrow indicator when open', async () => {
    render(
      <MultiSelectPill
        label="Depot"
        options={opts}
        selected={[]}
        onChange={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    expect(screen.getByText('▼')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Depot:/ }));
    expect(screen.getByText('▲')).toBeInTheDocument();
  });

  it('toggle adds id to selection when not present', async () => {
    const onChange = vi.fn();
    render(
      <MultiSelectPill
        label="Depot"
        options={opts}
        selected={[1]}
        onChange={onChange}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Depot:/ }));
    // Click the WLG checkbox row
    await user.click(screen.getByLabelText('WLG'));
    expect(onChange).toHaveBeenCalledWith([1, 2]);
  });

  it('toggle removes id from selection when already present', async () => {
    const onChange = vi.fn();
    render(
      <MultiSelectPill
        label="Depot"
        options={opts}
        selected={[1, 2]}
        onChange={onChange}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Depot:/ }));
    await user.click(screen.getByLabelText('AKL'));
    expect(onChange).toHaveBeenCalledWith([2]);
  });

  it('Clear button empties the selection', async () => {
    const onChange = vi.fn();
    render(
      <MultiSelectPill
        label="Depot"
        options={opts}
        selected={[1, 2]}
        onChange={onChange}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Depot:/ }));
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('renders "No options" and no Clear button when options is empty', async () => {
    render(
      <MultiSelectPill
        label="Depot"
        options={[]}
        selected={[]}
        onChange={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Depot:/ }));
    expect(screen.getByText('No options')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  it('shows checked state on the boxes that are selected', async () => {
    render(
      <MultiSelectPill
        label="Depot"
        options={opts}
        selected={[2]}
        onChange={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Depot:/ }));
    const akl = screen.getByLabelText('AKL') as HTMLInputElement;
    const wlg = screen.getByLabelText('WLG') as HTMLInputElement;
    expect(akl.checked).toBe(false);
    expect(wlg.checked).toBe(true);
  });

  it('applies passed className to the root wrapper', () => {
    const { container } = render(
      <MultiSelectPill
        label="Depot"
        options={opts}
        selected={[]}
        onChange={vi.fn()}
        className="test-wrap"
      />,
    );
    expect(container.querySelector('.test-wrap')).not.toBeNull();
  });
});
