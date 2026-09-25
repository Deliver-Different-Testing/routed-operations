import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderWithProviders } from '../../test/renderWithProviders';
import { FixAddressesModal } from './FixAddressesModal';
import { initialWizardState, type WizardState } from './wizardState';

// Mock the Google Maps package so no real browser API is required. Both
// APIProvider and Map are tree-passthrough components.
vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: any) => children,
  Map: ({ children }: any) => children ?? null,
  AdvancedMarker: () => null,
  useMap: () => ({ setCenter: vi.fn(), setZoom: vi.fn() }),
  useMapsLibrary: () => ({}),
}));

const env = { messageId: 'x', success: true, messages: [] };

function seed(state?: Partial<WizardState>): WizardState {
  return { ...initialWizardState(), ...state };
}

describe('FixAddressesModal', () => {
  const noop = vi.fn();

  it('renders nothing when open=false', () => {
    renderWithProviders(
      <FixAddressesModal
        open={false}
        state={seed()}
        dispatch={noop}
        onBack={noop}
        onNext={noop}
        onCancel={noop}
      />
    );
    expect(screen.queryByText('Fix Addresses')).not.toBeInTheDocument();
  });

  it('shows "Addresses seems OK" when every address geocodes fine', async () => {
    server.use(
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
      )
    );
    renderWithProviders(
      <FixAddressesModal
        open
        state={seed({
          parsed: { headers: ['ToAddress', 'ToSuburb'], rows: [{ ToAddress: '1 St', ToSuburb: 'Newton' }] },
          mapping: { toAddress: 'ToAddress', toSuburb: 'ToSuburb' },
        })}
        dispatch={noop}
        onBack={noop}
        onNext={noop}
        onCancel={noop}
      />
    );
    await waitFor(() => expect(screen.getByText(/Addresses seems OK/)).toBeInTheDocument());
  });

  it('surfaces the flagged-address list when geocode returns no lat/lng', async () => {
    server.use(
      http.post('/api/address/geocode', () =>
        HttpResponse.json({
          ...env,
          addresses: [
            {
              address: 'unknown',
              suburb: '',
              postCode: '',
              latitude: null,
              longitude: null,
              geoType: null,
            },
          ],
        })
      )
    );
    renderWithProviders(
      <FixAddressesModal
        open
        state={seed({
          parsed: { headers: ['ToAddress'], rows: [{ ToAddress: 'unknown' }] },
          mapping: { toAddress: 'ToAddress' },
        })}
        dispatch={vi.fn()}
        onBack={noop}
        onNext={noop}
        onCancel={noop}
      />
    );
    await waitFor(() =>
      expect(screen.getByText(/1 flagged address/i)).toBeInTheDocument()
    );
  });

  it('selecting a flagged pin opens the editor pane', async () => {
    server.use(
      http.post('/api/address/geocode', () =>
        HttpResponse.json({
          ...env,
          addresses: [
            {
              address: 'unknown',
              suburb: 'X',
              postCode: '',
              latitude: null,
              longitude: null,
              geoType: null,
            },
          ],
        })
      )
    );
    renderWithProviders(
      <FixAddressesModal
        open
        state={seed({
          parsed: { headers: ['ToAddress'], rows: [{ ToAddress: 'unknown' }] },
          mapping: { toAddress: 'ToAddress' },
        })}
        dispatch={vi.fn()}
        onBack={noop}
        onNext={noop}
        onCancel={noop}
      />
    );
    const flagBtn = await screen.findByRole('button', { name: /unknown/ });
    fireEvent.click(flagBtn);
    // Autocomplete input shows up.
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/corrected address/i)).toBeInTheDocument()
    );
  });

  it('geocode error surfaces a toast', async () => {
    server.use(
      http.post('/api/address/geocode', () => HttpResponse.json({ message: 'boom' }, { status: 500 }))
    );
    renderWithProviders(
      <FixAddressesModal
        open
        state={seed({
          parsed: { headers: ['ToAddress'], rows: [{ ToAddress: '1 St' }] },
          mapping: { toAddress: 'ToAddress' },
        })}
        dispatch={vi.fn()}
        onBack={noop}
        onNext={noop}
        onCancel={noop}
      />
    );
    await waitFor(() => expect(screen.getByText(/Geocode failed/)).toBeInTheDocument());
  });

  it('auto-write coords dispatches SET_FIXED_ADDRESS for successful rows', async () => {
    server.use(
      http.post('/api/address/geocode', () =>
        HttpResponse.json({
          ...env,
          addresses: [
            {
              address: '1 St',
              suburb: 'X',
              postCode: '',
              latitude: '-36.5',
              longitude: '174.7',
              geoType: 1,
            },
          ],
        })
      )
    );
    const dispatch = vi.fn();
    renderWithProviders(
      <FixAddressesModal
        open
        state={seed({
          parsed: { headers: ['ToAddress'], rows: [{ ToAddress: '1 St' }] },
          mapping: { toAddress: 'ToAddress' },
        })}
        dispatch={dispatch}
        onBack={noop}
        onNext={noop}
        onCancel={noop}
      />
    );
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SET_FIXED_ADDRESS',
          rowIndex: 0,
          coords: { lat: -36.5, lng: 174.7 },
        })
      )
    );
  });

  it('Cancel / Back / Next buttons wire through', async () => {
    server.use(
      http.post('/api/address/geocode', () =>
        HttpResponse.json({ ...env, addresses: [] })
      )
    );
    const onBack = vi.fn();
    const onNext = vi.fn();
    const onCancel = vi.fn();
    renderWithProviders(
      <FixAddressesModal
        open
        state={seed({
          parsed: { headers: ['ToAddress'], rows: [] },
          mapping: { toAddress: 'ToAddress' },
        })}
        dispatch={vi.fn()}
        onBack={onBack}
        onNext={onNext}
        onCancel={onCancel}
      />
    );
    await waitFor(() => expect(screen.getByText('Fix Addresses')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onBack).toHaveBeenCalled();
    expect(onNext).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('renders fallback lat/lng inputs when no Google Maps key configured', async () => {
    // Default __APP_USER__ has null googleMapsKey.
    server.use(
      http.post('/api/address/geocode', () =>
        HttpResponse.json({
          ...env,
          addresses: [
            {
              address: 'unknown',
              suburb: '',
              postCode: '',
              latitude: null,
              longitude: null,
              geoType: null,
            },
          ],
        })
      )
    );
    renderWithProviders(
      <FixAddressesModal
        open
        state={seed({
          parsed: { headers: ['ToAddress'], rows: [{ ToAddress: 'unknown' }] },
          mapping: { toAddress: 'ToAddress' },
        })}
        dispatch={vi.fn()}
        onBack={noop}
        onNext={noop}
        onCancel={noop}
      />
    );
    const flagBtn = await screen.findByRole('button', { name: /unknown/ });
    fireEvent.click(flagBtn);
    // Fallback map pane shows Latitude/Longitude inputs.
    await waitFor(() => expect(screen.getByText('Latitude')).toBeInTheDocument());
    expect(screen.getByText('Longitude')).toBeInTheDocument();
  });

  it('Save Coordinates button in fallback pane dispatches SET_FIXED_ADDRESS', async () => {
    server.use(
      http.post('/api/address/geocode', () =>
        HttpResponse.json({
          ...env,
          addresses: [
            {
              address: 'unknown',
              suburb: '',
              postCode: '',
              latitude: null,
              longitude: null,
              geoType: null,
            },
          ],
        })
      )
    );
    const dispatch = vi.fn();
    renderWithProviders(
      <FixAddressesModal
        open
        state={seed({
          parsed: { headers: ['ToAddress'], rows: [{ ToAddress: 'unknown' }] },
          mapping: { toAddress: 'ToAddress' },
        })}
        dispatch={dispatch}
        onBack={noop}
        onNext={noop}
        onCancel={noop}
      />
    );
    const flagBtn = await screen.findByRole('button', { name: /unknown/ });
    fireEvent.click(flagBtn);
    await waitFor(() => expect(screen.getByText('Latitude')).toBeInTheDocument());
    // Container div - find lat + lng inputs specifically.
    const inputs = screen.getAllByRole('textbox');
    // Two of the inputs are lat/lng in the fallback pane. The first (search
    // autocomplete) is above them. Fill the last two.
    fireEvent.change(inputs[inputs.length - 2], { target: { value: '-36.5' } });
    fireEvent.change(inputs[inputs.length - 1], { target: { value: '174.7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Coordinates' }));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SET_FIXED_ADDRESS',
        rowIndex: 0,
        coords: { lat: -36.5, lng: 174.7 },
      })
    );
  });
});
