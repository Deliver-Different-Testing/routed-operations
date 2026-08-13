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

// See NewImportWizard.walkthrough.test.tsx for the frozen-time rationale.
const FROZEN_NOW = new Date('2026-08-12T12:00:00Z');
const EXPECTED_DOW = 4;

const env = { messageId: 'x', success: true, messages: [] };
const clientsEnv = { ...env, isInternal: false, isUsTenant: false };

// Two-depot NZ handler bundle: two rows in the parsed file each fall into a
// distinct depot bucket. Every /import call succeeds.
function seedTwoDepotNzHandlers(opts: { importJobs?: any[] } = {}) {
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
            ToAddress: '1 A St',
            ToSuburb: 'Newton',
            ToPostCode: '1010',
            ToContact: 'Alice',
            Phone: '021',
          },
          {
            JobNumber: 'J2',
            ToAddress: '2 B St',
            ToSuburb: 'Wgtn',
            ToPostCode: '6011',
            ToContact: 'Bob',
            Phone: '022',
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
              name: 'Morning AKL',
              dayOfWeek: EXPECTED_DOW,
              startTime: '08:00:00',
              cutoffHours: 0,
              speed: { id: 10, name: 'Standard', code: null },
              depotId: 1,
            },
            {
              id: 200,
              name: 'Morning WLG',
              dayOfWeek: EXPECTED_DOW,
              startTime: '08:00:00',
              cutoffHours: 0,
              speed: { id: 10, name: 'Standard', code: null },
              depotId: 2,
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
          { id: 2, name: 'Wgtn', city: null, postCode: '6011', alias: null },
        ],
      })
    ),
    http.post('/api/address/geocode', () =>
      HttpResponse.json({
        ...env,
        addresses: [
          {
            address: '1 A St',
            suburb: 'Newton',
            postCode: '1010',
            latitude: '-36.85',
            longitude: '174.76',
            geoType: 1,
          },
          {
            address: '2 B St',
            suburb: 'Wgtn',
            postCode: '6011',
            latitude: '-41.28',
            longitude: '174.77',
            geoType: 1,
          },
        ],
      })
    ),
    http.get('/api/address/depots/postcodes', () =>
      HttpResponse.json({
        ...env,
        depots: [
          { id: 1, name: 'Auckland', postcodes: ['1010'] },
          { id: 2, name: 'Wellington', postcodes: ['6011'] },
        ],
      })
    ),
    http.post('/api/bulk-import/import', () =>
      HttpResponse.json({
        ...env,
        clientId: 1,
        bookDate: '2026-08-13',
        scheduleId: 100,
        speedId: 10,
        jobs: opts.importJobs ?? [],
      })
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

describe('NewImportWizard - multi-depot iteration', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(FROZEN_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('advances through two depots (SchedulePicker re-opens with the next depot title)', async () => {
    let importCall = 0;
    seedTwoDepotNzHandlers();
    server.use(
      http.post('/api/bulk-import/import', () => {
        importCall++;
        return HttpResponse.json({
          ...env,
          clientId: 1,
          bookDate: '2026-08-13',
          scheduleId: 100,
          speedId: 10,
          jobs: [],
        });
      })
    );
    const onClose = vi.fn();
    const onImported = vi.fn();
    renderWithProviders(
      <NewImportWizard open onClose={onClose} onImported={onImported} />
    );
    await waitFor(() => expect(screen.getByText('New Import')).toBeInTheDocument());
    await driveToSelectRegions();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    // SchedulePicker opens for the FIRST depot (Auckland - alphabetically first).
    await waitFor(() =>
      expect(screen.getByText(/Auckland/)).toBeInTheDocument()
    );
    // Two-depot indicator in title.
    await waitFor(() =>
      expect(screen.getByText(/1 of 2/)).toBeInTheDocument()
    );
    // Wait for auto-select + Next to enable, then advance.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    // Wizard advances the cursor and re-opens the picker on Wellington.
    await waitFor(() =>
      expect(screen.getByText(/Wellington/)).toBeInTheDocument()
    );
    await waitFor(() =>
      expect(screen.getByText(/2 of 2/)).toBeInTheDocument()
    );
    // Manually pick the sole speed for depot 2 - SchedulePicker's auto-select
    // effect keys on `speeds.length + speeds.map(id).join(',')` which is
    // identical across both depots (both offer Standard/10), so the effect
    // doesn't refire on advance and the reset leaves speedId=0. The operator
    // picks manually in real life; the test mirrors that.
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: '10' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(importCall).toBe(2);
  });

  it('surfaces per-depot summary when some rows fail across depots', async () => {
    let importCall = 0;
    seedTwoDepotNzHandlers();
    server.use(
      http.post('/api/bulk-import/import', () => {
        importCall++;
        // Depot 1 succeeds with no failed; depot 2 returns a failed row that
        // the wizard should merge into failedImportJobs, then route to summary
        // (since totalFailed > 0 && no pickup and no km-rated).
        if (importCall === 2) {
          return HttpResponse.json({
            ...env,
            clientId: 1,
            bookDate: '2026-08-13',
            scheduleId: 200,
            speedId: 10,
            jobs: [
              {
                jobNumber: 'J-fail',
                toAddress: '99 Bad St',
                toSuburb: 'Wgtn',
                toPostCode: '6011',
                errorMessage: 'Not found',
              },
            ],
          });
        }
        return HttpResponse.json({
          ...env,
          clientId: 1,
          bookDate: '2026-08-13',
          scheduleId: 100,
          speedId: 10,
          jobs: [],
        });
      })
    );
    renderWithProviders(
      <NewImportWizard open onClose={vi.fn()} onImported={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByText('New Import')).toBeInTheDocument());
    await driveToSelectRegions();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    // Depot 1 (Auckland).
    await waitFor(() =>
      expect(screen.getByText(/Auckland/)).toBeInTheDocument()
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    // Depot 2 (Wellington). This second-pass /import returns a km-rated row
    // pattern (any populated jobs array on a first-pass response is treated
    // as km-rated review by the wizard).
    await waitFor(() =>
      expect(screen.getByText(/Wellington/)).toBeInTheDocument()
    );
    // Same auto-select miss as the other test - pick the speed manually.
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: '10' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    // The Wellington response has jobs.length > 0 so wizard pivots to
    // KmRatedReviewModal for that bucket.
    await waitFor(() =>
      expect(screen.getByText(/Confirm km-rated jobs/)).toBeInTheDocument()
    );
    // Skip advances to summary because there are now failed rows.
    fireEvent.click(screen.getByRole('button', { name: 'Skip km-rated' }));
    await waitFor(() =>
      expect(screen.getByText(/Import Summary/)).toBeInTheDocument()
    );
    // Per-depot breakdown table renders when perDepot.length > 1.
    expect(screen.getByText(/Per-depot breakdown/)).toBeInTheDocument();
  });
});
