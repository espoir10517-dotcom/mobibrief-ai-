// 주간 브리핑 알림 발송 (GitHub Actions 에서 월요일 매시 정각 실행)
// - 이번 주 브리핑이 새로 발행된 경우에만 보냄 (지난주 내용을 다시 보내지 않음)
// - 각자 정한 시간이 됐거나 지난 사람에게, 이번 브리핑을 아직 안 받은 사람에게만 1번
// - 만료된 구독(앱 삭제·알림 해제)은 목록에서 자동 삭제
// 실행: node scripts/send-push.mjs   (FORCE_HOUR=8 처럼 주면 그 시각으로 간주해 시험 가능)

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cfClient } from '../pipeline/push/cloudflare.mjs';
import { sendPush } from '../pipeline/push/webpush.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_URL = 'https://espoir10517-dotcom.github.io/mobibrief-ai-/';
const CAT = [
  ['auto', '🚗 자동차보험'],
  ['mobility', '🚘 모빌리티'],
  ['insurance', '🏦 보험'],
  ['ai', '🤖 AI 기술'],
];

export function buildMessage(b) {
  const counts = CAT.map(([k, n]) => `${n} ${b.categories?.[k]?.length || 0}`).join(' · ');
  const issue = b.issues?.[0]?.title ? `\n🔥 ${b.issues[0].title}` : '';
  return {
    title: 'MobiBrief AI | 이번 주 브리핑이 도착했습니다',
    body: `${counts}${issue}\n이번 주 꼭 알아야 할 이슈를 확인해보세요.`,
    url: `${APP_URL}#/home`,
    tag: `weekly-${b.date}`,
  };
}

export async function sendWeekly({ env = process.env, now = new Date(), log = console.log, fetchImpl = fetch, briefing } = {}) {
  const cf = cfClient(env, fetchImpl);
  if (!cf) {
    log('ℹ️  Cloudflare 비밀값이 없어 알림을 보내지 않습니다.');
    return { sent: 0, skipped: 'no-config' };
  }
  const b = briefing || JSON.parse(await readFile(path.join(root, 'public/data/live/briefing.json'), 'utf8'));
  const kst = new Date(now.getTime() + 9 * 3600000);
  const hour = env.FORCE_HOUR ? Number(env.FORCE_HOUR) : kst.getUTCHours();
  // 이번 주 브리핑인지 확인: 발행된 지 30시간 이내
  const ageH = (now - Date.parse(b.generatedAt)) / 3600000;
  if (!(ageH >= 0 && ageH <= 30) && !env.FORCE_HOUR) {
    log(`ℹ️  최근 발행된 브리핑이 없어 보내지 않습니다 (발행 ${Math.round(ageH)}시간 전).`);
    return { sent: 0, skipped: 'stale' };
  }

  const nsList = await cf.call(`/{acc}/storage/kv/namespaces?per_page=100`);
  const ns = (nsList.result || []).find((n) => n.title === 'mobibrief-subs')?.id;
  if (!ns) return log('ℹ️  아직 알림을 켠 사람이 없습니다.'), { sent: 0, skipped: 'no-kv' };
  const vapid = await cf.kvGet(ns, 'config:vapid');
  const keys = await cf.kvKeys(ns, 'sub:');
  const msg = buildMessage(b);
  let sent = 0;
  let removed = 0;
  let waiting = 0;
  let done = 0;
  let failed = 0;

  for (const key of keys) {
    const rec = await cf.kvGet(ns, key);
    if (!rec?.subscription) continue;
    if (rec.lastSent === b.date) {
      done++;
      continue;
    }
    if ((rec.hour ?? 8) > hour) {
      waiting++;
      continue;
    }
    try {
      const r = await sendPush(rec.subscription, msg, vapid, { fetchImpl });
      if (r.ok) {
        sent++;
        await cf.kvPut(ns, key, { ...rec, lastSent: b.date, lastSentAt: now.toISOString() });
      } else if (r.gone) {
        removed++;
        await cf.kvDelete(ns, key);
      } else failed++;
    } catch {
      failed++;
    }
  }
  log(`📣 한국시간 ${hour}시 · 보냄 ${sent} · 이미 받음 ${done} · 시간 대기 ${waiting} · 만료 삭제 ${removed} · 실패 ${failed} (전체 ${keys.length}명)`);
  return { sent, done, waiting, removed, failed, total: keys.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await sendWeekly();
  } catch (e) {
    console.error(`❌ 알림 발송 오류: ${e.message}`);
    process.exit(1);
  }
}
