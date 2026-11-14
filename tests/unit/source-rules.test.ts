import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('source rules', () => {
  it('client uses logical properties only (no physical direction classes / CSS)', () => {
    const bad: string[] = [];
    const cls = /(?<![\w-])(ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|scroll-ml|scroll-mr)-[\w[]|(?<![\w-])text-(left|right)(?![\w-])/;
    for (const f of walk('src/client')) {
      const txt = readFileSync(f, 'utf8');
      if (/\.(tsx?|jsx?)$/.test(f)) {
        for (const m of txt.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{cx\(([\s\S]*?)\)\})/g)) {
          const s = m[1] ?? m[2] ?? m[3] ?? '';
          if (cls.test(s)) bad.push(`${f}: ${s.slice(0, 80)}`);
        }
        for (const m of txt.matchAll(/'([^'\n]*)'/g)) if (/\s/.test(m[1]!) && cls.test(m[1]!)) bad.push(`${f}: '${m[1]!.slice(0, 80)}'`);
      }
      if (f.endsWith('.css') && /(^|[\s;{])(left|right|margin-left|margin-right|padding-left|padding-right)\s*:/m.test(txt)) bad.push(f);
    }
    expect(bad).toEqual([]);
  });

  it('env.DB / D1Database / db/global only in allowed server paths (PLAN §6)', () => {
    const allowed = [/^src\/server\/env\.ts$/, /^src\/server\/db\//, /^src\/server\/routes\/(auth|admin)\.ts$/, /^src\/server\/middleware\//, /^src\/server\/seed\//];
    const bad: string[] = [];
    for (const f of walk('src')) {
      if (!/\.(ts|tsx)$/.test(f)) continue;
      const rel = f.split(path.sep).join('/');
      if (allowed.some((r) => r.test(rel))) continue;
      const txt = readFileSync(f, 'utf8');
      const lines = txt.split('\n');
      lines.forEach((line, i) => {
        if (/\.DB\b|D1Database|db\/global/.test(line) && !/eslint-disable-next-line no-restricted-syntax -- the health check/.test(lines[i - 1] ?? '')) bad.push(`${rel}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('no file under fixtures/**/private is tracked by git', () => {
    const tracked = execSync('git ls-files fixtures', { encoding: 'utf8' }).split('\n').filter((l) => l.includes('/private/'));
    expect(tracked).toEqual([]);
  });

  it('no dangerouslySetInnerHTML anywhere in the client', () => {
    const hits = walk('src/client').filter((f) => readFileSync(f, 'utf8').includes('dangerouslySetInnerHTML'));
    expect(hits).toEqual([]);
  });
});
