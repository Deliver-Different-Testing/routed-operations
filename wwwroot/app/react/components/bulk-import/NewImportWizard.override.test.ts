import { describe, expect, it, vi } from 'vitest';
import { buildJobs, decodeOverrideDimensions } from './NewImportWizard';
import { initialWizardState, type WizardState } from './wizardState';

vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: any) => children,
  Map: ({ children }: any) => children ?? null,
  AdvancedMarker: () => null,
  useMap: () => ({ setCenter: vi.fn(), setZoom: vi.fn() }),
  useMapsLibrary: () => ({}),
}));

// The name becomes the item line's name on a P2P job, as a stock size is on the booking page.
describe('decodeOverrideDimensions', () => {
  it('keeps the stock size name with its sizes', () => {
    expect(decodeOverrideDimensions('Banana Box |53|39|24|8')).toEqual({
      name: 'Banana Box',
      length: 53,
      width: 39,
      height: 24,
      weight: 8,
    });
  });

  it('returns nothing when no stock size is picked', () => {
    expect(decodeOverrideDimensions('')).toBeNull();
    expect(decodeOverrideDimensions('Banana Box|53|39')).toBeNull();
  });
});

// The server turns these into per-item and total figures (BulkP2PItemsTests).
describe('buildJobs weight columns on an on-demand P2P row', () => {
  const jobFrom = (
    row: Record<string, string>,
    mapping: Record<string, string>,
    overrides: Partial<WizardState> = {},
    overrideDimensions = ''
  ) => {
    const base = initialWizardState();
    const state: WizardState = {
      ...base,
      importType: 'onDemand',
      parsed: { headers: Object.keys(row), rows: [row] } as WizardState['parsed'],
      mapping,
      options: { ...base.options, overrideDimensions },
      ...overrides,
    };
    return buildJobs(state, false)[0];
  };

  it('sends Total Weight with no Weight, so the server can divide it', () => {
    const job = jobFrom({ Gross: '37.5', Qty: '3' }, { totalWeight: 'Gross', quantity: 'Qty' });
    expect(job).toMatchObject({ weight: 0, totalWeight: 37.5, quantity: 3 });
  });

  it('sends both when both are mapped, and the server uses Weight', () => {
    const job = jobFrom({ W: '12.5', T: '99' }, { weight: 'W', totalWeight: 'T' });
    expect(job).toMatchObject({ weight: 12.5, totalWeight: 99 });
  });

  it('adds no key for a file with no Total Weight column', () => {
    expect(jobFrom({ W: '12.5' }, { weight: 'W' })).not.toHaveProperty('totalWeight');
  });

  it('keeps the stock weight per item and ignores a leftover Total Weight mapping', () => {
    const job = jobFrom({ T: '99', Qty: '3' }, { totalWeight: 'T', quantity: 'Qty' }, {}, 'Banana Box|53|39|24|8');
    expect(job.weight).toBe(8);
    expect(job).not.toHaveProperty('totalWeight');
  });

  it('never sends Total Weight on a routed row', () => {
    const job = jobFrom({ T: '99' }, { totalWeight: 'T' }, { importType: 'routed' });
    expect(job).not.toHaveProperty('totalWeight');
  });
});
