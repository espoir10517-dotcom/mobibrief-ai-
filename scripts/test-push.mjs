// 웹 푸시 점검: npm run test:push
// 1) RFC 8291 부록 A 의 표준 테스트 벡터와 결과가 정확히 같은지
// 2) 휴대폰(수신자) 입장에서 복호화했을 때 원래 메시지가 나오는지
// 3) VAPID 서명이 공개키로 검증되는지
import { encryptPayload, b64uDecode, b64uEncode, generateVapidKeys, isValidSubscription, sendPush } from '../pipeline/push/webpush.mjs';

let fails = 0;
const ok = (c, m) => {
  console.log(`${c ? '  ✅' : '  ❌'} ${m}`);
  if (!c) fails++;
};
console.log('\n웹 푸시 점검\n');
const subtle = crypto.subtle;

// 1) RFC 8291 Appendix A
const rfc = {
  plaintext: 'When I grow up, I want to be a watermelon',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  expected: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};
const enc = await encryptPayload({ keys: { p256dh: rfc.uaPublic, auth: rfc.authSecret } }, rfc.plaintext, { asPrivate: rfc.asPrivate, asPublic: rfc.asPublic, salt: rfc.salt });
ok(b64uEncode(enc) === rfc.expected, 'RFC 8291 표준 테스트 벡터와 암호문 일치');

// 2) 수신자 복호화 (실제 휴대폰이 하는 일)
async function decrypt(body, uaKeys, authSecret) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const asKey = await subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, uaKeys.privateKey, 256));
  const uaPub = new Uint8Array(await subtle.exportKey('raw', uaKeys.publicKey));
  const h = async (s, k, info, n) => new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, await subtle.importKey('raw', k, 'HKDF', false, ['deriveBits']), n * 8));
  const te = new TextEncoder();
  const info = new Uint8Array([...te.encode('WebPush: info\0'), ...uaPub, ...asPublic]);
  const ikm = await h(authSecret, shared, info, 32);
  const cek = await h(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await h(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), cipher));
  return new TextDecoder().decode(plain.slice(0, plain.lastIndexOf(2)));
}
const ua = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const auth = crypto.getRandomValues(new Uint8Array(16));
const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: b64uEncode(await subtle.exportKey('raw', ua.publicKey)), auth: b64uEncode(auth) } };
const msg = JSON.stringify({ title: 'MobiBrief AI', body: '이번 주 브리핑이 도착했습니다 🚗' });
const body = await encryptPayload(sub, msg);
ok((await decrypt(body, ua, auth)) === msg, '수신자 복호화 → 한글·이모지 메시지 그대로 복원');

// 3) VAPID 서명 검증 + 발송 요청 형식
const vapid = { ...(await generateVapidKeys()), subject: 'mailto:test@example.com' };
let captured;
const r = await sendPush(sub, { title: 't' }, vapid, { fetchImpl: async (url, opts) => ((captured = { url, opts }), new Response('', { status: 201 })) });
const m = captured.opts.headers.Authorization.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
const pubKey = await subtle.importKey('raw', b64uDecode(m[4]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
const valid = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pubKey, b64uDecode(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`));
const claims = JSON.parse(new TextDecoder().decode(b64uDecode(m[2])));
ok(valid, 'VAPID 서명이 공개키로 검증됨');
ok(claims.aud === 'https://fcm.googleapis.com' && claims.exp > Date.now() / 1000, 'VAPID 대상·만료시간 올바름');
ok(r.ok && captured.opts.headers['Content-Encoding'] === 'aes128gcm', '발송 요청 형식 (aes128gcm)');
const gone = await sendPush(sub, { title: 't' }, vapid, { fetchImpl: async () => new Response('', { status: 410 }) });
ok(gone.gone, '만료된 구독(410) 감지 → 목록에서 삭제 대상');
ok(isValidSubscription(sub) && !isValidSubscription({ ...sub, endpoint: 'https://evil.example.com/x' }), '알림 서비스 주소만 허용');

console.log(fails ? `\n❌ ${fails}개 항목 실패\n` : '\n🎉 웹 푸시 점검 통과\n');
process.exit(fails ? 1 : 0);
