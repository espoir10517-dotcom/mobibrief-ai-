// 알림 서버 자동 배포 (GitHub Actions 에서 실행)
// 1) 구독 저장소(KV) 준비  2) 알림 서명 키(VAPID) 1회 생성  3) Worker 업로드
// 4) workers.dev 주소 연결  5) 앱 설정(public/js/config.js)에 서버 주소 기록
// 실행: node scripts/deploy-push.mjs   (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID 필요)

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cfClient, SCRIPT_NAME } from '../pipeline/push/cloudflare.mjs';
import { generateVapidKeys } from '../pipeline/push/webpush.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_ORIGIN = 'https://espoir10517-dotcom.github.io';
const APP_URL = `${APP_ORIGIN}/mobibrief-ai-/`;

export async function deployPush({ env = process.env, log = console.log, fetchImpl = fetch, cfgPath = path.join(root, 'public/js/config.js'), healthWaitMs = 5000 } = {}) {
  const cf = cfClient(env, fetchImpl);
  if (!cf) throw new Error('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID 비밀값이 없습니다. README 의 알림 설정 안내를 확인하세요.');

  log('1/5 구독 저장소(KV) 확인');
  const ns = await cf.findOrCreateKv();

  log('2/5 알림 서명 키 확인');
  if (!(await cf.kvGet(ns, 'config:vapid'))) {
    const keys = await generateVapidKeys();
    await cf.kvPut(ns, 'config:vapid', { ...keys, subject: 'mailto:espoir10517@gmail.com', createdAt: new Date().toISOString() });
    log('   새 알림 서명 키를 만들었습니다');
  }

  log('3/5 알림 서버 업로드');
  const index = (await readFile(path.join(root, 'worker/index.mjs'), 'utf8')).replace("'../pipeline/push/webpush.mjs'", "'./webpush.mjs'");
  const webpush = await readFile(path.join(root, 'pipeline/push/webpush.mjs'), 'utf8');
  const form = new FormData();
  form.append(
    'metadata',
    new Blob(
      [
        JSON.stringify({
          main_module: 'index.mjs',
          compatibility_date: '2026-09-01',
          bindings: [
            { type: 'kv_namespace', name: 'SUBS', namespace_id: ns },
            { type: 'plain_text', name: 'ALLOWED_ORIGIN', text: APP_ORIGIN },
            { type: 'plain_text', name: 'APP_URL', text: APP_URL },
          ],
        }),
      ],
      { type: 'application/json' },
    ),
  );
  form.append('index.mjs', new Blob([index], { type: 'application/javascript+module' }), 'index.mjs');
  form.append('webpush.mjs', new Blob([webpush], { type: 'application/javascript+module' }), 'webpush.mjs');
  await cf.call(`/{acc}/workers/scripts/${SCRIPT_NAME}`, { method: 'PUT', body: form });

  log('4/5 workers.dev 주소 연결');
  let sub;
  try {
    sub = (await cf.call(`/{acc}/workers/subdomain`)).result?.subdomain;
  } catch {
    sub = null;
  }
  if (!sub) {
    const name = `mobibrief-${cf.account.slice(0, 6).toLowerCase()}`;
    try {
      sub = (await cf.call(`/{acc}/workers/subdomain`, { method: 'PUT', body: { subdomain: name } })).result?.subdomain || name;
    } catch (e) {
      throw new Error(`workers.dev 주소를 만들지 못했습니다. Cloudflare 화면에서 Workers & Pages 메뉴를 한 번 열어 주세요. (${e.message})`);
    }
  }
  await cf.call(`/{acc}/workers/scripts/${SCRIPT_NAME}/subdomain`, { method: 'POST', body: { enabled: true, previews_enabled: false } });
  const url = `https://${SCRIPT_NAME}.${sub}.workers.dev`;

  // 새 주소는 연결까지 잠시 걸릴 수 있음
  let healthy = false;
  for (let i = 0; i < 12 && !healthy; i++) {
    try {
      const r = await fetchImpl(`${url}/health`);
      healthy = r.ok;
    } catch {
      /* 대기 */
    }
    if (!healthy) await new Promise((r) => setTimeout(r, healthWaitMs));
  }
  log(`   ${url} ${healthy ? '✅ 응답 확인' : '⚠️ 아직 응답 없음 (몇 분 뒤 자동 연결)'}`);

  log('5/5 앱 설정에 서버 주소 기록');
  const cfg = await readFile(cfgPath, 'utf8');
  const next = cfg.replace(/export const PUSH_API = '.*?';/, `export const PUSH_API = '${url}';`);
  if (next !== cfg) await writeFile(cfgPath, next);
  return { url, healthy, changed: next !== cfg };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
    console.log('ℹ️  Cloudflare 비밀값이 아직 없어 알림 서버 배포를 건너뜁니다. 등록 후 Actions 탭에서 다시 실행하세요.');
    process.exit(0);
  }
  try {
    const r = await deployPush();
    console.log(`\n✅ 알림 서버 준비 완료: ${r.url}${r.changed ? ' (앱 설정 갱신)' : ''}`);
  } catch (e) {
    console.error(`\n❌ ${e.message}`);
    process.exit(1);
  }
}
