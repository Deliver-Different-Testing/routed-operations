import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { bulkImportService } from './bulkImportService';

const baseEnvelope = { messageId: 'x', success: true, messages: [] };

describe('bulkImportService', () => {
  it('getJobs GETs /bulk-import/jobs and wraps as { response }', async () => {
    server.use(
      http.get('/api/bulk-import/jobs', () =>
        HttpResponse.json({ ...baseEnvelope, jobs: [] })),
    );
    const r = await bulkImportService.getJobs();
    expect(r.response.jobs).toEqual([]);
  });

  describe('uploadFile', () => {
    it('POSTs multipart to /bulk-import/upload and parses a dictionary-list response', async () => {
      let contentType: string | null = null;
      server.use(
        http.post('/api/bulk-import/upload', ({ request }) => {
          contentType = request.headers.get('content-type');
          const payload = JSON.stringify([
            { A: 'a1', B: 'b1' },
            { A: 'a2', B: 'b2', C: 'c2' },
          ]);
          return new HttpResponse(payload, { headers: { 'Content-Type': 'application/json' } });
        }),
      );
      const file = new File(['hello'], 'a.csv', { type: 'text/csv' });
      const r = await bulkImportService.uploadFile(file);
      expect(contentType).toMatch(/multipart\/form-data/);
      expect(r.response.headers).toEqual(['A', 'B', 'C']);
      expect(r.response.rows).toEqual([
        { A: 'a1', B: 'b1', C: '' },
        { A: 'a2', B: 'b2', C: 'c2' },
      ]);
    });

    it('parses a double-encoded JSON string payload', async () => {
      server.use(
        http.post('/api/bulk-import/upload', () =>
          HttpResponse.json(JSON.stringify([{ X: 1, Y: null }]))),
      );
      const r = await bulkImportService.uploadFile(new File([''], 'a.csv'));
      expect(r.response.headers).toEqual(['X', 'Y']);
      expect(r.response.rows).toEqual([{ X: '1', Y: '' }]);
    });

    it('parses a { response: [...] } wrapper payload', async () => {
      server.use(
        http.post('/api/bulk-import/upload', () =>
          HttpResponse.json({ response: [{ A: 'v' }] })),
      );
      const r = await bulkImportService.uploadFile(new File([''], 'a.csv'));
      expect(r.response.rows).toEqual([{ A: 'v' }]);
    });

    it('parses a { response: "<json-string>" } wrapper payload', async () => {
      server.use(
        http.post('/api/bulk-import/upload', () =>
          HttpResponse.json({ response: JSON.stringify([{ A: 'v' }]) })),
      );
      const r = await bulkImportService.uploadFile(new File([''], 'a.csv'));
      expect(r.response.rows).toEqual([{ A: 'v' }]);
    });

    it('rejects when server returns a non-array payload', async () => {
      server.use(
        http.post('/api/bulk-import/upload', () => HttpResponse.json({ notAnArray: true })),
      );
      await expect(bulkImportService.uploadFile(new File([''], 'a.csv'))).rejects.toThrow(
        /was not an array/,
      );
    });

    it('rejects with the server-emitted message on non-2xx response', async () => {
      server.use(
        http.post('/api/bulk-import/upload', () =>
          HttpResponse.json({ message: 'bad file' }, { status: 400 })),
      );
      await expect(bulkImportService.uploadFile(new File([''], 'a.csv'))).rejects.toThrow(/bad file/);
    });
  });

  it('import POSTs /bulk-import/import with the request body', async () => {
    let seen: any;
    server.use(
      http.post('/api/bulk-import/import', async ({ request }) => {
        seen = await request.json();
        return HttpResponse.json({ ...baseEnvelope, clientId: 1, bookDate: '2026-08-13', scheduleId: null, speedId: 1, jobs: [] });
      }),
    );
    await bulkImportService.import({
      clientId: 1, bookDate: '2026-08-13', speedId: 1,
      isKmRatedJobs: false, importAsCompleted: false, jobType: 'routed', jobs: [],
    });
    expect(seen.clientId).toBe(1);
    expect(seen.jobType).toBe('routed');
  });

  it('getPickupRate POSTs /bulk-import/pickup-rate', async () => {
    server.use(
      http.post('/api/bulk-import/pickup-rate', () =>
        HttpResponse.json({ ...baseEnvelope, amount: 42 })),
    );
    const r = await bulkImportService.getPickupRate({
      numberOfVehicle: 1, vehicleSize: 'Van', pickupJob: { clientID: 1, time: '2026-08-13T10:00', toPostCode: 1010 },
    });
    expect(r.response.amount).toBe(42);
  });

  it('bookPickup POSTs /bulk-import/book-pickup', async () => {
    server.use(
      http.post('/api/bulk-import/book-pickup', () =>
        HttpResponse.json({ ...baseEnvelope, jobId: [1, 2] })),
    );
    const r = await bulkImportService.bookPickup({
      numberOfVehicle: 2, vehicleSize: 'Van', pickupJob: { clientID: 1, time: '2026-08-13T10:00', toPostCode: 1010 },
    });
    expect(r.response.jobId).toEqual([1, 2]);
  });

  it('deleteRouted DELETEs /bulk-import/jobs/:id', async () => {
    let method: string | null = null;
    server.use(
      http.delete('/api/bulk-import/jobs/:id', ({ request }) => {
        method = request.method;
        return HttpResponse.json({ ...baseEnvelope });
      }),
    );
    await bulkImportService.deleteRouted(99);
    expect(method).toBe('DELETE');
  });

  it('deleteOnDemand DELETEs /bulk-import/tuc-jobs/:id', async () => {
    let method: string | null = null;
    server.use(
      http.delete('/api/bulk-import/tuc-jobs/:id', ({ request }) => {
        method = request.method;
        return HttpResponse.json({ ...baseEnvelope });
      }),
    );
    await bulkImportService.deleteOnDemand(101);
    expect(method).toBe('DELETE');
  });

  it('staffImport POSTs /bulk-import/staff-import with { jobs }', async () => {
    let seen: any;
    server.use(
      http.post('/api/bulk-import/staff-import', async ({ request }) => {
        seen = await request.json();
        return HttpResponse.json({ ...baseEnvelope, successCount: 1, failedCount: 0, failedJobs: [] });
      }),
    );
    await bulkImportService.staffImport([{ jobNumber: 'A1' }]);
    expect(seen).toEqual({ jobs: [{ jobNumber: 'A1' }] });
  });

  it('searchForComplete POSTs /bulk-import/search-for-complete', async () => {
    server.use(
      http.post('/api/bulk-import/search-for-complete', () =>
        HttpResponse.json({ ...baseEnvelope, foundJobs: [], notFoundJobNumbers: [] })),
    );
    const r = await bulkImportService.searchForComplete({ clientId: 1, jobs: [{ jobNumber: 'A' }], jobType: 'routed' });
    expect(r.response.notFoundJobNumbers).toEqual([]);
  });

  it('bulkComplete POSTs /bulk-import/bulk-complete', async () => {
    server.use(
      http.post('/api/bulk-import/bulk-complete', () =>
        HttpResponse.json({ ...baseEnvelope })),
    );
    const r = await bulkImportService.bulkComplete({ clientId: 1, jobs: [{ jobId: 1 }], jobType: 'routed' });
    expect(r.response.success).toBe(true);
  });

  describe('importFromGoogleDrive', () => {
    it('POSTs /bulk-import/import-google-drive and normalises the data string', async () => {
      let seen: any;
      server.use(
        http.post('/api/bulk-import/import-google-drive', async ({ request }) => {
          seen = await request.json();
          return HttpResponse.json({
            ...baseEnvelope,
            data: JSON.stringify([{ A: 'a' }, { A: 'a2', B: 'b' }]),
          });
        }),
      );
      const r = await bulkImportService.importFromGoogleDrive('fid', 'foo.csv', 'tok');
      expect(seen).toEqual({ fileId: 'fid', fileName: 'foo.csv', accessToken: 'tok' });
      expect(r.response.headers).toEqual(['A', 'B']);
      expect(r.response.rows).toEqual([
        { A: 'a', B: '' },
        { A: 'a2', B: 'b' },
      ]);
    });

    it('rejects when success=false', async () => {
      server.use(
        http.post('/api/bulk-import/import-google-drive', () =>
          HttpResponse.json({ ...baseEnvelope, success: false, messages: [{ message: 'no perm' }], data: null })),
      );
      await expect(bulkImportService.importFromGoogleDrive('a', 'b', 'c')).rejects.toThrow(/no perm/);
    });

    it('rejects when data is not parseable JSON', async () => {
      server.use(
        http.post('/api/bulk-import/import-google-drive', () =>
          HttpResponse.json({ ...baseEnvelope, data: 'not-json' })),
      );
      await expect(bulkImportService.importFromGoogleDrive('a', 'b', 'c')).rejects.toThrow(/unparseable/);
    });

    it('rejects when data is not an array', async () => {
      server.use(
        http.post('/api/bulk-import/import-google-drive', () =>
          HttpResponse.json({ ...baseEnvelope, data: JSON.stringify({ notArray: true }) })),
      );
      await expect(bulkImportService.importFromGoogleDrive('a', 'b', 'c')).rejects.toThrow(/non-array/);
    });
  });
});
