import type { RowValidationResult } from './validation.types';

export type ImportRowStatus = 'new' | 'modified' | 'unchanged' | 'error' | 'delete';

export interface FieldDiff {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  type: 'added' | 'changed' | 'removed';
}

export interface ParsedRow {
  rowNumber: number;
  status: ImportRowStatus;
  data: Record<string, unknown>;
  validationResult: RowValidationResult;
  existingRecord?: Record<string, unknown>;
  diff?: FieldDiff[];
}

export type ImportStep = 'select-file' | 'map-columns' | 'validate' | 'confirm' | 'processing' | 'complete';

export interface ImportSummary {
  total: number;
  new: number;
  modified: number;
  unchanged: number;
  errors: number;
  deleted: number;
}

export interface ImportState {
  step: ImportStep;
  file: File | null;
  schemaId: string | null;
  parsedRows: ParsedRow[];
  columnMapping: Record<string, string>;
  summary: ImportSummary;
  isProcessing: boolean;
  progress: number;
  error: string | null;
}
