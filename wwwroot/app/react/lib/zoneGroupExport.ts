import type { PostcodeGroupZone } from '../services/territoryService';

/**
 * Z3 (2026-11-12): a zone group's postcodes as CSV rows, header first.
 * Columns are exactly Zone,Postcode,Suburb, sorted by zone then postcode.
 * Codes arrive D4-padded from the detail endpoint, so a plain compare of
 * the code orders them the way they read. Escaping and the BOM are left to
 * downloadCsv / rowsToCsv in csvExport.ts.
 */
export function zoneGroupCsvRows(zones: PostcodeGroupZone[]): string[][] {
  const body = zones
    .flatMap((z) => z.members.map((m) => ({ zone: z.zone, code: m.code, suburb: m.suburb ?? '' })))
    .sort((a, b) => a.zone - b.zone || a.code.localeCompare(b.code, undefined, { numeric: true }));
  return [
    ['Zone', 'Postcode', 'Suburb'],
    // r1: zone 0 is a US ZIP stored with no zone; blank is how the upload
    // reads "no zone" back.
    ...body.map((r) => [r.zone > 0 ? String(r.zone) : '', r.code, r.suburb]),
  ];
}

/**
 * `<group name>-postcodes-<yyyy-MM-dd>.csv`, local date. Characters a file
 * name cannot hold become '-'; a group with no name falls back to its id.
 */
export function zoneGroupCsvFileName(groupName: string | null, groupId: number, today: Date = new Date()): string {
  const name = (groupName ?? '').trim().replace(/[\\/:*?"<>|]/g, '-') || `group-${groupId}`;
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return `${name}-postcodes-${yyyy}-${mm}-${dd}.csv`;
}

/**
 * Nit 3 (review 20 Nov): the text of an uploaded CSV. UTF-8 first, strictly,
 * so a real UTF-8 file (Excel's "CSV UTF-8", or the export itself) keeps its
 * macrons; its BOM is dropped. A file that is not valid UTF-8 is Excel's
 * plain "CSV (Comma delimited)", saved in the Windows code page, and is read
 * as Windows-1252 rather than turning each accented byte into U+FFFD.
 * Windows-1252 has no macron letters, so such a file cannot carry one.
 */
export function decodeCsvBytes(bytes: ArrayBuffer | Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
