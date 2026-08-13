import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderWithProviders } from '../../test/renderWithProviders';
import { NewImportWizard } from './NewImportWizard';

// The FixAddresses modal renders a Google Map when a row is flagged; mock
// out the maps library so it never tries to load the CDN in jsdom.
vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: any) => children,
  Map: ({ children }: any) => children ?? null,
  AdvancedMarker: () => null,
  useMap: () => ({ setCenter: vi.fn(), setZoom: vi.fn() }),
  useMapsLibrary: () => ({}),
}));

// -----------------------------------------------------------------------------
// Freeze system time so the wizard's dayOfWeek computation is deterministic.
// SchedulePickerModal derives dayOfWeek from state.bookDate (default = tomorrow)
// via `new Date(y, m-1, d).getDay()`. Freezing at Wed 2026-08-12 12:00 UTC
// makes tomorrow = 2026-08-13 (Thursday, JS dayOfWeek=4), which matches the
// schedule seed below. See the CLAUDE.md tests notes on this pattern.
// -----------------------------------------------------------------------------
const FROZEN_NOW = new Date('2026-08-12T12:00:00Z');
const EXPECTED_DOW = 4; // Thursday
const EXPECTED_BOOKDATE = '2026-08-13';

const env = { messageId: 'x', success: true, messages: [] };
const clientsEnv = { ...env, isInternal: false, isUsTenant: false };

function baseClientSettings(overrides: Record<string, any> = {}) {
  return {
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
      ...overrides,
    },
  };
}

function seedNzHandlers(options: {
  importResponse?: any;
  clientSettings?: Record<string, any>;
} = {}) {
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
      HttpResponse.json(baseClientSettings(options.clientSettings))
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
    http.post('/api/bulk-import/import', () =>
      HttpResponse.json(
        options.importResponse ?? {
          ...env,
          clientId: 1,
          bookDate: EXPECTED_BOOKDATE,
          scheduleId: 100,
          speedId: 10,
          jobs: [],
        }
      )
    ),
    http.post('/api/bulk-import/pickup-rate', () =>
      HttpResponse.json({ ...env, amount: 12 })
    ),
    http.post('/api/bulk-import/book-pickup', () =>
      HttpResponse.json({ ...env, jobId: [500] })
    )
  );
}

async function driveToSelectRegions() {
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
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(screen.getByText('Fix Suburbs')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(screen.getByText('Fix Addresses')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(screen.getByText('Select Depots')).toBeInTheDocument());
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled()
  );
}

describe('NewImportWizard - full walkthrough', () => {
  beforeEach(() => {
    // shouldAdvanceTime lets React's internal timers still tick so state
    // updates settle even with fake timers on.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(FROZEN_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('walks upload -> map -> zips -> addresses -> regions -> schedule -> import -> close', async () => {
    seedNzHandlers();
    const onClose = vi.fn();
    const onImported = vi.fn();
    renderWithProviders(
      <NewImportWizard open onClose={onClose} onImported={onImported} />
    );
    await waitFor(() => expect(screen.getByText('New Import')).toBeInTheDocument());
    await driveToSelectRegions();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    // SchedulePickerModal title contains the depot name.
    await waitFor(() => expect(screen.getByText(/Central/)).toBeInTheDocument());
    // The auto-select effect ticks speed + schedule once schedules resolve.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    // No km-rated rows in the response, so the wizard advances through
    // advanceOrFinish, fires the imported toast, and calls handleClose.
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('routes through KmRatedReviewModal when the /import response returns km-rated rows', async () => {
    // First-pass /import returns rows -> wizard flips to kmRatedReview.
    // Second-pass /import returns empty -> advance + close.
    let importCall = 0;
    seedNzHandlers();
    server.use(
      http.post('/api/bulk-import/import', async () => {
        importCall++;
        if (importCall === 1) {
          return HttpResponse.json({
            ...env,
            clientId: 1,
            bookDate: EXPECTED_BOOKDATE,
            scheduleId: 100,
            speedId: 10,
            jobs: [
              {
                jobNumber: 'J1',
                toAddress: '1 Main St',
                toSuburb: 'Newton',
                toPostCode: '1010',
                amount: 15,
              },
            ],
          });
        }
        return HttpResponse.json({
          ...env,
          clientId: 1,
          bookDate: EXPECTED_BOOKDATE,
          scheduleId: 100,
          speedId: 10,
          jobs: [],
        });
      })
    );
    const onClose = vi.fn();
    renderWithProviders(
      <NewImportWizard open onClose={onClose} onImported={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByText('New Import')).toBeInTheDocument());
    await driveToSelectRegions();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText(/Central/)).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    // Km-rated review appears.
    await waitFor(() =>
      expect(screen.getByText(/Confirm km-rated jobs/)).toBeInTheDocument()
    );
    // Upload the selected (all pre-ticked). Second-pass import fires + wizard closes.
    fireEvent.click(screen.getByRole('button', { name: /Upload selected/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(importCall).toBe(2);
  });

  it('Skip km-rated stashes the rows into failedImportJobs and advances to summary', async () => {
    seedNzHandlers({
      importResponse: {
        ...env,
        clientId: 1,
        bookDate: EXPECTED_BOOKDATE,
        scheduleId: 100,
        speedId: 10,
        jobs: [
          {
            jobNumber: 'J1',
            toAddress: '1 Main St',
            toSuburb: 'Newton',
            toPostCode: '1010',
            amount: 15,
          },
        ],
      },
    });
    renderWithProviders(
      <NewImportWizard open onClose={vi.fn()} onImported={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByText('New Import')).toBeInTheDocument());
    await driveToSelectRegions();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText(/Central/)).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(screen.getByText(/Confirm km-rated jobs/)).toBeInTheDocument()
    );
    // Skip - onKmRatedSkip fires, stashes the km-rated rows into
    // failedImportJobs, then advanceOrFinish routes to summary.
    fireEvent.click(screen.getByRole('button', { name: 'Skip km-rated' }));
    await waitFor(() =>
      expect(screen.getByText(/Import Summary/)).toBeInTheDocument()
    );
    // Summary shows the failed row.
    expect(screen.getByText('J1')).toBeInTheDocument();
  });

  it('advances to BookPickupModal when the import response returns a pickup payload', async () => {
    seedNzHandlers({
      clientSettings: { createBulkHomeDeliveryPickup: true },
      importResponse: {
        ...env,
        clientId: 1,
        bookDate: EXPECTED_BOOKDATE,
        scheduleId: 100,
        speedId: 10,
        jobs: [],
        pickupJob: {
          vehicleSizes: [{ label: 'Van', value: 'VAN' }],
          numberOfVehicles: [{ label: '1', value: '1' }],
          pickupJob: {
            clientID: 1,
            time: '2026-08-13T10:00',
            weight: '10',
            quantity: 1,
            toPostCode: 1010,
          },
        },
      },
    });
    renderWithProviders(
      <NewImportWizard open onClose={vi.fn()} onImported={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByText('New Import')).toBeInTheDocument());
    await driveToSelectRegions();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText(/Central/)).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(screen.getByText(/Book Pickup/)).toBeInTheDocument()
    );
  });
});
