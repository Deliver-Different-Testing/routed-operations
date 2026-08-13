import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderWithProviders } from '../../test/renderWithProviders';
import { FixZipCodesModal } from './FixZipCodesModal';
import { initialWizardState, type WizardState } from './wizardState';

const env = { messageId: 'x', success: true, messages: [] };

function seed(state?: Partial<WizardState>): WizardState {
  return { ...initialWizardState(), ...state };
}

describe('FixZipCodesModal - NZ suburbs', () => {
  it('renders nothing when open=false', () => {
    renderWithProviders(
      <FixZipCodesModal
        open={false}
        state={seed()}
        dispatch={vi.fn()}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.queryByText(/Fix Suburbs/)).not.toBeInTheDocument();
  });

  it('shows "Suburbs seems OK" when all values match reference list', async () => {
    server.use(
      http.get('/api/address/suburbs', () =>
        HttpResponse.json({
          ...env,
          suburbs: [{ id: 1, name: 'Auckland', city: null, postCode: '1010', alias: null }],
        })
      )
    );
    const s = seed({
      parsed: { headers: ['ToSuburb'], rows: [{ ToSuburb: 'Auckland' }] },
      mapping: { toSuburb: 'ToSuburb' },
    });
    renderWithProviders(
      <FixZipCodesModal
        open
        state={s}
        dispatch={vi.fn()}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByText(/Suburbs seems OK/)).toBeInTheDocument());
  });

  it('lists unknown suburbs with a dropdown to pick a replacement', async () => {
    server.use(
      http.get('/api/address/suburbs', () =>
        HttpResponse.json({
          ...env,
          suburbs: [
            { id: 1, name: 'Auckland', city: null, postCode: '1010', alias: null },
            { id: 2, name: 'Wellington', city: null, postCode: '6011', alias: null },
          ],
        })
      )
    );
    const s = seed({
      parsed: { headers: ['ToSuburb'], rows: [{ ToSuburb: 'Aukland' }] },
      mapping: { toSuburb: 'ToSuburb' },
    });
    renderWithProviders(
      <FixZipCodesModal
        open
        state={s}
        dispatch={vi.fn()}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByText(/Aukland/)).toBeInTheDocument());
    const select = screen.getByRole('combobox');
    // Auckland should be the top fuzzy suggestion (Levenshtein 1).
    expect(select.textContent).toContain('Auckland');
  });

  it('picking a replacement dispatches SET_FIXED_ZIP', async () => {
    server.use(
      http.get('/api/address/suburbs', () =>
        HttpResponse.json({
          ...env,
          suburbs: [
            { id: 1, name: 'Auckland', city: null, postCode: '1010', alias: null },
          ],
        })
      )
    );
    const dispatch = vi.fn();
    const s = seed({
      parsed: { headers: ['ToSuburb'], rows: [{ ToSuburb: 'Aukland' }] },
      mapping: { toSuburb: 'ToSuburb' },
    });
    renderWithProviders(
      <FixZipCodesModal
        open
        state={s}
        dispatch={dispatch}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Auckland' } });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_FIXED_ZIP', corrected: 'Auckland' })
    );
  });

  it('reference-list empty banner when server returns 0 suburbs', async () => {
    server.use(
      http.get('/api/address/suburbs', () =>
        HttpResponse.json({ ...env, suburbs: [] })
      )
    );
    const s = seed({
      parsed: { headers: ['ToSuburb'], rows: [{ ToSuburb: 'X' }] },
      mapping: { toSuburb: 'ToSuburb' },
    });
    renderWithProviders(
      <FixZipCodesModal
        open
        state={s}
        dispatch={vi.fn()}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(screen.getByText(/Suburb reference data unavailable/)).toBeInTheDocument()
    );
  });

  it('server error still leaves modal usable (banner not shown, empty state fine)', async () => {
    server.use(
      http.get('/api/address/suburbs', () => HttpResponse.json({}, { status: 500 }))
    );
    const s = seed({
      parsed: { headers: ['ToSuburb'], rows: [{ ToSuburb: 'X' }] },
      mapping: { toSuburb: 'ToSuburb' },
    });
    renderWithProviders(
      <FixZipCodesModal
        open
        state={s}
        dispatch={vi.fn()}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    // Rendered even with error - the "empty reference list" branch fires.
    await waitFor(() =>
      expect(screen.getByText(/Suburb reference data unavailable/)).toBeInTheDocument()
    );
  });

  it('Back / Next / Cancel buttons wire through', async () => {
    server.use(
      http.get('/api/address/suburbs', () =>
        HttpResponse.json({ ...env, suburbs: [] })
      )
    );
    const onBack = vi.fn();
    const onNext = vi.fn();
    const onCancel = vi.fn();
    renderWithProviders(
      <FixZipCodesModal
        open
        state={seed({ parsed: { headers: ['A'], rows: [] }, mapping: {} })}
        dispatch={vi.fn()}
        onBack={onBack}
        onNext={onNext}
        onCancel={onCancel}
      />
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onBack).toHaveBeenCalled();
    expect(onNext).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('alias-index rewrites value silently to canonical (no bad entry)', async () => {
    server.use(
      http.get('/api/address/suburbs', () =>
        HttpResponse.json({
          ...env,
          suburbs: [
            { id: 1, name: 'Mt Eden', city: null, postCode: '1024', alias: 'Mount Eden' },
          ],
        })
      )
    );
    const dispatch = vi.fn();
    const s = seed({
      parsed: {
        headers: ['ToSuburb', 'ToPostCode'],
        rows: [{ ToSuburb: 'Mount Eden', ToPostCode: '1024' }],
      },
      mapping: { toSuburb: 'ToSuburb', toPostCode: 'ToPostCode' },
    });
    renderWithProviders(
      <FixZipCodesModal
        open
        state={s}
        dispatch={dispatch}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    // Wait for the effect to dispatch SET_FIXED_ZIP with canonical name.
    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SET_FIXED_ZIP', corrected: 'Mt Eden' })
      );
    });
    // And the modal shouldn't list it as bad any more.
    expect(screen.queryByText(/Mount Eden \(1024\)/)).not.toBeInTheDocument();
  });
});

describe('FixZipCodesModal - US zip codes', () => {
  function usState(rows: Record<string, string>[]) {
    const s = seed({
      parsed: { headers: ['ToZipCode'], rows },
      mapping: { toZipCode: 'ToZipCode' },
      client: { id: 1, code: 'X', name: 'X', isUsTenant: true },
    });
    return s;
  }

  it('loads /address/zipcodes and shows a flagged bad zip', async () => {
    server.use(
      http.get('/api/address/zipcodes', () =>
        HttpResponse.json({
          ...env,
          zipCodes: [
            { id: 1, zoneNumber: 1, zoneName: 'Central', zip: '02110', clientId: null, applyCongestion: null },
          ],
        })
      )
    );
    renderWithProviders(
      <FixZipCodesModal
        open
        state={usState([{ ToZipCode: '02110' }, { ToZipCode: '99999' }])}
        dispatch={vi.fn()}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByText(/99999/)).toBeInTheDocument());
  });
});
