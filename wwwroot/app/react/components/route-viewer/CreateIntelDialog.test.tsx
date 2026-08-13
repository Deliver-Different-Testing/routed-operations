import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { CreateIntelDialog } from './CreateIntelDialog';

function renderDlg(props: Partial<Parameters<typeof CreateIntelDialog>[0]> = {}) {
  const defaults = {
    mobile: '02100000000',
    onClose: vi.fn(),
    onCreated: vi.fn(),
  };
  const merged = { ...defaults, ...props };
  renderWithProviders(<CreateIntelDialog {...merged} />);
  return merged;
}

describe('CreateIntelDialog', () => {
  it('renders with the mobile number', () => {
    renderDlg({ mobile: '02100011122' });
    expect(screen.getByText('02100011122')).toBeInTheDocument();
    expect(screen.getByText('Create client intel')).toBeInTheDocument();
  });

  it('save button is disabled when notes are empty', () => {
    renderDlg();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
  });

  it('cancel calls onClose', async () => {
    const props = renderDlg();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('enables save when notes present + submits + calls onCreated', async () => {
    server.use(
      http.post('/api/runviewer/events/client-intel', () =>
        HttpResponse.json({ response: 'ok' }),
      ),
    );
    const props = renderDlg();
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox'));
    await user.type(screen.getByRole('textbox'), 'Dog behind gate');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).not.toBeDisabled();
    await user.click(save);
    await waitFor(() => expect(props.onCreated).toHaveBeenCalled());
  });

  it('surfaces server error inline on 500', async () => {
    server.use(
      http.post('/api/runviewer/events/client-intel', () =>
        HttpResponse.json({ messages: [{ message: 'db down' }] }, { status: 500 }),
      ),
    );
    const props = renderDlg();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), 'note');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/db down/)).toBeInTheDocument();
    expect(props.onCreated).not.toHaveBeenCalled();
  });
});
