import { request } from './api';
import type { VehicleSize } from '../types';

export const vehicleSizeService = {
  getAll: () => request<{ response: VehicleSize[] }>('/vehicle-sizes'),
};
