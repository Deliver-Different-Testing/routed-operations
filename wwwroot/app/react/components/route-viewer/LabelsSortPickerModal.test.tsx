import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { LabelsSortPickerModal } from './LabelsSortPickerModal';

function renderModal(overrides: Partial<Parameters<typeof LabelsSortPickerModal>[0]> = {}) {
  const defaults = {
    open: true,
    onClose: vi.fn(),
    onPrint: vi.fn(),
  };
  const props = { ...defaults, ...overrides };
  renderWithProviders(<LabelsSortPickerModal {...props} />);
  return props;
}

describe('LabelsSortPickerModal', () => {
  it('renders three radio options with Run Name selected by default', () => {
    renderModal();
    const runName = screen.getByLabelText('Run Name') as HTMLInputElement;
    const product = screen.getByLabelText('Product') as HTMLInputElement;
    const client = screen.getByLabelText('Client') as HTMLInputElement;
    expect(runName.checked).toBe(true);
    expect(product.checked).toBe(false);
    expect(client.checked).toBe(false);
  });

  it('honours initialSortMode when provided', () => {
    renderModal({ initialSortMode: 2 });
    expect((screen.getByLabelText('Product') as HTMLInputElement).checked).toBe(true);
  });

  it('does not render when open is false', () => {
    renderModal({ open: false });
    expect(screen.queryByLabelText('Run Name')).toBeNull();
  });

  it('fires onPrint with the selected sort mode + closes on Print click', async () => {
    const props = renderModal();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Client'));
    await user.click(screen.getByRole('button', { name: 'Print' }));
    expect(props.onPrint).toHaveBeenCalledWith(3);
    expect(props.onClose).toHaveBeenCalled();
  });

  it('fires onPrint with default sort mode when nothing is changed', async () => {
    const props = renderModal();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Print' }));
    expect(props.onPrint).toHaveBeenCalledWith(1);
  });

  it('closes without firing onPrint on Cancel click', async () => {
    const props = renderModal();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onPrint).not.toHaveBeenCalled();
  });
});
