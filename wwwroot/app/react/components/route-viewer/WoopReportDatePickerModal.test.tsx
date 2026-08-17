import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { WoopReportDatePickerModal } from './WoopReportDatePickerModal';

function renderModal(overrides: Partial<Parameters<typeof WoopReportDatePickerModal>[0]> = {}) {
  const defaults = {
    open: true,
    onClose: vi.fn(),
    onDownload: vi.fn(),
    defaultDate: '2026-08-14',
  };
  const props = { ...defaults, ...overrides };
  renderWithProviders(<WoopReportDatePickerModal {...props} />);
  return props;
}

describe('WoopReportDatePickerModal', () => {
  it('renders From + To date inputs both defaulting to defaultDate', () => {
    renderModal();
    const from = screen.getByLabelText(/From date/) as HTMLInputElement;
    const to = screen.getByLabelText(/To date/) as HTMLInputElement;
    expect(from.value).toBe('2026-08-14');
    expect(to.value).toBe('2026-08-14');
  });

  it('does not render when open is false', () => {
    renderModal({ open: false });
    expect(screen.queryByLabelText(/From date/)).toBeNull();
  });

  it('fires onDownload with both dates + closes on Download click', async () => {
    const props = renderModal();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(props.onDownload).toHaveBeenCalledWith('2026-08-14', '2026-08-14');
    expect(props.onClose).toHaveBeenCalled();
  });

  it('allows setting a different From + To window before download', async () => {
    const props = renderModal();
    const user = userEvent.setup();
    const from = screen.getByLabelText(/From date/) as HTMLInputElement;
    const to = screen.getByLabelText(/To date/) as HTMLInputElement;
    await user.clear(from);
    await user.type(from, '2026-08-10');
    await user.clear(to);
    await user.type(to, '2026-08-14');
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(props.onDownload).toHaveBeenCalledWith('2026-08-10', '2026-08-14');
  });

  it('disables Download + shows an error when From > To', async () => {
    const props = renderModal();
    const user = userEvent.setup();
    const from = screen.getByLabelText(/From date/) as HTMLInputElement;
    await user.clear(from);
    await user.type(from, '2026-08-20');
    const download = screen.getByRole('button', { name: 'Download' }) as HTMLButtonElement;
    expect(download.disabled).toBe(true);
    expect(screen.getByText(/From date must be on or before To date/)).toBeInTheDocument();
    await user.click(download);
    expect(props.onDownload).not.toHaveBeenCalled();
  });

  it('closes without firing onDownload on Cancel click', async () => {
    const props = renderModal();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onDownload).not.toHaveBeenCalled();
  });
});
