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

const env = { messageId: 'x', success: true, messages: [] };
const clientsEnv = { ...env, isInternal: false, isUsTenant: false };

function seedNzHandlersForImportError(importFailure: () => Response) {
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
    http.post('/api/bulk-import/import', () => importFailure())
  );
}

async function driveToSchedulePicker() {
  // Every waitFor in this helper uses an explicit 3s timeout. Default is
  // 1s, which is too tight on the shared CI runner when fake timers are
  // active (see the vi.useFakeTimers on the describe block); step
  // transitions here span an MSW mock + a StepWizard re-render and
  // routinely take 1.5-2.5s to settle on CI, well under 3s locally.
  const TIMEOUT = { timeout: 3000 };
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(fileInput, 'files', {
    value: [new File(['x'], 'x.csv', { type: 'text/csv' })],
  });
  fireEvent.change(fileInput);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Upload File' })).not.toBeDisabled(),
    TIMEOUT,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Upload File' }));
  await waitFor(() => expect(screen.getByText('Map the Columns')).toBeInTheDocument(), TIMEOUT);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(screen.getByText('Fix Suburbs')).toBeInTheDocument(), TIMEOUT);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(screen.getByText('Fix Addresses')).toBeInTheDocument(), TIMEOUT);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(screen.getByText('Select Depots')).toBeInTheDocument(), TIMEOUT);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled(),
    TIMEOUT,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(screen.getByText(/Central/)).toBeInTheDocument(), TIMEOUT);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled(),
    TIMEOUT,
  );
}

describe('NewImportWizard - error paths', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(FROZEN_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows an error toast when /import returns success=false', async () => {
    seedNzHandlersForImportError(() =>
      HttpResponse.json({
        messageId: 'x',
        success: false,
        messages: [{ message: 'DB timeout', code: null }],
        clientId: 1,
        bookDate: '2026-08-13',
        scheduleId: 100,
        speedId: 10,
        jobs: [],
      }) as any
    );
    renderWithProviders(
      <NewImportWizard open onClose={vi.fn()} onImported={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByText('New Import')).toBeInTheDocument());
    await driveToSchedulePicker();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    // Toast surfaces the server-side failure message; wizard stays on the picker.
    await waitFor(() =>
      expect(screen.getByText(/Import failed: DB timeout/)).toBeInTheDocument()
    );
    // Still on the SchedulePickerModal (not advanced).
    expect(screen.getByText(/Central/)).toBeInTheDocument();
  });

  it('surfaces "unknown error" when server sends success=false without a message', async () => {
    seedNzHandlersForImportError(() =>
      HttpResponse.json({
        messageId: 'x',
        success: false,
        messages: [],
        clientId: 1,
        bookDate: '2026-08-13',
        scheduleId: 100,
        speedId: 10,
        jobs: [],
      }) as any
    );
    renderWithProviders(
      <NewImportWizard open onClose={vi.fn()} onImported={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByText('New Import')).toBeInTheDocument());
    await driveToSchedulePicker();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(screen.getByText(/Import failed: unknown error/)).toBeInTheDocument()
    );
  });

  it('surfaces the thrown Error when /import 500s', async () => {
    seedNzHandlersForImportError(
      () => HttpResponse.json({ message: 'boom' }, { status: 500 }) as any
    );
    renderWithProviders(
      <NewImportWizard open onClose={vi.fn()} onImported={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByText('New Import')).toBeInTheDocument());
    await driveToSchedulePicker();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(screen.getByText(/Import failed:/)).toBeInTheDocument()
    );
  });

  it('shows toast when upload fails and stays on the New Import modal', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({
          ...clientsEnv,
          clients: [{ id: 1, code: 'A', name: 'Alpha', isUsTenant: false }],
        })
      ),
      http.post('/api/bulk-import/upload', () =>
        HttpResponse.json({ message: 'File too large' }, { status: 400 })
      )
    );
    renderWithProviders(
      <NewImportWizard open onClose={vi.fn()} onImported={vi.fn()} />
    );
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
    await waitFor(() =>
      expect(screen.getByText(/Upload failed/)).toBeInTheDocument()
    );
    // Still on step 1 - MapColumnsModal hasn't opened.
    expect(screen.queryByText('Map the Columns')).not.toBeInTheDocument();
  });
});
