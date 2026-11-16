/**
 * Web Push with WebCrypto only (runs on Workers): RFC 8291 aes128gcm payload encryption and
 * RFC 8292 VAPID (ES256 JWT). Keys are base64url: public = 65-byte uncompressed P-256 point, private = 32-byte d.
 */
import { b64url } from './crypto';

const enc = new TextEncoder();
type Bytes = Uint8Array<ArrayBuffer>;
const utf8 = (s: string) => enc.encode(s) as Bytes;
const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;

export function b64uDecode(s: string): Bytes {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) out.set(p, (i += p.length) - p.length);
  return out;
};
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, len: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

/** Imports a P-256 private key from raw d + its uncompressed public point. */
export function importPrivate(d: string, pub: string, alg: 'ECDH' | 'ECDSA') {
  const p = b64uDecode(pub);
  const jwk = { kty: 'EC', crv: 'P-256', d, x: b64url(p.slice(1, 33)), y: b64url(p.slice(33, 65)), ext: true };
  return crypto.subtle.importKey('jwk', jwk, { name: alg, namedCurve: 'P-256' }, false, alg === 'ECDH' ? ['deriveBits'] : ['sign']);
}

/** RFC 8291 §3.4 single-record aes128gcm body. `fixed` pins the sender key and salt (test vector only). */
export async function encryptPayload(plaintext: Bytes, p256dh: string, auth: string, fixed?: { asPrivate: CryptoKey; asPublic: Bytes; salt: Bytes }) {
  const ua = b64uDecode(p256dh);
  let asPrivate: CryptoKey, asPublic: Bytes;
  if (fixed) ({ asPrivate, asPublic } = fixed);
  else {
    const kp = (await crypto.subtle.generateKey(P256, true, ['deriveBits'])) as CryptoKeyPair;
    asPrivate = kp.privateKey;
    asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer);
  }
  const uaKey = await crypto.subtle.importKey('raw', ua, P256, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as unknown as Parameters<SubtleCrypto['deriveBits']>[0], asPrivate, 256));
  const ikm = await hkdf(b64uDecode(auth), ecdh, concat(enc.encode('WebPush: info\0'), ua, asPublic), 32);
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = 65;
  return concat(header, asPublic, ct);
}

/** `Authorization` header value for a push endpoint (JWT valid 12 h). */
export async function vapidAuth(endpoint: string, keys: VapidKeys, now = Date.now()) {
  const part = (o: object) => b64url(enc.encode(JSON.stringify(o)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject })}`;
  const key = await importPrivate(keys.privateKey, keys.publicKey, 'ECDSA');
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned)));
  return `vapid t=${unsigned}.${b64url(sig)}, k=${keys.publicKey}`;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}
/** Generic text + an in-app URL only: payloads transit third-party push services. */
export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export function vapidKeys(env: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string; APP_HOST?: string }): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || `https://${env.APP_HOST || 'localhost'}` };
}

/** Sends one push; returns the push service's HTTP status (404/410 = subscription gone). */
export async function sendPush(keys: VapidKeys, to: PushTarget, msg: PushMessage, fetchImpl: typeof fetch = fetch): Promise<number> {
  const body = await encryptPayload(utf8(JSON.stringify(msg)), to.p256dh, to.auth);
  const res = await fetchImpl(to.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidAuth(to.endpoint, keys), TTL: '86400', Urgency: 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream' },
    body,
  });
  return res.status;
}
