import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { BookRedeliveryDialog } from './BookRedeliveryDialog';

function renderDlg(props: Partial<Parameters<typeof BookRedeliveryDialog>[0]> = {}) {
  const defaults = {
    sourceJobId: 42,
    onClose: vi.fn(),
    onBooked: vi.fn(),
  };
  const merged = { ...defaults, ...props };
  renderWithProviders(<BookRedeliveryDialog {...merged} />);
  return merged;
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Delivery company/), 'Acme');
  await user.type(screen.getByLabelText(/Contact \*/), 'Jane');
  await user.type(screen.getByLabelText(/Address \*/), '1 Main St');
  await user.type(screen.getByLabelText(/Suburb \*/), 'Grey Lynn');
}

describe('BookRedeliveryDialog', () => {
  it('renders in redelivery mode by default', () => {
    renderDlg();
    expect(screen.getByText('Book direct redelivery')).toBeInTheDocument();
  });

  it('renders in return-to-base mode when mode=return-to-base', () => {
    renderDlg({ mode: 'return-to-base' });
    expect(screen.getByText('Book return to base')).toBeInTheDocument();
  });

  it('primary book disabled until required fields filled', async () => {
    renderDlg();
    expect(screen.getByRole('button', { name: 'Book' })).toBeDisabled();
    const user = userEvent.setup();
    await fillRequired(user);
    expect(screen.getByRole('button', { name: 'Book' })).not.toBeDisabled();
  });

  it('submits with correct payload + calls onBooked with returned bulkJobId', async () => {
    let sent: any = null;
    server.use(
      http.post('/api/runviewer/booking/one-off', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ response: { bulkJobId: 999 } });
      }),
    );
    const props = renderDlg();
    const user = userEvent.setup();
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Book' }));
    await waitFor(() => expect(props.onBooked).toHaveBeenCalledWith(999));
    expect(sent.SourceId).toBe(8);
    expect(sent.QuoteId).toBe('42'); // string
    expect(sent.Weight).toBe(1);
  });

  it('adds JobNotificationType=WEBSITE when mode=return-to-base', async () => {
    let sent: any = null;
    server.use(
      http.post('/api/runviewer/booking/one-off', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ response: { bulkJobId: 5 } });
      }),
    );
    renderDlg({ mode: 'return-to-base' });
    const user = userEvent.setup();
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Book' }));
    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent.JobNotificationType).toBe('WEBSITE');
  });

  it('shows alert + inline error on server 500', async () => {
    server.use(
      http.post('/api/runviewer/booking/one-off', () =>
        HttpResponse.json({ messages: [{ message: 'nope' }] }, { status: 500 }),
      ),
    );
    const props = renderDlg();
    const user = userEvent.setup();
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Book' }));
    // Alert appears from useAlert (ConfirmContext modal); error also sets state
    await waitFor(() =>
      expect(screen.getAllByText(/nope/).length).toBeGreaterThan(0),
    );
    expect(props.onBooked).not.toHaveBeenCalled();
  });

  it('cancel triggers onClose', async () => {
    const props = renderDlg();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).toHaveBeenCalled();
  });
});
