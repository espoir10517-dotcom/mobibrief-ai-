// 웹 푸시 발송 모듈 (외부 라이브러리 없이 표준 WebCrypto 만 사용)
// - RFC 8291: 메시지 암호화 (aes128gcm)
// - RFC 8292: VAPID 서명 (발신자 인증)
// Node.js(GitHub Actions)와 Cloudflare Workers 양쪽에서 같은 코드로 동작합니다.

const te = new TextEncoder();
const subtle = globalThis.crypto.subtle;

export function b64uEncode(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64uDecode(str) {
  const s = atob(String(str).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(str).length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
const concat = (...arrs) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
};

async function hkdf(salt, ikm, info, length) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

// 공개키(65바이트, 04||x||y)와 개인키(d) → JWK
function ecJwk(publicRaw, dB64u) {
  return { kty: 'EC', crv: 'P-256', x: b64uEncode(publicRaw.slice(1, 33)), y: b64uEncode(publicRaw.slice(33, 65)), ...(dB64u ? { d: dB64u } : {}), ext: true };
}

// ───────── VAPID 키 ─────────
export async function generateVapidKeys() {
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
  const jwk = await subtle.exportKey('jwk', kp.privateKey);
  return { publicKey: b64uEncode(pub), privateKey: jwk.d };
}

async function vapidAuthHeader(endpoint, vapid) {
  const aud = new URL(endpoint).origin;
  const header = b64uEncode(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64uEncode(te.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: vapid.subject || 'mailto:admin@example.com' })));
  const pubRaw = b64uDecode(vapid.publicKey);
  const key = await subtle.importKey('jwk', ecJwk(pubRaw, vapid.privateKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(`${header}.${payload}`)));
  return `vapid t=${header}.${payload}.${b64uEncode(sig)}, k=${vapid.publicKey}`;
}

// ───────── 메시지 암호화 (RFC 8291) ─────────
// testing: { asPrivate, asPublic, salt } 를 주면 정해진 값으로 암호화 (표준 테스트 벡터 검증용)
export async function encryptPayload(subscription, plaintext, testing) {
  const uaPublic = b64uDecode(subscription.keys.p256dh);
  const authSecret = b64uDecode(subscription.keys.auth);
  let asPublic;
  let asPrivateKey;
  if (testing) {
    asPublic = b64uDecode(testing.asPublic);
    asPrivateKey = await subtle.importKey('jwk', ecJwk(asPublic, testing.asPrivate), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  } else {
    const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    asPublic = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
    asPrivateKey = kp.privateKey;
  }
  const uaKey = await subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPrivateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = testing ? b64uDecode(testing.salt) : crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const data = concat(typeof plaintext === 'string' ? te.encode(plaintext) : plaintext, new Uint8Array([2]));
  const aes = await subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, data));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

// 알림 1건 보내기 → { ok, status, gone } (gone = 구독이 만료돼 삭제해야 함)
export async function sendPush(subscription, payload, vapid, { ttl = 86400, fetchImpl = fetch } = {}) {
  const body = await encryptPayload(subscription, JSON.stringify(payload));
  const res = await fetchImpl(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthHeader(subscription.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: 'normal',
    },
    body,
  });
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}

// 알림 서비스 주소만 허용 (아무 주소로나 요청을 보내게 악용되지 않도록)
const PUSH_HOSTS = [/\.googleapis\.com$/, /\.push\.apple\.com$/, /\.mozilla\.com$/, /\.notify\.windows\.com$/, /\.push\.services\.mozilla\.com$/];
export function isValidSubscription(sub) {
  try {
    const u = new URL(sub.endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname)) && b64uDecode(sub.keys.p256dh).length === 65 && b64uDecode(sub.keys.auth).length >= 16;
  } catch {
    return false;
  }
}
