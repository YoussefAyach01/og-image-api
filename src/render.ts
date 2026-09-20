import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { z } from 'zod';

const require = createRequire(import.meta.url);
const fontDir = require
  .resolve('@fontsource/inter/package.json')
  .replace(/package\.json$/, 'files/');
const fonts = [
  {
    name: 'Inter',
    data: readFileSync(`${fontDir}inter-latin-400-normal.woff`),
    weight: 400 as const,
    style: 'normal' as const,
  },
  {
    name: 'Inter',
    data: readFileSync(`${fontDir}inter-latin-700-normal.woff`),
    weight: 700 as const,
    style: 'normal' as const,
  },
];

export const WIDTH = 1200;
export const HEIGHT = 630;

export const ogParamsSchema = z.object({
  title: z.string().trim().min(1, 'title is required').max(140),
  subtitle: z.string().trim().max(200).optional(),
  site: z.string().trim().max(60).optional(),
  theme: z.enum(['dark', 'light']).default('dark'),
  template: z.enum(['default', 'split', 'minimal']).default('default'),
  accent: z
    .string()
    .regex(/^[0-9a-fA-F]{6}$/, 'accent must be a 6-digit hex colour without #')
    .default('6366f1'),
});
export type OgParams = z.infer<typeof ogParamsSchema>;

type Node = { type: string; props: Record<string, unknown> };
const el = (
  type: string,
  style: Record<string, unknown>,
  children?: unknown,
  extra: Record<string, unknown> = {},
): Node => ({
  type,
  props: { style: { display: 'flex', ...style }, children, ...extra },
});

const palette = (theme: OgParams['theme']) =>
  theme === 'dark'
    ? { bg: '#0b0f1a', fg: '#f8fafc', muted: '#a8b3c7' }
    : { bg: '#ffffff', fg: '#0f172a', muted: '#475569' };

/** Shrink long titles so they still fit in the card. */
function titleSize(title: string, base: number): number {
  const n = title.length;
  if (n <= 40) return base;
  if (n <= 80) return Math.round(base * 0.8);
  return Math.round(base * 0.62);
}

export function buildTree(p: OgParams): Node {
  const c = palette(p.theme);
  const accent = `#${p.accent}`;
  const site = p.site ? el('div', { fontSize: 30, fontWeight: 700, color: accent }, p.site) : null;
  const sub = p.subtitle
    ? el('div', { fontSize: 34, color: c.muted, marginTop: 24, lineHeight: 1.35 }, p.subtitle)
    : null;
  const title = (base: number) =>
    el(
      'div',
      {
        fontSize: titleSize(p.title, base),
        fontWeight: 700,
        color: c.fg,
        lineHeight: 1.1,
        letterSpacing: -2,
      },
      p.title,
    );
  const root = { width: WIDTH, height: HEIGHT, background: c.bg, fontFamily: 'Inter' };

  if (p.template === 'split') {
    return el('div', { ...root, flexDirection: 'row' }, [
      el('div', { width: 60, height: HEIGHT, background: accent }),
      el(
        'div',
        { flexDirection: 'column', justifyContent: 'space-between', padding: 72, flex: 1 },
        [site ?? el('div', {}, ''), el('div', { flexDirection: 'column' }, [title(76), sub])],
      ),
    ]);
  }
  if (p.template === 'minimal') {
    return el('div', { ...root, flexDirection: 'column', justifyContent: 'center', padding: 96 }, [
      title(84),
      sub,
      site ? el('div', { marginTop: 40 }, site) : null,
    ]);
  }
  return el(
    'div',
    { ...root, flexDirection: 'column', justifyContent: 'space-between', padding: 72 },
    [
      el('div', { width: 120, height: 12, background: accent, borderRadius: 6 }),
      el('div', { flexDirection: 'column' }, [title(80), sub]),
      site ?? el('div', {}, ''),
    ],
  );
}

const clean = (n: unknown): unknown => {
  if (Array.isArray(n)) return n.filter((x) => x !== null).map(clean);
  if (n && typeof n === 'object') {
    const o = n as Node;
    return { ...o, props: { ...o.props, children: clean(o.props.children) } };
  }
  return n;
};

export async function renderPng(p: OgParams): Promise<Buffer> {
  const svg = await satori(clean(buildTree(p)) as never, { width: WIDTH, height: HEIGHT, fonts });
  return Buffer.from(
    new Resvg(svg, { font: { loadSystemFonts: false }, fitTo: { mode: 'width', value: WIDTH } })
      .render()
      .asPng(),
  );
}

/** Tiny LRU so repeated crawls of the same card don't re-render. */
export class PngCache {
  private m = new Map<string, Buffer>();
  constructor(private max = 200) {}
  get(k: string) {
    const v = this.m.get(k);
    if (v) {
      this.m.delete(k);
      this.m.set(k, v);
    }
    return v;
  }
  set(k: string, v: Buffer) {
    this.m.set(k, v);
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string);
  }
}
