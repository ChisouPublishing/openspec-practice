import Fastify from 'fastify';
import { openDatabase } from './db.js';
import { createRepository } from './expense-claims/repository.js';
import { expenseClaimsRoutes } from './expense-claims/routes.js';

export function buildApp({ dbPath = ':memory:' } = {}) {
  const app = Fastify({
    ajv: { customOptions: { coerceTypes: false } },
  });

  const db = openDatabase(dbPath);
  app.addHook('onClose', async () => {
    db.close();
  });

  app.get('/health', async () => ({ status: 'ok' }));
  app.register(expenseClaimsRoutes, { repository: createRepository(db) });
  return app;
}
