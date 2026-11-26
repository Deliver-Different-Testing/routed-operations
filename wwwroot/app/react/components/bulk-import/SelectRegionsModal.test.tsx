import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderWithProviders } from '../../test/renderWithProviders';
import { SelectRegionsModal } from './SelectRegionsModal';
import { initialWizardState, type DepotBucket, type WizardState } from './wizardState';

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
    // SEED_DEPOTS dispatched with one real bucket for depot id 1.
    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SEED_DEPOTS',
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

  it('Unmatched View / export opens the row review with the reason per row', async () => {
    server.use(
      http.get('/api/address/depots/postcodes', () =>
        HttpResponse.json({
          ...env,
          depots: [{ id: 1, name: 'Auckland North', postcodes: ['0612'] }],
        })
      )
    );
    const s = nzState([{ ToPostCode: '9999' }, { ToPostCode: '' }]);
    renderWithProviders(
      <SelectRegionsModal
        open
        state={s}
        dispatch={vi.fn()}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByText(/Unmatched/)).toBeInTheDocument());
    expect(screen.getByText(/Unmatched/).closest('label')!.querySelector('input')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View / export' }));
    expect(screen.getByText('Unmatched rows (2)')).toBeInTheDocument();
    expect(screen.getByText('Postcode not covered by any depot')).toBeInTheDocument();
    expect(screen.getByText('Missing postcode')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
  });

  it('a geocoder-fixed postcode rescues an unmatched row and is recorded as an override', async () => {
    server.use(
      http.get('/api/address/depots/postcodes', () =>
        HttpResponse.json({
          ...env,
          depots: [{ id: 1, name: 'Auckland North', postcodes: ['0612'] }],
        })
      )
    );
    const dispatch = vi.fn();
    const s = nzState([{ ToPostCode: '0612' }, { ToPostCode: '9999' }]);
    s.fixedPostCodes = { 1: '612', 0: '8011' };
    renderWithProviders(
      <SelectRegionsModal
        open
        state={s}
        dispatch={dispatch}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(screen.getByText(/Auckland North.*0 of 2 jobs imported/)).toBeInTheDocument()
    );
    expect(screen.queryByText(/Unmatched/)).not.toBeInTheDocument();
    // Row 0 matched on its own postcode, so its fix is ignored; only row 1
    // (rescued by the fix) carries an override.
    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SEED_DEPOTS',
          depots: [
            expect.objectContaining({
              depotId: 1,
              jobIndexes: [0, 1],
              postCodeOverrides: { 1: '0612' },
            }),
          ],
        })
      );
    });
  });

  it('an accepted postcode wins over a sheet postcode that also matches a depot (#332)', async () => {
    server.use(
      http.get('/api/address/depots/postcodes', () =>
        HttpResponse.json({
          ...env,
          depots: [
            { id: 1, name: 'Auckland South', postcodes: ['1062'] },
            { id: 2, name: 'Auckland CBD', postcodes: ['1010'] },
          ],
        })
      )
    );
    const dispatch = vi.fn();
    const s = nzState([{ ToPostCode: '1062' }, { ToPostCode: '1062' }]);
    // Row 1: the operator clicked Accept on "sheet says 1062, map says 1010".
    s.fixedPostCodes = { 1: '1010' };
    renderWithProviders(
      <SelectRegionsModal
        open
        state={s}
        dispatch={dispatch}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SEED_DEPOTS',
          depots: [
            expect.objectContaining({ depotId: 2, jobIndexes: [1], postCodeOverrides: { 1: '1010' } }),
            expect.objectContaining({ depotId: 1, jobIndexes: [0] }),
          ],
        })
      );
    });
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

  it('routed: depot with no schedules for the client is shown as a locked warning', async () => {
    let requestedUrl = '';
    server.use(
      http.get('/api/address/depots/postcodes', ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json({
          ...env,
          depots: [
            { id: 1, name: 'Christchurch', postcodes: ['8011'], hasSchedules: true },
            { id: 2, name: 'Air NZ Cargo', postcodes: ['2022'], hasSchedules: false },
          ],
        });
      })
    );
    const dispatch = vi.fn();
    const s = nzState([{ ToPostCode: '8011' }, { ToPostCode: '2022' }]);
    s.importType = 'routed';
    s.client = { id: 5, code: 'C', name: 'Client', isUsTenant: false };
    renderWithProviders(
      <SelectRegionsModal
        open
        state={s}
        dispatch={dispatch}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByText(/Air NZ Cargo/)).toBeInTheDocument());
    expect(requestedUrl).toContain('clientId=5');
    expect(screen.getByText(/no service set up at this depot/)).toBeInTheDocument();
    // Not importable: no checkbox, a View / export action instead.
    expect(screen.getByText(/Air NZ Cargo/).closest('label')!.querySelector('input')).toBeNull();
    expect(screen.getByRole('button', { name: 'View / export' })).toBeInTheDocument();
    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SEED_DEPOTS',
          depots: expect.arrayContaining([
            expect.objectContaining({ depotId: 2, noService: true }),
          ]),
        })
      );
    });
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

  // #332 US half. fixedZips is keyed by the zip value, so a suggestion made for
  // one row rewrote every row with that zip, including rows whose zip already
  // matched a depot. The sheet zip must win when it matches; the suggestion
  // only rescues a zip that matches nothing.
  it('keeps a sheet zip that matches a depot even when a fix was suggested for it', async () => {
    server.use(
      http.get('/api/address/locations/zipcodes', () =>
        HttpResponse.json({
          ...env,
          locations: [
            { id: 1, name: 'Boston', zipCodes: ['02110'] },
            { id: 2, name: 'Cambridge', zipCodes: ['02139'] },
          ],
        })
      ),
      http.get('/api/address/zip-polygons', () => HttpResponse.json({ ...env, zones: [] }))
    );
    const dispatch = vi.fn();
    const s = usState([{ ToZipCode: '02110' }, { ToZipCode: '99999' }]);
    s.fixedZips = { '02110': '02139', '99999': '02139' };
    renderWithProviders(
      <SelectRegionsModal open state={s} dispatch={dispatch} onBack={vi.fn()} onNext={vi.fn()} onCancel={vi.fn()} />
    );
    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SEED_DEPOTS',
          depots: [
            // Row 0 stays in Boston on its own zip, and the bucket pins the
            // sheet zip so the value-keyed fix is not applied at import.
            expect.objectContaining({ depotId: 1, jobIndexes: [0], postCodeOverrides: { 0: '02110' } }),
            // Row 1 matched nothing and is rescued by the suggestion.
            expect.objectContaining({ depotId: 2, jobIndexes: [1] }),
          ],
        })
      );
    });
  });
});

// #332 round 4 (Steve 26 Nov): an untouched postcode suggestion falls back to
// the map postcode when the sheet postcode matches no depot, as before round 2.
// Only an explicit Keep sheet sends such a row to Unmatched. A pending
// suggestion never overrides a sheet postcode that already matches a depot.
describe('SelectRegionsModal - #332 untouched suggestion (NZ)', () => {
  const depots = [
    { id: 1, name: 'Central', postcodes: ['1062'] },
    { id: 2, name: 'Auckland CBD', postcodes: ['1010'] },
  ];
  const pc = (rowIndex: number, sheet: string, map: string, decision: 'pending' | 'accept' | 'keep') => ({
    [`pc:${rowIndex}`]: { kind: 'postCode' as const, rowIndex, sheet, map, decision },
  });

  async function seeded(s: WizardState) {
    server.use(http.get('/api/address/depots/postcodes', () => HttpResponse.json({ ...env, depots })));
    const dispatch = vi.fn();
    renderWithProviders(
      <SelectRegionsModal open state={s} dispatch={dispatch} onBack={vi.fn()} onNext={vi.fn()} onCancel={vi.fn()} />
    );
    // Before the depot lookup arrives every row sits in Unmatched; wait for a
    // seed that has a real depot bucket or an Unmatched built from the lookup.
    await waitFor(() => expect(screen.queryByText('Loading depots...')).not.toBeInTheDocument());
    const calls = dispatch.mock.calls.map((c) => c[0]).filter((a) => a.type === 'SEED_DEPOTS');
    return calls[calls.length - 1].depots as DepotBucket[];
  }

  it('pending + sheet postcode with no depot: grouped under the map depot and booked with the map postcode', async () => {
    const s = nzState([{ ToPostCode: '0614' }]);
    s.geocodeSuggestions = pc(0, '0614', '1062', 'pending');
    const buckets = await seeded(s);
    expect(buckets).toEqual([
      expect.objectContaining({ depotId: 1, jobIndexes: [0], postCodeOverrides: { 0: '1062' } }),
    ]);
  });

  it('pending + sheet postcode that matches a depot: stays on the sheet depot with no override', async () => {
    const s = nzState([{ ToPostCode: '1010' }]);
    s.geocodeSuggestions = pc(0, '1010', '1062', 'pending');
    const buckets = await seeded(s);
    expect(buckets).toEqual([expect.objectContaining({ depotId: 2, jobIndexes: [0] })]);
    expect(buckets[0].postCodeOverrides).toBeUndefined();
  });

  it('keep + sheet postcode with no depot: Unmatched, with the kept reason', async () => {
    const s = nzState([{ ToPostCode: '0614' }]);
    s.geocodeSuggestions = pc(0, '0614', '1062', 'keep');
    const buckets = await seeded(s);
    expect(buckets).toEqual([expect.objectContaining({ depotId: 0, jobIndexes: [0] })]);
    fireEvent.click(screen.getByRole('button', { name: 'View / export' }));
    expect(screen.getByText('Sheet postcode 0614 kept (map says 1062); not covered by any depot')).toBeInTheDocument();
  });

  it('pending where neither the sheet nor the map postcode has a depot: Unmatched, and the reason says both', async () => {
    const s = nzState([{ ToPostCode: '0614' }]);
    s.geocodeSuggestions = pc(0, '0614', '9998', 'pending');
    server.use(http.get('/api/address/depots/postcodes', () => HttpResponse.json({ ...env, depots })));
    renderWithProviders(
      <SelectRegionsModal open state={s} dispatch={vi.fn()} onBack={vi.fn()} onNext={vi.fn()} onCancel={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByText(/Unmatched/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'View / export' }));
    expect(
      screen.getByText('Sheet postcode 0614 and map postcode 9998 are not covered by any depot')
    ).toBeInTheDocument();
  });

  it('accept wins over a sheet postcode that matches a depot', async () => {
    const s = nzState([{ ToPostCode: '1010' }]);
    s.geocodeSuggestions = pc(0, '1010', '1062', 'accept');
    s.fixedPostCodes = { 0: '1062' };
    const buckets = await seeded(s);
    expect(buckets).toEqual([
      expect.objectContaining({ depotId: 1, jobIndexes: [0], postCodeOverrides: { 0: '1062' } }),
    ]);
  });

  it('US: a pending postcode suggestion is ignored (zip grouping unchanged)', async () => {
    server.use(
      http.get('/api/address/locations/zipcodes', () =>
        HttpResponse.json({ ...env, locations: [{ id: 1, name: 'Boston', zipCodes: ['02110'] }] })
      ),
      http.get('/api/address/zip-polygons', () => HttpResponse.json({ ...env, zones: [] }))
    );
    const dispatch = vi.fn();
    const s = seed({
      parsed: { headers: ['ToZipCode'], rows: [{ ToZipCode: '99999' }] },
      mapping: { toZipCode: 'ToZipCode' },
      importType: 'onDemand',
      client: { id: 1, code: 'X', name: 'X', isUsTenant: true },
    });
    s.geocodeSuggestions = pc(0, '99999', '02110', 'pending');
    renderWithProviders(
      <SelectRegionsModal open state={s} dispatch={dispatch} onBack={vi.fn()} onNext={vi.fn()} onCancel={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByText(/Unmatched/)).toBeInTheDocument());
    const seeds = dispatch.mock.calls.map((c) => c[0]).filter((a) => a.type === 'SEED_DEPOTS');
    expect(seeds[seeds.length - 1].depots).toEqual([expect.objectContaining({ depotId: 0, jobIndexes: [0] })]);
  });
});
