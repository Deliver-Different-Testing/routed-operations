import { useReducer } from 'react';
import type { BulkJob, Fleet, JobFilters, Region, Run, Speed } from '../../types';
import { todayIso } from '../../lib/formatters';

export type JobSizeFilter = 'all' | 'moreThan100Cubic';

export interface ListSort {
  field: string;
  direction: 'asc' | 'desc';
}

export interface CockpitState {
  filters: JobFilters;
  jobs: BulkJob[];
  runs: Run[];
  regions: Region[];
  speeds: Speed[];
  fleets: Fleet[];
  selectedJobId: number | null;
  selectedRunId: number | null;
  selectedJobIds: number[];   // multi-select jobs for bulk actions
  selectedRunIds: number[];   // multi-select runs for bulk actions
  jobSort: ListSort | null;
  runSort: ListSort | null;
  sizeFilter: JobSizeFilter;
  // Per-panel free-text search boxes. Each string filters the visible rows
  // in the corresponding panel.
  jobSearch: string;
  runSearch: string;
  groupSearch: string;
  fleetSearch: string;
  groupMode: 'postcode' | 'time';
  loading: boolean;
  error: string | null;
}

type Action =
  | { type: 'SET_FILTER'; payload: Partial<JobFilters> }
  | { type: 'SET_JOBS'; payload: BulkJob[] }
  | { type: 'SET_RUNS'; payload: Run[] }
  | { type: 'SET_REGIONS'; payload: Region[] }
  | { type: 'SET_SPEEDS'; payload: Speed[] }
  | { type: 'SET_FLEETS'; payload: Fleet[] }
  | { type: 'SELECT_JOB'; payload: number | null }
  | { type: 'SELECT_RUN'; payload: number | null }
  | { type: 'TOGGLE_JOB_MULTISELECT'; payload: number }
  | { type: 'CLEAR_MULTISELECT' }
  | { type: 'REPLACE_MULTISELECT'; payload: number[] }
  | { type: 'TOGGLE_RUN_MULTISELECT'; payload: number }
  | { type: 'CLEAR_RUN_MULTISELECT' }
  | { type: 'REPLACE_RUN_MULTISELECT'; payload: number[] }
  | { type: 'SET_JOB_SORT'; payload: ListSort | null }
  | { type: 'SET_RUN_SORT'; payload: ListSort | null }
  | { type: 'SET_SIZE_FILTER'; payload: JobSizeFilter }
  | { type: 'SET_JOB_SEARCH'; payload: string }
  | { type: 'SET_RUN_SEARCH'; payload: string }
  | { type: 'SET_GROUP_SEARCH'; payload: string }
  | { type: 'SET_FLEET_SEARCH'; payload: string }
  | { type: 'SET_GROUP_MODE'; payload: 'postcode' | 'time' }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null };

const initialState: CockpitState = {
  filters: {
    date: todayIso(),
    clientIds: [],
    regionIds: [],
    ourRefs: [],
    speeds: [],
  },
  jobs: [],
  runs: [],
  regions: [],
  speeds: [],
  fleets: [],
  selectedJobId: null,
  selectedRunId: null,
  selectedJobIds: [],
  selectedRunIds: [],
  jobSort: null,
  runSort: null,
  sizeFilter: 'all',
  jobSearch: '',
  runSearch: '',
  groupSearch: '',
  fleetSearch: '',
  groupMode: 'postcode',
  loading: false,
  error: null,
};

function reducer(state: CockpitState, action: Action): CockpitState {
  switch (action.type) {
    case 'SET_FILTER':
      return { ...state, filters: { ...state.filters, ...action.payload } };
    case 'SET_JOBS':
      return { ...state, jobs: action.payload };
    case 'SET_RUNS':
      return { ...state, runs: action.payload };
    case 'SET_REGIONS':
      return { ...state, regions: action.payload };
    case 'SET_SPEEDS':
      return { ...state, speeds: action.payload };
    case 'SET_FLEETS':
      return { ...state, fleets: action.payload };
    case 'SELECT_JOB':
      return { ...state, selectedJobId: action.payload };
    case 'SELECT_RUN':
      return { ...state, selectedRunId: action.payload };
    case 'TOGGLE_JOB_MULTISELECT': {
      const has = state.selectedJobIds.includes(action.payload);
      return {
        ...state,
        selectedJobIds: has
          ? state.selectedJobIds.filter((id) => id !== action.payload)
          : [...state.selectedJobIds, action.payload],
      };
    }
    case 'CLEAR_MULTISELECT':
      return { ...state, selectedJobIds: [] };
    case 'REPLACE_MULTISELECT':
      return { ...state, selectedJobIds: action.payload };
    case 'TOGGLE_RUN_MULTISELECT': {
      const has = state.selectedRunIds.includes(action.payload);
      return {
        ...state,
        selectedRunIds: has
          ? state.selectedRunIds.filter((id) => id !== action.payload)
          : [...state.selectedRunIds, action.payload],
      };
    }
    case 'CLEAR_RUN_MULTISELECT':
      return { ...state, selectedRunIds: [] };
    case 'REPLACE_RUN_MULTISELECT':
      return { ...state, selectedRunIds: action.payload };
    case 'SET_JOB_SORT':
      return { ...state, jobSort: action.payload };
    case 'SET_RUN_SORT':
      return { ...state, runSort: action.payload };
    case 'SET_SIZE_FILTER':
      return { ...state, sizeFilter: action.payload };
    case 'SET_JOB_SEARCH':
      return { ...state, jobSearch: action.payload };
    case 'SET_RUN_SEARCH':
      return { ...state, runSearch: action.payload };
    case 'SET_GROUP_SEARCH':
      return { ...state, groupSearch: action.payload };
    case 'SET_FLEET_SEARCH':
      return { ...state, fleetSearch: action.payload };
    case 'SET_GROUP_MODE':
      return { ...state, groupMode: action.payload };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    default:
      return state;
  }
}

export function useCockpitState() {
  return useReducer(reducer, initialState);
}
