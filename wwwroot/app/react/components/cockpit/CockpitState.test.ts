import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCockpitState } from './CockpitState';

// Pure-state reducer coverage. useReducer is exercised via renderHook + act;
// every action type gets a direct dispatch so the reducer's branches all
// execute.
describe('CockpitState reducer', () => {
  it('initialises with empty collections and default filters', () => {
    const { result } = renderHook(() => useCockpitState());
    const [state] = result.current;
    expect(state.jobs).toEqual([]);
    expect(state.runs).toEqual([]);
    expect(state.regions).toEqual([]);
    expect(state.speeds).toEqual([]);
    expect(state.fleets).toEqual([]);
    expect(state.selectedJobId).toBeNull();
    expect(state.selectedRunId).toBeNull();
    expect(state.selectedJobIds).toEqual([]);
    expect(state.selectedRunIds).toEqual([]);
    expect(state.sizeFilter).toBe('all');
    expect(state.groupMode).toBe('postcode');
    expect(state.jobSort).toBeNull();
    expect(state.runSort).toBeNull();
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.filters.clientIds).toEqual([]);
    expect(state.filters.regionIds).toEqual([]);
    expect(state.filters.ourRefs).toEqual([]);
    expect(state.filters.speeds).toEqual([]);
    expect(state.filters.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('SET_FILTER shallow-merges the filter patch', () => {
    const { result } = renderHook(() => useCockpitState());
    act(() => result.current[1]({ type: 'SET_FILTER', payload: { regionIds: [1, 2] } }));
    expect(result.current[0].filters.regionIds).toEqual([1, 2]);
    // Other filter fields preserved.
    expect(result.current[0].filters.clientIds).toEqual([]);
    act(() => result.current[1]({ type: 'SET_FILTER', payload: { clientIds: [9] } }));
    expect(result.current[0].filters.regionIds).toEqual([1, 2]);
    expect(result.current[0].filters.clientIds).toEqual([9]);
  });

  it('SET_JOBS replaces the jobs array', () => {
    const { result } = renderHook(() => useCockpitState());
    act(() => result.current[1]({ type: 'SET_JOBS', payload: [{ bulkJobId: 1 } as any] }));
    expect(result.current[0].jobs).toHaveLength(1);
  });

  it('SET_RUNS replaces the runs array', () => {
    const { result } = renderHook(() => useCockpitState());
    act(() => result.current[1]({ type: 'SET_RUNS', payload: [{ id: 99 } as any] }));
    expect(result.current[0].runs[0].id).toBe(99);
  });

  it('SET_REGIONS / SET_SPEEDS / SET_FLEETS update lookups', () => {
    const { result } = renderHook(() => useCockpitState());
    act(() => result.current[1]({ type: 'SET_REGIONS', payload: [{ id: 1, label: 'N' }] }));
    act(() => result.current[1]({ type: 'SET_SPEEDS', payload: [{ id: 2, label: 'Same' }] }));
    act(() => result.current[1]({ type: 'SET_FLEETS', payload: [{ fleet: 'A', couriers: [] }] }));
    expect(result.current[0].regions[0].label).toBe('N');
    expect(result.current[0].speeds[0].label).toBe('Same');
    expect(result.current[0].fleets[0].fleet).toBe('A');
  });

  it('SELECT_JOB / SELECT_RUN set selected ids', () => {
    const { result } = renderHook(() => useCockpitState());
    act(() => result.current[1]({ type: 'SELECT_JOB', payload: 42 }));
    act(() => result.current[1]({ type: 'SELECT_RUN', payload: 7 }));
    expect(result.current[0].selectedJobId).toBe(42);
    expect(result.current[0].selectedRunId).toBe(7);
    act(() => result.current[1]({ type: 'SELECT_JOB', payload: null }));
    expect(result.current[0].selectedJobId).toBeNull();
  });

  it('TOGGLE_JOB_MULTISELECT adds and removes ids', () => {
    const { result } = renderHook(() => useCockpitState());
    act(() => result.current[1]({ type: 'TOGGLE_JOB_MULTISELECT', payload: 1 }));
    act(() => result.current[1]({ type: 'TOGGLE_JOB_MULTISELECT', payload: 2 }));
    expect(result.current[0].selectedJobIds).toEqual([1, 2]);
    act(() => result.current[1]({ type: 'TOGGLE_JOB_MULTISELECT', payload: 1 }));
    expect(result.current[0].selectedJobIds).toEqual([2]);
  });

  it('CLEAR_MULTISELECT + REPLACE_MULTISELECT reset job selection', () => {
    const { result } = renderHook(() => useCockpitState());
    act(() => result.current[1]({ type: 'REPLACE_MULTISELECT', payload: [10, 11, 12] }));
    expect(result.current[0].selectedJobIds).toEqual([10, 11, 12]);
    act(() => result.current[1]({ type: 'CLEAR_MULTISELECT' }));
    expect(result.current[0].selectedJobIds).toEqual([]);
  });

  it('TOGGLE_RUN_MULTISELECT + CLEAR_RUN_MULTISELECT + REPLACE_RUN_MULTISELECT work symmetrically', () => {
    const { result } = renderHook(() => useCockpitState());
    act(() => result.current[1]({ type: 'TOGGLE_RUN_MULTISELECT', payload: 5 }));
    act(() => result.current[1]({ type: 'TOGGLE_RUN_MULTISELECT', payload: 6 }));
    expect(result.current[0].selectedRunIds).toEqual([5, 6]);
    act(() => result.current[1]({ type: 'TOGGLE_RUN_MULTISELECT', payload: 5 }));
    expect(result.current[0].selectedRunIds).toEqual([6]);
    act(() => result.current[1]({ type: 'REPLACE_RUN_MULTISELECT', payload: [1, 2] }));
    expect(result.current[0].selectedRunIds).toEqual([1, 2]);
    act(() => result.current[1]({ type: 'CLEAR_RUN_MULTISELECT' }));
    expect(result.current[0].selectedRunIds).toEqual([]);
  });

  it('SET_JOB_SORT and SET_RUN_SORT accept both patterns and null', () => {
    const { result } = renderHook(() => useCockpitState());
    act(() => result.current[1]({ type: 'SET_JOB_SORT', payload: { field: 'jobNumber', direction: 'asc' } }));
    expect(result.current[0].jobSort).toEqual({ field: 'jobNumber', direction: 'asc' });
    act(() => result.current[1]({ type: 'SET_JOB_SORT', payload: null }));
    expect(result.current[0].jobSort).toBeNull();
    act(() => result.current[1]({ type: 'SET_RUN_SORT', payload: { field: 'name', direction: 'desc' } }));
    expect(result.current[0].runSort?.direction).toBe('desc');
    act(() => result.current[1]({ type: 'SET_RUN_SORT', payload: null }));
    expect(result.current[0].runSort).toBeNull();
  });

  it('SET_SIZE_FILTER cycles all <-> moreThan100Cubic', () => {
    const { result } = renderHook(() => useCockpitState());
    act(() => result.current[1]({ type: 'SET_SIZE_FILTER', payload: 'moreThan100Cubic' }));
    expect(result.current[0].sizeFilter).toBe('moreThan100Cubic');
    act(() => result.current[1]({ type: 'SET_SIZE_FILTER', payload: 'all' }));
    expect(result.current[0].sizeFilter).toBe('all');
  });

  it('SET_JOB_SEARCH / SET_RUN_SEARCH / SET_GROUP_SEARCH / SET_FLEET_SEARCH each write their slot', () => {
    const { result } = renderHook(() => useCockpitState());
    act(() => result.current[1]({ type: 'SET_JOB_SEARCH', payload: 'abc' }));
    act(() => result.current[1]({ type: 'SET_RUN_SEARCH', payload: 'def' }));
    act(() => result.current[1]({ type: 'SET_GROUP_SEARCH', payload: 'ghi' }));
    act(() => result.current[1]({ type: 'SET_FLEET_SEARCH', payload: 'jkl' }));
    expect(result.current[0].jobSearch).toBe('abc');
    expect(result.current[0].runSearch).toBe('def');
    expect(result.current[0].groupSearch).toBe('ghi');
    expect(result.current[0].fleetSearch).toBe('jkl');
  });

  it('SET_GROUP_MODE toggles postcode / time', () => {
    const { result } = renderHook(() => useCockpitState());
    act(() => result.current[1]({ type: 'SET_GROUP_MODE', payload: 'time' }));
    expect(result.current[0].groupMode).toBe('time');
    act(() => result.current[1]({ type: 'SET_GROUP_MODE', payload: 'postcode' }));
    expect(result.current[0].groupMode).toBe('postcode');
  });

  it('SET_LOADING and SET_ERROR flip flags', () => {
    const { result } = renderHook(() => useCockpitState());
    act(() => result.current[1]({ type: 'SET_LOADING', payload: true }));
    act(() => result.current[1]({ type: 'SET_ERROR', payload: 'boom' }));
    expect(result.current[0].loading).toBe(true);
    expect(result.current[0].error).toBe('boom');
    act(() => result.current[1]({ type: 'SET_LOADING', payload: false }));
    act(() => result.current[1]({ type: 'SET_ERROR', payload: null }));
    expect(result.current[0].loading).toBe(false);
    expect(result.current[0].error).toBeNull();
  });

  it('unknown action types return state unchanged (default branch)', () => {
    const { result } = renderHook(() => useCockpitState());
    const before = result.current[0];
    act(() => result.current[1]({ type: 'DOES_NOT_EXIST' as any, payload: null as any }));
    expect(result.current[0]).toBe(before);
  });
});
