import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';

try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the real environment.
}
const config = loadConfig();
const app = createApp({ config, db: openDb(config.DB_PATH) });
serve({ fetch: app.fetch, port: config.PORT }, (i) =>
  console.log(`og-image-api listening on :${i.port}`),
);
