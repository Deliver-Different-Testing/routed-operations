import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RosterPickerModal } from './RosterPickerModal';

const targets = {
  couriers: [{ id: 1, name: 'Courier One', code: 'C1' }],
  agents: [],
  networkPartners: [],
} as any;

describe('RosterPickerModal', () => {
  it('renders the title and Save button', () => {
    render(
      <RosterPickerModal
        title="Pick target"
        targets={targets}
        value={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByRole('heading', { name: 'Pick target' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('disables Save when no value is picked', () => {
    render(
      <RosterPickerModal
        title="Pick target"
        targets={targets}
        value={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows the Clear button when a value is present and allowClear is default', () => {
    render(
      <RosterPickerModal
        title="Pick target"
        targets={targets}
        value={{ type: 'Courier', id: 1, label: 'Courier One' } as any}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Clear (use default)' })).toBeInTheDocument();
  });

  it('hides the Clear button when allowClear is false', () => {
    render(
      <RosterPickerModal
        title="Pick target"
        targets={targets}
        value={{ type: 'Courier', id: 1, label: 'Courier One' } as any}
        allowClear={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Clear (use default)' })).not.toBeInTheDocument();
  });

  it('fires onSave with null when Clear is clicked', () => {
    const onSave = vi.fn();
    render(
      <RosterPickerModal
        title="Pick target"
        targets={targets}
        value={{ type: 'Courier', id: 1, label: 'Courier One' } as any}
        onClose={vi.fn()}
        onSave={onSave}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear (use default)' }));
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it('fires onClose when Cancel button is clicked', () => {
    const onClose = vi.fn();
    render(
      <RosterPickerModal
        title="Pick target"
        targets={targets}
        value={null}
        onClose={onClose}
        onSave={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fires onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <RosterPickerModal
        title="Pick target"
        targets={targets}
        value={null}
        onClose={onClose}
        onSave={vi.fn()}
      />
    );
    fireEvent.click(container.firstChild as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
