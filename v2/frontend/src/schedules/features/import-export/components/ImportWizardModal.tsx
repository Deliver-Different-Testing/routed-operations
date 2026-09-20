import React, { useState, useCallback, useMemo } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { FileDropzone } from './FileDropzone';
import { ColumnMapper } from './ColumnMapper';
import { ValidationSummary } from './ValidationSummary';
import { ImportConfirmationTabs } from './ImportConfirmationTabs';
import { parseCSV } from '../engine/CSVParser';
import { validateAll } from '../engine/ValidationEngine';
import { diffAll } from '../engine/DiffEngine';
import { processImport } from '../services/importService';
import type { ImportSchema } from '../types/schema.types';
import type { ImportStep, ParsedRow, ImportSummary } from '../types/import.types';
import type { ValidationResult } from '../types/validation.types';

export interface ImportWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  schema: ImportSchema;
  existingData?: Record<string, unknown>[];
  onComplete: (result: {
    created: number;
    updated: number;
    deleted: number;
    errors: number;
  }) => void;
}

const STEP_LABELS = ['File', 'Map', 'Validate', 'Confirm', 'Process', 'Done'];

interface StepIndicatorProps {
  currentStep: number;
  steps: string[];
}

const StepIndicator = React.memo(function StepIndicator({ currentStep, steps }: StepIndicatorProps): React.ReactElement {
  return (
    <div className="flex items-center justify-center gap-2 py-4" role="list" aria-label="Import steps" data-testid="step-indicator">
      {steps.map((step, index) => (
        <React.Fragment key={step}>
          <div
            role="listitem"
            aria-current={index === currentStep ? 'step' : undefined}
            aria-label={`Step ${index + 1}: ${step}${index < currentStep ? ' (completed)' : index === currentStep ? ' (current)' : ''}`}
            className={`
              w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
              ${index < currentStep ? 'bg-green-500 text-white' : ''}
              ${index === currentStep ? 'bg-brand-cyan text-white' : ''}
              ${index > currentStep ? 'bg-gray-200 text-gray-500' : ''}
            `}
          >
            {index < currentStep ? '' : index + 1}
          </div>
          {index < steps.length - 1 && (
            <div className={`w-12 h-0.5 ${index < currentStep ? 'bg-green-500' : 'bg-gray-200'}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
});
StepIndicator.displayName = 'StepIndicator';

export function ImportWizardModal({
  isOpen,
  onClose,
  schema,
  existingData = [],
  onComplete,
}: ImportWizardModalProps): React.ReactElement {
  // State management
  const [step, setStep] = useState<ImportStep>('select-file');
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<{
    headers: string[];
    rows: Record<string, string>[];
  } | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [summary, setSummary] = useState<ImportSummary>({
    total: 0,
    new: 0,
    modified: 0,
    unchanged: 0,
    errors: 0,
    deleted: 0,
  });
  const [, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Get current step index for indicator
  const stepIndex = useMemo(() => {
    const steps: ImportStep[] = ['select-file', 'map-columns', 'validate', 'confirm', 'processing', 'complete'];
    return steps.indexOf(step);
  }, [step]);

  // Handle file selection
  const handleFileSelect = useCallback(async (selectedFile: File) => {
    setFile(selectedFile);
    setError(null);

    try {
      // Read file content
      const content = await selectedFile.text();

      // Parse CSV
      const parseResult = parseCSV(content);

      if (parseResult.rows.length === 0) {
        setError('CSV file is empty or contains no data rows');
        return;
      }

      setParsedData({
        headers: parseResult.headers,
        rows: parseResult.rows,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse CSV file');
    }
  }, []);

  // Handle column mapping change
  const handleMappingChange = useCallback((mapping: Record<string, string>) => {
    setColumnMapping(mapping);
  }, []);

  // Handle next step
  const handleNext = useCallback(async () => {
    if (step === 'select-file') {
      if (!parsedData) {
        setError('Please select a file first');
        return;
      }
      setStep('map-columns');
    } else if (step === 'map-columns') {
      if (!parsedData) return;

      // Apply column mapping to transform data
      const mappedRows = parsedData.rows.map((row) => {
        const mappedRow: Record<string, unknown> = {};

        // Apply mapping
        Object.entries(columnMapping).forEach(([csvColumn, schemaColumn]) => {
          mappedRow[schemaColumn] = row[csvColumn];
        });

        // Add unique key if it doesn't exist (generate ID)
        if (!mappedRow[schema.uniqueKey]) {
          mappedRow[schema.uniqueKey] = schema.generateId();
        }

        return mappedRow;
      });

      // Run validation
      const validation = validateAll(mappedRows, schema);
      setValidationResult(validation);

      // Run diff against existing data
      const diffResult = diffAll(mappedRows, existingData, schema);

      // Create ParsedRow objects
      const rows: ParsedRow[] = mappedRows.map((row, index) => {
        const uniqueValue = String(row[schema.uniqueKey]);
        const diff = diffResult.results.get(uniqueValue);
        const rowValidation = validation.errors.filter((e) => e.row === index + 2);
        const hasErrors = rowValidation.length > 0;

        return {
          rowNumber: index + 2,
          status: hasErrors ? 'error' : diff?.status || 'new',
          data: row,
          validationResult: {
            isValid: !hasErrors,
            errors: rowValidation,
            warnings: validation.warnings.filter((w) => w.row === index + 2),
            autoFixes: [],
          },
          existingRecord: diff?.status === 'modified' ? existingData.find(
            (existing) => String(existing[schema.uniqueKey]) === uniqueValue
          ) : undefined,
          diff: diff?.diffs,
        };
      });

      setParsedRows(rows);

      // Calculate summary
      const newSummary: ImportSummary = {
        total: rows.length,
        new: diffResult.summary.new,
        modified: diffResult.summary.modified,
        unchanged: diffResult.summary.unchanged,
        errors: rows.filter((r) => r.status === 'error').length,
        deleted: diffResult.summary.deleted,
      };
      setSummary(newSummary);

      setStep('validate');
    } else if (step === 'validate') {
      // Only proceed if no errors or user accepts warnings
      if (validationResult && !validationResult.isValid && validationResult.errors.length > 0) {
        setError('Please fix validation errors before continuing');
        return;
      }
      setStep('confirm');
    } else if (step === 'confirm') {
      // Start processing
      setStep('processing');
      setIsProcessing(true);
      setProgress(0);

      try {
        // Process the import using the service
        const result = await processImport({
          schemaId: schema.id,
          uniqueKey: schema.uniqueKey,
          rows: parsedRows,
          onProgress: (progress, _message) => {
            setProgress(progress);
          },
        });

        // Update summary with actual results from processing
        setSummary({
          total: parsedRows.length,
          new: result.created,
          modified: result.updated,
          unchanged: result.unchanged,
          errors: result.errors,
          deleted: result.deleted,
        });

        setIsProcessing(false);
        setStep('complete');
      } catch (err) {
        setIsProcessing(false);
        setError(err instanceof Error ? err.message : 'Import failed');
        setStep('confirm'); // Go back to confirm step on error
      }
    }
  }, [step, parsedData, columnMapping, schema, existingData, validationResult, parsedRows, summary]);

  // Handle back
  const handleBack = useCallback(() => {
    if (step === 'map-columns') {
      setStep('select-file');
    } else if (step === 'validate') {
      setStep('map-columns');
    } else if (step === 'confirm') {
      setStep('validate');
    }
  }, [step]);

  // Handle close
  const handleClose = useCallback(() => {
    if (step === 'processing') {
      return; // Don't allow closing during processing
    }

    // If closing from complete step, call onComplete to notify parent
    if (step === 'complete') {
      onComplete({
        created: summary.new,
        updated: summary.modified,
        deleted: summary.deleted,
        errors: summary.errors,
      });
    }

    // Reset state
    setStep('select-file');
    setFile(null);
    setParsedData(null);
    setColumnMapping({});
    setValidationResult(null);
    setParsedRows([]);
    setSummary({
      total: 0,
      new: 0,
      modified: 0,
      unchanged: 0,
      errors: 0,
      deleted: 0,
    });
    setIsProcessing(false);
    setProgress(0);
    setError(null);

    onClose();
  }, [step, onClose, onComplete, summary]);

  // Render step content
  const renderStepContent = useCallback(() => {
    switch (step) {
      case 'select-file':
        return (
          <div className="space-y-4">
            <FileDropzone onFileSelect={handleFileSelect} error={error || undefined} />
            {file && (
              <div className="text-sm text-text-secondary">
                Selected: <span className="font-medium">{file.name}</span> ({(file.size / 1024).toFixed(2)} KB)
              </div>
            )}
          </div>
        );

      case 'map-columns':
        return parsedData ? (
          <ColumnMapper
            csvHeaders={parsedData.headers}
            schema={schema}
            onMappingChange={handleMappingChange}
          />
        ) : null;

      case 'validate':
        return validationResult ? (
          <ValidationSummary result={validationResult} showDetails={true} />
        ) : null;

      case 'confirm':
        return (
          <ImportConfirmationTabs rows={parsedRows} schema={schema} summary={summary} />
        );

      case 'processing':
        return (
          <div className="space-y-4 py-12">
            <div className="text-center">
              <div className="text-lg font-medium text-text-primary mb-4">
                Processing import...
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3 mb-2">
                <div
                  className="bg-brand-cyan h-3 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="text-sm text-text-secondary">{progress}% complete</div>
            </div>
          </div>
        );

      case 'complete':
        return (
          <div className="space-y-6 py-12">
            <div className="text-center">
              <div className="text-6xl mb-4"></div>
              <div className="text-2xl font-semibold text-text-primary mb-2">Import Complete</div>
              <div className="text-text-secondary">
                {summary.total} record{summary.total !== 1 ? 's' : ''} processed successfully
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
              <div className="border border-border rounded-lg p-4 text-center">
                <div className="text-3xl font-bold text-green-600">{summary.new}</div>
                <div className="text-sm text-text-secondary">Created</div>
              </div>
              <div className="border border-border rounded-lg p-4 text-center">
                <div className="text-3xl font-bold text-brand-cyan">{summary.modified}</div>
                <div className="text-sm text-text-secondary">Updated</div>
              </div>
              {summary.unchanged > 0 && (
                <div className="border border-border rounded-lg p-4 text-center">
                  <div className="text-3xl font-bold text-gray-500">{summary.unchanged}</div>
                  <div className="text-sm text-text-secondary">Unchanged</div>
                </div>
              )}
              {summary.deleted > 0 && (
                <div className="border border-border rounded-lg p-4 text-center">
                  <div className="text-3xl font-bold text-red-600">{summary.deleted}</div>
                  <div className="text-sm text-text-secondary">Deleted</div>
                </div>
              )}
              {summary.errors > 0 && (
                <div className="border border-border rounded-lg p-4 text-center">
                  <div className="text-3xl font-bold text-error">{summary.errors}</div>
                  <div className="text-sm text-text-secondary">Errors</div>
                </div>
              )}
            </div>
          </div>
        );

      default:
        return null;
    }
  }, [step, file, parsedData, validationResult, parsedRows, summary, progress, error, schema, handleFileSelect, handleMappingChange]);

  // Render footer buttons
  const renderFooter = useCallback(() => {
    if (step === 'select-file') {
      return (
        <>
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleNext} disabled={!parsedData}>
            Next
          </Button>
        </>
      );
    }

    if (step === 'map-columns') {
      return (
        <>
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleBack}>
              Back
            </Button>
            <Button onClick={handleNext}>Next</Button>
          </div>
        </>
      );
    }

    if (step === 'validate') {
      const hasErrors = validationResult != null && validationResult.errors.length > 0;
      return (
        <>
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleBack}>
              Back
            </Button>
            <Button onClick={handleNext} disabled={hasErrors}>
              {hasErrors ? 'Fix Errors' : 'Continue'}
            </Button>
          </div>
        </>
      );
    }

    if (step === 'confirm') {
      const changedRecords = summary.new + summary.modified + summary.deleted;
      const buttonText = changedRecords > 0
        ? `Import ${changedRecords} Record${changedRecords !== 1 ? 's' : ''}`
        : `Confirm ${summary.total} Record${summary.total !== 1 ? 's' : ''}`;
      return (
        <>
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleBack}>
              Back
            </Button>
            <Button variant="save" onClick={handleNext}>
              {buttonText}
            </Button>
          </div>
        </>
      );
    }

    if (step === 'processing') {
      return null; // No buttons during processing
    }

    if (step === 'complete') {
      return (
        <Button onClick={handleClose} className="ml-auto">
          Done
        </Button>
      );
    }

    return null;
  }, [step, parsedData, validationResult, summary, handleNext, handleBack, handleClose]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`Import ${schema.label}`}
      variant="right-slide"
      size="xl"
      footer={renderFooter()}
    >
      <StepIndicator currentStep={stepIndex} steps={STEP_LABELS} />
      {renderStepContent()}
    </Modal>
  );
}
