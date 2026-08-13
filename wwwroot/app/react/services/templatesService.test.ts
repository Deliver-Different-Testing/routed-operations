import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { templatesService } from './templatesService';

describe('templatesService', () => {
  it('getTemplates GETs /templates and wraps as { response }', async () => {
    server.use(
      http.get('/api/templates', () =>
        HttpResponse.json({ messageId: 'x', success: true, templates: [{ id: 1, name: 't', mappings: [] }] })),
    );
    const r = await templatesService.getTemplates();
    expect(r.response.templates[0].name).toBe('t');
  });

  it('createTemplate POSTs /templates with { template: { name, mappings } }', async () => {
    let seen: any;
    server.use(
      http.post('/api/templates', async ({ request }) => {
        seen = await request.json();
        return HttpResponse.json({ messageId: 'x', success: true, template: { id: 1, name: 't', mappings: [] } });
      }),
    );
    await templatesService.createTemplate('t', [{ urgentField: 'F', importField: 'F' }]);
    expect(seen).toEqual({ template: { name: 't', mappings: [{ urgentField: 'F', importField: 'F' }] } });
  });

  it('deleteTemplate DELETEs /templates/:id', async () => {
    let method: string | null = null;
    server.use(
      http.delete('/api/templates/:id', ({ request, params }) => {
        method = request.method;
        expect(params.id).toBe('5');
        return HttpResponse.json({ messageId: 'x', success: true });
      }),
    );
    const r = await templatesService.deleteTemplate(5);
    expect(method).toBe('DELETE');
    expect(r.response.success).toBe(true);
  });
});
