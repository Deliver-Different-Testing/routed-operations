import { describe, expect, it, vi } from 'vitest';
import { buildJobs } from './NewImportWizard';
import { initialWizardState, type WizardState } from './wizardState';

vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: any) => children,
  Map: ({ children }: any) => children ?? null,
  AdvancedMarker: () => null,
  useMap: () => ({ setCenter: vi.fn(), setZoom: vi.fn() }),
  useMapsLibrary: () => ({}),
}));

// UC #881. Each on-demand row books on its own Book Date and Book Time. The
// server reads yyyy-MM-dd / HH:mm, so the row's cell is normalised here in the
// tenant's order, and a blank cell takes the defaults-step value. Before this
// the raw cell went up and the server ignored it, so a file with two days
// booked every row on the defaults-step date.
describe('buildJobs per-row Book Date and Book Time', () => {
  const jobsFrom = (rows: Record<string, string>[], isUs = false, overrides: Partial<WizardState> = {}) => {
    const base = initialWizardState();
    const state: WizardState = {
      ...base,
      importType: 'onDemand',
      parsed: { headers: Object.keys(rows[0]), rows } as WizardState['parsed'],
      mapping: { bookDate: 'Ready Date', bookTime: 'Ready Time' },
      bookDate: '2026-11-18',
      bookTime: '09:30',
      ...overrides,
    };
    return buildJobs(state, isUs);
  };

  it("sends her two rows' own dates and times, normalised", () => {
    const jobs = jobsFrom([
      { 'Ready Date': '13/11/2026', 'Ready Time': '8:30 am' },
      { 'Ready Date': '12/11/2026', 'Ready Time': '1899-12-31T14:00:00' },
    ]);
    expect(jobs.map((j) => [j.bookDate, j.bookTime])).toEqual([
      ['2026-11-13', '08:30'],
      ['2026-11-12', '14:00'],
    ]);
  });

  it('reads an ambiguous date in the tenant order', () => {
    expect(jobsFrom([{ 'Ready Date': '12/11/2026', 'Ready Time': '08:00' }], true)[0].bookDate).toBe('2026-12-11');
  });

  it('fills a blank cell from the defaults step', () => {
    const jobs = jobsFrom([
      { 'Ready Date': '', 'Ready Time': '' },
      { 'Ready Date': '20/11/2026', 'Ready Time': '' },
    ]);
    expect(jobs.map((j) => [j.bookDate, j.bookTime])).toEqual([
      ['2026-11-18', '09:30'],
      ['2026-11-20', '09:30'],
    ]);
  });

  it('sends an unreadable cell as it is, so the server refuses that row with a reason', () => {
    const [job] = jobsFrom([{ 'Ready Date': '31/02/2026', 'Ready Time': 'noon' }]);
    expect(job).toMatchObject({ bookDate: '31/02/2026', bookTime: 'noon' });
  });

  it('sends nothing per row when the file has no date or time column', () => {
    const [job] = jobsFrom([{ Ref: 'A1' }], false, { mapping: { jobNumber: 'Ref' } });
    expect(job.bookDate ?? null).toBeNull();
    expect(job.bookTime ?? null).toBeNull();
  });
});
