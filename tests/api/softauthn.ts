/** Minimal software passkey (ES256, attestation "none") for API tests. Test-only. */
const te = new TextEncoder();

function b64url(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (ch) => ch.charCodeAt(0));
}
const cat = (...xs: Uint8Array[]) => {
  const out = new Uint8Array(xs.reduce((a, x) => a + x.length, 0));
  let o = 0;
  for (const x of xs) {
    out.set(x, o);
    o += x.length;
  }
  return out;
};
const sha = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', b));

// --- tiny CBOR encoder ---
function head(major: number, n: number): Uint8Array {
  if (n < 24) return Uint8Array.of((major << 5) | n);
  if (n < 256) return Uint8Array.of((major << 5) | 24, n);
  return Uint8Array.of((major << 5) | 25, n >> 8, n & 255);
}
type C = number | string | Uint8Array | Map<C, C>;
function cbor(v: C): Uint8Array {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') {
    const b = te.encode(v);
    return cat(head(3, b.length), b);
  }
  if (v instanceof Uint8Array) return cat(head(2, v.length), v);
  const parts: Uint8Array[] = [head(5, v.size)];
  for (const [k, x] of v) parts.push(cbor(k), cbor(x));
  return cat(...parts);
}

function derSig(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let x = b.slice(i);
    if (x[0]! & 0x80) x = cat(Uint8Array.of(0), x);
    return cat(Uint8Array.of(0x02, x.length), x);
  };
  const r = int(raw.slice(0, 32)), s = int(raw.slice(32));
  return cat(Uint8Array.of(0x30, r.length + s.length), r, s);
}

export class SoftAuthenticator {
  credId = crypto.getRandomValues(new Uint8Array(16));
  counter = 0;
  userHandle: Uint8Array | null = null;
  private keys!: CryptoKeyPair;
  constructor(public rpId = 'example.com', public origin = 'http://example.com') {}

  async register(options: { challenge: string; user: { id: string } }) {
    this.keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    this.userHandle = fromB64url(options.user.id);
    const jwk = (await crypto.subtle.exportKey('jwk', this.keys.publicKey)) as JsonWebKey;
    const cose = cbor(new Map<C, C>([[1, 2], [3, -7], [-1, 1], [-2, fromB64url(jwk.x!)], [-3, fromB64url(jwk.y!)]]));
    const authData = cat(await sha(te.encode(this.rpId)), Uint8Array.of(0x45), Uint8Array.of(0, 0, 0, 0), new Uint8Array(16), Uint8Array.of(0, this.credId.length), this.credId, cose);
    const clientData = te.encode(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin: this.origin, crossOrigin: false }));
    const att = cbor(new Map<C, C>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
    return {
      id: b64url(this.credId),
      rawId: b64url(this.credId),
      type: 'public-key',
      response: { clientDataJSON: b64url(clientData), attestationObject: b64url(att), transports: ['internal'] },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  async login(options: { challenge: string }, counterOverride?: number) {
    this.counter = counterOverride ?? this.counter + 1;
    const c = this.counter;
    const authData = cat(await sha(te.encode(this.rpId)), Uint8Array.of(0x05), Uint8Array.of((c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255));
    const clientData = te.encode(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: this.origin, crossOrigin: false }));
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.keys.privateKey, cat(authData, await sha(clientData))));
    return {
      id: b64url(this.credId),
      rawId: b64url(this.credId),
      type: 'public-key',
      response: { clientDataJSON: b64url(clientData), authenticatorData: b64url(authData), signature: b64url(derSig(sig)), userHandle: this.userHandle ? b64url(this.userHandle) : undefined },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }
}
