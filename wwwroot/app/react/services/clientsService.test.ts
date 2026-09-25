import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { clientsService } from './clientsService';

const envelope = { messageId: 'x', success: true, messages: [], isInternal: false, isUsTenant: false };

describe('clientsService', () => {
  it('getClients GETs /clients and wraps as { response }', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({ ...envelope, clients: [{ id: 1, code: 'ACME', name: 'Acme', isUsTenant: false }] })),
    );
    const r = await clientsService.getClients();
    expect(r.response.clients[0].name).toBe('Acme');
  });

  it('search GETs /clients/search?search=', async () => {
    let seenUrl!: URL;
    server.use(
      http.get('/api/clients/search', ({ request }) => {
        seenUrl = new URL(request.url);
        return HttpResponse.json({ ...envelope, clients: [] });
      }),
    );
    await clientsService.search('acme');
    expect(seenUrl.searchParams.get('search')).toBe('acme');
  });

  it('getSettings GETs /clients/:id/settings', async () => {
    server.use(
      http.get('/api/clients/:id/settings', ({ params }) => {
        expect(params.id).toBe('42');
        return HttpResponse.json({
          messageId: 'x', success: true, messages: [],
          settings: {
            id: 42, code: 'ACME', name: 'Acme', jobPrefix: null, isUsTenant: false,
            contacts: [], speeds: [], stockSizes: [], schedules: [],
            referenceAMandatory: false, referenceAMessage: null,
            referenceBMandatory: false, referenceBMessage: null,
            createBulkHomeDeliveryPickup: false,
          },
        });
      }),
    );
    const r = await clientsService.getSettings(42);
    expect(r.response.settings.id).toBe(42);
  });

  it('getSchedules GETs /clients/:id/schedules/:date/:speed/:depot in positional path', async () => {
    let seenPath: string | null = null;
    server.use(
      http.get('/api/clients/:id/schedules/:date/:speed/:depot', ({ request }) => {
        seenPath = new URL(request.url).pathname;
        return HttpResponse.json({ messageId: 'x', success: true, messages: [], schedules: [] });
      }),
    );
    await clientsService.getSchedules(1, '2026-08-13', 2, 3);
    expect(seenPath).toBe('/api/clients/1/schedules/2026-08-13/2/3');
  });
});
