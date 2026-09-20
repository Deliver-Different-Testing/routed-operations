// src/modules/schedules/components/OverrideFieldRow.tsx
import { Toggle } from '../../../components/ui/Toggle';

/** Props for the OverrideFieldRow component. */
interface OverrideFieldRowProps {
  label: string;
  baseValue: React.ReactNode;
  overrideValue: React.ReactNode;
  isOverridden: boolean;
  onToggleOverride: () => void;
  onReset?: () => void;
}

/** Displays a single overridable field row with base/override values and toggle. */
export function OverrideFieldRow({
  label,
  baseValue,
  overrideValue,
  isOverridden,
  onToggleOverride,
  onReset,
}: OverrideFieldRowProps) {
  return (
    <div
      className={`
        grid grid-cols-[180px_1fr_1fr_60px] gap-3 items-start p-3 rounded-lg transition-colors
        ${isOverridden ? 'bg-yellow-50 border border-yellow-200' : 'bg-white border border-border'}
      `}
     data-testid="override-field-row">
      {/* Label */}
      <div className="text-sm font-medium text-text-primary pt-2">{label}</div>

      {/* Base Value (Left) */}
      <div
        className={`px-3 py-2 rounded bg-surface-cream ${!isOverridden ? 'ring-2 ring-brand-cyan/30' : ''}`}
      >
        <div className="text-xs text-text-muted mb-1">Base Value</div>
        <div className="text-sm text-text-secondary">{baseValue}</div>
      </div>

      {/* Override Value (Right) */}
      <div
        className={`px-3 py-2 rounded transition-all ${
          isOverridden
            ? 'bg-white ring-2 ring-yellow-300'
            : 'bg-gray-100 opacity-50 pointer-events-none'
        }`}
      >
        <div className="text-xs text-text-muted mb-1">
          {isOverridden ? 'Override Value' : 'Same as base'}
        </div>
        <div className="text-sm">{isOverridden ? overrideValue : '—'}</div>
      </div>

      {/* Toggle */}
      <div className="flex flex-col items-center gap-1 pt-1">
        <Toggle checked={isOverridden} onChange={onToggleOverride} size="sm" />
        {isOverridden && onReset && (
          <button
            onClick={onReset}
            className="text-xs text-text-muted hover:text-brand-cyan transition-colors" aria-label="Reset override"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
