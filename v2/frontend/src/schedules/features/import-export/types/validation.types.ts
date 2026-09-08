export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface FieldError {
  row: number;
  column: string;
  value: unknown;
  message: string;
  severity: ValidationSeverity;
  suggestedFix?: unknown;
}

export interface ValidationResult {
  isValid: boolean;
  errors: FieldError[];
  warnings: FieldError[];
  infos: FieldError[];
  autoFixed: number;
  unfixable: number;
}

export interface RowValidationResult {
  isValid: boolean;
  errors: FieldError[];
  warnings: FieldError[];
  autoFixes: { field: string; original: unknown; fixed: unknown }[];
}
