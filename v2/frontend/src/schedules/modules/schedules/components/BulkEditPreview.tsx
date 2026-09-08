// src/modules/schedules/components/BulkEditPreview.tsx
import { Check, AlertTriangle, XCircle, ChevronRight } from 'lucide-react';
import type { BulkEditPreviewRow } from '../types';

interface BulkEditPreviewProps {
  rows: BulkEditPreviewRow[];
  fieldLabel: string;
  onToggleInclude: (scheduleId: number) => void;
  onViewSchedule: (scheduleId: number) => void;
}

export function BulkEditPreview({
  rows,
  fieldLabel,
  onToggleInclude,
  onViewSchedule,
}: BulkEditPreviewProps) {
  const includedCount = rows.filter((r) => r.included).length;
  const warningCount = rows.filter((r) => r.included && r.warningLevel === 'caution').length;
  const conflictCount = rows.filter((r) => r.included && r.warningLevel === 'conflict').length;

  const getWarningIcon = (level: BulkEditPreviewRow['warningLevel']) => {
    switch (level) {
      case 'ok':
        return <Check className="w-4 h-4 text-green-600" />;
      case 'caution':
        return <AlertTriangle className="w-4 h-4 text-orange-500" />;
      case 'conflict':
        return <XCircle className="w-4 h-4 text-red-500" />;
    }
  };

  const getWarningText = (level: BulkEditPreviewRow['warningLevel']) => {
    switch (level) {
      case 'ok':
        return 'OK';
      case 'caution':
        return 'Caution';
      case 'conflict':
        return 'Conflict';
    }
  };

  return (
    <div className="space-y-3" data-testid="bulk-edit-preview" aria-label="bulk edit preview">
      {/* Header */}
      <div className="text-sm font-medium text-text-primary">
        Preview: {fieldLabel}
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-light">
            <tr className="border-b border-border">
              <th className="w-10 p-2 text-left"></th>
              <th className="p-2 text-left font-medium text-text-muted">Schedule</th>
              <th className="p-2 text-left font-medium text-text-muted">Before</th>
              <th className="p-2 text-left font-medium text-text-muted">After</th>
              <th className="p-2 text-left font-medium text-text-muted">Status</th>
              <th className="w-10 p-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr
                key={row.scheduleId}
                className={`
                  ${!row.included ? 'opacity-50 bg-surface-light' : 'bg-white'}
                  ${row.warningLevel === 'conflict' ? 'bg-red-50' : ''}
                  ${row.warningLevel === 'caution' ? 'bg-orange-50' : ''}
                `}
              >
                <td className="p-2">
                  <input
                    type="checkbox"
                    checked={row.included}
                    onChange={() => onToggleInclude(row.scheduleId)}
                    className="w-4 h-4 rounded border-border text-brand-cyan focus:ring-brand-cyan"
                  />
                </td>
                <td className="p-2 font-medium text-text-primary">
                  {row.scheduleName}
                </td>
                <td className="p-2 text-text-secondary">{row.beforeValue}</td>
                <td className="p-2 text-text-primary font-medium">{row.afterValue}</td>
                <td className="p-2">
                  <div className="flex items-center gap-1.5">
                    {getWarningIcon(row.warningLevel)}
                    <span
                      className={`text-xs ${
                        row.warningLevel === 'ok'
                          ? 'text-green-600'
                          : row.warningLevel === 'caution'
                          ? 'text-orange-600'
                          : 'text-red-600'
                      }`}
                    >
                      {getWarningText(row.warningLevel)}
                    </span>
                  </div>
                  {row.warningMessage && (
                    <div className="text-xs text-text-muted mt-0.5">{row.warningMessage}</div>
                  )}
                </td>
                <td className="p-2">
                  <button
                    onClick={() => onViewSchedule(row.scheduleId)}
                    className="p-1 hover:bg-surface-cream rounded transition-colors"
                    title="View schedule details"
                  >
                    <ChevronRight className="w-4 h-4 text-text-muted" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      <div className="flex items-center gap-4 text-xs text-text-muted">
        <span>{includedCount} selected</span>
        {warningCount > 0 && (
          <span className="text-orange-600">{warningCount} warning{warningCount !== 1 ? 's' : ''}</span>
        )}
        {conflictCount > 0 && (
          <span className="text-red-600">{conflictCount} conflict{conflictCount !== 1 ? 's' : ''}</span>
        )}
      </div>
    </div>
  );
}
