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

function usClientsEnv() {
  return { ...env, isInternal: false, isUsTenant: true };
}

// US tenant handlers: /import always succeeds, unless caller passes an
// override. The seeded parsed file has one row whose zip is only covered by
// the polygon set (not any real location), so it lands in the -1
// coverage-only bucket which triggers the RateByDistanceModal detour.
function seedUsCoverageOnlyHandlers(opts: { importResponse?: any } = {}) {
  server.use(
    http.get('/api/clients', () =>
      HttpResponse.json({
        ...usClientsEnv(),
        clients: [{ id: 1, code: 'A', name: 'Alpha', isUsTenant: true }],
      })
    ),
    http.post('/api/bulk-import/upload', () =>
      HttpResponse.text(
        JSON.stringify([
          {
            JobNumber: 'J1',
            Address: '1 Main St',
            City: 'Boston',
            State: 'MA',
            ZipCode: '02110',
            Contact: 'Alice',
            Phone: '617',
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
          isUsTenant: true,
          contacts: [],
          speeds: [{ id: 10, name: 'Standard', code: null }],
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
      HttpResponse.json({ ...env, suburbs: [] })
    ),
    http.get('/api/address/zipcodes', () =>
      HttpResponse.json({ ...env, zipCodes: [] })
    ),
    http.post('/api/address/geocode', () =>
      HttpResponse.json({
        ...env,
        addresses: [
          {
            address: '1 Main St',
            city: 'Boston',
            state: 'MA',
            zipCode: '02110',
            latitude: '42.36',
            longitude: '-71.06',
            geoType: 1,
          },
        ],
      })
    ),
    // Coverage-only bucket needs a polygon zone containing 02110 but no
    // assigned location for that zip.
    http.get('/api/address/locations/zipcodes', () =>
      HttpResponse.json({ ...env, locations: [] })
    ),
    http.get('/api/address/zip-polygons', () =>
      HttpResponse.json({
        ...env,
        zones: [{ id: 1, name: 'Boston zone', zips: ['02110'] }],
      })
    ),
    http.post('/api/bulk-import/import', () =>
      HttpResponse.json(
        opts.importResponse ?? {
          ...env,
          clientId: 1,
          bookDate: EXPECTED_BOOKDATE,
          scheduleId: null,
          speedId: 10,
          jobs: [],
        }
      )
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
  // US flow: Fix Zips + Fix Addresses may or may not appear depending on
  // mapping / geocode results. Walk forward past whichever renders.
  await waitFor(() => {
    const heading = screen.queryByText('Fix Zip Codes') ?? screen.queryByText('Fix Suburbs');
    expect(heading).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(screen.getByText('Fix Addresses')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(screen.getByText('Select Regions')).toBeInTheDocument());
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled()
  );
}

describe('NewImportWizard - US coverage-only + rateByDistance branch', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(FROZEN_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('advances through RateByDistanceModal when the current bucket is US coverage-only', async () => {
    seedUsCoverageOnlyHandlers();
    renderWithProviders(
      <NewImportWizard open onClose={vi.fn()} onImported={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByText('New Import')).toBeInTheDocument());
    await driveToSelectRegions();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    // SchedulePicker opens for the coverage-only bucket.
    await waitFor(() =>
      expect(screen.getByText(/Valid ZIP - Rate By Distance/)).toBeInTheDocument()
    );
    // Coverage-only: no schedule row, operator picks speed + time manually.
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Book Time'), { target: { value: '09:00' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    // afterSchedulePicker routes coverage-only through RateByDistanceModal.
    await waitFor(() =>
      expect(screen.getByText(/Rate by Distance/)).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    // afterRateByDistance fires the import; response has jobs=[] so wizard closes.
    await waitFor(() =>
      expect(screen.queryByText(/Rate by Distance/)).not.toBeInTheDocument()
    );
  });
});

// -----------------------------------------------------------------------------
// NZ-side edge cases: template save + km-rated with deselected rows + pickup
// with prior failed jobs.
// -----------------------------------------------------------------------------

function seedNzHandlers(opts: {
  importResponse?: any;
  templateResponse?: any;
  createBulkHomeDeliveryPickup?: boolean;
} = {}) {
  server.use(
    http.get('/api/clients', () =>
      HttpResponse.json({
        ...env,
        isInternal: false,
        isUsTenant: false,
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
          createBulkHomeDeliveryPickup: opts.createBulkHomeDeliveryPickup ?? false,
        },
      })
    ),
    http.get('/api/templates', () => HttpResponse.json({ ...env, templates: [] })),
    http.post('/api/templates', () =>
      HttpResponse.json(
        opts.templateResponse ?? { ...env, template: { id: 99, name: 'saved' } }
      )
    ),
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
        opts.importResponse ?? {
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

async function driveNzToSelectRegions() {
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

describe('NewImportWizard - km-rated upload with deselected rows', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(FROZEN_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('onKmRatedUpload merges deselected rows into failedImportJobs before the second /import call', async () => {
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
                jobNumber: 'J1-a',
                toAddress: '1 A St',
                toSuburb: 'Newton',
                toPostCode: '1010',
                amount: 10,
              },
              {
                jobNumber: 'J1-b',
                toAddress: '1 B St',
                toSuburb: 'Newton',
                toPostCode: '1010',
                amount: 20,
              },
            ],
          });
        }
        // Second-pass returns a failed row too so the fireImport merge path
        // also fires; this guarantees advanceOrFinish sees a fresh failed count
        // from perDepotResults regardless of state.failedImportJobs staleness.
        return HttpResponse.json({
          ...env,
          clientId: 1,
          bookDate: EXPECTED_BOOKDATE,
          scheduleId: 100,
          speedId: 10,
          jobs: [
            {
              jobNumber: 'J1-b-rejected',
              toAddress: '1 B St',
              toSuburb: 'Newton',
              toPostCode: '1010',
              errorMessage: 'rejected',
            },
          ],
        });
      })
    );
    renderWithProviders(
      <NewImportWizard open onClose={vi.fn()} onImported={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByText('New Import')).toBeInTheDocument());
    await driveNzToSelectRegions();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText(/Central/)).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(screen.getByText(/Confirm km-rated jobs/)).toBeInTheDocument()
    );
    // Untick the first row so onKmRatedUpload receives one deselected row.
    const rowCheckboxes = screen.getAllByRole('checkbox');
    // 0 = header toggle-all, 1 = row 1, 2 = row 2
    fireEvent.click(rowCheckboxes[1]);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Upload selected \(1\)/ })
      ).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: /Upload selected/ }));
    // Second-pass /import fires + summary shows since failed rows landed
    // in failedImportJobs (via both onKmRatedUpload merge and fireImport merge).
    await waitFor(() => expect(importCall).toBe(2));
    await waitFor(() =>
      expect(screen.getByText(/Import Summary/)).toBeInTheDocument()
    );
    // Both the deselected row (J1-a) AND the second-pass rejected row
    // (J1-b-rejected) end up in the failed list.
    expect(screen.getByText('J1-a')).toBeInTheDocument();
    expect(screen.getByText('J1-b-rejected')).toBeInTheDocument();
  });
});

describe('NewImportWizard - BookPickupModal.onBooked branches', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(FROZEN_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('advances to Summary after pickup booked when there are failed jobs pending', async () => {
    let importCall = 0;
    seedNzHandlers({
      createBulkHomeDeliveryPickup: true,
    });
    server.use(
      http.post('/api/bulk-import/import', () => {
        importCall++;
        return HttpResponse.json({
          ...env,
          clientId: 1,
          bookDate: EXPECTED_BOOKDATE,
          scheduleId: 100,
          speedId: 10,
          // First-pass returns a km-rated row so we can then Skip and
          // populate failedImportJobs before reaching pickup.
          jobs:
            importCall === 1
              ? [
                  {
                    jobNumber: 'J-fail',
                    toAddress: '9 Bad',
                    toSuburb: 'Newton',
                    toPostCode: '1010',
                    amount: 5,
                  },
                ]
              : [],
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
        });
      })
    );
    renderWithProviders(
      <NewImportWizard open onClose={vi.fn()} onImported={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByText('New Import')).toBeInTheDocument());
    await driveNzToSelectRegions();
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
    // Skip km-rated -> failedImportJobs gets the row, advanceOrFinish sees
    // pickup on state, opens BookPickupModal (the pickup gate wins over the
    // failed-jobs gate on the FIRST advance).
    fireEvent.click(screen.getByRole('button', { name: 'Skip km-rated' }));
    await waitFor(() =>
      expect(screen.getByText(/Book Pickup/)).toBeInTheDocument()
    );
    // Click Book pickup - onBooked fires; because failedImportJobs.length > 0
    // the wizard advances to summary instead of closing.
    fireEvent.click(screen.getByRole('button', { name: /Book pickup/ }));
    await waitFor(() => expect(screen.getByText('Finish')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() =>
      expect(screen.getByText(/Import Summary/)).toBeInTheDocument()
    );
  });
});
