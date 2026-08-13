import { describe, expect, it } from 'vitest';
import {
  autoMatchColumn,
  initialWizardState,
  urgentFieldsFor,
  wizardReducer,
  type UrgentField,
  type WizardState,
} from './wizardState';

// wizardState is a pure reducer + a couple of pure helpers. Every action,
// selector and helper is exercised here so downstream modal tests can focus
// on UI behaviour rather than state shape.

function makeClient(id: number, isUs = false) {
  return { id, code: `C${id}`, name: `Client ${id}`, isUsTenant: isUs };
}

describe('initialWizardState', () => {
  it('boots on step=newImport with an empty payload', () => {
    const s = initialWizardState();
    expect(s.step).toBe('newImport');
    expect(s.client).toBeNull();
    expect(s.file).toBeNull();
    expect(s.parsed).toBeNull();
    expect(s.importType).toBe('routed');
    expect(s.mapping).toEqual({});
    expect(s.selectedRegions.size).toBe(0);
    expect(s.depots).toEqual([]);
    expect(s.currentDepotIndex).toBe(0);
    expect(s.speedId).toBe(0);
    expect(s.scheduleId).toBeNull();
    expect(s.perDepotResults).toEqual([]);
  });

  it('defaults bookDate to a valid yyyy-MM-dd string one day out', () => {
    const s = initialWizardState();
    expect(s.bookDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const today = new Date();
    today.setDate(today.getDate() + 1);
    expect(s.bookDate).toBe(today.toISOString().slice(0, 10));
  });
});

describe('wizardReducer - navigation + basics', () => {
  it('RESET returns a fresh initial state regardless of the incoming state', () => {
    const s: WizardState = { ...initialWizardState(), step: 'summary', client: makeClient(1) };
    const next = wizardReducer(s, { type: 'RESET' });
    expect(next.step).toBe('newImport');
    expect(next.client).toBeNull();
  });

  it('GOTO transitions the step', () => {
    const s = initialWizardState();
    const next = wizardReducer(s, { type: 'GOTO', step: 'mapColumns' });
    expect(next.step).toBe('mapColumns');
  });

  it('unknown action falls through to default and returns state unchanged', () => {
    const s = initialWizardState();
    const next = wizardReducer(s, { type: 'UNKNOWN' } as any);
    expect(next).toBe(s);
  });
});

describe('wizardReducer - SET_CLIENT wipe semantics', () => {
  it('first-time client selection keeps other state intact', () => {
    const s: WizardState = {
      ...initialWizardState(),
      mapping: { jobNumber: 'JOB' },
      file: new File(['x'], 'x.csv'),
    };
    const next = wizardReducer(s, { type: 'SET_CLIENT', client: makeClient(1) });
    expect(next.client?.id).toBe(1);
    expect(next.mapping).toEqual({ jobNumber: 'JOB' });
    expect(next.file).not.toBeNull();
  });

  it('same-id re-selection is a no-op refresh', () => {
    const s: WizardState = {
      ...initialWizardState(),
      client: makeClient(1),
      mapping: { jobNumber: 'JOB' },
    };
    const next = wizardReducer(s, { type: 'SET_CLIENT', client: makeClient(1) });
    expect(next.mapping).toEqual({ jobNumber: 'JOB' });
  });

  it('switching client wipes previous state entirely', () => {
    const s: WizardState = {
      ...initialWizardState(),
      client: makeClient(1),
      mapping: { jobNumber: 'JOB' },
      file: new File(['x'], 'x.csv'),
      speedId: 5,
    };
    const next = wizardReducer(s, { type: 'SET_CLIENT', client: makeClient(2) });
    expect(next.client?.id).toBe(2);
    expect(next.mapping).toEqual({});
    expect(next.file).toBeNull();
    expect(next.speedId).toBe(0);
  });

  it('clearing client (setting null) after having one keeps state', () => {
    const s: WizardState = { ...initialWizardState(), client: makeClient(1) };
    const next = wizardReducer(s, { type: 'SET_CLIENT', client: null });
    expect(next.client).toBeNull();
  });
});

describe('wizardReducer - primitive setters', () => {
  it('SET_FILE writes the file', () => {
    const f = new File(['x'], 'x.csv');
    const next = wizardReducer(initialWizardState(), { type: 'SET_FILE', file: f });
    expect(next.file).toBe(f);
  });

  it('SET_IMPORT_TYPE switches routed <-> onDemand', () => {
    const s1 = wizardReducer(initialWizardState(), { type: 'SET_IMPORT_TYPE', importType: 'onDemand' });
    expect(s1.importType).toBe('onDemand');
    const s2 = wizardReducer(s1, { type: 'SET_IMPORT_TYPE', importType: 'routed' });
    expect(s2.importType).toBe('routed');
  });

  it('SET_PARSED stores the parsed file', () => {
    const parsed = { headers: ['A'], rows: [{ A: '1' }] };
    const next = wizardReducer(initialWizardState(), { type: 'SET_PARSED', parsed });
    expect(next.parsed).toBe(parsed);
  });

  it('SET_MAPPING replaces the mapping wholesale', () => {
    const s = { ...initialWizardState(), mapping: { a: '1' } };
    const next = wizardReducer(s, { type: 'SET_MAPPING', mapping: { b: '2' } });
    expect(next.mapping).toEqual({ b: '2' });
  });

  it('PATCH_MAPPING merges the field into existing mapping', () => {
    const s = { ...initialWizardState(), mapping: { a: '1' } };
    const next = wizardReducer(s, { type: 'PATCH_MAPPING', field: 'b', column: '2' });
    expect(next.mapping).toEqual({ a: '1', b: '2' });
  });

  it('SET_OPTIONS merges partial options', () => {
    const s = initialWizardState();
    const next = wizardReducer(s, {
      type: 'SET_OPTIONS',
      options: { overrideFromContact: 'Bob' },
    });
    expect(next.options.overrideFromContact).toBe('Bob');
    // other options preserved
    expect(next.options.stopType).toBe('mapped');
  });

  it('SET_FIXED_ZIP records the bad -> corrected mapping', () => {
    const s = initialWizardState();
    const next = wizardReducer(s, { type: 'SET_FIXED_ZIP', badZip: '02110', corrected: '02111' });
    expect(next.fixedZips['02110']).toBe('02111');
  });

  it('SET_FIXED_ADDRESS records coords keyed by row index', () => {
    const s = initialWizardState();
    const next = wizardReducer(s, {
      type: 'SET_FIXED_ADDRESS',
      rowIndex: 3,
      coords: { lat: 1, lng: 2 },
    });
    expect(next.fixedAddresses[3]).toEqual({ lat: 1, lng: 2 });
  });

  it('SET_FIXED_FROM_ADDRESS records origin coords keyed by row index', () => {
    const s = initialWizardState();
    const next = wizardReducer(s, {
      type: 'SET_FIXED_FROM_ADDRESS',
      rowIndex: 5,
      coords: { lat: 10, lng: 20 },
    });
    expect(next.fixedFromAddresses[5]).toEqual({ lat: 10, lng: 20 });
  });

  it('SET_SELECTED_REGIONS replaces the set', () => {
    const s = initialWizardState();
    const next = wizardReducer(s, { type: 'SET_SELECTED_REGIONS', regions: new Set(['1', '2']) });
    expect([...next.selectedRegions]).toEqual(['1', '2']);
  });

  it('TOGGLE_REGION adds when absent, removes when present', () => {
    let s = initialWizardState();
    s = wizardReducer(s, { type: 'TOGGLE_REGION', region: '1' });
    expect(s.selectedRegions.has('1')).toBe(true);
    s = wizardReducer(s, { type: 'TOGGLE_REGION', region: '1' });
    expect(s.selectedRegions.has('1')).toBe(false);
    s = wizardReducer(s, { type: 'TOGGLE_REGION', region: '2' });
    expect(s.selectedRegions.has('2')).toBe(true);
  });

  it('SET_RBD_DATE stores the date value (or null)', () => {
    const s = initialWizardState();
    const next = wizardReducer(s, { type: 'SET_RBD_DATE', date: '2026-01-01' });
    expect(next.rateByDistanceDate).toBe('2026-01-01');
    const clear = wizardReducer(next, { type: 'SET_RBD_DATE', date: null });
    expect(clear.rateByDistanceDate).toBeNull();
  });

  it('SET_CLIENT_SETTINGS stores or clears settings', () => {
    const settings = { id: 1 } as any;
    const s = wizardReducer(initialWizardState(), { type: 'SET_CLIENT_SETTINGS', settings });
    expect(s.clientSettings).toBe(settings);
    const cleared = wizardReducer(s, { type: 'SET_CLIENT_SETTINGS', settings: null });
    expect(cleared.clientSettings).toBeNull();
  });

  it('SET_BOOK_DATE / SET_BOOK_TIME / SET_SPEED_ID / SET_SCHEDULE_ID', () => {
    let s = wizardReducer(initialWizardState(), { type: 'SET_BOOK_DATE', date: '2026-06-01' });
    expect(s.bookDate).toBe('2026-06-01');
    s = wizardReducer(s, { type: 'SET_BOOK_TIME', time: '12:34' });
    expect(s.bookTime).toBe('12:34');
    s = wizardReducer(s, { type: 'SET_SPEED_ID', speedId: 7 });
    expect(s.speedId).toBe(7);
    s = wizardReducer(s, { type: 'SET_SCHEDULE_ID', scheduleId: 9 });
    expect(s.scheduleId).toBe(9);
    s = wizardReducer(s, { type: 'SET_SCHEDULE_ID', scheduleId: null });
    expect(s.scheduleId).toBeNull();
  });

  it('SET_ON_HOLD / SET_NATIONWIDE_DOC edit nested options only', () => {
    let s = wizardReducer(initialWizardState(), { type: 'SET_ON_HOLD', value: true });
    expect(s.options.onHold).toBe(true);
    expect(s.options.nationwideDoc).toBe(false);
    s = wizardReducer(s, { type: 'SET_NATIONWIDE_DOC', value: true });
    expect(s.options.nationwideDoc).toBe(true);
    expect(s.options.onHold).toBe(true);
  });

  it('SET_DEPOTS / SET_CURRENT_DEPOT / ADD/RESET_PER_DEPOT_RESULT', () => {
    let s = wizardReducer(initialWizardState(), {
      type: 'SET_DEPOTS',
      depots: [{ depotId: 1, depotName: 'A', jobIndexes: [0] }],
    });
    expect(s.depots).toHaveLength(1);
    s = wizardReducer(s, { type: 'SET_CURRENT_DEPOT', index: 3 });
    expect(s.currentDepotIndex).toBe(3);
    s = wizardReducer(s, {
      type: 'ADD_PER_DEPOT_RESULT',
      result: { depotId: 1, imported: 5, failed: 1 },
    });
    expect(s.perDepotResults).toHaveLength(1);
    s = wizardReducer(s, {
      type: 'ADD_PER_DEPOT_RESULT',
      result: { depotId: 2, imported: 3, failed: 0 },
    });
    expect(s.perDepotResults).toHaveLength(2);
    s = wizardReducer(s, { type: 'RESET_PER_DEPOT_RESULTS' });
    expect(s.perDepotResults).toEqual([]);
  });
});

describe('wizardReducer - km-rated flow', () => {
  it('SET_KMRATED stores rows and pre-ticks every one by default', () => {
    const rows = [{}, {}, {}] as any[];
    const s = wizardReducer(initialWizardState(), { type: 'SET_KMRATED', rows });
    expect(s.kmRatedRows).toEqual(rows);
    expect(s.kmRatedSelected.size).toBe(3);
  });

  it('TOGGLE_KMRATED_ROW flips selection', () => {
    let s = wizardReducer(initialWizardState(), { type: 'SET_KMRATED', rows: [{}, {}] as any });
    s = wizardReducer(s, { type: 'TOGGLE_KMRATED_ROW', index: 0 });
    expect(s.kmRatedSelected.has(0)).toBe(false);
    s = wizardReducer(s, { type: 'TOGGLE_KMRATED_ROW', index: 0 });
    expect(s.kmRatedSelected.has(0)).toBe(true);
  });

  it('SET_ALL_KMRATED_SELECTED true re-ticks all, false empties', () => {
    let s = wizardReducer(initialWizardState(), { type: 'SET_KMRATED', rows: [{}, {}, {}] as any });
    s = wizardReducer(s, { type: 'SET_ALL_KMRATED_SELECTED', selected: false });
    expect(s.kmRatedSelected.size).toBe(0);
    s = wizardReducer(s, { type: 'SET_ALL_KMRATED_SELECTED', selected: true });
    expect(s.kmRatedSelected.size).toBe(3);
  });

  it('SET_KMRATED_CONFIRMED toggles the flag', () => {
    const s = wizardReducer(initialWizardState(), { type: 'SET_KMRATED_CONFIRMED', value: true });
    expect(s.kmRatedConfirmed).toBe(true);
  });

  it('SET_FAILED_IMPORT_JOBS replaces the failed list', () => {
    const jobs = [{ jobNumber: 'A' }, { jobNumber: 'B' }] as any;
    const s = wizardReducer(initialWizardState(), { type: 'SET_FAILED_IMPORT_JOBS', jobs });
    expect(s.failedImportJobs).toEqual(jobs);
  });

  it('SET_PICKUP_JOB stores or clears the pickup payload', () => {
    const payload = { pickupJob: { time: '2026-01-01T00:00' } } as any;
    let s = wizardReducer(initialWizardState(), { type: 'SET_PICKUP_JOB', payload });
    expect(s.pickupJobPayload).toBe(payload);
    s = wizardReducer(s, { type: 'SET_PICKUP_JOB', payload: null });
    expect(s.pickupJobPayload).toBeNull();
  });

  it('APPLY_TEMPLATE overwrites mapping + stamps templateId onto options', () => {
    const s = wizardReducer(initialWizardState(), {
      type: 'APPLY_TEMPLATE',
      templateId: 7,
      mapping: { toAddress: 'Address' },
    });
    expect(s.mapping).toEqual({ toAddress: 'Address' });
    expect(s.options.templateId).toBe(7);
  });
});

describe('urgentFieldsFor', () => {
  it('NZ routed without autogen requires Job Number + To Address + To Contact + To Contact Phone', () => {
    const fields = urgentFieldsFor(false, 'routed', false);
    const requiredKeys = fields.filter((f) => f.required).map((f) => f.key);
    expect(requiredKeys).toContain('jobNumber');
    expect(requiredKeys).toContain('toAddress');
    expect(requiredKeys).toContain('toContact');
    expect(requiredKeys).toContain('toContactPhone');
  });

  it('autogenerate removes Job Number entirely from the field list', () => {
    const fields = urgentFieldsFor(false, 'routed', true);
    expect(fields.find((f) => f.key === 'jobNumber')).toBeUndefined();
  });

  it('on-demand exposes bookDate + bookTime', () => {
    const fields = urgentFieldsFor(false, 'onDemand', false);
    const keys = fields.map((f) => f.key);
    expect(keys).toContain('bookDate');
    expect(keys).toContain('bookTime');
  });

  it('NZ on-demand exposes fromSuburb + fromPostCode', () => {
    const fields = urgentFieldsFor(false, 'onDemand', false);
    const keys = fields.map((f) => f.key);
    expect(keys).toContain('fromSuburb');
    expect(keys).toContain('fromPostCode');
  });

  it('US routed with routeStartsFromClientSite exposes from* fields', () => {
    const fields = urgentFieldsFor(true, 'routed', false, true);
    const keys = fields.map((f) => f.key);
    expect(keys).toContain('fromAddress');
    expect(keys).toContain('fromCity');
    expect(keys).toContain('fromState');
    expect(keys).toContain('fromZipCode');
  });

  it('US routed without routeStartsFromClientSite hides from* address fields', () => {
    const fields = urgentFieldsFor(true, 'routed', false, false);
    const keys = fields.map((f) => f.key);
    expect(keys).not.toContain('fromAddress');
    expect(keys).not.toContain('fromCity');
  });

  it('US on-demand exposes stop type toggle', () => {
    const fields = urgentFieldsFor(true, 'onDemand', false);
    const keys = fields.map((f) => f.key);
    expect(keys).toContain('stopType');
  });

  it('NZ tenant does not expose zip / state / stopType field', () => {
    const fields = urgentFieldsFor(false, 'routed', false);
    const keys = fields.map((f) => f.key);
    expect(keys).not.toContain('toZipCode');
    expect(keys).not.toContain('toState');
    expect(keys).not.toContain('stopType');
  });

  it('client overrides mark refA / refB required and prefix message into label', () => {
    const fields = urgentFieldsFor(false, 'routed', true, false, {
      referenceAMandatory: true,
      referenceAMessage: 'PO Number',
      referenceBMandatory: false,
      referenceBMessage: null,
    });
    const refA = fields.find((f) => f.key === 'clientRefA')!;
    const refB = fields.find((f) => f.key === 'clientRefB')!;
    expect(refA.required).toBe(true);
    expect(refA.label).toBe('Ref A (PO Number)');
    expect(refB.required).toBe(false);
    expect(refB.label).toBe('Ref B');
  });

  it('stockSizeOverridden hides length/width/height/weight rows', () => {
    const fields = urgentFieldsFor(false, 'routed', true, false, undefined, true);
    const keys = fields.map((f) => f.key);
    expect(keys).not.toContain('length');
    expect(keys).not.toContain('weight');
  });
});

describe('autoMatchColumn', () => {
  const field = (key: string, label: string, aliases: string[] = []): UrgentField => ({
    key,
    label,
    aliases,
    showFor: 'both',
  });

  it('exact match on the field key wins', () => {
    expect(autoMatchColumn(field('toAddress', 'To Address'), ['ToAddress', 'Something'])).toBe(
      'ToAddress'
    );
  });

  it('exact match on the stripped key (to/from prefix removed)', () => {
    expect(autoMatchColumn(field('toContact', 'To Contact'), ['Contact'])).toBe('Contact');
  });

  it('exact match on an alias', () => {
    expect(
      autoMatchColumn(field('toContact', 'To Contact', ['Recipient']), ['Recipient'])
    ).toBe('Recipient');
  });

  it('longest alias wins to avoid short-alias hijack', () => {
    // toContactPhone has a longer alias `contactphone` that should beat
    // toContact's shorter `contact` for a header of `ContactPhone`.
    const f = field('toContactPhone', 'To Contact Phone', ['Contact Phone']);
    expect(autoMatchColumn(f, ['ContactPhone'])).toBe('ContactPhone');
  });

  it('startsWith match aligns on from/to prefixes', () => {
    // Header `PickupAddressLine1` shares the `pickupaddress` prefix with
    // the alias `Pickup Address` (both from-prefixed) so startsWith fires.
    expect(
      autoMatchColumn(field('fromAddress', 'From Address', ['Pickup Address']), ['PickupAddressLine1'])
    ).toBe('PickupAddressLine1');
  });

  it('substring match with min length 3 (short aliases like H/W never match)', () => {
    const f = field('height', 'Height', ['H']);
    expect(autoMatchColumn(f, ['Contact'])).toBe('');
  });

  it('from-prefixed field will not match a to-prefixed header', () => {
    const f = field('fromAddress', 'From Address', ['Pickup']);
    // 'DeliveryAddress' has a to-prefix ("delivery"), fromAddress has from-prefix,
    // so prefix-guard blocks the substring match.
    expect(autoMatchColumn(f, ['DeliveryAddress'])).toBe('');
  });

  it('neutral field (no from/to prefix on key) accepts either header side', () => {
    const f = field('weight', 'Weight', ['Wgt']);
    expect(autoMatchColumn(f, ['Weight'])).toBe('Weight');
  });

  it('empty customer columns returns empty string', () => {
    expect(autoMatchColumn(field('foo', 'Foo'), [])).toBe('');
  });

  it('no match returns empty string', () => {
    expect(autoMatchColumn(field('foo', 'Foo', ['Bar']), ['Baz'])).toBe('');
  });
});
