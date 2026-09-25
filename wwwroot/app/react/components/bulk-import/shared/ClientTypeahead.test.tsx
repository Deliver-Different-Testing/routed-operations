import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/server';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { ClientTypeahead } from './ClientTypeahead';

const clientsEnvelope = {
  messageId: 'x',
  success: true,
  messages: [],
  isInternal: false,
  isUsTenant: false,
};

function seedClients(clients: Array<{ id: number; code: string; name: string }>) {
  server.use(
    http.get('/api/clients/search', () =>
      HttpResponse.json({
        ...clientsEnvelope,
        clients: clients.map((c) => ({ ...c, isUsTenant: false })),
      })
    )
  );
}

describe('ClientTypeahead', () => {
  it('renders the label + placeholder input', () => {
    renderWithProviders(<ClientTypeahead value={null} onChange={vi.fn()} />);
    expect(screen.getByText('Client')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/min 3 characters/i)).toBeInTheDocument();
  });

  it('shows the "type 3+" hint when opened with empty query', () => {
    renderWithProviders(<ClientTypeahead value={null} onChange={vi.fn()} />);
    fireEvent.focus(screen.getByPlaceholderText(/min 3 characters/i));
    expect(screen.getByText(/Type at least 3 characters/i)).toBeInTheDocument();
  });

  it('does not fire the search request below 3 characters', async () => {
    let called = 0;
    server.use(
      http.get('/api/clients/search', () => {
        called++;
        return HttpResponse.json({ ...clientsEnvelope, clients: [] });
      })
    );
    renderWithProviders(<ClientTypeahead value={null} onChange={vi.fn()} />);
    const input = screen.getByPlaceholderText(/min 3 characters/i);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ac' } });
    // Wait for the debounce to elapse.
    await new Promise((r) => setTimeout(r, 400));
    expect(called).toBe(0);
  });

  it('debounces and issues a /clients/search call at 3+ chars', async () => {
    seedClients([{ id: 1, code: 'ACME', name: 'Acme Ltd' }]);
    renderWithProviders(<ClientTypeahead value={null} onChange={vi.fn()} />);
    const input = screen.getByPlaceholderText(/min 3 characters/i);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'acme' } });
    await waitFor(() => expect(screen.getByRole('option')).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText('Acme Ltd')).toBeInTheDocument();
  });

  it('shows "No matching clients" for an empty result set', async () => {
    seedClients([]);
    renderWithProviders(<ClientTypeahead value={null} onChange={vi.fn()} />);
    const input = screen.getByPlaceholderText(/min 3 characters/i);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'zzz' } });
    await waitFor(() => expect(screen.getByText(/No matching clients/i)).toBeInTheDocument(), {
      timeout: 2000,
    });
  });

  it('surfaces a search-error message when the API 500s', async () => {
    server.use(
      http.get('/api/clients/search', () => HttpResponse.json({}, { status: 500 }))
    );
    renderWithProviders(<ClientTypeahead value={null} onChange={vi.fn()} />);
    const input = screen.getByPlaceholderText(/min 3 characters/i);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'acme' } });
    await waitFor(() => expect(screen.getByText(/Search failed/i)).toBeInTheDocument(), {
      timeout: 2000,
    });
  });

  it('firing onMouseDown on a suggestion calls onChange with the client', async () => {
    seedClients([{ id: 7, code: 'BETA', name: 'Beta Co' }]);
    const onChange = vi.fn();
    renderWithProviders(<ClientTypeahead value={null} onChange={onChange} />);
    const input = screen.getByPlaceholderText(/min 3 characters/i);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'beta' } });
    const option = await screen.findByRole('option', {}, { timeout: 2000 });
    fireEvent.mouseDown(option);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 7, code: 'BETA' }));
  });

  it('renders the selected client formatted and a Clear button', () => {
    const client = { id: 1, code: 'ACME', name: 'Acme Ltd', isUsTenant: false };
    renderWithProviders(<ClientTypeahead value={client} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('ACME - Acme Ltd')).toBeInTheDocument();
    expect(screen.getByLabelText('Clear selected client')).toBeInTheDocument();
  });

  it('clicking Clear invokes onChange(null)', () => {
    const client = { id: 1, code: 'ACME', name: 'Acme Ltd', isUsTenant: false };
    const onChange = vi.fn();
    renderWithProviders(<ClientTypeahead value={client} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Clear selected client'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('honours the disabled prop by disabling the input', () => {
    renderWithProviders(<ClientTypeahead value={null} onChange={vi.fn()} disabled />);
    expect(screen.getByPlaceholderText(/min 3 characters/i)).toBeDisabled();
  });

  it('closes the panel on outside mousedown', async () => {
    seedClients([{ id: 1, code: 'A', name: 'A' }]);
    renderWithProviders(
      <div>
        <ClientTypeahead value={null} onChange={vi.fn()} />
        <div data-testid="outside">outside</div>
      </div>
    );
    const input = screen.getByPlaceholderText(/min 3 characters/i);
    fireEvent.focus(input);
    expect(screen.getByText(/Type at least 3 characters/i)).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    await waitFor(() =>
      expect(screen.queryByText(/Type at least 3 characters/i)).not.toBeInTheDocument()
    );
  });
});
