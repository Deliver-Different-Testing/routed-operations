import { describe, expect, it } from 'vitest';
import {
  buildBulkJobsLabelPayload,
  buildRunLabelPayload,
  isRoutedRunId,
  labelFailureText,
  runLabelPayloadIsEmpty,
  toIdCsv,
} from './labelPrint';

// Medical prod, 4 Nov 2026, Burbank to Lab (route 15, run id -15): the grid
// rows carry tucJob ids and bulkJobId 0. Before #855 the button sent the
// bulkJobIds (all 0, so nothing) and the server printed only the two LHP legs.
const burbankRows = [
  { jobId: 17960, bulkJobId: 0 },  // P5543DEL
  { jobId: 20849, bulkJobId: 0 },  // E896WILLLHP
  { jobId: 20858, bulkJobId: 0 },  // E897WILLLHP
];

describe('toIdCsv', () => {
  it('keeps positive distinct integers in order', () => {
    expect(toIdCsv([5, 0, 3, 5, -1, null, undefined, 2.5, 9])).toBe('5,3,9');
  });
  it('is null when nothing usable is left', () => {
    expect(toIdCsv([])).toBeNull();
    expect(toIdCsv([0, 0])).toBeNull();
  });
});

describe('isRoutedRunId', () => {
  it('treats negative run ids as routed runs', () => {
    expect(isRoutedRunId(-15)).toBe(true);
    expect(isRoutedRunId(42)).toBe(false);
    expect(isRoutedRunId(null)).toBe(false);
  });
});

describe('buildRunLabelPayload', () => {
  it('routed run sends the tucJob ids of the rows on screen, not bulkJobIds', () => {
    const p = buildRunLabelPayload({
      runId: -15, runName: 'Burbank to Lab', rows: burbankRows,
      bookDate: '2026-11-04', sortMode: 3, speedIds: [423],
    });
    expect(p).toEqual({
      bookDate: '2026-11-04', sortMode: 3, runName: 'Burbank to Lab',
      jobIds: '17960,20849,20858', bulkJobIds: null,
      clientIds: null, regionIds: null, speedIds: '423',
    });
    expect(runLabelPayloadIsEmpty(-15, p)).toBe(false);
  });

  it('bulk-form run sends bulkJobIds and no jobIds', () => {
    const p = buildRunLabelPayload({
      runId: 812, runName: 'RUN 1', rows: [{ jobId: 1, bulkJobId: 70 }, { jobId: 0, bulkJobId: 71 }],
      bookDate: '2026-11-04', clientIds: [3, 4], regionIds: [9],
    });
    expect(p.jobIds).toBeNull();
    expect(p.bulkJobIds).toBe('70,71');
    expect(p.clientIds).toBe('3,4');
    expect(p.regionIds).toBe('9');
    expect(p.sortMode).toBe(1);
  });

  it('a routed run with no rows on screen is empty, a bulk-form run is not', () => {
    const routed = buildRunLabelPayload({ runId: -15, runName: 'Burbank to Lab', rows: [], bookDate: '2026-11-03' });
    const bulk = buildRunLabelPayload({ runId: 812, runName: 'RUN 1', rows: [], bookDate: '2026-11-03' });
    expect(runLabelPayloadIsEmpty(-15, routed)).toBe(true);
    expect(runLabelPayloadIsEmpty(812, bulk)).toBe(false);
  });
});

describe('buildBulkJobsLabelPayload', () => {
  it('sends the selected bulk jobs as a CSV string, which LabelRequest binds', () => {
    expect(buildBulkJobsLabelPayload('2026-11-04', [1, 2])).toEqual({
      bookDate: '2026-11-04', sortMode: 1, runName: null, jobIds: null,
      bulkJobIds: '1,2', clientIds: null, regionIds: null, speedIds: null,
    });
  });
});

describe('labelFailureText', () => {
  it('shows the nothing-to-print message on its own', () => {
    expect(labelFailureText('Print run failed', 'No labels to print for this run (Burbank to Lab, 3 Nov 2026).'))
      .toBe('No labels to print for this run (Burbank to Lab, 3 Nov 2026).');
  });
  it('keeps the real cause for any other failure', () => {
    expect(labelFailureText('Print run failed', 'Database error: timeout'))
      .toBe('Print run failed: Database error: timeout');
  });
});
