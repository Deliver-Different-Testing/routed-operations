import React, { memo, useState } from 'react';
import { AlertCircle, AlertTriangle, Info, CheckCircle, ChevronDown, ChevronUp } from 'lucide-react';
import type { ValidationResult, FieldError } from '../types';

export interface ValidationSummaryProps {
  result: ValidationResult;
  showDetails?: boolean;        // Default false - show expandable details
  maxErrors?: number;           // Max errors to show (default 10)
  className?: string;
}

interface ErrorCardProps {
  error: FieldError;
}

const ErrorCard = memo(function ErrorCard({ error }: ErrorCardProps): React.ReactElement {
  return (
    <div className="border rounded-lg p-3 bg-surface-light">
      <div className="font-medium text-sm">
        Row {error.row}, Column "{error.column}"
      </div>
      <div className="text-sm text-text-secondary mt-1">
        {error.message}
      </div>
      {error.suggestedFix !== undefined && (
        <div className="text-sm text-green-600 mt-1">
          Suggested: {String(error.suggestedFix)}
        </div>
      )}
    </div>
  );
});

interface SummaryCardProps {
  icon: React.ReactNode;
  count: number;
  label: string;
  bgColor: string;
  borderColor: string;
  textColor: string;
}

const SummaryCard = memo(function SummaryCard({ icon, count, label, bgColor, borderColor, textColor }: SummaryCardProps): React.ReactElement {
  return (
    <div className={`border ${borderColor} ${bgColor} rounded-lg p-4 flex items-center gap-3`}>
      <div className={textColor}>
        {icon}
      </div>
      <div>
        <div className={`text-2xl font-bold ${textColor}`}>
          {count}
        </div>
        <div className={`text-sm ${textColor}`}>
          {label}
        </div>
      </div>
    </div>
  );
});

/**
 * Displays validation results with summary cards and expandable error details.
 * Uses `role="alert"` when errors are present for screen-reader announcements.
 */
export function ValidationSummary({
  result,
  showDetails = false,
  maxErrors = 10,
  className = ''
}: ValidationSummaryProps): React.ReactElement {
  const [isExpanded, setIsExpanded] = useState(showDetails);

  const errorCount = result.errors.length;
  const warningCount = result.warnings.length;
  const infoCount = result.infos.length;
  const autoFixedCount = result.autoFixed;

  const hasAnyIssues = errorCount > 0 || warningCount > 0 || infoCount > 0;
  const allItems = [...result.errors, ...result.warnings, ...result.infos];
  const displayedItems = allItems.slice(0, maxErrors);
  const remainingCount = allItems.length - displayedItems.length;

  // Empty state - all valid
  if (result.isValid && !hasAnyIssues) {
    return (
      <div className={`border border-green-200 bg-green-50 rounded-lg p-6 ${className}`}>
        <div className="flex items-center gap-2 text-green-700">
          <CheckCircle className="w-5 h-5" />
          <span className="font-medium">All rows validated successfully</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`border border-border rounded-lg ${className}`} data-testid="validation-summary" aria-label="validation summary" role={errorCount > 0 ? 'alert' : undefined}>
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <h3 className="text-lg font-semibold text-text-primary">Validation Results</h3>
      </div>

      {/* Summary Cards */}
      <div className="p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Errors */}
          <SummaryCard
            icon={<AlertCircle className="w-6 h-6" />}
            count={errorCount}
            label="Errors"
            bgColor="bg-red-50"
            borderColor="border-red-200"
            textColor="text-red-700"
          />

          {/* Warnings */}
          <SummaryCard
            icon={<AlertTriangle className="w-6 h-6" />}
            count={warningCount}
            label="Warnings"
            bgColor="bg-orange-50"
            borderColor="border-orange-200"
            textColor="text-orange-700"
          />

          {/* Info */}
          <SummaryCard
            icon={<Info className="w-6 h-6" />}
            count={infoCount}
            label="Info"
            bgColor="bg-blue-50"
            borderColor="border-blue-200"
            textColor="text-blue-700"
          />

          {/* Auto-fixed */}
          <SummaryCard
            icon={<CheckCircle className="w-6 h-6" />}
            count={autoFixedCount}
            label="Auto-fix"
            bgColor="bg-green-50"
            borderColor="border-green-200"
            textColor="text-green-700"
          />
        </div>

        {/* Expandable Details Section */}
        {hasAnyIssues && (
          <div className="mt-6">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-2 text-sm font-medium text-text-primary hover:text-brand-dark transition-colors"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="w-4 h-4" />
                  Hide Details
                </>
              ) : (
                <>
                  <ChevronDown className="w-4 h-4" />
                  Show Error Details
                </>
              )}
            </button>

            {isExpanded && (
              <div className="mt-4 space-y-3">
                {displayedItems.map((item, index) => (
                  <ErrorCard key={index} error={item} />
                ))}

                {remainingCount > 0 && (
                  <div className="text-sm text-text-secondary pt-2">
                    + {remainingCount} more {remainingCount === 1 ? 'error' : 'errors'}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
