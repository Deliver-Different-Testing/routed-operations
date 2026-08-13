import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderWithProviders } from '../../test/renderWithProviders';
import { SelectRegionsModal } from './SelectRegionsModal';
import { initialWizardState, type WizardState } from './wizardState';

const env = { messageId: 'x', success: true, messages: [] };

function seed(state?: Partial<WizardState>): WizardState {
  return { ...initialWizardState(), ...state };
}

function nzState(rows: Record<string, string>[]) {
  return seed({
    parsed: { headers: ['ToPostCode'], rows },
    mapping: { toPostCode: 'ToPostCode' },
    importType: 'onDemand',
  });
}

describe('SelectRegionsModal - NZ tenant path', () => {
  it('renders nothing when open=false', () => {
    renderWithProviders(
      <SelectRegionsModal
        open={false}
        state={seed()}
        dispatch={vi.fn()}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.queryByText(/Select Depots/)).not.toBeInTheDocument();
  });

  it('loads depots + buckets NZ rows by 4-digit padded postcode', async () => {
    server.use(
      http.get('/api/address/depots/postcodes', () =>
        HttpResponse.json({
          ...env,
          depots: [{ id: 1, name: 'Auckland North', postcodes: ['0612', '0620'] }],
        })
      )
    );
    const dispatch = vi.fn();
    renderWithProviders(
      <SelectRegionsModal
        open
        state={nzState([{ ToPostCode: '612' }])}
        dispatch={dispatch}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    // Depot name renders inside the label with "(0 of 1 jobs imported)".
    await waitFor(() => expect(screen.getByText(/Auckland North.*0 of 1 jobs imported/)).toBeInTheDocument());
    // SET_DEPOTS dispatched with one real bucket for depot id 1.
    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SET_DEPOTS',
          depots: expect.arrayContaining([expect.objectContaining({ depotId: 1 })]),
        })
      );
    });
  });

  it('rows with unknown postcode land in the Unmatched bucket', async () => {
    server.use(
      http.get('/api/address/depots/postcodes', () =>
        HttpResponse.json({
          ...env,
          depots: [{ id: 1, name: 'Auckland North', postcodes: ['0612'] }],
        })
      )
    );
    renderWithProviders(
      <SelectRegionsModal
        open
        state={nzState([{ ToPostCode: '9999' }])}
        dispatch={vi.fn()}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByText(/Unmatched/)).toBeInTheDocument());
    // Unmatched cannot be selected: banner text lists them separately.
    expect(screen.getByText(/cannot be imported/)).toBeInTheDocument();
  });

  it('Cancel and Back buttons wire through their handlers', async () => {
    server.use(
      http.get('/api/address/depots/postcodes', () =>
        HttpResponse.json({ ...env, depots: [] })
      )
    );
    const onCancel = vi.fn();
    const onBack = vi.fn();
    renderWithProviders(
      <SelectRegionsModal
        open
        state={nzState([])}
        dispatch={vi.fn()}
        onBack={onBack}
        onNext={vi.fn()}
        onCancel={onCancel}
      />
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onBack).toHaveBeenCalled();
  });

  it('Next button fires onNext when regions are selected in state', async () => {
    server.use(
      http.get('/api/address/depots/postcodes', () =>
        HttpResponse.json({
          ...env,
          depots: [{ id: 1, name: 'Auckland North', postcodes: ['0612'] }],
        })
      )
    );
    const onNext = vi.fn();
    // Pre-tick the region so the Next button starts enabled without needing
    // the internal auto-select useEffect to write back.
    const s = nzState([{ ToPostCode: '0612' }]);
    s.selectedRegions = new Set(['1']);
    s.depots = [{ depotId: 1, depotName: 'Auckland North', jobIndexes: [0] }];
    renderWithProviders(
      <SelectRegionsModal
        open
        state={s}
        dispatch={vi.fn()}
        onBack={vi.fn()}
        onNext={onNext}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByText(/Auckland North/)).toBeInTheDocument());
    const nextBtn = screen.getByRole('button', { name: 'Next' });
    fireEvent.click(nextBtn);
    expect(onNext).toHaveBeenCalled();
  });

  it('handles API failure with error banner', async () => {
    server.use(
      http.get('/api/address/depots/postcodes', () =>
        HttpResponse.json({ message: 'kaboom' }, { status: 500 })
      )
    );
    renderWithProviders(
      <SelectRegionsModal
        open
        state={nzState([{ ToPostCode: '0612' }])}
        dispatch={vi.fn()}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByText(/kaboom/)).toBeInTheDocument());
  });

  it('toggling depot checkbox dispatches TOGGLE_REGION', async () => {
    server.use(
      http.get('/api/address/depots/postcodes', () =>
        HttpResponse.json({
          ...env,
          depots: [{ id: 5, name: 'Wellington', postcodes: ['6011'] }],
        })
      )
    );
    const dispatch = vi.fn();
    renderWithProviders(
      <SelectRegionsModal
        open
        state={nzState([{ ToPostCode: '6011' }])}
        dispatch={dispatch}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByText(/Wellington/)).toBeInTheDocument());
    const cb = screen.getAllByRole('checkbox').find((c) => !(c as HTMLInputElement).disabled)!;
    fireEvent.click(cb);
    expect(dispatch).toHaveBeenCalledWith({ type: 'TOGGLE_REGION', region: '5' });
  });
});

describe('SelectRegionsModal - US tenant path', () => {
  function usState(rows: Record<string, string>[]) {
    const s = seed({
      parsed: { headers: ['ToZipCode'], rows },
      mapping: { toZipCode: 'ToZipCode' },
      importType: 'onDemand',
      client: { id: 1, code: 'X', name: 'X', isUsTenant: true },
    });
    return s;
  }

  it('buckets by 5-digit base zip and surfaces the coverage-only bucket', async () => {
    server.use(
      http.get('/api/address/locations/zipcodes', () =>
        HttpResponse.json({
          ...env,
          locations: [{ id: 1, name: 'Boston', zipCodes: ['02110'] }],
        })
      ),
      http.get('/api/address/zip-polygons', () =>
        HttpResponse.json({
          ...env,
          zones: [{ zoneId: 99, zoneName: 'Extended', zips: ['02110', '02120'] }],
        })
      )
    );
    renderWithProviders(
      <SelectRegionsModal
        open
        state={usState([{ ToZipCode: '02110' }, { ToZipCode: '02120-4321' }])}
        dispatch={vi.fn()}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByText(/Boston/)).toBeInTheDocument());
    expect(screen.getByText(/Valid ZIP - Rate By Distance/)).toBeInTheDocument();
  });
});
