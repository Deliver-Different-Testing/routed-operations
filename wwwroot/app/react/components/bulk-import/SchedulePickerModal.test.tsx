import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import { SchedulePickerModal } from './SchedulePickerModal';
import { initialWizardState, type WizardState } from './wizardState';

function seed(state?: Partial<WizardState>): WizardState {
  return { ...initialWizardState(), ...state };
}

// Pick a stable future weekday (2026-06-15 is a Monday, dayOfWeek=1).
const MONDAY = '2026-06-15';

const speedA = { id: 10, name: 'Standard', code: null };
const speedB = { id: 20, name: 'Express', code: null };

function withSettings(overrides?: Partial<WizardState>): WizardState {
  return seed({
    importType: 'routed',
    bookDate: MONDAY,
    clientSettings: {
      id: 1,
      code: 'X',
      name: 'X',
      jobPrefix: null,
      isUsTenant: false,
      contacts: [],
      speeds: [speedA, speedB],
      stockSizes: [],
      schedules: [
        {
          id: 1,
          name: 'Morning',
          dayOfWeek: 1,
          startTime: '08:00:00',
          cutoffHours: 1,
          speed: speedA,
          depotId: 1,
        },
      ],
      referenceAMandatory: false,
      referenceAMessage: null,
      referenceBMandatory: false,
      referenceBMessage: null,
      createBulkHomeDeliveryPickup: false,
    } as any,
    depots: [{ depotId: 1, depotName: 'Central', jobIndexes: [0] }],
    selectedRegions: new Set(['1']),
    ...overrides,
  });
}

describe('SchedulePickerModal', () => {
  const noop = vi.fn();

  it('renders nothing when open=false', () => {
    renderWithProviders(
      <SchedulePickerModal
        open={false}
        state={seed()}
        dispatch={noop}
        onBack={noop}
        onNext={noop}
        onCancel={noop}
      />
    );
    expect(screen.queryByText(/Book Date/)).not.toBeInTheDocument();
  });

  it('shows the current depot name in the title and renders the Book Date input', () => {
    renderWithProviders(
      <SchedulePickerModal
        open
        state={withSettings()}
        dispatch={noop}
        onBack={noop}
        onNext={noop}
        onCancel={noop}
      />
    );
    expect(screen.getByText(/Central/)).toBeInTheDocument();
    expect(screen.getByLabelText('Book Date')).toBeInTheDocument();
    expect(screen.getByLabelText('Service')).toBeInTheDocument();
  });

  it('filters services to those with a matching (depot, dayOfWeek) schedule', () => {
    renderWithProviders(
      <SchedulePickerModal
        open
        state={withSettings()}
        dispatch={noop}
        onBack={noop}
        onNext={noop}
        onCancel={noop}
      />
    );
    const service = screen.getByLabelText('Service') as HTMLSelectElement;
    const options = Array.from(service.options).map((o) => o.textContent);
    expect(options).toContain('Standard');
    expect(options).not.toContain('Express');
  });

  it('auto-selects the sole matching speed via dispatch', () => {
    const dispatch = vi.fn();
    renderWithProviders(
      <SchedulePickerModal
        open
        state={withSettings()}
        dispatch={dispatch}
        onBack={noop}
        onNext={noop}
        onCancel={noop}
      />
    );
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_SPEED_ID', speedId: 10 });
  });

  it('changing book date dispatches SET_BOOK_DATE', () => {
    const dispatch = vi.fn();
    renderWithProviders(
      <SchedulePickerModal
        open
        state={withSettings()}
        dispatch={dispatch}
        onBack={noop}
        onNext={noop}
        onCancel={noop}
      />
    );
    fireEvent.change(screen.getByLabelText('Book Date'), { target: { value: '2026-06-16' } });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_BOOK_DATE', date: '2026-06-16' });
  });

  it('changing service dispatches SET_SPEED_ID with the new value + clears SCHEDULE_ID', () => {
    const dispatch = vi.fn();
    renderWithProviders(
      <SchedulePickerModal
        open
        state={withSettings({ speedId: 10 })}
        dispatch={dispatch}
        onBack={noop}
        onNext={noop}
        onCancel={noop}
      />
    );
    dispatch.mockClear();
    // Only speedA is in the filtered list (given schedules), so change is a no-op
    // for value. Just verify handler wiring.
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: '' } });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_SPEED_ID', speedId: 0 });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_SCHEDULE_ID', scheduleId: null });
  });

  it('schedule select disabled when speedId=0', () => {
    renderWithProviders(
      <SchedulePickerModal
        open
        state={withSettings({ speedId: 0 })}
        dispatch={noop}
        onBack={noop}
        onNext={noop}
        onCancel={noop}
      />
    );
    const sch = screen.getByLabelText('Schedule') as HTMLSelectElement;
    expect(sch).toBeDisabled();
  });

  it('Cancel / Back buttons wire through', () => {
    const onBack = vi.fn();
    const onCancel = vi.fn();
    renderWithProviders(
      <SchedulePickerModal
        open
        state={withSettings()}
        dispatch={noop}
        onBack={onBack}
        onNext={vi.fn()}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onBack).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('Next disabled when bookDate blank', () => {
    renderWithProviders(
      <SchedulePickerModal
        open
        state={withSettings({ bookDate: '' })}
        dispatch={noop}
        onBack={noop}
        onNext={noop}
        onCancel={noop}
      />
    );
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('on-demand branch: full speed catalogue available + Book Time editable', () => {
    renderWithProviders(
      <SchedulePickerModal
        open
        state={withSettings({ importType: 'onDemand', speedId: 20 })}
        dispatch={noop}
        onBack={noop}
        onNext={noop}
        onCancel={noop}
      />
    );
    const service = screen.getByLabelText('Service') as HTMLSelectElement;
    const options = Array.from(service.options).map((o) => o.textContent);
    expect(options).toContain('Standard');
    expect(options).toContain('Express');
    // Book Time should be editable (not readOnly) for on-demand.
    const bookTime = screen.getByLabelText('Book Time') as HTMLInputElement;
    expect(bookTime).not.toHaveAttribute('readOnly');
  });

  it('on-demand shows On Hold + Nationwide Doc checkboxes when depot is non-Auckland', () => {
    renderWithProviders(
      <SchedulePickerModal
        open
        state={withSettings({
          importType: 'onDemand',
          depots: [{ depotId: 1, depotName: 'Wellington', jobIndexes: [0] }],
          speedId: 10,
        })}
        dispatch={noop}
        onBack={noop}
        onNext={noop}
        onCancel={noop}
      />
    );
    expect(screen.getByText(/On Hold/)).toBeInTheDocument();
    expect(screen.getByText(/Nationwide Doc/)).toBeInTheDocument();
  });

  it('on-demand hides Nationwide Doc when depot name contains "auckland"', () => {
    renderWithProviders(
      <SchedulePickerModal
        open
        state={withSettings({
          importType: 'onDemand',
          depots: [{ depotId: 1, depotName: 'Auckland Central', jobIndexes: [0] }],
          speedId: 10,
        })}
        dispatch={noop}
        onBack={noop}
        onNext={noop}
        onCancel={noop}
      />
    );
    expect(screen.queryByText(/Nationwide Doc/)).not.toBeInTheDocument();
  });
});
