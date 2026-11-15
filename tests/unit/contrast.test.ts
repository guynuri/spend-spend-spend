import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** WCAG contrast of the colour tokens actually used for text (PLAN M10 a11y pass). */
function tokens(block: string) {
  return Object.fromEntries([...block.matchAll(/--mz-([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!]));
}
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};
const css = readFileSync('src/client/styles.css', 'utf8');
const light = tokens(css.slice(css.indexOf(':root {'), css.indexOf('.dark {')));
const dark = tokens(css.slice(css.indexOf('.dark {')));

describe('colour contrast ≥ 4.5:1 for text tokens', () => {
  for (const [name, t] of [['light', light], ['dark', dark]] as const)
    for (const fg of ['text', 'muted', 'accent', 'good', 'warn', 'bad'])
      for (const bg of ['bg', 'surface'])
        it(`${name}: ${fg} on ${bg}`, () => expect(ratio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5));
  it('accent foreground on accent buttons', () => {
    expect(ratio(light['accent-fg']!, light.accent!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(dark['accent-fg']!, dark.accent!)).toBeGreaterThanOrEqual(4.5);
  });
});
