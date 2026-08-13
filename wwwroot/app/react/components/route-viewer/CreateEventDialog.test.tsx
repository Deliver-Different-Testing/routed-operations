import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { CreateEventDialog } from './CreateEventDialog';

function renderDlg(props: Partial<Parameters<typeof CreateEventDialog>[0]> = {}) {
  const defaults = {
    jobId: 100,
    jobNumber: 'JOB-100',
    courierCode: 'ACE',
    onClose: vi.fn(),
    onCreated: vi.fn(),
  };
  const merged = { ...defaults, ...props };
  renderWithProviders(<CreateEventDialog {...merged} />);
  return merged;
}

describe('CreateEventDialog', () => {
  beforeEach(() => {
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__,
      isNetworkPartner: false,
      fullName: 'Kev',
    };
  });

  it('renders job number + courier code + defaults', () => {
    renderDlg({ jobNumber: 'ABC-1', courierCode: 'KEV' });
    expect(screen.getByText('ABC-1')).toBeInTheDocument();
    expect(screen.getByText('KEV')).toBeInTheDocument();
  });

  it('falls back to #jobId when jobNumber is null', () => {
    renderDlg({ jobId: 42, jobNumber: undefined });
    expect(screen.getByText('#42')).toBeInTheDocument();
  });

  it('shows chained banner when chainedFromBooking=true', () => {
    renderDlg({ chainedFromBooking: true });
    expect(screen.getByText(/Booking succeeded/)).toBeInTheDocument();
  });

  it('does NOT show chained banner by default', () => {
    renderDlg();
    expect(screen.queryByText(/Booking succeeded/)).toBeNull();
  });

  it('save disabled without notes', () => {
    renderDlg();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('toggles follow-up radio between UCL and Client', async () => {
    renderDlg();
    const radios = screen.getAllByRole('radio');
    expect(radios[0]).toBeChecked(); // UCL first
    const user = userEvent.setup();
    await user.click(radios[1]);
    expect(radios[1]).toBeChecked();
  });

  it('shows admin-only checkboxes when not NP', () => {
    renderDlg();
    expect(screen.getByText('Client visible')).toBeInTheDocument();
    expect(screen.getByText('Notify client')).toBeInTheDocument();
  });

  it('hides admin-only checkboxes for NP user', () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, isNetworkPartner: true };
    renderDlg();
    expect(screen.queryByText('Client visible')).toBeNull();
    expect(screen.queryByText('Notify client')).toBeNull();
  });

  it('submits + calls onCreated on 200', async () => {
    server.use(
      http.post('/api/runviewer/events', () =>
        HttpResponse.json({ response: 'ok' }),
      ),
    );
    const props = renderDlg();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Notes/), 'Followed up with courier');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(props.onCreated).toHaveBeenCalled());
  });

  it('surfaces server error on 500', async () => {
    server.use(
      http.post('/api/runviewer/events', () =>
        HttpResponse.json({ messages: [{ message: 'oops' }] }, { status: 500 }),
      ),
    );
    renderDlg();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Notes/), 'note');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/oops/)).toBeInTheDocument();
  });

  it('cancel triggers onClose', async () => {
    const props = renderDlg();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).toHaveBeenCalled();
  });
});
