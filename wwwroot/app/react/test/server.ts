// MSW server. Individual tests can override handlers via server.use(...);
// resetHandlers() in setup.ts clears them after each test so state doesn't
// leak between suites.
import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
