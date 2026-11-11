// Builds the POST /api/runviewer/labels/bulk-jobs body (LabelRequest) for
// every Route Viewer label button: Print Run, the run toolbar tag icon, the
// Utility menu Labels entry and Print Manager.
//
// Ticket #855 (Medical prod, Nov 2026): Print Run on a routed run printed a
// different set of jobs from the one on screen. A routed run's grid rows
// carry a tucJob id and bulkJobId 0, so the id list the button sent was
// always empty and the server fell back to searching by route and leg
// number. Routed runs (synthetic negative run id) now send the tucJob ids
// of the rows the grid shows; bulk-form runs keep sending bulkJobIds.
//
// LabelRequest's id fields are CSV strings on the server. An array there
// does not bind, which is why Print Manager and the tag icon never printed.

export interface LabelRow {
  jobId?: number | null;
  bulkJobId?: number | null;
}

export interface LabelPayload {
  bookDate: string | null;
  sortMode: number;
  runName: string | null;
  jobIds: string | null;
  bulkJobIds: string | null;
  clientIds: string | null;
  regionIds: string | null;
  speedIds: string | null;
}

/** Positive, distinct ids as a CSV, or null when there are none. */
export function toIdCsv(ids: ReadonlyArray<number | null | undefined>): string | null {
  const seen = new Set<number>();
  for (const id of ids) {
    if (typeof id === 'number' && Number.isInteger(id) && id > 0) seen.add(id);
  }
  return seen.size > 0 ? Array.from(seen).join(',') : null;
}

/** Route Viewer gives routed runs a synthetic negative id (-RouteId). */
export function isRoutedRunId(runId: number | null | undefined): boolean {
  return typeof runId === 'number' && runId < 0;
}

export interface RunLabelInput {
  runId: number | null;
  runName: string | null;
  rows: ReadonlyArray<LabelRow>;
  bookDate: string;
  sortMode?: number;
  clientIds?: ReadonlyArray<number>;
  regionIds?: ReadonlyArray<number>;
  speedIds?: ReadonlyArray<number>;
}

/** Payload for printing one run's labels from the rows the grid shows. */
export function buildRunLabelPayload(input: RunLabelInput): LabelPayload {
  const routed = isRoutedRunId(input.runId);
  return {
    bookDate: input.bookDate,
    sortMode: input.sortMode ?? 1,
    runName: input.runName ?? null,
    jobIds: routed ? toIdCsv(input.rows.map((r) => r.jobId)) : null,
    bulkJobIds: routed ? null : toIdCsv(input.rows.map((r) => r.bulkJobId)),
    clientIds: toIdCsv(input.clientIds ?? []),
    regionIds: toIdCsv(input.regionIds ?? []),
    speedIds: toIdCsv(input.speedIds ?? []),
  };
}

/** True when a run print has no ids to send. For a routed run that means
 *  nothing to print (sending no ids would fall back to the server-side
 *  route search, the pre-#855 behaviour). A bulk-form run with no rows
 *  still prints by run name, as it always has. */
export function runLabelPayloadIsEmpty(runId: number | null, payload: LabelPayload): boolean {
  return isRoutedRunId(runId) && payload.jobIds == null;
}

/** Payload for an explicit set of bulk jobs on a date (Print Manager). */
export function buildBulkJobsLabelPayload(
  bookDate: string,
  bulkJobIds: ReadonlyArray<number>,
  sortMode = 1,
): LabelPayload {
  return {
    bookDate,
    sortMode,
    runName: null,
    jobIds: null,
    bulkJobIds: toIdCsv(bulkJobIds),
    clientIds: null,
    regionIds: null,
    speedIds: null,
  };
}

/** Text for the toast when a label print fails. "Nothing to print" (the
 *  server's 422) is not an error and is shown as the server words it; any
 *  other failure keeps the "<prefix>: <real cause>" form from 1de3414. */
export const NO_LABELS_MESSAGE = 'No labels to print for this run.';

export function labelFailureText(prefix: string, message: string): string {
  return message.startsWith('No labels to print') ? message : `${prefix}: ${message}`;
}
