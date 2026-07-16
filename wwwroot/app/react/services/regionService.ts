import { buildQuery, request } from './api';
import type { Region } from '../types';

export const regionService = {
  getForRunDate: (runDate: string) =>
    request<Region[]>(`/regions${buildQuery({ runDate })}`),
};
