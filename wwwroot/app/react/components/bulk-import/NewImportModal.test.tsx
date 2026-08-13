import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderWithProviders } from '../../test/renderWithProviders';
import { NewImportModal } from './NewImportModal';
import { initialWizardState, type WizardState } from './wizardState';

const clientsEnvelope = {
  messageId: 'x',
  success: true,
  messages: [],
  isInternal: false,
  isUsTenant: false,
};

function seed(state?: Partial<WizardState>): WizardState {
  return { ...initialWizardState(), ...state };
}

describe('NewImportModal', () => {
  it('renders nothing (no dialog / heading) when open is false', () => {
    renderWithProviders(
      <NewImportModal open={false} state={seed()} dispatch={vi.fn()} onCancel={vi.fn()} />
    );
    expect(screen.queryByText('New Import')).not.toBeInTheDocument();
  });

  it('shows title, import type radios, and disabled Upload button before file/client are set', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({ ...clientsEnvelope, clients: [] })
      )
    );
    renderWithProviders(
      <NewImportModal open state={seed()} dispatch={vi.fn()} onCancel={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByText('New Import')).toBeInTheDocument());
    expect(screen.getByText('Import Type')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload File' })).toBeDisabled();
  });

  it('populates the dropdown when the operator is not internal and multiple clients returned', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({
          ...clientsEnvelope,
          clients: [
            { id: 1, code: 'A', name: 'Alpha', isUsTenant: false },
            { id: 2, code: 'B', name: 'Bravo', isUsTenant: false },
          ],
        })
      )
    );
    renderWithProviders(
      <NewImportModal open state={seed()} dispatch={vi.fn()} onCancel={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByLabelText('Client')).toBeInTheDocument());
    const select = screen.getByLabelText('Client') as HTMLSelectElement;
    expect(select.options.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('option', { name: /A - Alpha/i })).toBeInTheDocument();
  });

  it('auto-selects the single non-internal client via SET_CLIENT dispatch', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({
          ...clientsEnvelope,
          clients: [{ id: 42, code: 'X', name: 'Only', isUsTenant: false }],
        })
      )
    );
    const dispatch = vi.fn();
    renderWithProviders(
      <NewImportModal open state={seed()} dispatch={dispatch} onCancel={vi.fn()} />
    );
    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SET_CLIENT',
          client: expect.objectContaining({ id: 42 }),
        })
      );
    });
  });

  it('renders ClientTypeahead when isInternal is true', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({ ...clientsEnvelope, isInternal: true, clients: [] })
      )
    );
    renderWithProviders(
      <NewImportModal open state={seed()} dispatch={vi.fn()} onCancel={vi.fn()} />
    );
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/min 3 characters/i)).toBeInTheDocument()
    );
  });

  it('clicking a radio dispatches SET_IMPORT_TYPE', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({ ...clientsEnvelope, clients: [] })
      )
    );
    const dispatch = vi.fn();
    renderWithProviders(
      <NewImportModal open state={seed()} dispatch={dispatch} onCancel={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByText('Import Type')).toBeInTheDocument());
    const onDemandRadio = screen.getByRole('radio', { name: /On-Demand/i });
    fireEvent.click(onDemandRadio);
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_IMPORT_TYPE', importType: 'onDemand' });
    // Re-render with onDemand state so clicking Routed / Scheduled fires a
    // change. React's controlled radio only reports change events when the
    // checked state actually flips.
    dispatch.mockClear();
    const stateOnDemand = seed({ importType: 'onDemand' });
    const { rerender } = renderWithProviders(
      <NewImportModal open state={stateOnDemand} dispatch={dispatch} onCancel={vi.fn()} />
    );
    await waitFor(() => expect(screen.getAllByText('Import Type').length).toBeGreaterThan(0));
    // With two modal instances active, target the second one's radio.
    const routedRadios = screen.getAllByRole('radio', { name: /Scheduled|Routed/i });
    fireEvent.click(routedRadios[routedRadios.length - 1]);
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_IMPORT_TYPE', importType: 'routed' });
    rerender(<div />);
  });

  it('clicking Cancel invokes onCancel', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({ ...clientsEnvelope, clients: [] })
      )
    );
    const onCancel = vi.fn();
    renderWithProviders(
      <NewImportModal open state={seed()} dispatch={vi.fn()} onCancel={onCancel} />
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('dispatches SET_PARSED + GOTO(mapColumns) after a successful upload', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({ ...clientsEnvelope, clients: [] })
      ),
      http.post('/api/bulk-import/upload', () =>
        HttpResponse.text(JSON.stringify([{ A: '1', B: '2' }]))
      )
    );
    const dispatch = vi.fn();
    const state = seed({
      client: { id: 1, code: 'C', name: 'C', isUsTenant: false },
      file: new File(['x'], 'x.csv'),
    });
    renderWithProviders(
      <NewImportModal open state={state} dispatch={dispatch} onCancel={vi.fn()} />
    );
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: 'Upload File' });
      expect(btn).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload File' }));
    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SET_PARSED' })
      );
    });
    expect(dispatch).toHaveBeenCalledWith({ type: 'GOTO', step: 'mapColumns' });
  });

  it('shows a toast when upload fails', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({ ...clientsEnvelope, clients: [] })
      ),
      http.post('/api/bulk-import/upload', () =>
        HttpResponse.json({ message: 'kaboom' }, { status: 500 })
      )
    );
    const dispatch = vi.fn();
    const state = seed({
      client: { id: 1, code: 'C', name: 'C', isUsTenant: false },
      file: new File(['x'], 'x.csv'),
    });
    renderWithProviders(
      <NewImportModal open state={state} dispatch={dispatch} onCancel={vi.fn()} />
    );
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: 'Upload File' });
      expect(btn).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload File' }));
    await waitFor(() => expect(screen.getByText(/Upload failed/)).toBeInTheDocument());
  });

  it('shows the "Failed to load clients" toast when /clients 500s', async () => {
    server.use(
      http.get('/api/clients', () => HttpResponse.json({}, { status: 500 }))
    );
    renderWithProviders(
      <NewImportModal open state={seed()} dispatch={vi.fn()} onCancel={vi.fn()} />
    );
    await waitFor(() =>
      expect(screen.getByText(/Failed to load clients/)).toBeInTheDocument()
    );
  });

  it('dispatch SET_CLIENT fires when picking a client in the dropdown', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({
          ...clientsEnvelope,
          clients: [
            { id: 1, code: 'A', name: 'A', isUsTenant: false },
            { id: 2, code: 'B', name: 'B', isUsTenant: false },
          ],
        })
      )
    );
    const dispatch = vi.fn();
    renderWithProviders(
      <NewImportModal open state={seed()} dispatch={dispatch} onCancel={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByLabelText('Client')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: '2' } });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_CLIENT', client: expect.objectContaining({ id: 2 }) })
    );
  });
});
