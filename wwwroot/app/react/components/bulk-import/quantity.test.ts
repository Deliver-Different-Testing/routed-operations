import { describe, expect, it, vi } from 'vitest';
import { buildJobs } from './NewImportWizard';
import { initialWizardState, quantityCellProblem, quantityProblemLine, type WizardState } from './wizardState';

vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: any) => children,
  Map: ({ children }: any) => children ?? null,
  AdvancedMarker: () => null,
  useMap: () => ({ setCenter: vi.fn(), setZoom: vi.fn() }),
  useMapsLibrary: () => ({}),
}));

// #319. A blank Quantity cell books 1 (the server's default). Anything else must
// be a whole number from 1 to 32767, the same rule as BulkQuantity on the
// server. Before this a cell holding a space booked Qty 0 at price 0, "abc"
// silently booked 1, 2.7 booked 2 and a negative failed the import with a 500.
const mapping = { quantity: 'Qty' };

describe('quantityCellProblem', () => {
  it.each(['', '   ', '1', ' 4 ', '32767'])('accepts %j', (cell) => {
    expect(quantityCellProblem(cell)).toBe(false);
  });

  it.each(['0', '-3', '2.7', 'abc', '32768', '1e2'])('refuses %j', (cell) => {
    expect(quantityCellProblem(cell)).toBe(true);
  });
});

describe('quantityProblemLine', () => {
  it('names each record and the value that is wrong', () => {
    const rows = [{ Qty: '2' }, { Qty: '0' }, { Qty: '' }, { Qty: 'abc' }, { Qty: '2.7' }];
    expect(quantityProblemLine(mapping, rows)).toBe(
      "Quantity must be a whole number from 1 to 32767: record 2 ('0'), record 4 ('abc'), record 5 ('2.7')"
    );
  });

  it('lists ten records and says how many more', () => {
    const rows = Array.from({ length: 12 }, () => ({ Qty: '-1' }));
    const line = quantityProblemLine(mapping, rows)!;
    expect(line).toContain("record 10 ('-1')");
    expect(line).not.toContain('record 11');
    expect(line.endsWith(' +2 more')).toBe(true);
  });

  it('has nothing to say when every cell is blank or whole, or Quantity is not mapped', () => {
    expect(quantityProblemLine(mapping, [{ Qty: ' ' }, { Qty: '3' }])).toBeNull();
    expect(quantityProblemLine({}, [{ Qty: '0' }])).toBeNull();
  });
});

describe('buildJobs quantity', () => {
  const quantityOf = (cell: string) => {
    const state: WizardState = {
      ...initialWizardState(),
      parsed: { headers: ['Qty'], rows: [{ Qty: cell }] },
      mapping,
    };
    return buildJobs(state, false)[0].quantity;
  };

  it('sends no quantity for a blank or whitespace cell so the server books 1', () => {
    expect(quantityOf('')).toBeNull();
    expect(quantityOf('   ')).toBeNull();
  });

  it('sends the whole number in the cell', () => {
    expect(quantityOf('3')).toBe(3);
    expect(quantityOf(' 4 ')).toBe(4);
  });
});
