import { describe, expect, it } from 'vitest';
import { checkShortcut, shortcutHasKey } from '../../src/server/lib/shortcutCheck';

const link = 'https://www.icloud.com/shortcuts/80dfb62f91ba41ac8808d1e331e46675';
const fake = (file: string) =>
  (async (url: string) =>
    url.includes('/api/records/')
      ? new Response(JSON.stringify({ fields: { shortcut: { value: { downloadURL: 'https://cvws.icloud-content.com/x/${f}' } } } }))
      : new Response(new TextEncoder().encode(file))) as unknown as typeof fetch;

describe('shared shortcut key check', () => {
  it('finds a capture key inside the shortcut file', async () => {
    expect(await shortcutHasKey(link, fake('bplist00...Bearer mz_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefg...'))).toBe(true);
    expect(await shortcutHasKey(link, fake('bplist00...Bearer ...Import Question...'))).toBe(false);
  });
  it('accepts the link when iCloud cannot be read', async () => {
    expect(await shortcutHasKey(link, (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBe(false);
  });
});

describe('the app-wide link must be verified (D-R34)', () => {
  it('tells a clean shortcut, one with a key, and one iCloud could not give us apart', async () => {
    expect(await checkShortcut(link, fake('bplist00...Import Question...'))).toBe('ok');
    expect(await checkShortcut(link, fake('bplist00...Bearer mz_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefg'))).toBe('key');
    expect(await checkShortcut(link, (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBe('unverified');
    expect(await checkShortcut(link, (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch)).toBe('unverified');
  });
});
