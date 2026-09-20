import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useImportExport } from './useImportExport';
import type { ImportSchema } from '../types';

describe('useImportExport', () => {
  const mockSchema: ImportSchema = {
    id: 'test-schema',
    name: 'Test Schema',
    description: 'Test description',
    columns: [
      {
        key: 'id',
        header: 'ID',
        type: 'string',
        locked: true,
      },
      {
        key: 'name',
        header: 'Name',
        type: 'string',
        required: true,
      },
      {
        key: 'email',
        header: 'Email',
        type: 'email',
        required: true,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with correct default state', () => {
    const { result } = renderHook(() => useImportExport({ schema: mockSchema }));

    expect(result.current.step).toBe('select-file');
    expect(result.current.file).toBeNull();
    expect(result.current.parsedData).toBeNull();
    expect(result.current.columnMapping).toEqual({});
    expect(result.current.parsedRows).toEqual([]);
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.progress).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('should calculate summary correctly', () => {
    const { result } = renderHook(() => useImportExport({ schema: mockSchema }));

    expect(result.current.summary).toEqual({
      total: 0,
      new: 0,
      modified: 0,
      unchanged: 0,
      errors: 0,
      deleted: 0,
    });
  });

  it('should reset state when reset is called', () => {
    const { result } = renderHook(() => useImportExport({ schema: mockSchema }));

    // Modify some state
    act(() => {
      result.current.setColumnMapping({ name: 'Name', email: 'Email' });
    });

    expect(result.current.columnMapping).not.toEqual({});

    // Reset
    act(() => {
      result.current.reset();
    });

    expect(result.current.step).toBe('select-file');
    expect(result.current.columnMapping).toEqual({});
    expect(result.current.file).toBeNull();
  });

  it('should allow step navigation with nextStep/prevStep', () => {
    const { result } = renderHook(() => useImportExport({ schema: mockSchema }));

    expect(result.current.step).toBe('select-file');

    act(() => {
      result.current.nextStep();
    });

    expect(result.current.step).toBe('map-columns');

    act(() => {
      result.current.prevStep();
    });

    expect(result.current.step).toBe('select-file');
  });

  it('should allow direct step navigation with goToStep', () => {
    const { result } = renderHook(() => useImportExport({ schema: mockSchema }));

    act(() => {
      result.current.goToStep('validate');
    });

    expect(result.current.step).toBe('validate');

    act(() => {
      result.current.goToStep('complete');
    });

    expect(result.current.step).toBe('complete');
  });

  it('should handle column mapping updates', () => {
    const { result } = renderHook(() => useImportExport({ schema: mockSchema }));

    const mapping = { id: 'ID', name: 'Full Name', email: 'Email Address' };

    act(() => {
      result.current.setColumnMapping(mapping);
    });

    expect(result.current.columnMapping).toEqual(mapping);
  });

  it('should execute import with progress simulation', async () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() =>
      useImportExport({ schema: mockSchema, onImportComplete: onComplete })
    );

    expect(result.current.isProcessing).toBe(false);
    expect(result.current.step).toBe('select-file');

    await act(async () => {
      await result.current.executeImport();
    });

    expect(result.current.step).toBe('complete');
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.progress).toBe(100);
    expect(onComplete).toHaveBeenCalledWith(result.current.summary);
  });

  it('should provide download functions', () => {
    const { result } = renderHook(() => useImportExport({ schema: mockSchema }));

    expect(typeof result.current.downloadData).toBe('function');
    expect(typeof result.current.downloadTemplate).toBe('function');
  });

  it('should expose validation state from child hook', () => {
    const { result } = renderHook(() => useImportExport({ schema: mockSchema }));

    expect(result.current.validationResult).toBeNull();
    expect(result.current.isValidating).toBe(false);
    expect(result.current.canProceed).toBe(false);
  });
});
