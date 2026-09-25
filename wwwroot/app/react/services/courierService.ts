import { request } from './api';
import type { Courier, Fleet } from '../types';

export const courierService = {
  getActive: () =>
    request<{ potentialCouriers: Courier[] }>('/couriers'),

  getFleets: () =>
    request<{ fleets: Fleet[] }>('/fleets'),
};
