// Default MSW handlers for the Driver Scheduling module. Every
// endpoint returns an empty-but-valid response so components under
// test can mount without needing to declare per-test handlers unless
// they care about the payload shape.
//
// Individual tests can still override with server.use(...) - the
// setup.ts wrapper resets handlers between tests.
import { http, HttpResponse, type RequestHandler } from 'msw';

export const driverSchedulingHandlers: RequestHandler[] = [
  http.get('/api/driver-scheduling/summaries/:bookDate', () =>
    HttpResponse.json({ response: [] })),
  http.get('/api/driver-scheduling/notifications', () =>
    HttpResponse.json({ response: [] })),
  http.get('/api/driver-scheduling/:id/couriers', () =>
    HttpResponse.json({ response: [] })),
  http.get('/api/driver-scheduling/responses/statuses/:statusId/couriers', () =>
    HttpResponse.json({ response: [] })),
];
