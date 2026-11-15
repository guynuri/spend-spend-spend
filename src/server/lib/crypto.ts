import { customAlphabet } from 'nanoid';

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** 21-char ids (PLAN §5). */
export const newId = customAlphabet(alphabet, 21);

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 32 random bytes, base64url (256-bit tokens for sessions, invites, recovery). */
export function randomToken(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison (compares SHA-256 digests so lengths never leak). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export const nowIso = () => new Date().toISOString();
export const isoIn = (ms: number) => new Date(Date.now() + ms).toISOString();
export const DAY_MS = 86_400_000;
