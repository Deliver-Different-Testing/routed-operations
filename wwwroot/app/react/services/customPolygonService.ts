import { request } from './api';

export interface CustomPolygon {
  customZipPolygonId: number;
  name: string;
  centroidLatitude: number;
  centroidLongitude: number;
  wkt: string;
  active: boolean;
  attachedRouteCount: number;
  createdAt: string;
  updatedAt: string | null;
}

export interface CreateCustomPolygonBody {
  name: string;
  centroidLatitude: number;
  centroidLongitude: number;
  wkt: string;
}

export interface UpdateCustomPolygonShapeBody {
  centroidLatitude: number;
  centroidLongitude: number;
  wkt: string;
}

export interface UpdateCustomPolygonMetaBody {
  name: string;
}

export const customPolygonService = {
  list: () => request<{ response: CustomPolygon[] }>('/custom-polygons'),
  get: (id: number) => request<{ response: CustomPolygon }>(`/custom-polygons/${id}`),
  create: (body: CreateCustomPolygonBody) =>
    request<{ response: CustomPolygon }>('/custom-polygons', {
      method: 'POST', body: JSON.stringify(body),
    }),
  updateShape: (id: number, body: UpdateCustomPolygonShapeBody) =>
    request<{ response: CustomPolygon }>(`/custom-polygons/${id}/shape`, {
      method: 'PUT', body: JSON.stringify(body),
    }),
  updateMeta: (id: number, body: UpdateCustomPolygonMetaBody) =>
    request<{ response: CustomPolygon }>(`/custom-polygons/${id}`, {
      method: 'PUT', body: JSON.stringify(body),
    }),
  remove: (id: number) =>
    request<{ response: string }>(`/custom-polygons/${id}`, { method: 'DELETE' }),
};
