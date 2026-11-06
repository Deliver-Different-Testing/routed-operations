// Shapes the rows for POST /bulk-import/reference-check and words what comes back.
// The rule itself lives on the server (ClientReferenceRule), so every screen shows
// the same refusal the booking proc gives.
import type { BulkReferenceCheckError, BulkReferenceCheckRow } from '../../services/bulkImportService';

// Case-insensitive column lookup used by every "get value from row" call.
// Mirrors homeControl.js:4803-4821 getStaffJobFieldValue.
export function pickRowValue(row: Record<string, string>, candidates: string[]): string | null {
  for (const c of candidates) {
    if (row[c] != null && row[c] !== '') return row[c];
  }
  // Case-insensitive fallback.
  const lowered = candidates.map((c) => c.toLowerCase());
  for (const key of Object.keys(row)) {
    if (lowered.includes(key.toLowerCase()) && row[key] != null && row[key] !== '') {
      return row[key];
    }
  }
  return null;
}

// The same columns BulkImportStaffImport.cs reads, in the same order.
export const STAFF_CLIENT_ID_KEYS = ['ClientID', 'ClientId', 'Client_ID', 'clientid'];
export const STAFF_CLIENT_CODE_KEYS = ['ClientCode', 'Client_Code', 'clientcode'];
export const STAFF_REF_A_KEYS = ['ClientRefA', 'Client Ref A', 'clientrefa', 'Ref A', 'Reference A'];
export const STAFF_REF_B_KEYS = ['ClientRefB', 'Client Ref B', 'clientrefb', 'Ref B', 'Reference B'];
export const STAFF_JOB_NUMBER_KEYS = ['JobNumber', 'Job Number', 'jobnumber'];

// The server trims these cells and takes the first column with a value.
function firstFilled(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = String(pickRowValue(row, [key]) ?? '').trim();
    if (value) return value;
  }
  return '';
}

/** Staff Import rows for the check. rowNumber is the 1-based row the import reports. */
export function staffReferenceRows(rows: Record<string, string>[]): BulkReferenceCheckRow[] {
  return rows.map((row, i) => {
    const id = Math.trunc(Number(firstFilled(row, STAFF_CLIENT_ID_KEYS)));
    return {
      rowNumber: i + 1,
      clientId: Number.isFinite(id) && id > 0 ? id : null,
      clientCode: firstFilled(row, STAFF_CLIENT_CODE_KEYS) || null,
      referenceA: firstFilled(row, STAFF_REF_A_KEYS),
      referenceB: firstFilled(row, STAFF_REF_B_KEYS),
    };
  });
}

/** New Import rows for one client, read through the operator's column mapping. */
export function mappedReferenceRows(
  rows: Record<string, string>[],
  mapping: Record<string, string>,
  clientId: number
): BulkReferenceCheckRow[] {
  const cell = (row: Record<string, string>, key: string) => {
    const column = mapping[key];
    return column ? String(row[column] ?? '') : '';
  };
  return rows.map((row, i) => ({
    rowNumber: i + 1,
    clientId,
    referenceA: cell(row, 'clientRefA'),
    referenceB: cell(row, 'clientRefB'),
  }));
}

/** What the Staff Import preview says above its error table. */
export function refusedRowsNotice(refused: number, total: number): string {
  if (refused >= total) {
    return 'Every row would be refused, so there is nothing to import. Fix the file and upload it again.';
  }
  const rows = refused === 1 ? '1 row' : `${refused} rows`;
  return `${rows} will be refused. The other ${total - refused} will import.`;
}

/** The New Import mapping step's list of refused records. */
export function referenceErrorLines(errors: BulkReferenceCheckError[], limit = 5): string[] {
  const lines = errors.slice(0, limit).map((e) => `Record ${e.rowNumber}: ${e.error}`);
  if (errors.length > limit) lines.push(`...and ${errors.length - limit} more.`);
  return lines;
}
