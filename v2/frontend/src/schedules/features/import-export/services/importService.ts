/**
 * Import Service
 *
 * This service handles the actual processing of import data.
 * Currently uses in-memory storage for testing.
 *
 * TO CONNECT TO REAL DATABASE:
 * 1. Replace the in-memory dataStore with API calls
 * 2. Update processImport to call your backend endpoint
 * 3. The rest of the code (UI, validation, diff) stays the same
 */

import type { ParsedRow, ImportRowStatus } from '../types/import.types';

// ============================================================================
// IN-MEMORY DATA STORE (Replace with API calls for production)
// ============================================================================

type DataStore = Record<string, Record<string, unknown>[]>;

// This will hold all imported data in memory during the session
let dataStore: DataStore = {};

// Listeners for data changes (so UI can react)
type DataChangeListener = (schemaId: string, data: Record<string, unknown>[]) => void;
const listeners: Set<DataChangeListener> = new Set();

/**
 * Initialize the data store with existing data
 * Call this at app startup with your sample/fetched data
 */
export function initializeDataStore(initialData: DataStore): void {
  dataStore = { ...initialData };
  // Deep clone to avoid reference issues
  Object.keys(dataStore).forEach(key => {
    dataStore[key] = JSON.parse(JSON.stringify(dataStore[key]));
  });
}

/**
 * Get current data for a schema
 */
export function getData(schemaId: string): Record<string, unknown>[] {
  return dataStore[schemaId] || [];
}

/**
 * Get all data (for passing to components)
 */
export function getAllData(): DataStore {
  return { ...dataStore };
}

/**
 * Subscribe to data changes
 */
export function subscribeToChanges(listener: DataChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Notify all listeners of a change
function notifyListeners(schemaId: string, data: Record<string, unknown>[]): void {
  listeners.forEach(listener => listener(schemaId, data));
}

// ============================================================================
// IMPORT PROCESSING
// ============================================================================

export interface ImportResult {
  success: boolean;
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  errors: number;
  errorDetails: Array<{
    rowNumber: number;
    error: string;
  }>;
}

export interface ProcessImportOptions {
  schemaId: string;
  uniqueKey: string;
  rows: ParsedRow[];
  onProgress?: (progress: number, message: string) => void;
}

/**
 * Process the import - this is where data actually gets "saved"
 *
 * TO CONNECT TO REAL DATABASE:
 * Replace this function body with an API call like:
 *
 * export async function processImport(options: ProcessImportOptions): Promise<ImportResult> {
 *   const response = await fetch(`/api/import/${options.schemaId}`, {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ rows: options.rows, uniqueKey: options.uniqueKey }),
 *   });
 *   return response.json();
 * }
 */
export async function processImport(options: ProcessImportOptions): Promise<ImportResult> {
  const { schemaId, uniqueKey, rows, onProgress } = options;

  // Get current data or initialize empty array
  const currentData = [...(dataStore[schemaId] || [])];

  // Create a map for quick lookup by unique key
  const dataMap = new Map<string, { index: number; record: Record<string, unknown> }>();
  currentData.forEach((record, index) => {
    const key = String(record[uniqueKey]);
    dataMap.set(key, { index, record });
  });

  const result: ImportResult = {
    success: true,
    created: 0,
    updated: 0,
    deleted: 0,
    unchanged: 0,
    errors: 0,
    errorDetails: [],
  };

  const totalRows = rows.length;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Simulate processing delay (remove this for real API)
    await new Promise(resolve => setTimeout(resolve, 30));

    // Report progress
    if (onProgress) {
      const progress = Math.round(((i + 1) / totalRows) * 100);
      onProgress(progress, `Processing row ${i + 1} of ${totalRows}`);
    }

    // Skip rows with errors
    if (row.status === 'error') {
      result.errors++;
      result.errorDetails.push({
        rowNumber: row.rowNumber,
        error: row.validationResult.errors.map(e => e.message).join(', '),
      });
      continue;
    }

    const recordKey = String(row.data[uniqueKey]);
    const existing = dataMap.get(recordKey);

    try {
      switch (row.status as ImportRowStatus) {
        case 'new':
          // Add new record
          currentData.push({ ...row.data });
          result.created++;
          break;

        case 'modified':
          // Update existing record
          if (existing) {
            currentData[existing.index] = { ...row.data };
          }
          result.updated++;
          break;

        case 'unchanged':
          // No action needed
          result.unchanged++;
          break;

        case 'delete':
          // Mark for deletion (we'll filter later)
          if (existing) {
            currentData[existing.index] = { ...existing.record, __deleted: true };
          }
          result.deleted++;
          break;
      }
    } catch (error) {
      result.errors++;
      result.errorDetails.push({
        rowNumber: row.rowNumber,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Remove deleted records
  const finalData = currentData.filter(record => !record.__deleted);

  // Save to data store
  dataStore[schemaId] = finalData;

  // Notify listeners
  notifyListeners(schemaId, finalData);

  result.success = result.errors === 0;

  return result;
}

// ============================================================================
// EXPORT FUNCTIONS (for completeness)
// ============================================================================

/**
 * Get data for export
 * In production, this would fetch from API
 */
export async function getExportData(schemaId: string): Promise<Record<string, unknown>[]> {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 100));
  return getData(schemaId);
}
