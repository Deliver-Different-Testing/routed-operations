import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderWithProviders } from '../../test/renderWithProviders';
import { StaffImportModal } from './StaffImportModal';

vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: any) => children,
  Map: ({ children }: any) => children ?? null,
  AdvancedMarker: () => null,
  useMap: () => ({ setCenter: vi.fn(), setZoom: vi.fn() }),
  useMapsLibrary: () => ({}),
}));

const env = { messageId: 'x', success: true, messages: [] };

describe('StaffImportModal - upload step', () => {
  it('renders nothing when open=false', () => {
    renderWithProviders(<StaffImportModal open={false} onClose={vi.fn()} onImported={vi.fn()} />);
    expect(screen.queryByText(/Staff Import/)).not.toBeInTheDocument();
  });

  it('renders header, upload banner, and disabled Parse button initially', () => {
    renderWithProviders(<StaffImportModal open onClose={vi.fn()} onImported={vi.fn()} />);
    expect(screen.getByText(/Staff Import Mode/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Parse File/ })).toBeDisabled();
  });

  it('Cancel button fires onClose from upload step', () => {
    const onClose = vi.fn();
    renderWithProviders(<StaffImportModal open onClose={onClose} onImported={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the "requires ClientID" error when upload lacks required column', async () => {
    server.use(
      http.post('/api/bulk-import/upload', () =>
        HttpResponse.text(JSON.stringify([{ Foo: 'bar' }]))
      )
    );
    renderWithProviders(<StaffImportModal open onClose={vi.fn()} onImported={vi.fn()} />);
    // Use FileUploadZone's hidden file input.
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      value: [new File(['x'], 'x.csv', { type: 'text/csv' })],
    });
    fireEvent.change(fileInput);
    await waitFor(() => expect(screen.getByRole('button', { name: /Parse File/ })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /Parse File/ }));
    await waitFor(() =>
      expect(screen.getByText(/requires ClientID or ClientCode column/i)).toBeInTheDocument()
    );
  });

  it('shows "requires ClientID" for empty-array upload (no headers to check)', async () => {
    // Empty rows also means no headers, which trips the ClientID check first.
    server.use(
      http.post('/api/bulk-import/upload', () =>
        HttpResponse.text(JSON.stringify([]))
      )
    );
    renderWithProviders(<StaffImportModal open onClose={vi.fn()} onImported={vi.fn()} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      value: [new File(['x'], 'x.csv', { type: 'text/csv' })],
    });
    fireEvent.change(fileInput);
    await waitFor(() => expect(screen.getByRole('button', { name: /Parse File/ })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /Parse File/ }));
    await waitFor(() =>
      expect(screen.getByText(/requires ClientID/)).toBeInTheDocument()
    );
  });

  it('surfaces "Parse failed" toast on upload failure', async () => {
    server.use(
      http.post('/api/bulk-import/upload', () =>
        HttpResponse.json({ message: 'kaboom' }, { status: 500 })
      )
    );
    renderWithProviders(<StaffImportModal open onClose={vi.fn()} onImported={vi.fn()} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      value: [new File(['x'], 'x.csv', { type: 'text/csv' })],
    });
    fireEvent.change(fileInput);
    await waitFor(() => expect(screen.getByRole('button', { name: /Parse File/ })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /Parse File/ }));
    await waitFor(() => expect(screen.getByText(/Parse failed/)).toBeInTheDocument());
  });
});

async function advanceToPreview() {
  server.use(
    http.post('/api/bulk-import/upload', () =>
      HttpResponse.text(
        JSON.stringify([
          {
            ClientID: '1',
            JobNumber: 'J1',
            FromSuburb: 'Newton',
            ToSuburb: 'Ponsonby',
            FromAddress: '1 Old St',
            ToAddress: '2 New St',
            DeliveryDate: '2026-06-15',
          },
        ])
      )
    )
  );
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(fileInput, 'files', {
    value: [new File(['x'], 'x.csv', { type: 'text/csv' })],
  });
  fireEvent.change(fileInput);
  await waitFor(() => expect(screen.getByRole('button', { name: /Parse File/ })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: /Parse File/ }));
  await waitFor(() => expect(screen.getByText(/Parsed 1 row/i)).toBeInTheDocument());
}

describe('StaffImportModal - preview + fix flow', () => {
  it('after parsing shows preview table and legacy-fields hint', async () => {
    renderWithProviders(<StaffImportModal open onClose={vi.fn()} onImported={vi.fn()} />);
    await advanceToPreview();
    expect(screen.getByText(/Parsed 1 row/i)).toBeInTheDocument();
    expect(screen.getByText(/Legacy field names detected/i)).toBeInTheDocument();
    // Header names visible in preview.
    expect(screen.getByRole('columnheader', { name: 'ClientID' })).toBeInTheDocument();
  });

  it('Preview -> Fix Suburbs advances the step wizard', async () => {
    server.use(
      http.get('/api/address/suburbs', () =>
        HttpResponse.json({ ...env, suburbs: [] })
      )
    );
    renderWithProviders(<StaffImportModal open onClose={vi.fn()} onImported={vi.fn()} />);
    await advanceToPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText(/Suburbs seems OK/)).toBeInTheDocument());
  });

  it('Fix Suburbs -> Fix Addresses -> Confirm walk through', async () => {
    server.use(
      http.get('/api/address/suburbs', () =>
        HttpResponse.json({ ...env, suburbs: [] })
      ),
      http.post('/api/address/geocode', () =>
        HttpResponse.json({
          ...env,
          addresses: [
            {
              address: '1 Old St',
              suburb: 'Newton',
              postCode: null,
              latitude: '-36.5',
              longitude: '174.7',
              geoType: 1,
            },
          ],
        })
      )
    );
    renderWithProviders(<StaffImportModal open onClose={vi.fn()} onImported={vi.fn()} />);
    await advanceToPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText(/Suburbs seems OK/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    // Fix Addresses step - either seems OK or lists flagged addresses.
    await waitFor(() =>
      expect(
        screen.queryByText(/Addresses seems OK/) || screen.queryByText(/flagged address/)
      ).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText(/Confirm Staff Import/)).toBeInTheDocument());
  });

  it('flagged suburb dropdown populates suburb reference and lets operator pick', async () => {
    server.use(
      http.get('/api/address/suburbs', () =>
        HttpResponse.json({
          ...env,
          suburbs: [
            { id: 1, name: 'Auckland Central', city: null, postCode: '1010', alias: null },
          ],
        })
      )
    );
    renderWithProviders(<StaffImportModal open onClose={vi.fn()} onImported={vi.fn()} />);
    await advanceToPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    // 'Newton' and 'Ponsonby' aren't in the suburb list so they flag.
    await waitFor(() => expect(screen.getByText(/Newton/)).toBeInTheDocument());
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThan(0);
    fireEvent.change(selects[0], { target: { value: 'Auckland Central' } });
  });

  it('Confirm -> fire import happy path calls onImported', async () => {
    server.use(
      http.get('/api/address/suburbs', () =>
        HttpResponse.json({ ...env, suburbs: [] })
      ),
      http.post('/api/address/geocode', () =>
        HttpResponse.json({ ...env, addresses: [] })
      ),
      http.post('/api/bulk-import/staff-import', () =>
        HttpResponse.json({
          messageId: 'x',
          success: true,
          messages: [{ message: 'ok' }],
          successCount: 1,
          failedCount: 0,
          failedJobs: [],
        })
      )
    );
    const onImported = vi.fn();
    renderWithProviders(<StaffImportModal open onClose={vi.fn()} onImported={onImported} />);
    await advanceToPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); // -> fixSuburbs
    await waitFor(() => expect(screen.getByText(/Suburbs seems OK/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); // -> fixAddresses
    // Wait for the geocode + flag effect to settle; then advance.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); // -> confirm
    await waitFor(() => expect(screen.getByText(/Confirm Staff Import/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Import 1 Jobs/ }));
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(screen.getByText(/Import complete/i)).toBeInTheDocument();
  });

  it('staff-import failure shows the result table with friendly errors', async () => {
    server.use(
      http.get('/api/address/suburbs', () =>
        HttpResponse.json({ ...env, suburbs: [] })
      ),
      http.post('/api/address/geocode', () =>
        HttpResponse.json({ ...env, addresses: [] })
      ),
      http.post('/api/bulk-import/staff-import', () =>
        HttpResponse.json({
          messageId: 'x',
          success: true,
          messages: [{ message: 'partial' }],
          successCount: 0,
          failedCount: 1,
          failedJobs: [
            {
              rowNumber: 1,
              jobNumber: 'J1',
              error: 'Violation of UNIQUE KEY constraint on ucjbNumber',
            },
          ],
        })
      )
    );
    renderWithProviders(<StaffImportModal open onClose={vi.fn()} onImported={vi.fn()} />);
    await advanceToPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText(/Suburbs seems OK/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    // Fix Addresses can either finish clean or still show flagged rows.
    // Either way, Next stays present.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: /Import 1 Jobs/ }));
    await waitFor(() =>
      expect(screen.getByText(/Job number already exists/)).toBeInTheDocument()
    );
  });

  it('Back button on preview returns to upload step', async () => {
    renderWithProviders(<StaffImportModal open onClose={vi.fn()} onImported={vi.fn()} />);
    await advanceToPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.getByText(/Staff Import Mode/i)).toBeInTheDocument());
  });
});
