import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { AssignRouteDialog } from './AssignRouteDialog';

const stubCouriers = (rows: Array<{ courierId: number; code: string; name: string }>) =>
  http.get('/api/runviewer/couriers/search', () =>
    HttpResponse.json({ response: rows }),
  );

function renderDlg(props: Partial<Parameters<typeof AssignRouteDialog>[0]> = {}) {
  const defaults = {
    runId: 5,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  };
  const merged = { ...defaults, ...props };
  renderWithProviders(<AssignRouteDialog {...merged} />);
  return merged;
}

describe('AssignRouteDialog', () => {
  beforeEach(() => {
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__,
      isNetworkPartner: false,
    };
    server.use(stubCouriers([]));
  });

  it('renders "Assign route" title for admin', () => {
    renderDlg();
    expect(screen.getByText('Assign route')).toBeInTheDocument();
  });

  it('renders "Assign courier" title for NP + hides bucket radios', () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, isNetworkPartner: true };
    renderDlg();
    expect(screen.getByText('Assign courier')).toBeInTheDocument();
    // Only one bucket for NP -> no radios rendered
    expect(screen.queryByLabelText(/Agent/)).toBeNull();
  });

  it('shows admin bucket radios (courier/agent/np)', () => {
    renderDlg();
    // Radio labels rendered as capitalize / Network Partner
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('shows "search wires up in P6b" note when agent bucket picked', async () => {
    renderDlg();
    const user = userEvent.setup();
    const radios = screen.getAllByRole('radio');
    await user.click(radios[1]); // agent
    expect(await screen.findByText(/agent search wires up in P6b/)).toBeInTheDocument();
  });

  it('runs courier search after debounce + lists rows', async () => {
    server.use(
      stubCouriers([
        { courierId: 1, code: 'ACE', name: 'Ace' },
        { courierId: 2, code: 'KEV', name: 'Kev' },
      ]),
    );
    renderDlg();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Search couriers/), 'e');
    expect(await screen.findByRole('button', { name: /Ace \(ACE\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Kev \(KEV\)/ })).toBeInTheDocument();
  });

  it('picks a courier + assigns + calls onSuccess', async () => {
    server.use(
      stubCouriers([{ courierId: 1, code: 'ACE', name: 'Ace' }]),
      http.post('/api/runviewer/jobs/assign', () =>
        HttpResponse.json({ response: { assigned: 3 } }),
      ),
    );
    const props = renderDlg();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Search couriers/), 'ac');
    await user.click(await screen.findByRole('button', { name: /Ace \(ACE\)/ }));
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(props.onSuccess).toHaveBeenCalled());
    expect(vi.mocked(props.onSuccess).mock.calls[0][0]).toMatch(/Ace/);
  });

  it('shows error on assign 500', async () => {
    server.use(
      stubCouriers([{ courierId: 1, code: 'ACE', name: 'Ace' }]),
      http.post('/api/runviewer/jobs/assign', () =>
        HttpResponse.json({ messages: [{ message: 'assign fail' }] }, { status: 500 }),
      ),
    );
    renderDlg();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Search couriers/), 'ac');
    await user.click(await screen.findByRole('button', { name: /Ace \(ACE\)/ }));
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    expect(await screen.findByText(/assign fail/)).toBeInTheDocument();
  });

  it('cancel triggers onClose', async () => {
    const props = renderDlg();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('shows empty-state message initially with no matches', async () => {
    renderDlg();
    expect(
      await screen.findByText(/No matches - type to search/),
    ).toBeInTheDocument();
  });

  it('renders empty rows message on 404-like empty response', async () => {
    server.use(stubCouriers([]));
    renderDlg();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Search couriers/), 'xx');
    // Wait for empty state (also fires courier search but empty)
    await waitFor(() =>
      expect(screen.getByText(/No matches - type to search/)).toBeInTheDocument(),
    );
  });
});
