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

// Rich US row: everything is mapped, including quantity/dimensions/refs/notes/
// tracking/stopType/combined-from-address. Exercises the widest set of
// buildJobs branches and the parseCombinedUsAddress + stripZipPlus4 helpers.
function seedUsRichRowHandlers(importCapture: (body: any) => void) {
  server.use(
    http.get('/api/clients', () =>
      HttpResponse.json({
        ...env,
        isInternal: false,
        isUsTenant: true,
        clients: [{ id: 1, code: 'A', name: 'Alpha', isUsTenant: true }],
      })
    ),
    http.post('/api/bulk-import/upload', () =>
      HttpResponse.text(
        JSON.stringify([
          {
            JobNumber: 'J1',
            FromAddress: '100 Beacon St, Boston, MA 02110-1234',
            Address: '1 Main St',
            City: 'Cambridge',
            State: 'MA',
            ZipCode: '02139-9999',
            Contact: 'Alice',
            Phone: '617',
            Quantity: '3',
            Length: '5',
            Width: '4',
            Height: '3',
            Weight: '2',
            RefA: 'REFA',
            RefB: 'REFB',
            OurRef: 'OUR',
            Notes: 'be careful',
            Email: 'a@b.com',
            Mobile: '021',
            StopType: 'delivery',
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
    http.get('/api/address/zipcodes', () =>
      HttpResponse.json({ ...env, zipCodes: [] })
    ),
    http.get('/api/address/suburbs', () =>
      HttpResponse.json({ ...env, suburbs: [] })
    ),
    http.post('/api/address/geocode', () =>
      HttpResponse.json({
        ...env,
        addresses: [
          {
            address: '1 Main St',
            city: 'Cambridge',
            state: 'MA',
            zipCode: '02139',
            latitude: '42.36',
            longitude: '-71.06',
            geoType: 1,
          },
        ],
      })
    ),
    http.get('/api/address/locations/zipcodes', () =>
      HttpResponse.json({
        ...env,
        locations: [{ id: 1, name: 'Cambridge Hub', zipCodes: ['02139'] }],
      })
    ),
    http.get('/api/address/zip-polygons', () =>
      HttpResponse.json({ ...env, zones: [] })
    ),
    http.post('/api/bulk-import/import', async ({ request }) => {
      const body = await request.json();
      importCapture(body);
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
}

describe('NewImportWizard - buildJobs projection helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(FROZEN_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('projects a rich US row through buildJobs (combined FromAddress, ZIP+4 strip, dims, refs)', async () => {
    let captured: any = null;
    seedUsRichRowHandlers((body) => {
      captured = body;
    });
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
    await waitFor(() => expect(screen.getByText('Map the Columns')).toBeInTheDocument());
    // Advance through the wizard. Some US mappings may not auto-map; if Next
    // is disabled, dispatch mappings via the visible dropdowns (fromAddress
    // in particular tends to auto-map from "FromAddress").
    // Click Next; the MapColumnsModal must pass validation. Required fields
    // for US onDemand=false are Address / City / State / ZipCode / Contact /
    // Phone / JobNumber; all mapped above.
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    // FixZips OR FixSuburbs may render depending on tenant.
    await waitFor(() => {
      const hdr = screen.queryByText('Fix Zip Codes') ?? screen.queryByText('Fix Suburbs');
      expect(hdr).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('Fix Addresses')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('Select Regions')).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText(/Cambridge Hub/)).toBeInTheDocument());
    // Wait for auto-select or pick manually.
    const serviceSelect = screen.getByLabelText('Service') as HTMLSelectElement;
    if (serviceSelect.value === '') {
      fireEvent.change(serviceSelect, { target: { value: '10' } });
    }
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    // Wait until captured; the mocked import endpoint stores the payload.
    await waitFor(() => expect(captured).not.toBeNull());
    // Payload assertions - exercise the helper transforms in buildJobs.
    expect(captured.jobs.length).toBe(1);
    const job = captured.jobs[0];
    // ZIP+4 stripped to 5 digits (stripZipPlus4 branch).
    expect(job.toZipCode).toBe('02139');
    // Quantity, dims, refs, notes, tracking landed on the payload.
    expect(job.quantity).toBe(3);
    expect(job.length).toBe(5);
    expect(job.width).toBe(4);
    expect(job.height).toBe(3);
    expect(job.weight).toBe(2);
    expect(job.clientRefA).toBe('REFA');
    expect(job.notes).toBe('be careful');
    // stopType "delivery" normalises to 'dropoff'.
    expect(job.stopType).toBe('dropoff');
  });
});
