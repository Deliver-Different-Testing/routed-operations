export type ColumnType =
  | 'id' | 'string' | 'number' | 'boolean' | 'enum'
  | 'date' | 'time' | 'datetime' | 'email' | 'phone' | 'reference' | 'tags';

export interface ColumnDef {
  key: string;
  header: string;
  type: ColumnType;
  required?: boolean;
  locked?: boolean;
  values?: string[];          // For enum
  refTable?: string;          // For reference
  refDisplayField?: string;
  min?: number;
  max?: number;
  pattern?: RegExp;
  dateFormat?: string;
  allowFuzzyMatch?: boolean;
  templateHint?: string;
  templateDefault?: string;
}

export interface ImportSchema {
  id: string;
  label: string;
  description?: string;
  columns: ColumnDef[];
  uniqueKey: string;
  generateId: () => string;
  beforeValidate?: (row: Record<string, unknown>) => Record<string, unknown>;
  afterValidate?: (row: Record<string, unknown>) => Record<string, unknown>;
  dependencies?: string[];
}
