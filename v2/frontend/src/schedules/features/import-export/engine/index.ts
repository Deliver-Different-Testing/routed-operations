/**
 * Import/Export Engine
 * Core parsing and formatting utilities
 */

export {
  parseCSV,
  parseRow,
  detectDelimiter,
  removeBOM,
  type CSVParseOptions,
  type CSVParseResult
} from './CSVParser';

export {
  parseDate,
  parseTime,
  parseDateTime,
  isValidDate,
  type DateParseResult,
  type TimeParseResult,
  type DateTimeParseResult
} from './SmartDateParser';

export {
  diffRow,
  diffAll,
  compareValues,
  hasDeleteMarker,
  type DiffOptions,
  type DiffResult,
  type BatchDiffResult
} from './DiffEngine';

export {
  createReferenceRegistry,
  registerReferenceData,
  clearReferenceData,
  getReferenceData,
  resolveReference,
  fuzzyMatch,
  type ReferenceData,
  type ReferenceRegistry,
  type ResolveResult,
  type ResolveOptions
} from './ReferenceResolver';

export {
  generateCSV,
  generateTemplate,
  generateHeaders,
  generateHintRow,
  escapeCSVValue,
  rowToCSV,
  downloadCSV,
  type CSVGenerateOptions,
  type TemplateOptions
} from './CSVGenerator';

export {
  validateRow,
  validateAll,
  tryAutoFix,
  validateString,
  validateNumber,
  validateBoolean,
  validateEnum,
  validateDate,
  validateDateTime,
  validateEmail,
  validatePhone,
  validateReference,
  type ValidateRowOptions
} from './ValidationEngine';
