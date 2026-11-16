import { describe, expect, it } from 'vitest';
import { b64uDecode, encryptPayload, importPrivate, vapidAuth } from '../../src/server/lib/webpush';
import { b64url } from '../../src/server/lib/crypto';
import { isPushEndpoint } from '../../src/shared/reminders';

// RFC 8291 Appendix A
const V = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

describe('web push', () => {
  it('aes128gcm encryption matches the RFC 8291 test vector', async () => {
    const out = await encryptPayload(new TextEncoder().encode(V.plaintext), V.uaPublic, V.auth, {
      asPrivate: await importPrivate(V.asPrivate, V.asPublic, 'ECDH'),
      asPublic: b64uDecode(V.asPublic),
      salt: b64uDecode(V.salt),
    });
    expect(b64url(out)).toBe(V.body);
  });

  it('VAPID JWT is ES256-signed with the right claims', async () => {
    const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const pub = b64url(new Uint8Array((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer));
    const d = ((await crypto.subtle.exportKey('jwk', kp.privateKey)) as JsonWebKey).d!;
    const h = await vapidAuth('https://fcm.googleapis.com/fcm/send/abc', { publicKey: pub, privateKey: d, subject: 'https://example.com' }, 1_700_000_000_000);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
    expect(m[4]).toBe(pub);
    expect(JSON.parse(new TextDecoder().decode(b64uDecode(m[1]!)))).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(new TextDecoder().decode(b64uDecode(m[2]!)))).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_700_000_000 + 43200, sub: 'https://example.com' });
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, b64uDecode(m[3]!), new TextEncoder().encode(`${m[1]}.${m[2]}`));
    expect(ok).toBe(true);
  });
});

describe('push endpoint allow-list', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://push.services.mozilla.com/x',
    'https://web.push.apple.com/QH',
    'https://wns2-par02p.notify.windows.com/w/?token=x',
  ])('accepts %s', (u) => expect(isPushEndpoint(u)).toBe(true));
  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://storage.googleapis.com/x',
    'https://evil.mozilla.com/x',
    'https://push.apple.com/x',
    'https://notify.windows.com/x',
    'https://fcm.googleapis.com.evil.com/x',
    'https://fcm.googleapis.com:8443/x',
    'https://user:pw@fcm.googleapis.com/x',
    'https://evil.com/?fcm.googleapis.com',
    'not a url',
  ])('rejects %s', (u) => expect(isPushEndpoint(u)).toBe(false));
});
