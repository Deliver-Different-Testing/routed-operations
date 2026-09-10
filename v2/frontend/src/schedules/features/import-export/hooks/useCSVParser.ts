import { useState, useCallback } from 'react';
import { parseCSV, type CSVParseResult, type CSVParseOptions } from '../engine';

export interface UseCSVParserOptions extends CSVParseOptions {
  onSuccess?: (result: CSVParseResult) => void;
  onError?: (error: string) => void;
}

export interface UseCSVParserReturn {
  // State
  result: CSVParseResult | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  parseFile: (file: File) => Promise<void>;
  parseString: (content: string) => void;
  reset: () => void;
}

/**
 * Hook for parsing CSV files or strings. Returns parsed result, loading state,
 * error state, and `parseFile`/`parseString`/`reset` actions.
 */
export function useCSVParser(options: UseCSVParserOptions = {}): UseCSVParserReturn {
  const [result, setResult] = useState<CSVParseResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parseString = useCallback((content: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const parseResult = parseCSV(content, {
        delimiter: options.delimiter,
        hasHeaders: options.hasHeaders,
        skipEmptyRows: options.skipEmptyRows,
        trimValues: options.trimValues,
      });

      setResult(parseResult);
      options.onSuccess?.(parseResult);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to parse CSV';
      setError(errorMsg);
      options.onError?.(errorMsg);
    } finally {
      setIsLoading(false);
    }
  }, [options]);

  const parseFile = useCallback(async (file: File) => {
    try {
      setIsLoading(true);
      setError(null);

      const content = await file.text();
      parseString(content);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to read file';
      setError(errorMsg);
      options.onError?.(errorMsg);
      setIsLoading(false);
    }
  }, [parseString, options]);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setIsLoading(false);
  }, []);

  return {
    result,
    isLoading,
    error,
    parseFile,
    parseString,
    reset,
  };
}
