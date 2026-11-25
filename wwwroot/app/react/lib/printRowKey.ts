import type { LabelRow } from './labelPrint';

// #880: Print Manager selection key. Bulk rows ('b:<bulkJobId>') print and
// cancel as before; on-demand tucJob rows have bulkJobId 0 and are keyed
// 'j:<jobId>'. The prefix says which table the id is from, so a bulk id and
// a tucJob id with the same number never collide.
export type PrintRowKey = `b:${number}` | `j:${number}`;

export function printRowKey(r: { bulkJobId: number; jobId?: number | null }): PrintRowKey {
  return r.bulkJobId > 0 ? `b:${r.bulkJobId}` : `j:${r.jobId ?? 0}`;
}

export function isOnDemandKey(k: PrintRowKey): boolean {
  return k.startsWith('j:');
}

/** The label row a key prints: { bulkJobId } for bulk, { bulkJobId: 0, jobId } for on-demand. */
export function decodePrintRowKey(k: PrintRowKey): LabelRow & { bulkJobId: number } {
  const id = Number(k.slice(2));
  return isOnDemandKey(k) ? { bulkJobId: 0, jobId: id } : { bulkJobId: id };
}
