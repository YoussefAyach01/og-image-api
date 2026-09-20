import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3300),
  ADMIN_TOKEN: z.string().min(16, 'ADMIN_TOKEN must be at least 16 chars'),
  DB_PATH: z.string().default('./data/og.db'),
  PUBLIC_URL: z.string().default('http://localhost:3300'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}

/** Monthly request quota per plan. */
export const PLANS = {
  free: { monthly: 100, perMinute: 20 },
  pro: { monthly: 10_000, perMinute: 120 },
  business: { monthly: 100_000, perMinute: 600 },
} as const;
export type Plan = keyof typeof PLANS;
