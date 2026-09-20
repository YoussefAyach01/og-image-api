import { describe, expect, it, beforeEach } from 'vitest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { hashKey } from '../src/keys.js';

const ADMIN = 'a'.repeat(32);
const config = { PORT: 3300, ADMIN_TOKEN: ADMIN, DB_PATH: ':memory:', PUBLIC_URL: 'http://x' };
const admin = { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' };
const PNG = [0x89, 0x50, 0x4e, 0x47];

function setup(now = () => new Date('2026-09-20T10:00:00Z')) {
  const db = openDb(':memory:');
  return { db, app: createApp({ config, db, now }) };
}
type App = ReturnType<typeof setup>['app'];
async function mint(app: App, plan = 'free') {
  const r = await app.request('/admin/keys', {
    method: 'POST',
    headers: admin,
    body: JSON.stringify({ label: 't', plan }),
  });
  return (await r.json()) as { key: string; id: string };
}

describe('smoke', () => {
  it('serves landing page and health', async () => {
    const { app } = setup();
    expect((await app.request('/')).status).toBe(200);
    expect(await (await app.request('/health')).json()).toEqual({ ok: true });
  });
});

describe('admin + key storage', () => {
  it('rejects admin calls without the token', async () => {
    const { app } = setup();
    expect((await app.request('/admin/keys')).status).toBe(401);
    const bad = await app.request('/admin/keys', { headers: { Authorization: 'Bearer nope' } });
    expect(bad.status).toBe(401);
  });
  it('stores only a hash of the key, never the plaintext', async () => {
    const { app, db } = setup();
    const { key } = await mint(app);
    const rows = db.prepare('SELECT * FROM api_keys').all() as Record<string, string>[];
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(key);
    expect(rows[0]!.key_hash).toBe(hashKey(key));
    const list = await (await app.request('/admin/keys', { headers: admin })).text();
    expect(list).not.toContain(key);
  });
  it('validates the create body', async () => {
    const { app } = setup();
    const r = await app.request('/admin/keys', {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({ plan: 'gold' }),
    });
    expect(r.status).toBe(400);
  });
});

describe('GET /v1/og', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('401 without a key or with a bad key', async () => {
    expect((await ctx.app.request('/v1/og?title=Hi')).status).toBe(401);
    const r = await ctx.app.request('/v1/og?title=Hi', { headers: { 'x-api-key': 'og_bad' } });
    expect(r.status).toBe(401);
  });
  it('renders a real 1200x630 PNG for each template, via header or query key', async () => {
    const { key } = await mint(ctx.app);
    for (const template of ['default', 'split', 'minimal']) {
      const r = await ctx.app.request(
        `/v1/og?title=Hello%20World&subtitle=Sub&site=x.dev&template=${template}&theme=light&key=${key}`,
      );
      expect(r.status, template).toBe(200);
      expect(r.headers.get('content-type')).toBe('image/png');
      const buf = new Uint8Array(await r.arrayBuffer());
      expect([...buf.slice(0, 4)]).toEqual(PNG);
      const dv = new DataView(buf.buffer);
      expect([dv.getUint32(16), dv.getUint32(20)]).toEqual([1200, 630]);
    }
    const r2 = await ctx.app.request('/v1/og?title=Hi', { headers: { 'x-api-key': key } });
    expect(r2.status).toBe(200);
  });
  it('handles very long titles without failing', async () => {
    const { key } = await mint(ctx.app);
    const r = await ctx.app.request(`/v1/og?title=${'W'.repeat(140)}&key=${key}`);
    expect(r.status).toBe(200);
  });
  it('rejects invalid params with 400 and does not spend quota', async () => {
    const { key } = await mint(ctx.app);
    for (const q of ['', 'title=x&accent=zzz', 'title=x&theme=neon', `title=${'a'.repeat(141)}`]) {
      expect((await ctx.app.request(`/v1/og?${q}&key=${key}`)).status, q).toBe(400);
    }
    const u = await (await ctx.app.request('/v1/usage', { headers: { 'x-api-key': key } })).json();
    expect(u).toMatchObject({ used: 0, limit: 100 });
  });
  it('meters usage and enforces the monthly quota', async () => {
    const { key, id } = await mint(ctx.app);
    ctx.db
      .prepare('INSERT INTO usage (key_id, month, count) VALUES (?, ?, ?)')
      .run(id, '2026-09', 99);
    const ok = await ctx.app.request('/v1/og?title=Last', { headers: { 'x-api-key': key } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('x-quota-remaining')).toBe('0');
    const over = await ctx.app.request('/v1/og?title=Over', { headers: { 'x-api-key': key } });
    expect(over.status).toBe(429);
    expect(((await over.json()) as { error: { code: string } }).error.code).toBe('QUOTA_EXCEEDED');
  });
  it('resets quota in a new month', async () => {
    let d = new Date('2026-09-30T23:00:00Z');
    const { db, app } = setup(() => d);
    const { key, id } = await mint(app);
    db.prepare('INSERT INTO usage (key_id, month, count) VALUES (?, ?, ?)').run(id, '2026-09', 100);
    expect((await app.request('/v1/og?title=A', { headers: { 'x-api-key': key } })).status).toBe(
      429,
    );
    d = new Date('2026-10-01T00:00:01Z');
    expect((await app.request('/v1/og?title=A', { headers: { 'x-api-key': key } })).status).toBe(
      200,
    );
  });
  it('rate-limits per minute (free = 20)', async () => {
    const { key } = await mint(ctx.app);
    const codes: number[] = [];
    for (let i = 0; i < 22; i++) {
      codes.push(
        (await ctx.app.request('/v1/og?title=R', { headers: { 'x-api-key': key } })).status,
      );
    }
    expect(codes.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(codes[20]).toBe(429);
  });
  it('revoked keys stop working immediately', async () => {
    const { key, id } = await mint(ctx.app);
    const del = await ctx.app.request(`/admin/keys/${id}`, { method: 'DELETE', headers: admin });
    expect(del.status).toBe(204);
    expect(
      (await ctx.app.request('/v1/og?title=Hi', { headers: { 'x-api-key': key } })).status,
    ).toBe(401);
  });
  it('does not leak internals when rendering fails', async () => {
    const db = openDb(':memory:');
    const app = createApp({
      config,
      db,
      render: async () => {
        throw new Error('/secret/path boom');
      },
    });
    const { key } = await mint(app);
    const r = await app.request('/v1/og?title=x', { headers: { 'x-api-key': key } });
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain('secret');
  });
});
