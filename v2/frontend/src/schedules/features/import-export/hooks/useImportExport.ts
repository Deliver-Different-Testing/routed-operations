import { useState, useCallback, useMemo, useEffect } from 'react';
import type { ImportSchema, ImportStep, ImportSummary, ParsedRow, ValidationResult } from '../types';
import { useCSVParser } from './useCSVParser';
import { useValidation } from './useValidation';
import { generateCSV, generateTemplate, downloadCSV, diffAll, validateRow } from '../engine';

export interface UseImportExportOptions {
  schema: ImportSchema;
  existingData?: Record<string, unknown>[];
  onImportComplete?: (result: ImportSummary) => void;
}

export interface UseImportExportReturn {
  // State
  step: ImportStep;
  file: File | null;
  parsedData: { headers: string[]; rows: Record<string, string>[] } | null;
  columnMapping: Record<string, string>;
  parsedRows: ParsedRow[];
  summary: ImportSummary;
  isProcessing: boolean;
  progress: number;
  error: string | null;

  // From child hooks
  validationResult: ValidationResult | null;
  isValidating: boolean;
  canProceed: boolean;

  // Actions
  setFile: (file: File | null) => void;
  setColumnMapping: (mapping: Record<string, string>) => void;
  goToStep: (step: ImportStep) => void;
  nextStep: () => void;
  prevStep: () => void;
  downloadData: (data: Record<string, unknown>[]) => void;
  downloadTemplate: () => void;
  executeImport: () => Promise<void>;
  reset: () => void;
}

/**
 * Orchestrates the full CSV import flow: file parsing → validation → diff → confirmation.
 * Composes `useCSVParser` and `useValidation` internally.
 *
 * @param options - Schema, existing data, and completion callback.
 * @returns Step state, parsed data, actions (uploadFile, goBack, confirm, etc.), and export utilities.
 *
 * @example
 * ```tsx
 * function ImportWizard() {
 *   const { step, uploadFile, goBack, confirm, downloadTemplate } = useImportExport({
 *     schema: clientSchema,
 *     existingData: currentClients,
 *     onImportComplete: (summary) => toast(`Imported ${summary.created} records`),
 *   });
 *
 *   if (step === 'upload') return <FileDropzone onFile={uploadFile} />;
 *   if (step === 'confirm') return <button onClick={confirm}>Import</button>;
 * }
 * ```
 */
export function useImportExport({
  schema,
  existingData = [],
  onImportComplete,
}: UseImportExportOptions): UseImportExportReturn {
  // Core state
  const [step, setStep] = useState<ImportStep>('select-file');
  const [file, setFileState] = useState<File | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Child hooks
  const csvParser = useCSVParser({
    onSuccess: () => {
      // Auto-transition to map-columns when file is parsed
      setStep('map-columns');
    },
    onError: (err) => {
      setError(err);
    },
  });

  const validation = useValidation({
    onComplete: () => {
      // Validation complete - transition handled manually
    },
  });

  // Build parsed rows when validation completes and we have column mapping
  useEffect(() => {
    if (!csvParser.result || !validation.result || Object.keys(columnMapping).length === 0) {
      return;
    }

    // Map CSV rows to schema columns using columnMapping
    const mappedRows = csvParser.result.rows.map((row) => {
      const mapped: Record<string, unknown> = {};
      for (const [schemaKey, csvHeader] of Object.entries(columnMapping)) {
        mapped[schemaKey] = row[csvHeader];
      }
      return mapped;
    });

    // Get id field from schema
    const idField = schema.columns.find(col => col.locked)?.key || 'id';

    // Run diff against existing data
    const diffResult = diffAll(mappedRows, existingData, schema);

    // Build ParsedRow array with validation results
    const newParsedRows: ParsedRow[] = mappedRows.map((row, index) => {
      const rowId = String(row[idField] || '');
      const diff = diffResult.results.get(rowId);

      // Get validation for this specific row
      const rowValidation = validateRow(row, schema, index + 1);

      return {
        rowNumber: index + 1,
        status: rowValidation.isValid ? (diff?.status || 'new') : 'error',
        data: row,
        validationResult: rowValidation,
        existingRecord: diff?.status === 'modified' || diff?.status === 'unchanged'
          ? existingData.find(existing => String(existing[idField]) === rowId)
          : undefined,
        diff: diff?.diffs,
      };
    });

    setParsedRows(newParsedRows);
  }, [csvParser.result, validation.result, columnMapping, existingData, schema]);

  // Summary calculation
  const summary = useMemo<ImportSummary>(() => {
    return {
      total: parsedRows.length,
      new: parsedRows.filter(r => r.status === 'new').length,
      modified: parsedRows.filter(r => r.status === 'modified').length,
      unchanged: parsedRows.filter(r => r.status === 'unchanged').length,
      errors: parsedRows.filter(r => r.status === 'error').length,
      deleted: parsedRows.filter(r => r.status === 'delete').length,
    };
  }, [parsedRows]);

  // File setter with auto-parse
  const setFile = useCallback((newFile: File | null) => {
    setFileState(newFile);
    if (newFile) {
      csvParser.parseFile(newFile);
    } else {
      csvParser.reset();
      setStep('select-file');
    }
  }, [csvParser]);

  // Download handlers
  const downloadData = useCallback((data: Record<string, unknown>[]) => {
    const csv = generateCSV(data, schema);
    downloadCSV(csv, `${schema.id}-export-${Date.now()}.csv`);
  }, [schema]);

  const downloadTemplate = useCallback(() => {
    const csv = generateTemplate(schema, { includeHintRow: true });
    downloadCSV(csv, `${schema.id}-template.csv`);
  }, [schema]);

  // Step navigation
  const nextStep = useCallback(() => {
    const steps: ImportStep[] = ['select-file', 'map-columns', 'validate', 'confirm', 'processing', 'complete'];
    const currentIndex = steps.indexOf(step);
    if (currentIndex < steps.length - 1) {
      const nextStepValue = steps[currentIndex + 1];

      // Trigger validation when moving to validate step
      if (nextStepValue === 'validate' && csvParser.result) {
        // Map CSV rows using column mapping
        const mappedRows = csvParser.result.rows.map((row) => {
          const mapped: Record<string, unknown> = {};
          for (const [schemaKey, csvHeader] of Object.entries(columnMapping)) {
            mapped[schemaKey] = row[csvHeader];
          }
          return mapped;
        });

        validation.validate(mappedRows, schema);
      }

      setStep(nextStepValue);
    }
  }, [step, csvParser.result, columnMapping, schema, validation]);

  const prevStep = useCallback(() => {
    const steps: ImportStep[] = ['select-file', 'map-columns', 'validate', 'confirm', 'processing', 'complete'];
    const currentIndex = steps.indexOf(step);
    if (currentIndex > 0) {
      setStep(steps[currentIndex - 1]);
    }
  }, [step]);

  // Execute import (simulated for now)
  const executeImport = useCallback(async () => {
    setIsProcessing(true);
    setStep('processing');
    setError(null);

    try {
      // Simulate progress
      for (let i = 0; i <= 100; i += 10) {
        await new Promise(r => setTimeout(r, 100));
        setProgress(i);
      }

      setStep('complete');
      onImportComplete?.(summary);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Import failed';
      setError(errorMsg);
      setStep('confirm'); // Go back to confirm step on error
    } finally {
      setIsProcessing(false);
    }
  }, [summary, onImportComplete]);

  // Reset all state
  const reset = useCallback(() => {
    setStep('select-file');
    setFileState(null);
    setColumnMapping({});
    setParsedRows([]);
    setIsProcessing(false);
    setProgress(0);
    setError(null);
    csvParser.reset();
    validation.reset();
  }, [csvParser, validation]);

  return {
    // State
    step,
    file,
    parsedData: csvParser.result ? {
      headers: csvParser.result.headers,
      rows: csvParser.result.rows
    } : null,
    columnMapping,
    parsedRows,
    summary,
    isProcessing,
    progress,
    error: error || csvParser.error,

    // From child hooks
    validationResult: validation.result,
    isValidating: validation.isValidating,
    canProceed: validation.canProceed,

    // Actions
    setFile,
    setColumnMapping,
    goToStep: setStep,
    nextStep,
    prevStep,
    downloadData,
    downloadTemplate,
    executeImport,
    reset,
  };
}
