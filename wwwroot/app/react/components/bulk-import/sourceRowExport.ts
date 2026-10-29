import type { BulkImportJobCreateDto, ParsedFile } from '../../services/bulkImportService';

/**
 * Helpers for exporting wizard rows as CSV in the client's own file layout.
 *
 * Tester feedback (2026-09-22): the unmatched and km-rated exports should
 * carry the whole original row (every column, original headers) so the
 * client can fix the address and feed the same file straight back into the
 * importer. Km-rated exports prepend an "Amount" column as column A.
 */

export type CsvCell = string | number | null | undefined;

export const KM_RATED_DISCLAIMER =
  'Amount shown is based on the current booking details as km-rate. ' +
  'Our system will re-evaluate the amount on re-import.';

/**
 * Build CSV rows (header first) from the original parsed file for the given
 * source row indexes. With `amounts`, an "Amount" column is prepended as
 * column A (one entry per rowIndexes entry, blank when null).
 */
export function sourceRowsCsv(
  parsed: ParsedFile,
  rowIndexes: number[],
  amounts?: (number | null | undefined)[]
): CsvCell[][] {
  const withAmount = amounts !== undefined;
  const header: CsvCell[] = withAmount ? ['Amount', ...parsed.headers] : [...parsed.headers];
  const out: CsvCell[][] = [header];
  rowIndexes.forEach((rowIndex, i) => {
    const row = parsed.rows[rowIndex] ?? {};
    const cells: CsvCell[] = parsed.headers.map((h) => row[h] ?? '');
    out.push(withAmount ? [amounts![i] ?? '', ...cells] : cells);
  });
  return out;
}

/**
 * Fallback for a km-rated row that could not be traced back to its source
 * row: lay the server DTO out under the original headers using the column
 * mapping (header -> urgent field). Unmapped columns stay blank.
 */
export function dtoToSourceLayout(
  parsed: ParsedFile,
  mapping: Record<string, string>,
  job: BulkImportJobCreateDto
): CsvCell[] {
  const fieldByHeader = new Map<string, string>();
  for (const [field, header] of Object.entries(mapping)) {
    if (header && !fieldByHeader.has(header)) fieldByHeader.set(header, field);
  }
  return parsed.headers.map((h) => {
    const field = fieldByHeader.get(h);
    if (!field) return '';
    const v = (job as unknown as Record<string, unknown>)[field];
    return v == null ? '' : String(v);
  });
}

const norm = (v: unknown) =>
  (v == null ? '' : String(v)).trim().toLowerCase().replace(/\s+/g, ' ');

// The server stores postcodes as integers, so "0612" comes back as "612".
const normCode = (v: unknown) => norm(v).replace(/[^0-9a-z]/g, '').replace(/^0+/, '');

function looseKey(j: BulkImportJobCreateDto): string {
  return [norm(j.toAddress), normCode(j.toPostCode ?? j.toZipCode)].join('|');
}

function strictKey(j: BulkImportJobCreateDto, includeJobNumber: boolean): string {
  return [
    includeJobNumber ? norm(j.jobNumber) : '',
    norm(j.toCompany),
    looseKey(j),
    norm(j.clientRefA),
    norm(j.clientRefB),
    norm(j.ourRef),
    norm(j.toContact),
  ].join('|');
}

/**
 * The /import response rebuilds km-rated rows from the saved bulk jobs, so
 * they carry no source row index. Match each one back to the job built from
 * the source file (the rows sent for this depot) on the fields the server
 * round-trips unchanged; strict key first, then address + postcode. Each
 * source row is claimed at most once, so duplicate addresses pair up in
 * order. Returns the source row index per km-rated row, or null.
 */
export function matchKmRatedToSourceRows(
  kmRows: BulkImportJobCreateDto[],
  candidates: { rowIndex: number; job: BulkImportJobCreateDto }[]
): (number | null)[] {
  // AUTOGENERATE job numbers are replaced server-side, so they can't match.
  const includeJobNumber = !candidates.some(
    (c) => norm(c.job.jobNumber) === 'autogenerate' || !c.job.jobNumber
  );
  const claimed = new Set<number>();
  const take = (key: (j: BulkImportJobCreateDto) => string, target: string) => {
    const hit = candidates.find((c) => !claimed.has(c.rowIndex) && key(c.job) === target);
    if (!hit) return null;
    claimed.add(hit.rowIndex);
    return hit.rowIndex;
  };
  const result: (number | null)[] = kmRows.map((k) =>
    take((j) => strictKey(j, includeJobNumber), strictKey(k, includeJobNumber))
  );
  return result.map((r, i) => (r != null ? r : take(looseKey, looseKey(kmRows[i]))));
}
