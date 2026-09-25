import { buildQuery, request } from './api';
import type { Speed } from '../types';

export const speedService = {
  getForRunDate: (runDate: string) =>
    request<Speed[]>(`/speeds${buildQuery({ runDate })}`),

  getAll: () =>
    request<Speed[]>('/speeds/all'),
};
