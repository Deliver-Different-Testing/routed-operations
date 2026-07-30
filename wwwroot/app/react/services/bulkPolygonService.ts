import { request } from './api';

export interface PolygonPoint {
  orderIndex: number;
  lat: number;
  lng: number;
}

export interface BulkPolygon {
  polygonId: number;
  name: string;
  /** 0 = Manual draw, 1 = seeded from a ZipPolygon. */
  sourceType: number;
  /** ZIP / postcode code when sourceType === 1; null when Manual. */
  sourceCode: string | null;
  centroidLatitude: number;
  centroidLongitude: number;
  active: boolean;
  points: PolygonPoint[];
  attachedRouteCount: number;
  createdUtc: string;
  createdBy: string;
  lastModifiedUtc: string | null;
  updatedBy: string | null;
}

export interface CreateBulkPolygonBody {
  name: string;
  centroidLatitude: number;
  centroidLongitude: number;
  points: PolygonPoint[];
  sourceType?: number;
  sourceCode?: string | null;
}

export interface UpdateBulkPolygonShapeBody {
  centroidLatitude: number;
  centroidLongitude: number;
  points: PolygonPoint[];
}

export interface UpdateBulkPolygonMetaBody {
  name: string;
}

export const bulkPolygonService = {
  list: () => request<{ response: BulkPolygon[] }>('/bulk-polygons'),
  get: (id: number) => request<{ response: BulkPolygon }>(`/bulk-polygons/${id}`),
  create: (body: CreateBulkPolygonBody) =>
    request<{ response: BulkPolygon }>('/bulk-polygons', {
      method: 'POST', body: JSON.stringify(body),
    }),
  updateShape: (id: number, body: UpdateBulkPolygonShapeBody) =>
    request<{ response: BulkPolygon }>(`/bulk-polygons/${id}/shape`, {
      method: 'PUT', body: JSON.stringify(body),
    }),
  updateMeta: (id: number, body: UpdateBulkPolygonMetaBody) =>
    request<{ response: BulkPolygon }>(`/bulk-polygons/${id}`, {
      method: 'PUT', body: JSON.stringify(body),
    }),
  remove: (id: number) =>
    request<{ response: string }>(`/bulk-polygons/${id}`, { method: 'DELETE' }),
};
