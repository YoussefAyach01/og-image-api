# og-image-api

Open Graph / social preview image API. `GET /v1/og?title=...` returns a 1200x630 PNG.
API keys (hashed at rest), monthly usage metering per plan, per-minute rate limits, 3 templates, dark/light themes, custom accent colour.

Stack: Node 22.5+ (uses built-in `node:sqlite`), Hono, satori + resvg (no browser needed), Zod, TypeScript strict.

## Run

```bash
cp .env.example .env          # set ADMIN_TOKEN (16+ chars)
npm install
npm run dev                   # http://localhost:3300
```

Create a key (shown once, only its SHA-256 is stored):

```bash
curl -X POST localhost:3300/admin/keys -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"label":"customer-1","plan":"free"}'
```

Use it:

```
GET /v1/og?title=Hello&subtitle=World&site=example.dev&template=split&theme=dark&accent=ff5500
X-API-Key: og_...         (or ?key=og_... inside an og:image meta tag)
GET /v1/usage             (with the key)
```

Admin (Bearer ADMIN_TOKEN): `POST /admin/keys`, `GET /admin/keys`, `GET /admin/keys/:id/usage`, `DELETE /admin/keys/:id` (revoke).

Plans (edit in `src/config.ts`): free 100/month + 20/min, pro 10,000 + 120/min, business 100,000 + 600/min.
Errors are always `{ "error": { "code", "message" } }`.

## Scripts

`npm run typecheck && npm run lint && npm test`

## Deploy

Any Node host with a persistent disk (Fly.io, Railway, a VPS): `npm ci && npm start`, set `ADMIN_TOKEN`, `DB_PATH` on the persistent volume, put HTTPS in front.
Not suited to serverless (SQLite file + in-memory limiter/cache). Single instance only; use Postgres/Redis if you scale out.

## Known limits

- Latin glyphs only (Inter latin subset). Arabic/CJK/emoji render as missing glyphs. Adding a font with Arabic shaping is the next step.
- The `?key=` form puts the key in URLs (logs, page source). Use one key per site and rotate; a signed-URL scheme is a future improvement.
- Rate limiter and PNG cache are in-memory.
