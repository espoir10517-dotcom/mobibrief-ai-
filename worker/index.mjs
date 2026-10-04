// MobiBrief 알림 서버 (Cloudflare Worker)
// 하는 일: 알림을 켠 휴대폰의 '받을 주소(구독 정보)'와 받을 시간을 저장 / 삭제, 시험 알림 1건 발송
// 매주 월요일 실제 발송은 GitHub Actions(scripts/send-push.mjs)가 합니다.
// 저장 내용: 알림 주소·받을 시간만 저장하며 이름·이메일 같은 개인정보는 받지 않습니다.
//
// 바인딩(scripts/deploy-push.mjs 가 자동 설정): SUBS(KV), ALLOWED_ORIGIN, APP_URL

import { sendPush, isValidSubscription } from '../pipeline/push/webpush.mjs';

const json = (data, status, cors) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors } });

async function keyFor(endpoint) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)));
  return `sub:${[...d.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function corsFor(request, env) {
  const origin = request.headers.get('origin') || '';
  const allowed = [env.ALLOWED_ORIGIN, 'http://localhost:5173'].filter(Boolean);
  return {
    'access-control-allow-origin': allowed.includes(origin) ? origin : env.ALLOWED_ORIGIN || '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'origin',
  };
}

const kstDay = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

export default {
  async fetch(request, env) {
    const cors = corsFor(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const { pathname } = new URL(request.url);

    try {
      if (pathname === '/health') return json({ ok: true }, 200, cors);

      if (pathname === '/vapid-public-key') {
        const v = await env.SUBS.get('config:vapid', 'json');
        if (!v) return json({ error: '알림 키가 아직 준비되지 않았습니다' }, 503, cors);
        return json({ publicKey: v.publicKey }, 200, cors);
      }

      if (request.method !== 'POST') return json({ error: 'not found' }, 404, cors);
      const body = await request.json().catch(() => ({}));

      if (pathname === '/subscribe') {
        const sub = body.subscription;
        if (!sub || !isValidSubscription(sub)) return json({ error: '알림 정보가 올바르지 않습니다' }, 400, cors);
        const hour = Math.min(22, Math.max(7, Number.parseInt(body.hour, 10) || 8));
        const key = await keyFor(sub.endpoint);
        const prev = (await env.SUBS.get(key, 'json')) || {};
        await env.SUBS.put(key, JSON.stringify({ ...prev, subscription: { endpoint: sub.endpoint, keys: sub.keys }, hour, updatedAt: new Date().toISOString(), createdAt: prev.createdAt || new Date().toISOString() }));
        return json({ ok: true, hour }, 200, cors);
      }

      if (pathname === '/unsubscribe') {
        if (!body.endpoint) return json({ error: 'endpoint 필요' }, 400, cors);
        await env.SUBS.delete(await keyFor(body.endpoint));
        return json({ ok: true }, 200, cors);
      }

      if (pathname === '/test') {
        if (!body.endpoint) return json({ error: 'endpoint 필요' }, 400, cors);
        const key = await keyFor(body.endpoint);
        const rec = await env.SUBS.get(key, 'json');
        if (!rec) return json({ error: '먼저 알림을 켜 주세요' }, 404, cors);
        // 하루 3번까지만 (남용 방지)
        const today = kstDay();
        const count = rec.testDay === today ? rec.testCount || 0 : 0;
        if (count >= 3) return json({ error: '시험 알림은 하루 3번까지 보낼 수 있습니다' }, 429, cors);
        const vapid = await env.SUBS.get('config:vapid', 'json');
        const r = await sendPush(rec.subscription, { title: 'MobiBrief AI 알림 시험', body: '알림이 잘 연결되었습니다. 매주 월요일 이번 주 브리핑을 알려드릴게요.', url: env.APP_URL || '/', tag: 'mobibrief-test' }, vapid);
        if (r.gone) await env.SUBS.delete(key);
        else await env.SUBS.put(key, JSON.stringify({ ...rec, testDay: today, testCount: count + 1 }));
        return json({ ok: r.ok, status: r.status }, r.ok ? 200 : 502, cors);
      }

      return json({ error: 'not found' }, 404, cors);
    } catch (e) {
      return json({ error: '알림 서버 오류', detail: String(e?.message || e).slice(0, 200) }, 500, cors);
    }
  },
};
