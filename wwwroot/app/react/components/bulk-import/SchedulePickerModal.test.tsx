import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  // Pin the clock to the Wednesday before MONDAY so the fixture schedules
  // are genuinely still open for booking. Without this the suite runs
  // against the real date, MONDAY is long past, and every schedule is
  // correctly filtered out by the booking cutoff - which is what these
  // tests used to rely on NOT happening.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10, 9, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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
  // Regression, Urgent staging 2026-10-29: "Hawkes Bay Afternoons (Parcel
  // Only)" starts at 12:00 with cutoffHours 22, so booking it for tomorrow
  // closes at 14:00 TODAY. The picker used to apply the cutoff only when the
  // book date was today, offered the schedule anyway, and the operator got a
  // bare HTTP 500-shaped failure from the server's "Schedule cutoff
  // exceeded." check. A schedule the server will refuse must not be listed.
  describe('cutoff that reaches back past midnight', () => {
    const lateSchedule = {
      id: 7,
      name: 'Hawkes Bay Afternoons',
      dayOfWeek: 1,
      startTime: '12:00:00',
      cutoffHours: 22,
      speed: speedA,
      depotId: 1,
    };

    function renderAt(localNow: Date) {
      vi.useFakeTimers();
      vi.setSystemTime(localNow);
      const state = withSettings({ speedId: speedA.id });
      (state.clientSettings as any).schedules = [lateSchedule];
      renderWithProviders(
        <SchedulePickerModal
          open
          state={state}
          dispatch={noop}
          onBack={noop}
          onNext={noop}
          onCancel={noop}
        />
      );
      return screen.getByLabelText('Schedule') as HTMLSelectElement;
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('offers the schedule while the cutoff is still ahead', () => {
      // Cutoff is 2026-06-14 14:00 for a 2026-06-15 12:00 run.
      const sch = renderAt(new Date(2026, 5, 14, 13, 59));
      expect([...sch.options].map((o) => o.text)).toContain('Hawkes Bay Afternoons');
    });

    it('hides the schedule once the cutoff has passed, even though the book date is tomorrow', () => {
      const sch = renderAt(new Date(2026, 5, 14, 14, 1));
      expect([...sch.options].map((o) => o.text)).not.toContain('Hawkes Bay Afternoons');
    });
  });
  // Kevin 2026-10-29: a service whose schedules have all closed must not be
  // offered either, and the operator has to be told why the list shrank
  // rather than being left to guess.
  describe('cutoff applied to the Service list, with an on-screen reason', () => {
    const speedC = { id: 30, name: 'Afternoon', code: null };

    // Both start 12:00 with 22 hours notice, so booking MONDAY closes
    // 2026-06-14 14:00. speedA's other schedule starts 08:00 with 1 hour
    // notice, so it closes 2026-06-15 07:00 and stays open far longer.
    const closing = {
      id: 7, name: 'Afternoon run', dayOfWeek: 1, startTime: '12:00:00',
      cutoffHours: 22, speed: speedC, depotId: 1,
    };
    const stayingOpen = {
      id: 8, name: 'Morning run', dayOfWeek: 1, startTime: '08:00:00',
      cutoffHours: 1, speed: speedA, depotId: 1,
    };

    function renderAt(localNow: Date, scheduleRows: unknown[]) {
      vi.useFakeTimers();
      vi.setSystemTime(localNow);
      const state = withSettings();
      (state.clientSettings as any).schedules = scheduleRows;
      renderWithProviders(
        <SchedulePickerModal
          open
          state={state}
          dispatch={noop}
          onBack={noop}
          onNext={noop}
          onCancel={noop}
        />
      );
      return screen.getByLabelText('Service') as HTMLSelectElement;
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('drops a service once every schedule behind it has closed', () => {
      const service = renderAt(new Date(2026, 5, 14, 14, 1), [closing, stayingOpen]);
      const names = [...service.options].map((o) => o.text);
      expect(names).not.toContain('Afternoon');
      expect(names).toContain('Standard');
    });

    it('still offers that service while its cutoff is ahead', () => {
      const service = renderAt(new Date(2026, 5, 14, 13, 59), [closing, stayingOpen]);
      expect([...service.options].map((o) => o.text)).toContain('Afternoon');
    });

    it('names the cutoff that removed it instead of silently shrinking the list', () => {
      renderAt(new Date(2026, 5, 14, 14, 1), [closing, stayingOpen]);
      const notice = screen.getByTestId('sp-cutoff-notice');
      expect(notice.textContent).toContain('14/06 14:00');
      expect(notice.textContent).toContain('not listed');
    });

    it('says booking has closed and tells the operator what to do when nothing is left', () => {
      const service = renderAt(new Date(2026, 5, 14, 14, 1), [closing]);
      expect(service.options[0].text).toBe('Booking has closed for this date.');
      const notice = screen.getByTestId('sp-cutoff-notice');
      expect(notice.textContent).toContain('closed at 14/06 14:00');
      expect(notice.textContent).toContain('Choose a later book date');
    });

    it('shows no notice at all when nothing was removed', () => {
      renderAt(new Date(2026, 5, 14, 13, 59), [stayingOpen]);
      expect(screen.queryByTestId('sp-cutoff-notice')).not.toBeInTheDocument();
    });
  });
  // Kevin 2026-10-29: every error has to be visible. The toast carrying the
  // server's reason auto-dismisses after 4s, which is not long enough to
  // read a list of clashing job numbers, so the reason also lives on the
  // step the operator is still looking at.
  describe('last import rejection', () => {
    it('shows the server reason and keeps it on screen', () => {
      renderWithProviders(
        <SchedulePickerModal
          open
          state={withSettings({
            importError: 'These job number(s) already exist for this date: WN5730330,WN5730380',
          })}
          dispatch={noop}
          onBack={noop}
          onNext={noop}
          onCancel={noop}
        />
      );
      const err = screen.getByTestId('sp-import-error');
      expect(err.textContent).toContain('Import failed:');
      expect(err.textContent).toContain('already exist for this date');
      expect(err.getAttribute('role')).toBe('alert');
    });

    it('shows nothing when the last attempt did not fail', () => {
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
      expect(screen.queryByTestId('sp-import-error')).not.toBeInTheDocument();
    });
  });
});
