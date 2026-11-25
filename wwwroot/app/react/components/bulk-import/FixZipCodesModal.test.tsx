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
    // NZ options carry the suburb id; the dispatched fix is still the name.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } });
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

  // #333. The suburbs API pads postcodes to 4 digits but Excel drops the
  // leading zero, so a sheet "624" never matched an alias row's "0624" and
  // the row was flagged. And the server strips macrons from the sheet
  // value, so "Ōtāhuhu" books fine against "Otahuhu", but the modal flagged
  // it because it compared the raw text.
  it('matches an alias when the sheet dropped the leading zero of the postcode', async () => {
    server.use(
      http.get('/api/address/suburbs', () =>
        HttpResponse.json({
          ...env,
          suburbs: [
            { id: 1, name: 'Devonport', city: null, postCode: '0624', alias: 'Devenport' },
            { id: 2, name: 'Auckland', city: null, postCode: '1010', alias: null },
          ],
        })
      )
    );
    const dispatch = vi.fn();
    const s = seed({
      parsed: { headers: ['ToSuburb', 'ToPostCode'], rows: [{ ToSuburb: 'Devenport', ToPostCode: '624' }] },
      mapping: { toSuburb: 'ToSuburb', toPostCode: 'ToPostCode' },
    });
    renderWithProviders(
      <FixZipCodesModal open state={s} dispatch={dispatch} onBack={vi.fn()} onNext={vi.fn()} onCancel={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByText(/Suburbs seems OK/)).toBeInTheDocument());
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_FIXED_ZIP', badZip: 'devenport|624', corrected: 'Devonport' })
    );
  });

  it('matches a suburb written with macrons to the reference name without them', async () => {
    server.use(
      http.get('/api/address/suburbs', () =>
        HttpResponse.json({
          ...env,
          suburbs: [{ id: 1, name: 'Otahuhu', city: null, postCode: '1062', alias: null }],
        })
      )
    );
    const s = seed({
      parsed: { headers: ['ToSuburb', 'ToPostCode'], rows: [{ ToSuburb: 'Ōtāhuhu', ToPostCode: '1062' }] },
      mapping: { toSuburb: 'ToSuburb', toPostCode: 'ToPostCode' },
    });
    renderWithProviders(
      <FixZipCodesModal open state={s} dispatch={vi.fn()} onBack={vi.fn()} onNext={vi.fn()} onCancel={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByText(/Suburbs seems OK/)).toBeInTheDocument());
  });

  // B5: the shared normaliser on the main match, so 'Mt Eden' needs no fix.
  it('accepts Mt Eden for the reference Mount Eden without asking', async () => {
    server.use(
      http.get('/api/address/suburbs', () =>
        HttpResponse.json({
          ...env,
          suburbs: [{ id: 1, name: 'Mount Eden', city: null, postCode: '1024', alias: null }],
        })
      )
    );
    const dispatch = vi.fn();
    const s = seed({
      parsed: { headers: ['ToSuburb', 'ToPostCode'], rows: [{ ToSuburb: 'Mt Eden', ToPostCode: '1024' }] },
      mapping: { toSuburb: 'ToSuburb', toPostCode: 'ToPostCode' },
    });
    renderWithProviders(
      <FixZipCodesModal open state={s} dispatch={dispatch} onBack={vi.fn()} onNext={vi.fn()} onCancel={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByText(/Suburbs seems OK/)).toBeInTheDocument());
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_FIXED_ZIP', badZip: 'mt eden|1024', corrected: 'Mount Eden' })
    );
  });

  // Two real suburbs normalise alike: a spelling that matches neither
  // exactly is asked about, not guessed.
  it('asks about St. Albans when both St Albans and Saint Albans exist', async () => {
    server.use(
      http.get('/api/address/suburbs', () =>
        HttpResponse.json({
          ...env,
          suburbs: [
            { id: 1, name: 'St Albans', city: null, postCode: '8014', alias: null },
            { id: 2, name: 'Saint Albans', city: null, postCode: '8014', alias: null },
          ],
        })
      )
    );
    const dispatch = vi.fn();
    const s = seed({
      parsed: { headers: ['ToSuburb', 'ToPostCode'], rows: [{ ToSuburb: 'St. Albans', ToPostCode: '8014' }] },
      mapping: { toSuburb: 'ToSuburb', toPostCode: 'ToPostCode' },
    });
    renderWithProviders(
      <FixZipCodesModal open state={s} dispatch={dispatch} onBack={vi.fn()} onNext={vi.fn()} onCancel={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    expect(screen.getByText('St. Albans (8014)')).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_FIXED_ZIP' }));
  });

  // Order is exact name, then remembered fix, then normalised match. Alias
  // keys are normalised, so the fix saved for 'St. Albans' -> Saint Albans
  // ('saint albans') also matches a sheet 'St Albans', a different real
  // suburb, which must stay as itself; 'St. Albans' still takes the fix.
  it('keeps an exact suburb name even when a remembered fix matches it', async () => {
    server.use(
      http.get('/api/address/suburbs', () =>
        HttpResponse.json({
          ...env,
          suburbs: [
            { id: 1, name: 'St Albans', city: null, postCode: '8014', alias: null },
            { id: 3, name: 'Saint Albans', city: null, postCode: '8014', alias: null },
          ],
        })
      ),
      http.get('/api/bulk-import/suburb-aliases', () =>
        HttpResponse.json({
          ...env,
          aliases: [
            { id: 9, clientId: 7, rawSuburb: 'saint albans', rawPostCode: '8014', suburbId: 3, suburbName: 'Saint Albans', postCode: '8014' },
          ],
        })
      )
    );
    const dispatch = vi.fn();
    const s = seed({
      client: { id: 7, code: 'C', name: 'C', isUsTenant: false },
      parsed: {
        headers: ['ToSuburb', 'ToPostCode'],
        rows: [
          { ToSuburb: 'St Albans', ToPostCode: '8014' },
          { ToSuburb: 'St. Albans', ToPostCode: '8014' },
          { ToSuburb: 'St  Albans', ToPostCode: '8014' },
          { ToSuburb: 'St Albans.', ToPostCode: '8014' },
          { ToSuburb: ' saint  albans ', ToPostCode: '8014' },
        ],
      },
      mapping: { toSuburb: 'ToSuburb', toPostCode: 'ToPostCode' },
    });
    renderWithProviders(
      <FixZipCodesModal open state={s} dispatch={dispatch} onBack={vi.fn()} onNext={vi.fn()} onCancel={vi.fn()} />
    );
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SET_FIXED_ZIP', badZip: 'st. albans|8014', corrected: 'Saint Albans' })
      )
    );
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ badZip: 'st albans|8014' }));
    // Spacing and a trailing dot are still the exact name, not the alias.
    for (const badZip of ['st  albans|8014', 'st albans.|8014']) {
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_FIXED_ZIP', badZip, corrected: 'St Albans' }));
      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ badZip, corrected: 'Saint Albans' }));
      expect(screen.queryByTestId(`remembered-fix-${badZip}`)).toBeNull();
    }
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_FIXED_ZIP', badZip: 'saint  albans|8014', corrected: 'Saint Albans' })
    );
    expect(screen.queryByTestId('remembered-fix-saint  albans|8014')).toBeNull();
    expect(screen.queryByTestId('remembered-fix-st albans|8014')).toBeNull();
    expect(screen.getByTestId('remembered-fix-st. albans|8014')).toBeInTheDocument();
  });

  // NZ has duplicate suburb names. The remembered fix must be the exact
  // tucSuburb the operator picked, not the first one with that name.
  it('remembers the picked suburb id when two suburbs share a name', async () => {
    let posted: unknown = null;
    server.use(
      http.get('/api/address/suburbs', () =>
        HttpResponse.json({
          ...env,
          suburbs: [
            { id: 5, name: 'Newton', city: 'Auckland', postCode: '1010', alias: null },
            { id: 6, name: 'Newton', city: 'Wellington', postCode: '6021', alias: null },
          ],
        })
      ),
      http.get('/api/bulk-import/suburb-aliases', () => HttpResponse.json({ ...env, aliases: [] })),
      http.post('/api/bulk-import/suburb-aliases', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({
          ...env,
          alias: { id: 9, clientId: 7, rawSuburb: 'nuton', rawPostCode: '1010', suburbId: 6, suburbName: 'Newton', postCode: '6021' },
        });
      })
    );
    const dispatch = vi.fn();
    const s = seed({
      client: { id: 7, code: 'C', name: 'C', isUsTenant: false },
      parsed: { headers: ['ToSuburb', 'ToPostCode'], rows: [{ ToSuburb: 'Nuton', ToPostCode: '1010' }] },
      mapping: { toSuburb: 'ToSuburb', toPostCode: 'ToPostCode' },
    });
    renderWithProviders(
      <FixZipCodesModal open state={s} dispatch={dispatch} onBack={vi.fn()} onNext={vi.fn()} onCancel={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '6' } });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_FIXED_ZIP', badZip: 'nuton|1010', corrected: 'Newton' })
    );
    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({ clientId: 7, rawSuburb: 'Nuton', rawPostCode: '1010', suburbId: 6 });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ badZip: 'nuton|1010', suburbId: 6 }));
  });

  // Back then Next remounts the modal. The pick lives in wizard state, so
  // the select still shows the Newton that was picked (id 6), not the first
  // suburb with that name (id 5).
  it('shows the picked suburb again after a remount', async () => {
    server.use(
      http.get('/api/address/suburbs', () =>
        HttpResponse.json({
          ...env,
          suburbs: [
            { id: 5, name: 'Newton', city: 'Auckland', postCode: '1010', alias: null },
            { id: 6, name: 'Newton', city: 'Wellington', postCode: '6021', alias: null },
          ],
        })
      ),
      http.get('/api/bulk-import/suburb-aliases', () => HttpResponse.json({ ...env, aliases: [] }))
    );
    const s = seed({
      client: { id: 7, code: 'C', name: 'C', isUsTenant: false },
      parsed: { headers: ['ToSuburb', 'ToPostCode'], rows: [{ ToSuburb: 'Nuton', ToPostCode: '1010' }] },
      mapping: { toSuburb: 'ToSuburb', toPostCode: 'ToPostCode' },
      fixedZips: { 'nuton|1010': 'Newton' },
      fixedSuburbIds: { 'nuton|1010': 6 },
    } as Partial<WizardState>);
    renderWithProviders(
      <FixZipCodesModal open state={s} dispatch={vi.fn()} onBack={vi.fn()} onNext={vi.fn()} onCancel={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    expect(screen.getByRole('combobox')).toHaveValue('6');
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
