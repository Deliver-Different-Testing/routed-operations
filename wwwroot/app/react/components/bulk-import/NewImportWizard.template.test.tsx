import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderWithProviders } from '../../test/renderWithProviders';
import { NewImportWizard } from './NewImportWizard';

vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: any) => children,
  Map: ({ children }: any) => children ?? null,
  AdvancedMarker: () => null,
  useMap: () => ({ setCenter: vi.fn(), setZoom: vi.fn() }),
  useMapsLibrary: () => ({}),
}));

const FROZEN_NOW = new Date('2026-08-12T12:00:00Z');
const EXPECTED_DOW = 4;
const EXPECTED_BOOKDATE = '2026-08-13';

const env = { messageId: 'x', success: true, messages: [] };
const clientsEnv = { ...env, isInternal: false, isUsTenant: false };

function seedNzHandlersWithTemplateEndpoint(templatePost: () => Response) {
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
            JobNumber: 'J1',
            ToAddress: '1 Main St',
            ToSuburb: 'Newton',
            ToPostCode: '1010',
            ToContact: 'Alice',
            Phone: '021',
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
              dayOfWeek: EXPECTED_DOW,
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
    http.post('/api/templates', () => templatePost()),
    http.get('/api/address/regions', () => HttpResponse.json({ ...env, regions: [] })),
    http.get('/api/address/suburbs', () =>
      HttpResponse.json({
        ...env,
        suburbs: [
          { id: 1, name: 'Newton', city: null, postCode: '1010', alias: null },
        ],
      })
    ),
    http.post('/api/address/geocode', () =>
      HttpResponse.json({
        ...env,
        addresses: [
          {
            address: '1 Main St',
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
        ...env,
        clientId: 1,
        bookDate: EXPECTED_BOOKDATE,
        scheduleId: 100,
        speedId: 10,
        jobs: [],
      })
    )
  );
}

async function driveToMapColumns() {
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
}

async function drivePastMapColumns() {
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(screen.getByText('Fix Suburbs')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(screen.getByText('Fix Addresses')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(screen.getByText('Select Depots')).toBeInTheDocument());
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(screen.getByText(/Central/)).toBeInTheDocument());
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
}

describe('NewImportWizard - saveTemplateIfRequested', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(FROZEN_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('POSTs to /api/templates when Save as template is ticked with a name and no templateId', async () => {
    let templateCalls = 0;
    seedNzHandlersWithTemplateEndpoint(() => {
      templateCalls++;
      return HttpResponse.json({ ...env, template: { id: 55, name: 'My tpl' } }) as any;
    });
    const onClose = vi.fn();
    renderWithProviders(
      <NewImportWizard open onClose={onClose} onImported={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByText('New Import')).toBeInTheDocument());
    await driveToMapColumns();
    // Tick Save as template + type a name. The MapColumnsModal Options panel
    // exposes both controls.
    const saveCheckbox = screen.getByLabelText(/Save as template/i);
    fireEvent.click(saveCheckbox);
    const nameInput = screen.getByLabelText(/Template name/i);
    fireEvent.change(nameInput, { target: { value: 'My tpl' } });
    await drivePastMapColumns();
    // saveTemplateIfRequested fires from advanceOrFinish which runs once the
    // per-depot loop completes.
    await waitFor(() => expect(templateCalls).toBeGreaterThan(0));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('toasts a warning when the template POST fails', async () => {
    seedNzHandlersWithTemplateEndpoint(
      () => HttpResponse.json({ message: 'template db down' }, { status: 500 }) as any
    );
    renderWithProviders(
      <NewImportWizard open onClose={vi.fn()} onImported={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByText('New Import')).toBeInTheDocument());
    await driveToMapColumns();
    const saveCheckbox = screen.getByLabelText(/Save as template/i);
    fireEvent.click(saveCheckbox);
    const nameInput = screen.getByLabelText(/Template name/i);
    fireEvent.change(nameInput, { target: { value: 'Bad tpl' } });
    await drivePastMapColumns();
    // Template save failure surfaces as a warning toast; wizard still closes.
    await waitFor(() =>
      expect(screen.getByText(/Template save failed/)).toBeInTheDocument()
    );
  });
});

describe('NewImportWizard - open=false mid-flight triggers reset', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(FROZEN_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resets wizard state when parent flips open=false while past step 1', async () => {
    seedNzHandlersWithTemplateEndpoint(() =>
      HttpResponse.json({ ...env, template: { id: 1, name: 'x' } }) as any
    );
    const { rerender } = renderWithProviders(
      <NewImportWizard open onClose={vi.fn()} onImported={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByText('New Import')).toBeInTheDocument());
    await driveToMapColumns();
    // Now we're on step=mapColumns; toggling open=false should trigger the
    // safety reset effect (line 91) since state.step !== 'newImport'.
    rerender(<NewImportWizard open={false} onClose={vi.fn()} onImported={vi.fn()} />);
    // Rerender with open=true should now show the fresh initial modal, not
    // MapColumns.
    rerender(<NewImportWizard open onClose={vi.fn()} onImported={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('New Import')).toBeInTheDocument());
    expect(screen.queryByText('Map the Columns')).not.toBeInTheDocument();
  });
});
