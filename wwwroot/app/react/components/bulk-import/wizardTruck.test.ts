import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BulkImportJobCreateDto } from '../../services/bulkImportService';
import type { ClientSettingsDto } from '../../services/clientsService';
import {
  applyTruckFields,
  autoMapTruckFields,
  autoMatchColumn,
  columnHasTruckSpeed,
  initialWizardState,
  parseYesNo,
  splitReturnedJobs,
  truckInPlay,
  urgentFieldsFor,
  type WizardState,
} from './wizardState';

// Truck fields must stay out of the way: a P2P import has to look and send
// exactly what it did before (acceptance test F), so each visibility rule has
// a negative case next to the positive one.

const speeds = [
  { id: 3, name: 'Standard', code: 'STD', systemName: 'ST', isTruck: false },
  { id: 52, name: 'Truck Economy', code: 'TECO', systemName: 'TY', isTruck: true },
];

function fixture(name: string): { headers: string[]; rows: Record<string, string>[] } {
  const text = readFileSync(resolve(process.cwd(), 'tests/e2e/fixtures/bulk-truck', name), 'utf8');
  const [head, ...lines] = text.trim().split(/\r?\n/).map((l) => l.split(','));
  return {
    headers: head,
    rows: lines.map((cells) => Object.fromEntries(head.map((h, i) => [h, cells[i] ?? '']))),
  };
}

function state(patch: Partial<WizardState> = {}, withTruckSpeeds = true): WizardState {
  return {
    ...initialWizardState(),
    importType: 'onDemand',
    clientSettings: { speeds: withTruckSpeeds ? speeds : [speeds[0]] } as unknown as ClientSettingsDto,
    ...patch,
  };
}

describe('truckInPlay', () => {
  it('is off for a client with no truck speeds, whatever the file says', () => {
    const s = state({ parsed: fixture('bulk-truck-ingram-like.csv'), mapping: { speed: 'Speed' } }, false);
    expect(truckInPlay(s, false)).toBe(false);
  });

  it('is off for a routed import and for a US tenant', () => {
    const on = state({ speedId: 52 });
    expect(truckInPlay(on, false)).toBe(true);
    expect(truckInPlay({ ...on, importType: 'routed' }, false)).toBe(false);
    expect(truckInPlay(on, true)).toBe(false);
  });

  it('is off when a truck client imports a P2P batch with no Speed column', () => {
    expect(truckInPlay(state({ speedId: 3 }), false)).toBe(false);
  });

  it('turns on from the batch speed, the operator tick, or a truck value in the Speed column', () => {
    expect(truckInPlay(state({ speedId: 52 }), false)).toBe(true);
    const ticked = state();
    ticked.options = { ...ticked.options, truckJobs: true };
    expect(truckInPlay(ticked, false)).toBe(true);
    const file = fixture('bulk-truck-ingram-like.csv');
    expect(truckInPlay(state({ parsed: file, mapping: { speed: 'Speed' } }), false)).toBe(true);
  });

  it('matches a Speed value by id, code, system name or name, ignoring case', () => {
    for (const value of ['52', 'teco', ' TY ', 'truck economy']) {
      const s = state({ parsed: { headers: ['S'], rows: [{ S: value }] } as WizardState['parsed'] });
      expect(columnHasTruckSpeed(s, 'S')).toBe(true);
    }
    const p2p = state({ parsed: { headers: ['S'], rows: [{ S: 'Standard' }] } as WizardState['parsed'] });
    expect(columnHasTruckSpeed(p2p, 'S')).toBe(false);
  });
});

describe('urgentFieldsFor truck fields', () => {
  const keys = (truck: boolean) => urgentFieldsFor(false, 'onDemand', false, false, undefined, false, truck).map((f) => f.key);

  it('adds no truck-only fields unless a truck speed is in play', () => {
    expect(keys(false)).not.toContain('speed');
    expect(keys(false)).not.toContain('palletType');
  });

  it('lists every truck target field and labels Weight as per pallet', () => {
    expect(keys(true)).toEqual(expect.arrayContaining([
      'speed', 'palletType', 'totalWeight', 'tailLiftPickup', 'tailLiftDropoff',
      'residential', 'dangerousGoods', 'dgClass', 'dgDocument', 'truckStart', 'truckHours',
    ]));
    const weight = urgentFieldsFor(false, 'onDemand', false, false, undefined, false, true).find((f) => f.key === 'weight');
    expect(weight?.label).toBe('Weight (per pallet)');
  });

  it('auto-maps the mixed fixture without mixing up Pallets and Pallet Type', () => {
    const { headers } = fixture('bulk-truck-ingram-like.csv');
    const fields = urgentFieldsFor(false, 'onDemand', false, false, undefined, false, true);
    const match = (key: string) => autoMatchColumn(fields.find((f) => f.key === key)!, headers);
    expect(match('speed')).toBe('Speed');
    expect(match('quantity')).toBe('Pallets');
    expect(match('palletType')).toBe('Pallet Type');
    expect(match('weight')).toBe('Weight');
    expect(match('tailLiftDropoff')).toBe('Tail Lift DO');
    expect(match('tailLiftPickup')).toBe('Tail Lift PU');
    expect(match('residential')).toBe('Residential');
    expect(match('dgClass')).toBe('DG Class');
  });

  // Getting this wrong multiplies or divides every price input by the pallet count.
  it('leaves a per-pallet Weight column as Weight and never as Total Weight', () => {
    const { headers } = fixture('bulk-truck-ingram-like.csv');
    const fields = urgentFieldsFor(false, 'onDemand', false, false, undefined, false, true);
    const mapped = autoMapTruckFields(fields, headers, { weight: 'Weight' });
    expect(mapped.weight).toBe('Weight');
    expect(mapped.totalWeight).toBeUndefined();
    expect(mapped.tailLiftDropoff).toBe('Tail Lift DO');
  });

  it('takes a lone Total Weight column away from Weight, which claimed it on open', () => {
    const { headers } = fixture('bulk-truck-total-weight.csv');
    const fields = urgentFieldsFor(false, 'onDemand', false, false, undefined, false, true);
    const mapped = autoMapTruckFields(fields, headers, { weight: 'Total Weight' });
    expect(mapped.totalWeight).toBe('Total Weight');
    expect(mapped.weight).toBeUndefined();
  });

  it('keeps both when a file has both columns', () => {
    const fields = urgentFieldsFor(false, 'onDemand', false, false, undefined, false, true);
    const mapped = autoMapTruckFields(fields, ['Weight', 'Total Weight'], { weight: 'Weight' });
    expect(mapped.weight).toBe('Weight');
    expect(mapped.totalWeight).toBe('Total Weight');
  });
});

// A column read the wrong way multiplies or divides the rated weight by the quantity.
describe('Weight and Total Weight mapping on an on-demand import', () => {
  const match = (headers: string[], isUs = false, jobType: 'onDemand' | 'routed' = 'onDemand', truck = false) => {
    const fields = urgentFieldsFor(isUs, jobType, false, false, undefined, false, truck);
    const of = (key: string) => {
      const f = fields.find((x) => x.key === key);
      return f ? autoMatchColumn(f, headers) : undefined;
    };
    return { weight: of('weight'), totalWeight: of('totalWeight') };
  };

  it.each([false, true])('maps each column when a file has both (US %s)', (isUs) => {
    expect(match(['Weight', 'Total Weight'], isUs)).toEqual({ weight: 'Weight', totalWeight: 'Total Weight' });
    expect(match(['Total Weight', 'Weight'], isUs)).toEqual({ weight: 'Weight', totalWeight: 'Total Weight' });
  });

  it.each(['Gross Weight', 'Total Weight', 'TotalWeight', 'Total Kg', 'Total_Kgs', 'Total Lbs', 'Gross Lbs'])(
    'a file with only %s maps it to Total Weight and not Weight',
    (header) => {
      expect(match([header])).toEqual({ weight: '', totalWeight: header });
      expect(match([header], true)).toEqual({ weight: '', totalWeight: header });
    }
  );

  it('a plain Weight or Kg column stays per item and never reaches Total Weight', () => {
    expect(match(['Weight'])).toEqual({ weight: 'Weight', totalWeight: '' });
    expect(match(['Kg'])).toEqual({ weight: 'Kg', totalWeight: '' });
  });

  it('a money column called Total or Gross is left alone', () => {
    expect(match(['Total'])).toEqual({ weight: '', totalWeight: '' });
    expect(match(['Gross'])).toEqual({ weight: '', totalWeight: '' });
  });

  it('a truck import reads the same headers the same way', () => {
    expect(match(['Weight', 'Gross Weight'], false, 'onDemand', true)).toEqual({ weight: 'Weight', totalWeight: 'Gross Weight' });
    expect(match(['Gross Weight'], false, 'onDemand', true)).toEqual({ weight: '', totalWeight: 'Gross Weight' });
  });

  it('a routed import keeps its matching and has no Total Weight', () => {
    expect(match(['Total Weight'], false, 'routed')).toEqual({ weight: 'Total Weight', totalWeight: undefined });
    expect(match(['Gross Weight'], true, 'routed')).toEqual({ weight: 'Gross Weight', totalWeight: undefined });
  });

  it('hides Total Weight with Weight when a stock size is picked on a P2P import', () => {
    const keys = urgentFieldsFor(false, 'onDemand', false, false, undefined, true, false).map((f) => f.key);
    expect(keys).not.toContain('weight');
    expect(keys).not.toContain('totalWeight');
  });
});

describe('applyTruckFields', () => {
  const job = (): BulkImportJobCreateDto => ({ weight: 400 } as BulkImportJobCreateDto);
  const from = (values: Record<string, string>) => (key: string) => values[key] ?? null;

  it('adds no keys for a row with no truck columns', () => {
    const j = job();
    applyTruckFields(j, from({}), null);
    expect(j).toEqual({ weight: 400 });
  });

  it('carries the raw speed, flags and numbers', () => {
    const j = job();
    applyTruckFields(j, from({ speed: 'TECO', tailLiftDropoff: 'Y', residential: 'no', dgClass: '3', truckHours: '2.5' }), 400);
    expect(j).toMatchObject({ speed: 'TECO', tailLiftDropoff: true, residential: false, dgClass: 3, truckHours: 2.5 });
  });

  it('lets a row total beat a stock size weight, but not the rows own weight', () => {
    const stockOnly = job();
    applyTruckFields(stockOnly, from({ totalWeight: '500' }), null);
    expect(stockOnly).toMatchObject({ totalWeight: 500, weight: 0 });

    const both = job();
    applyTruckFields(both, from({ totalWeight: '500' }), 400);
    expect(both).toMatchObject({ totalWeight: 500, weight: 400 });
  });

  it('reads Y/N values and treats anything else as not given', () => {
    expect(parseYesNo('Yes')).toBe(true);
    expect(parseYesNo('n')).toBe(false);
    expect(parseYesNo('maybe')).toBeNull();
    expect(parseYesNo(null)).toBeNull();
  });
});

describe('splitReturnedJobs', () => {
  it('keeps refused truck rows away from km-rated review', () => {
    const refused = { jobNumber: 'T1', truckRejected: true } as BulkImportJobCreateDto;
    const kmRated = { jobNumber: 'K1' } as BulkImportJobCreateDto;
    const { truckRejected, others } = splitReturnedJobs([refused, kmRated]);
    expect(truckRejected).toEqual([refused]);
    expect(others).toEqual([kmRated]);
  });
});
