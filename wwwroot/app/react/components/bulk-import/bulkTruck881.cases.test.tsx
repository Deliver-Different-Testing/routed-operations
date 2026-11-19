import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import { SchedulePickerModal } from './SchedulePickerModal';
import { buildJobs } from './NewImportWizard';
import { parseBookDate, parseBookTime } from './bookDateParse';
import { initialWizardState, urgentFieldsFor, type WizardState } from './wizardState';
import type { ClientSettingsDto } from '../../services/clientsService';

// UC #881 cases from the independent review.
// 1. Parser parity table: the SAME inputs and expected outputs as
//    tests/RoutedOperations.Tests/Services/BulkImport/BulkTruckRoutingTests.Cases.cs,
//    so a frontend/server disagreement shows up as a red row on one side.
// 2. Spec test 2: a row with a blank Speed cell takes the defaults-step speed,
//    the others keep their own (buildJobs half; the server half is in the C# file).
// 3. Spec F1 "with the default control disabled" when every row has a value.
// 4. US tenant: no Speed field, no row speed sent.

vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: any) => children,
  Map: ({ children }: any) => children ?? null,
  AdvancedMarker: () => null,
  useMap: () => ({ setCenter: vi.fn(), setZoom: vi.fn() }),
  useMapsLibrary: () => ({}),
}));

// [input, NZ expected, US expected]
const DATE_CASES: [string, string | null, string | null][] = [
  ['13/11/2026', '2026-11-13', '2026-11-13'],
  ['12/11/2026', '2026-11-12', '2026-12-11'],
  ['11/13/2026', '2026-11-13', '2026-11-13'],
  ['1/2/26', '2026-02-01', '2026-01-02'],
  ['13/11/26', '2026-11-13', '2026-11-13'],
  ['13-11-2026', '2026-11-13', '2026-11-13'],
  ['  13/11/2026  ', '2026-11-13', '2026-11-13'],
  ['13/11/2026 0:00', '2026-11-13', '2026-11-13'],
  ['13/11/2026 8:30 AM', '2026-11-13', '2026-11-13'],
  ['2026-11-13', '2026-11-13', '2026-11-13'],
  ['2026-11-13T00:00:00', '2026-11-13', '2026-11-13'],
  ['2026-11-13 08:30:00', '2026-11-13', '2026-11-13'],
  ['29/02/2028', '2028-02-29', '2028-02-29'],
  ['31/02/2026', null, null],
  ['2026-02-29', null, null],
  ['13/13/2026', null, null],
  ['0/11/2026', null, null],
  ['46339', null, null], // Excel serial number: not supported either side
  ['1899-12-31T08:30:00', null, null], // Excel time-only cell
  ['13.11.2026', null, null],
  ['2026/11/13', null, null],
  ['13/11/126', null, null],
  // Month names (review finding 5): English, either order, so NZ and US agree.
  ['Nov 13 2026', '2026-11-13', '2026-11-13'],
  ['13 Nov 2026', '2026-11-13', '2026-11-13'],
  ['13-Nov-2026', '2026-11-13', '2026-11-13'],
  ['13-Nov-26', '2026-11-13', '2026-11-13'],
  ['13 November 2026', '2026-11-13', '2026-11-13'],
  ['13 nov 2026 08:30', '2026-11-13', '2026-11-13'],
  ['1 Sept 2026', '2026-09-01', '2026-09-01'],
  ['Nov 13, 2026', '2026-11-13', '2026-11-13'],
  ['November 13, 2026 8:30 AM', '2026-11-13', '2026-11-13'],
  ['Dec 1, 2026 14:00', '2026-12-01', '2026-12-01'],
  ['29 Feb 2028', '2028-02-29', '2028-02-29'],
  ['31 Feb 2026', null, null],
  ['13 Foo 2026', null, null],
  ['Nov 13, 26', null, null],
  ['13 Nov', null, null],
];

// [input, expected HH:mm]
const TIME_CASES: [string, string | null][] = [
  ['08:30', '08:30'],
  ['8:30', '08:30'],
  [' 08:30 ', '08:30'],
  ['14:00:59', '14:00'],
  ['8:30 am', '08:30'],
  ['8:30 PM', '20:30'],
  ['8:30pm', '20:30'],
  ['12:00 am', '00:00'],
  ['12:15 pm', '12:15'],
  ['1899-12-31T14:00:00', '14:00'],
  ['1899-12-30T14:00:00', '14:00'],
  ['2026-11-13T08:30:00Z', '08:30'],
  ['2026-11-13T08:30:00+13:00', '08:30'],
  ['24:00', null],
  ['13:00 pm', null],
  ['0.3541666', null], // Excel serial time
  ['0830', null],
  ['8.30', null],
  ['noon', null],
];

describe('parser parity table (frontend side)', () => {
  it.each(DATE_CASES)('date %j -> NZ %j, US %j', (input, nz, us) => {
    expect(parseBookDate(input, false)).toBe(nz);
    expect(parseBookDate(input, true)).toBe(us);
  });

  it.each(TIME_CASES)('time %j -> %j', (input, expected) => {
    expect(parseBookTime(input)).toBe(expected);
  });
});

const truckSpeeds = [
  { id: 3, name: 'Standard', code: 'STD', systemName: 'ST', isTruck: false },
  { id: 36, name: 'Economy', code: 'Eco', systemName: 'EC', isTruck: false },
  { id: 52, name: 'Truck Economy', code: 'TECO', systemName: 'TY', isTruck: true },
  { id: 43, name: 'Truck Standard', code: 'TSTD', systemName: 'TS', isTruck: true },
];

function nzOnDemand(rows: Record<string, string>[], patch: Partial<WizardState> = {}): WizardState {
  return {
    ...initialWizardState(),
    importType: 'onDemand',
    bookDate: '2026-11-18',
    bookTime: '09:30',
    speedId: 52,
    clientSettings: { speeds: truckSpeeds } as unknown as ClientSettingsDto,
    parsed: { headers: Object.keys(rows[0]), rows } as WizardState['parsed'],
    mapping: { bookDate: 'Book Date', bookTime: 'Book Time', speed: 'Speed' },
    ...patch,
  };
}

describe('spec test 2: a blank Speed cell takes the default speed (buildJobs)', () => {
  it('truck file: the blank row sends no speed (server uses batch speedId), the others keep theirs', () => {
    const jobs = buildJobs(
      nzOnDemand([
        { 'Book Date': '19/11/2026', 'Book Time': '08:30', Speed: 'Truck Economy' },
        { 'Book Date': '18/11/2026', 'Book Time': '14:00', Speed: '' },
        { 'Book Date': '18/11/2026', 'Book Time': '15:00', Speed: 'Truck Standard' },
      ]),
      false
    );
    expect(jobs.map((j) => j.speed ?? null)).toEqual(['Truck Economy', null, 'Truck Standard']);
  });

  it('NZ P2P file (no truck speed in play): blank row sends no speed, the other keeps its own', () => {
    const jobs = buildJobs(
      nzOnDemand(
        [
          { 'Book Date': '19/11/2026', 'Book Time': '08:30', Speed: 'Economy' },
          { 'Book Date': '19/11/2026', 'Book Time': '09:00', Speed: '' },
        ],
        { speedId: 3, clientSettings: { speeds: [truckSpeeds[0], truckSpeeds[1]] } as unknown as ClientSettingsDto }
      ),
      false
    );
    expect(jobs.map((j) => j.speed ?? null)).toEqual(['Economy', null]);
  });
});

describe('US tenant: Speed is not mapped or sent', () => {
  it('urgentFieldsFor on a US on-demand import has no speed field', () => {
    const keys = urgentFieldsFor(true, 'onDemand', false, false, undefined, false, false).map((f) => f.key);
    expect(keys).not.toContain('speed');
  });

  it('buildJobs on a US tenant sends no row speed even with a Speed mapping left over', () => {
    const jobs = buildJobs(
      nzOnDemand([{ 'Book Date': '12/11/2026', 'Book Time': '08:30', Speed: 'Standard' }], { speedId: 3 }),
      true
    );
    expect(jobs[0].speed ?? null).toBeNull();
    expect(jobs[0].bookDate).toBe('2026-12-11'); // US order kept
  });
});

describe('spec F1 "with the default control disabled"', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-17T09:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  const settings = {
    id: 1, code: 'X', name: 'X', jobPrefix: null, isUsTenant: false, contacts: [],
    speeds: truckSpeeds, stockSizes: [], schedules: [],
    referenceAMandatory: false, referenceAMessage: null, referenceBMandatory: false, referenceBMessage: null,
    createBulkHomeDeliveryPickup: false,
  } as any;

  const rows = [
    { 'Book Date': '19/11/2026', 'Book Time': '08:30', Speed: 'Truck Economy' },
    { 'Book Date': '18/11/2026', 'Book Time': '14:00', Speed: 'Truck Standard' },
  ];

  function render(r: Record<string, string>[], patch: Partial<WizardState> = {}) {
    const noop = vi.fn();
    renderWithProviders(
      <SchedulePickerModal
        open
        state={nzOnDemand(r, {
          speedId: 0,
          clientSettings: settings,
          depots: [{ depotId: 1, depotName: 'Central', jobIndexes: r.map((_, i) => i) }],
          selectedRegions: new Set(['1']),
          ...patch,
        })}
        dispatch={noop}
        onBack={noop}
        onNext={noop}
        onCancel={noop}
      />
    );
  }

  it('every row has a date, time and speed: the three default controls are disabled', () => {
    render(rows);
    expect(screen.getByLabelText(/^Book Date: from file/)).toBeDisabled();
    expect(screen.getByLabelText(/^Book Time: from file/)).toBeDisabled();
    expect(screen.getByLabelText(/^Speed: from file/)).toBeDisabled();
  });

  it('one row is blank: the controls stay enabled as the fallback', () => {
    render([...rows, { 'Book Date': '', 'Book Time': '', Speed: '' }]);
    expect(screen.getByLabelText(/^Book Date: from file/)).toBeEnabled();
    expect(screen.getByLabelText(/^Book Time: from file/)).toBeEnabled();
    expect(screen.getByLabelText(/^Speed: from file/)).toBeEnabled();
  });

  it('a disabled default shows no value, never the stored fallback date or time', () => {
    // State still holds 2026-11-18 09:30 (tomorrow); no row books on it.
    render(rows);
    expect(screen.getByLabelText(/^Book Date: from file/)).toHaveValue('');
    expect(screen.getByLabelText(/^Book Time: from file/)).toHaveValue('');
    expect(screen.getByLabelText(/^Speed: from file/)).toHaveValue('');
  });

  // Decision B: the server books an unknown speed on the batch speed, so the
  // batch speed must be picked before Next, and the control must be usable.
  it('an unknown speed name counts as blank: the speed control is enabled and Next waits for a speed', () => {
    render([rows[0], { ...rows[1], Speed: 'Overnight' }]);
    expect(screen.getByLabelText(/^Speed: from file/)).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('an unknown speed name with a batch speed picked lets Next through', () => {
    render([rows[0], { ...rows[1], Speed: 'Overnight' }], { speedId: 3 });
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('every row names a real speed: Next needs no batch speed', () => {
    render(rows);
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('the from-file speed label names at most three speeds, then +N more', () => {
    const five = ['Standard', 'Economy', 'Truck Economy', 'Truck Standard', 'Overnight']
      .map((Speed) => ({ ...rows[0], Speed }));
    render(five);
    expect(
      screen.getByLabelText('Speed: from file (Standard, Economy, Truck Economy +2 more)')
    ).toBeInTheDocument();
  });

  it('three speeds are listed in full', () => {
    render(['Standard', 'Economy', 'Truck Economy'].map((Speed) => ({ ...rows[0], Speed })));
    expect(screen.getByLabelText('Speed: from file (Standard, Economy, Truck Economy)')).toBeInTheDocument();
  });
});
