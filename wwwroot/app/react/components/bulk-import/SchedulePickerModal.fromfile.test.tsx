import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import { SchedulePickerModal } from './SchedulePickerModal';
import { fromFileSummary, initialWizardState, type WizardState } from './wizardState';

// UC #881. When the file carries Book Date, Book Time and Speed per row, the
// defaults step says so instead of asking for values it will not use. Each
// control stays as the fallback for rows the file leaves blank, and is only
// required when some row is blank. Before this the operator had to pick a
// speed even though every row named its own, and the step read as if the one
// date picked there applied to the whole file.

const speeds = [
  { id: 52, name: 'Truck Economy', code: 'TECO', isTruck: true },
  { id: 43, name: 'Truck Standard', code: 'TSTD', isTruck: true },
];

function onDemand(rows: Record<string, string>[], overrides: Partial<WizardState> = {}): WizardState {
  return {
    ...initialWizardState(),
    importType: 'onDemand',
    bookDate: '2026-11-18',
    bookTime: '09:30',
    parsed: { headers: Object.keys(rows[0]), rows } as WizardState['parsed'],
    mapping: { bookDate: 'Ready Date', bookTime: 'Ready Time', speed: 'Speed' },
    clientSettings: {
      id: 1, code: 'X', name: 'X', jobPrefix: null, isUsTenant: false, contacts: [],
      speeds, stockSizes: [], schedules: [],
      referenceAMandatory: false, referenceAMessage: null, referenceBMandatory: false, referenceBMessage: null,
      createBulkHomeDeliveryPickup: false,
    } as any,
    depots: [{ depotId: 1, depotName: 'Central', jobIndexes: rows.map((_, i) => i) }],
    selectedRegions: new Set(['1']),
    ...overrides,
  };
}

const herRows = [
  { 'Ready Date': '19/11/2026', 'Ready Time': '08:30', Speed: 'Truck Economy' },
  { 'Ready Date': '18/11/2026', 'Ready Time': '14:00', Speed: 'Truck Standard' },
];

function render(state: WizardState) {
  const noop = vi.fn();
  renderWithProviders(
    <SchedulePickerModal open state={state} dispatch={noop} onBack={noop} onNext={noop} onCancel={noop} />
  );
}

describe('fromFileSummary', () => {
  it('counts the distinct dates and lists the speeds in file order', () => {
    const s = fromFileSummary(onDemand([...herRows, { ...herRows[0] }]), false);
    expect(s.bookDate).toEqual({ mapped: true, dates: 2, anyBlank: false });
    expect(s.bookTime).toEqual({ mapped: true, anyBlank: false });
    expect(s.speed).toEqual({ mapped: true, names: ['Truck Economy', 'Truck Standard'], anyBlank: false });
  });

  it('notes a blank row, and an unmapped column counts as blank', () => {
    const s = fromFileSummary(
      onDemand([herRows[0], { 'Ready Date': '', 'Ready Time': '', Speed: '' }], { mapping: { bookDate: 'Ready Date' } }),
      false
    );
    expect(s.bookDate.anyBlank).toBe(true);
    expect(s.bookTime).toEqual({ mapped: false, anyBlank: true });
    expect(s.speed.mapped).toBe(false);
  });

  it('never reads Speed from the file on a US tenant', () => {
    expect(fromFileSummary(onDemand(herRows), true).speed.mapped).toBe(false);
  });
});

describe('SchedulePickerModal from-file state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-17T09:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('labels each control as coming from the file', () => {
    render(onDemand(herRows));
    expect(screen.getByLabelText('Book Date: from file (2 dates)')).toBeInTheDocument();
    expect(screen.getByLabelText('Book Time: from file')).toBeInTheDocument();
    expect(screen.getByLabelText('Speed: from file (Truck Economy, Truck Standard)')).toBeInTheDocument();
  });

  it('lets Next through with no batch speed when every row has one', () => {
    render(onDemand(herRows, { speedId: 0 }));
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('still asks for a speed when a row has none', () => {
    render(onDemand([herRows[0], { ...herRows[1], Speed: '' }], { speedId: 0 }));
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('lets Next through with no batch date or time when every row has both', () => {
    render(onDemand(herRows, { speedId: 52, bookDate: '', bookTime: '' }));
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('calls it Speed when the file has no speed column', () => {
    render(onDemand(herRows, { mapping: {}, speedId: 0, depots: [] }));
    expect(screen.getByLabelText('Speed')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Select a speed...' })).toBeInTheDocument();
    expect(screen.getByText(/Book Date, Speed & Schedule/)).toBeInTheDocument();
  });
});
