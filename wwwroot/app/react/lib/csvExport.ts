import type { BulkJob } from '../types';

/**
 * Client-side CSV export of the current Jobs list. Matches the columns
 * operators see so pastes into Excel look right. Handles the two common
 * gotchas: values with commas / quotes / newlines get quoted + doubled,
 * and Excel opens UTF-8 CSVs correctly only when a BOM is present.
 */
export function exportJobsToCsv(jobs: BulkJob[], filename?: string): void {
  const columns: { field: keyof BulkJob | 'window'; header: string; get: (j: BulkJob) => string }[] = [
    { field: 'clientCode', header: 'Client', get: (j) => j.clientCode ?? '' },
    { field: 'jobNumber', header: 'Job #', get: (j) => j.jobNumber ?? '' },
    { field: 'bookDate', header: 'Date', get: (j) => j.bookDate ? new Date(j.bookDate).toLocaleDateString('en-GB') : '' },
    { field: 'bookTime', header: 'Time', get: (j) => j.bookTime ?? '' },
    { field: 'toAddress', header: 'To Address', get: (j) => j.toAddress ?? '' },
    { field: 'toSuburb', header: 'To Suburb', get: (j) => j.toSuburb ?? '' },
    { field: 'toPostCode', header: 'To Zip', get: (j) => j.toPostCode?.toString() ?? '' },
    { field: 'courierName', header: 'Courier', get: (j) => j.courierName ?? '' },
    { field: 'speedName', header: 'Speed', get: (j) => j.speedName ?? String(j.speed) },
    { field: 'runName', header: 'Run', get: (j) => j.runName ?? '' },
    { field: 'jobCubicM3', header: 'Cubic m3', get: (j) => j.jobCubicM3?.toString() ?? '' },
    { field: 'amount', header: 'Amount', get: (j) => j.amount?.toString() ?? '' },
    { field: 'window', header: 'Window', get: (j) => {
      if (!j.scheduleWindowStart || !j.scheduleWindowEnd) return '';
      const f = (iso: string) => {
        const d = new Date(iso);
        return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
      };
      return `${f(j.scheduleWindowStart)}-${f(j.scheduleWindowEnd)}`;
    }},
  ];

  const rows = [
    columns.map((c) => c.header),
    ...jobs.map((j) => columns.map((c) => c.get(j))),
  ];

  const csv = rows.map((r) => r.map(quoteCsv).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? `jobs-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function quoteCsv(value: string): string {
  if (value == null) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
