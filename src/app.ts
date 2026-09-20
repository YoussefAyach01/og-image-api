import { Hono, type Context } from 'hono';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { PLANS, type Config } from './config.js';
import type { Db } from './db.js';
import {
  consumeQuota,
  createKey,
  findActiveKey,
  getKey,
  getUsage,
  listKeys,
  monthOf,
  revokeKey,
  type KeyRecord,
} from './keys.js';
import { RateLimiter } from './ratelimit.js';
import { PngCache, ogParamsSchema, renderPng } from './render.js';

export interface Deps {
  config: Config;
  db: Db;
  now?: () => Date;
  render?: typeof renderPng;
}

type ErrStatus = 400 | 401 | 404 | 429 | 500;
const err = (c: Context, status: ErrStatus, code: string, message: string, details?: unknown) =>
  c.json({ error: { code, message, ...(details ? { details } : {}) } }, status);

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const asset = (name: string) => readFileSync(publicDir + name, 'utf8');

const sha = (s: string) => createHash('sha256').update(s).digest();
/** Hash first so both buffers have equal length, then compare in constant time. */
const safeEqual = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));

export function createApp({ config, db, now = () => new Date(), render = renderPng }: Deps) {
  const app = new Hono();
  const limiter = new RateLimiter();
  const adminLimiter = new RateLimiter();
  const cache = new PngCache();
  const files: Record<string, [string, string]> = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/style.css': ['style.css', 'text/css; charset=utf-8'],
    '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  };

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' blob: data:; frame-ancestors 'none'",
    );
  });

  app.get('/health', (c) => c.json({ ok: true }));
  for (const [path, [file, type]] of Object.entries(files)) {
    app.get(path, (c) => c.body(asset(file), 200, { 'Content-Type': type }));
  }

  // Header preferred; query param so the URL works inside an og:image meta tag.
  const authenticate = (c: Context): KeyRecord | null => {
    const key = c.req.header('x-api-key') ?? c.req.query('key');
    return key ? findActiveKey(db, key) : null;
  };

  app.get('/v1/og', async (c) => {
    const key = authenticate(c);
    if (!key) return err(c, 401, 'INVALID_API_KEY', 'Missing or invalid API key.');

    const rl = limiter.check(key.id, PLANS[key.plan].perMinute);
    if (!rl.ok) {
      c.header('Retry-After', String(rl.retryAfterSec));
      return err(c, 429, 'RATE_LIMITED', 'Too many requests per minute for your plan.');
    }

    const rest: Record<string, string> = { ...c.req.query() };
    delete rest.key;
    const parsed = ogParamsSchema.safeParse(rest);
    if (!parsed.success) {
      return err(
        c,
        400,
        'VALIDATION_FAILED',
        parsed.error.issues[0]?.message ?? 'Invalid parameters.',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }

    // Validate BEFORE metering so bad requests never burn quota.
    const quota = consumeQuota(db, key, monthOf(now()));
    if (!quota.ok) {
      return err(
        c,
        429,
        'QUOTA_EXCEEDED',
        `Monthly quota of ${PLANS[key.plan].monthly} cards reached. Upgrade your plan.`,
      );
    }

    const ck = JSON.stringify(parsed.data);
    let png = cache.get(ck);
    if (!png) {
      try {
        png = await render(parsed.data);
      } catch (e) {
        console.error('render failed', e);
        return err(c, 500, 'RENDER_FAILED', 'Could not render this card.');
      }
      cache.set(ck, png);
    }
    return c.body(new Uint8Array(png), 200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=86400',
      'X-Quota-Remaining': String(PLANS[key.plan].monthly - quota.used),
    });
  });

  app.get('/v1/usage', (c) => {
    const key = authenticate(c);
    if (!key) return err(c, 401, 'INVALID_API_KEY', 'Missing or invalid API key.');
    const month = monthOf(now());
    const used = getUsage(db, key.id, month);
    const limit = PLANS[key.plan].monthly;
    return c.json({ plan: key.plan, month, used, limit, remaining: limit - used });
  });

  // ---- Admin (operator only, bearer token) ----
  app.use('/admin/*', async (c, next) => {
    if (!adminLimiter.check('admin', 60).ok)
      return err(c, 429, 'RATE_LIMITED', 'Too many admin requests.');
    const auth = c.req.header('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token || !safeEqual(token, config.ADMIN_TOKEN)) {
      return err(c, 401, 'UNAUTHORIZED', 'Admin token required.');
    }
    await next();
  });

  const createSchema = z.object({
    label: z.string().trim().min(1).max(80),
    plan: z.enum(['free', 'pro', 'business']).default('free'),
  });
  app.post('/admin/keys', async (c) => {
    const body = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return err(c, 400, 'VALIDATION_FAILED', body.error.issues[0]?.message ?? 'Invalid body.');
    }
    const { key, record } = createKey(db, body.data.label, body.data.plan);
    return c.json({ key, ...record, note: 'Store this key now. It cannot be shown again.' }, 201);
  });
  app.get('/admin/keys', (c) => c.json({ items: listKeys(db) }));
  app.get('/admin/keys/:id/usage', (c) => {
    const rec = getKey(db, c.req.param('id'));
    if (!rec) return err(c, 404, 'NOT_FOUND', 'No such key.');
    const rows = db
      .prepare('SELECT month, count FROM usage WHERE key_id = ? ORDER BY month DESC LIMIT 24')
      .all(rec.id);
    return c.json({ key: rec, usage: rows });
  });
  app.delete('/admin/keys/:id', (c) => {
    if (!revokeKey(db, c.req.param('id'))) return err(c, 404, 'NOT_FOUND', 'No such active key.');
    return c.body(null, 204);
  });

  app.notFound((c) => err(c, 404, 'NOT_FOUND', 'Route not found.'));
  app.onError((e, c) => {
    console.error(e);
    return err(c, 500, 'INTERNAL', 'Something went wrong.');
  });
  return app;
}
