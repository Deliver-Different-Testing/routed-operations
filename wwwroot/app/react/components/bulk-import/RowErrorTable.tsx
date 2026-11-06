export interface RowError {
  rowNumber: number;
  jobNumber: string | null;
  error: string | null;
}

/** Row, job number and reason. A reason can hold several lines: the proc joins its errors with CRLF. */
export function RowErrorTable({ rows, testId }: { rows: RowError[]; testId?: string }) {
  return (
    <div className="overflow-auto border border-border rounded max-h-72" data-testid={testId}>
      <table className="w-full text-[11px]">
        <thead className="bg-surface-cream text-text-secondary sticky top-0">
          <tr>
            <th className="text-left px-2 py-1">Row</th>
            <th className="text-left px-2 py-1">Job Number</th>
            <th className="text-left px-2 py-1">Error</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-border-light">
              <td className="px-2 py-1 align-top">{row.rowNumber}</td>
              <td className="px-2 py-1 align-top">{row.jobNumber ?? '-'}</td>
              <td className="px-2 py-1 text-error whitespace-pre-line">{row.error}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
