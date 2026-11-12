import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildApp } from './app.js';

const dbPath = process.env.DB_PATH ?? 'data/expenses.db';
if (dbPath !== ':memory:') {
  mkdirSync(dirname(dbPath), { recursive: true });
}

const app = buildApp({ dbPath });
await app.listen({ port: Number(process.env.PORT ?? 3000) });
