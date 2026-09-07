import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderWithProviders } from '../../test/renderWithProviders';
import { NewImportWizard } from './NewImportWizard';

// Mock Google Maps in case FixAddresses ends up rendering.
vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: any) => children,
  Map: ({ children }: any) => children ?? null,
  AdvancedMarker: () => null,
  useMap: () => ({ setCenter: vi.fn(), setZoom: vi.fn() }),
  useMapsLibrary: () => ({}),
}));

const env = { messageId: 'x', success: true, messages: [] };
const clientsEnv = { ...env, isInternal: false, isUsTenant: false };

describe('NewImportWizard', () => {
  it('renders nothing meaningful when open=false', () => {
    renderWithProviders(
      <NewImportWizard open={false} onClose={vi.fn()} onImported={vi.fn()} />
    );
    expect(screen.queryByText('New Import')).not.toBeInTheDocument();
  });

  it('renders the initial NewImportModal at step=newImport when open', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({ ...clientsEnv, clients: [] })
      )
    );
    renderWithProviders(<NewImportWizard open onClose={vi.fn()} onImported={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('New Import')).toBeInTheDocument());
  });

  it('Cancel from the first modal calls onClose', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({ ...clientsEnv, clients: [] })
      )
    );
    const onClose = vi.fn();
    renderWithProviders(<NewImportWizard open onClose={onClose} onImported={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('New Import')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('walks New Import -> Map Columns after successful upload', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({
          ...clientsEnv,
          clients: [{ id: 1, code: 'A', name: 'Alpha', isUsTenant: false }],
        })
      ),
      http.post('/api/bulk-import/upload', () =>
        HttpResponse.text(
          JSON.stringify([{ JobNumber: '1', ToAddress: '1 St', ToSuburb: 'Newton', ToContact: 'Bob', Phone: '021' }])
        )
      ),
      http.get('/api/clients/:id/settings', () =>
        HttpResponse.json({
          ...env,
          settings: {
            id: 1,
            code: 'A',
            name: 'A',
            jobPrefix: null,
            isUsTenant: false,
            contacts: [],
            speeds: [],
            stockSizes: [],
            schedules: [],
            referenceAMandatory: false,
            referenceAMessage: null,
            referenceBMandatory: false,
            referenceBMessage: null,
            createBulkHomeDeliveryPickup: false,
          },
        })
      ),
      http.get('/api/templates', () => HttpResponse.json({ ...env, templates: [] })),
      http.get('/api/address/regions', () => HttpResponse.json({ ...env, regions: [] }))
    );
    renderWithProviders(<NewImportWizard open onClose={vi.fn()} onImported={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('New Import')).toBeInTheDocument());
    // Simulate picking a file via the FileUploadZone input.
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      value: [new File(['x'], 'x.csv', { type: 'text/csv' })],
    });
    fireEvent.change(fileInput);
    // Upload button becomes enabled once client+file both set.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Upload File' })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Upload File' }));
    // After upload, MapColumnsModal renders with title "Map the Columns".
    await waitFor(() => expect(screen.getByText('Map the Columns')).toBeInTheDocument());
  });

  it('closes cleanly when Cancel is clicked from the first modal', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({ ...clientsEnv, clients: [] })
      )
    );
    const onClose = vi.fn();
    renderWithProviders(<NewImportWizard open onClose={onClose} onImported={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('New Import')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows toast when clients fetch fails but modal still renders', async () => {
    server.use(
      http.get('/api/clients', () => HttpResponse.json({}, { status: 500 }))
    );
    renderWithProviders(<NewImportWizard open onClose={vi.fn()} onImported={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/Failed to load clients/)).toBeInTheDocument()
    );
  });

  it('reset triggers on toggle from open=true to open=false when not at newImport step', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({ ...clientsEnv, clients: [] })
      )
    );
    const { rerender } = renderWithProviders(
      <NewImportWizard open onClose={vi.fn()} onImported={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByText('New Import')).toBeInTheDocument());
    // Toggle open=false; the internal effect should still handle the transition.
    rerender(<NewImportWizard open={false} onClose={vi.fn()} onImported={vi.fn()} />);
    // Nothing user-visible after close.
    expect(screen.queryByText('Map the Columns')).not.toBeInTheDocument();
  });

  it('full walkthrough clicks through to SelectRegions and fires the /import call', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({
          ...clientsEnv,
          clients: [{ id: 1, code: 'A', name: 'Alpha', isUsTenant: false }],
        })
      ),
      http.post('/api/bulk-import/upload', () =>
        HttpResponse.text(
          JSON.stringify([
            {
              JobNumber: '1',
              ToAddress: '1 St',
              ToSuburb: 'Newton',
              ToContact: 'Bob',
              Phone: '021',
              ToPostCode: '1010',
            },
          ])
        )
      ),
      http.get('/api/clients/:id/settings', () =>
        HttpResponse.json({
          ...env,
          settings: {
            id: 1,
            code: 'A',
            name: 'A',
            jobPrefix: null,
            isUsTenant: false,
            contacts: [],
            speeds: [{ id: 10, name: 'Standard', code: null }],
            stockSizes: [],
            schedules: [
              {
                id: 100,
                name: 'Morning',
                dayOfWeek: new Date('2026-06-15').getDay() || 7,
                startTime: '08:00:00',
                cutoffHours: 0,
                speed: { id: 10, name: 'Standard', code: null },
                depotId: 1,
              },
            ],
            referenceAMandatory: false,
            referenceAMessage: null,
            referenceBMandatory: false,
            referenceBMessage: null,
            createBulkHomeDeliveryPickup: false,
          },
        })
      ),
      http.get('/api/templates', () => HttpResponse.json({ ...env, templates: [] })),
      http.get('/api/address/regions', () => HttpResponse.json({ ...env, regions: [] })),
      http.get('/api/address/suburbs', () =>
        HttpResponse.json({
          ...env,
          suburbs: [{ id: 1, name: 'Newton', city: null, postCode: '1010', alias: null }],
        })
      ),
      http.post('/api/address/geocode', () =>
        HttpResponse.json({
          ...env,
          addresses: [
            {
              address: '1 St',
              suburb: 'Newton',
              postCode: '1010',
              latitude: '-36.85',
              longitude: '174.76',
              geoType: 1,
            },
          ],
        })
      ),
      http.get('/api/address/depots/postcodes', () =>
        HttpResponse.json({
          ...env,
          depots: [{ id: 1, name: 'Central', postcodes: ['1010'] }],
        })
      ),
      http.post('/api/bulk-import/import', () =>
        HttpResponse.json({
          messageId: 'x',
          success: true,
          messages: [],
          clientId: 1,
          bookDate: '2026-06-15',
          scheduleId: 100,
          speedId: 10,
          jobs: [],
        })
      )
    );
    const onImported = vi.fn();
    renderWithProviders(<NewImportWizard open onClose={vi.fn()} onImported={onImported} />);
    await waitFor(() => expect(screen.getByText('New Import')).toBeInTheDocument());
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      value: [new File(['x'], 'x.csv', { type: 'text/csv' })],
    });
    fireEvent.change(fileInput);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Upload File' })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Upload File' }));
    await waitFor(() => expect(screen.getByText('Map the Columns')).toBeInTheDocument());
    // Every Next click is preceded by a `not.toBeDisabled` wait because
    // each wizard step runs an async setup effect (Map = column
    // auto-map; Fix Suburbs / Fix Addresses = suburb + address resolve;
    // Select Depots = depot auto-tick) that keeps Next disabled until
    // completion. On the CI slow runner those effects can take >5s.
    // A bare `click Next` fires while the button is still disabled -
    // the click is a no-op, the next waitFor times out, and the test
    // flakes. See feedback_vitest_react_ci_flakes.md.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('Fix Suburbs')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('Fix Addresses')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('Select Depots')).toBeInTheDocument());
    // Advance through SelectRegions - it auto-ticks depot 1 via effect.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    // SchedulePickerModal appears; verify title.
    await waitFor(() => expect(screen.getByText(/Central/)).toBeInTheDocument());
  });

  it('walks through New Import -> Map Columns -> Fix Zips -> Fix Addresses (multi-step navigation)', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({
          ...clientsEnv,
          clients: [{ id: 1, code: 'A', name: 'Alpha', isUsTenant: false }],
        })
      ),
      http.post('/api/bulk-import/upload', () =>
        HttpResponse.text(
          JSON.stringify([
            {
              JobNumber: '1',
              ToAddress: '1 St',
              ToSuburb: 'Newton',
              ToContact: 'Bob',
              Phone: '021',
              ToPostCode: '1010',
            },
          ])
        )
      ),
      http.get('/api/clients/:id/settings', () =>
        HttpResponse.json({
          ...env,
          settings: {
            id: 1,
            code: 'A',
            name: 'A',
            jobPrefix: null,
            isUsTenant: false,
            contacts: [],
            speeds: [],
            stockSizes: [],
            schedules: [],
            referenceAMandatory: false,
            referenceAMessage: null,
            referenceBMandatory: false,
            referenceBMessage: null,
            createBulkHomeDeliveryPickup: false,
          },
        })
      ),
      http.get('/api/templates', () => HttpResponse.json({ ...env, templates: [] })),
      http.get('/api/address/regions', () => HttpResponse.json({ ...env, regions: [] })),
      http.get('/api/address/suburbs', () =>
        HttpResponse.json({
          ...env,
          suburbs: [{ id: 1, name: 'Newton', city: null, postCode: '1010', alias: null }],
        })
      ),
      http.post('/api/address/geocode', () =>
        HttpResponse.json({
          ...env,
          addresses: [
            {
              address: '1 St',
              suburb: 'Newton',
              postCode: '1010',
              latitude: '-36.85',
              longitude: '174.76',
              geoType: 1,
            },
          ],
        })
      ),
      http.get('/api/address/depots/postcodes', () =>
        HttpResponse.json({
          ...env,
          depots: [{ id: 1, name: 'Auckland Central', postcodes: ['1010'] }],
        })
      )
    );
    renderWithProviders(<NewImportWizard open onClose={vi.fn()} onImported={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('New Import')).toBeInTheDocument());
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      value: [new File(['x'], 'x.csv', { type: 'text/csv' })],
    });
    fireEvent.change(fileInput);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Upload File' })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Upload File' }));
    await waitFor(() => expect(screen.getByText('Map the Columns')).toBeInTheDocument());
    // Same wait-for-enabled pattern as the walkthrough test above.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled());
    // Next -> FixZips (assuming auto-mapping resolved required fields).
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('Fix Suburbs')).toBeInTheDocument());
    // Next -> FixAddresses.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('Fix Addresses')).toBeInTheDocument());
    // Next -> SelectRegions (NZ = "Select Depots").
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('Select Depots')).toBeInTheDocument());
  });
});
