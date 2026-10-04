// 알림 서버·배포·발송 점검 (Cloudflare·휴대폰을 가짜로 흉내 내어 실행): npm run test:push
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import worker from '../worker/index.mjs';
import { generateVapidKeys, b64uEncode } from '../pipeline/push/webpush.mjs';
import { deployPush } from './deploy-push.mjs';
import { sendWeekly, buildMessage } from './send-push.mjs';

let fails = 0;
const ok = (c, m) => {
  console.log(`${c ? '  ✅' : '  ❌'} ${m}`);
  if (!c) fails++;
};
console.log('\n알림 서버·발송 점검\n');

// 가짜 휴대폰 구독 만들기
async function fakeSub(host = 'fcm.googleapis.com', id = Math.random().toString(36).slice(2)) {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { endpoint: `https://${host}/fcm/send/${id}`, keys: { p256dh: b64uEncode(await crypto.subtle.exportKey('raw', kp.publicKey)), auth: b64uEncode(crypto.getRandomValues(new Uint8Array(16))) } };
}

// ───────── 1) Worker ─────────
const store = new Map();
const KV = {
  get: async (k, t) => (store.has(k) ? (t === 'json' ? JSON.parse(store.get(k)) : store.get(k)) : null),
  put: async (k, v) => void store.set(k, v),
  delete: async (k) => void store.delete(k),
};
const env = { SUBS: KV, ALLOWED_ORIGIN: 'https://espoir10517-dotcom.github.io', APP_URL: 'https://espoir10517-dotcom.github.io/mobibrief-ai-/' };
const call = (p, body, method = body ? 'POST' : 'GET') =>
  worker.fetch(new Request(`https://w.example${p}`, { method, headers: { origin: env.ALLOWED_ORIGIN, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env);

ok((await call('/vapid-public-key')).status === 503, '서명 키 준비 전에는 503');
const vapid = await generateVapidKeys();
store.set('config:vapid', JSON.stringify(vapid));
const vk = await (await call('/vapid-public-key')).json();
ok(vk.publicKey === vapid.publicKey, '공개키 제공 (개인키는 노출 안 함)');
const pre = await call('/subscribe', undefined, 'OPTIONS');
ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === env.ALLOWED_ORIGIN, '앱 주소에서만 호출 허용(CORS)');
const sub = await fakeSub();
const r1 = await (await call('/subscribe', { subscription: sub, hour: 9 })).json();
ok(r1.ok && r1.hour === 9 && [...store.keys()].some((k) => k.startsWith('sub:')), '알림 켜기 → 구독 저장 (9시)');
ok((await call('/subscribe', { subscription: { ...sub, endpoint: 'https://evil.example.com/x' } })).status === 400, '이상한 주소는 거부');
const r99 = await (await call('/subscribe', { subscription: sub, hour: 99 })).json();
ok(r99.hour === 22, '시간 범위 밖 값은 7~22시로 보정');
const subKeys = [...store.keys()].filter((k) => k.startsWith('sub:'));
ok(subKeys.length === 1 && JSON.parse(store.get(subKeys[0])).hour === 22, '같은 휴대폰은 1건으로 갱신');

const realFetch = globalThis.fetch;
let pushCalls = 0;
globalThis.fetch = async (url) => (pushCalls++, new Response('', { status: 201 }));
const t1 = await call('/test', { endpoint: sub.endpoint });
await call('/test', { endpoint: sub.endpoint });
await call('/test', { endpoint: sub.endpoint });
const t4 = await call('/test', { endpoint: sub.endpoint });
globalThis.fetch = realFetch;
ok(t1.status === 200 && pushCalls === 3 && t4.status === 429, '시험 알림 발송 + 하루 3회 제한');
await call('/unsubscribe', { endpoint: sub.endpoint });
ok(![...store.keys()].some((k) => k.startsWith('sub:')), '알림 끄기 → 구독 삭제');

// ───────── 2) 배포 (가짜 Cloudflare API) ─────────
const cfKV = new Map();
let uploaded = null;
let subdomainEnabled = false;
const cfFetch = async (url, opts = {}) => {
  const u = new URL(url);
  const p = u.pathname;
  const j = (data, status = 200) => new Response(JSON.stringify({ success: status < 400, result: data, errors: status < 400 ? [] : [{ code: status, message: 'err' }] }), { status });
  if (p.endsWith('/health')) return new Response('{}', { status: 200 });
  if (p.endsWith('/storage/kv/namespaces') && opts.method === 'POST') return j({ id: 'ns1' });
  if (p.endsWith('/storage/kv/namespaces')) return j(cfKV.size ? [{ id: 'ns1', title: 'mobibrief-subs' }] : []);
  const mv = p.match(/\/values\/(.+)$/);
  if (mv) {
    const key = decodeURIComponent(mv[1]);
    if (opts.method === 'PUT') return cfKV.set(key, opts.body), new Response('{}', { status: 200 });
    if (opts.method === 'DELETE') return cfKV.delete(key), new Response('{}', { status: 200 });
    return cfKV.has(key) ? new Response(cfKV.get(key), { status: 200 }) : new Response('', { status: 404 });
  }
  if (p.endsWith('/keys')) return new Response(JSON.stringify({ success: true, result: [...cfKV.keys()].filter((k) => k.startsWith(u.searchParams.get('prefix') || '')).map((name) => ({ name })), result_info: {} }), { status: 200 });
  if (p.endsWith('/workers/scripts/mobibrief-push') && opts.method === 'PUT') return (uploaded = opts.body), j({ id: 'mobibrief-push' });
  if (p.endsWith('/workers/subdomain') && opts.method === 'PUT') return j({ subdomain: JSON.parse(opts.body).subdomain });
  if (p.endsWith('/workers/subdomain')) return j(null, 404);
  if (p.endsWith('/mobibrief-push/subdomain')) return (subdomainEnabled = true), j({ enabled: true });
  return j(null, 404);
};
const tmp = await mkdtemp(path.join(tmpdir(), 'mb-push-'));
const cfgPath = path.join(tmp, 'config.js');
await writeFile(cfgPath, "export const PUSH_API = '';\n");
const dep = await deployPush({ env: { CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'abcdef123456' }, log: () => {}, fetchImpl: cfFetch, cfgPath, healthWaitMs: 1 });
const meta = uploaded && JSON.parse(await uploaded.get('metadata').text());
const idx = uploaded && (await uploaded.get('index.mjs').text());
ok(cfKV.has('config:vapid'), '배포: 알림 서명 키 1회 생성');
ok(meta?.main_module === 'index.mjs' && meta.bindings.some((b) => b.type === 'kv_namespace' && b.name === 'SUBS'), '배포: 서버 코드 + 저장소 연결');
ok(idx?.includes("from './webpush.mjs'") && uploaded.get('webpush.mjs'), '배포: 암호화 모듈 함께 업로드');
ok(subdomainEnabled && dep.url === 'https://mobibrief-push.mobibrief-abcdef.workers.dev', `배포: 주소 연결 (${dep.url})`);
ok((await readFile(cfgPath, 'utf8')).includes(dep.url), '배포: 앱 설정에 서버 주소 기록 → 알림 화면 표시');
const firstKey = cfKV.get('config:vapid');
await deployPush({ env: { CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'abcdef123456' }, log: () => {}, fetchImpl: cfFetch, cfgPath, healthWaitMs: 1 });
ok(cfKV.get('config:vapid') === firstKey, '다시 배포해도 서명 키 유지 (기존 구독 계속 유효)');

// ───────── 3) 월요일 발송 ─────────
const briefing = { date: '2026-10-12', generatedAt: '2026-10-11T21:40:00Z', categories: { auto: Array(10), mobility: Array(10), insurance: Array(10), ai: Array(10) }, issues: [{ title: 'AI 해킹, 금융권 전방위 확산' }] };
const msg = buildMessage(briefing);
ok(msg.body.startsWith('🚗 자동차보험 10 · 🚘 모빌리티 10 · 🏦 보험 10 · 🤖 AI 기술 10') && msg.body.includes('AI 해킹'), `알림 문구: ${msg.title} / ${msg.body.split('\n')[0]}`);
const s7 = await fakeSub('fcm.googleapis.com', 'a');
const s8 = await fakeSub('web.push.apple.com', 'b');
const s21 = await fakeSub('fcm.googleapis.com', 'c');
const sDone = await fakeSub('fcm.googleapis.com', 'd');
const sGone = await fakeSub('fcm.googleapis.com', 'gone');
cfKV.set('sub:a', JSON.stringify({ subscription: s7, hour: 7 }));
cfKV.set('sub:b', JSON.stringify({ subscription: s8, hour: 8 }));
cfKV.set('sub:c', JSON.stringify({ subscription: s21, hour: 21 }));
cfKV.set('sub:d', JSON.stringify({ subscription: sDone, hour: 7, lastSent: '2026-10-12' }));
cfKV.set('sub:e', JSON.stringify({ subscription: sGone, hour: 7 }));
const pushed = [];
const sendFetch = async (url, opts) => {
  if (String(url).includes('api.cloudflare.com')) return cfFetch(url, opts);
  pushed.push(String(url));
  return new Response('', { status: String(url).includes('gone') ? 410 : 201 });
};
const env2 = { CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'abcdef123456' };
const at8 = new Date('2026-10-11T23:05:00Z'); // 한국시간 월요일 08:05
const r8 = await sendWeekly({ env: env2, now: at8, log: () => {}, fetchImpl: sendFetch, briefing });
ok(r8.sent === 2 && pushed.length === 3, `08시: 7시·8시 사용자에게 발송, 21시는 대기 (보냄 ${r8.sent})`);
ok(r8.done === 1, '이미 받은 사람에게는 다시 안 보냄');
ok(r8.removed === 1 && !cfKV.has('sub:e'), '만료된 구독은 자동 삭제');
const again = await sendWeekly({ env: env2, now: new Date('2026-10-12T00:05:00Z'), log: () => {}, fetchImpl: sendFetch, briefing });
ok(again.sent === 0, '다음 시간에 다시 실행돼도 중복 발송 없음');
const at21 = await sendWeekly({ env: env2, now: new Date('2026-10-12T12:05:00Z'), log: () => {}, fetchImpl: sendFetch, briefing });
ok(at21.sent === 1, '21시: 21시 사용자에게 발송');
const stale = await sendWeekly({ env: env2, now: new Date('2026-10-19T00:05:00Z'), log: () => {}, fetchImpl: sendFetch, briefing });
ok(stale.skipped === 'stale', '새 브리핑이 없는 주에는 알림 안 보냄');
const noCfg = await sendWeekly({ env: {}, log: () => {} });
ok(noCfg.skipped === 'no-config', 'Cloudflare 설정 전에는 조용히 건너뜀');

console.log(fails ? `\n❌ ${fails}개 항목 실패\n` : '\n🎉 알림 서버·발송 점검 통과\n');
process.exit(fails ? 1 : 0);
