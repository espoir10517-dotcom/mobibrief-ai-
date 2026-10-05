// AI 키 점검: 등록한 키로 아주 짧은 요청 1번만 보내 정상 동작을 확인합니다 (비용 약 $0.0001).
// 브리핑·앱 데이터는 건드리지 않습니다. 키 값은 화면에 출력하지 않습니다.
// 실행: Actions 탭 → 'AI 키 점검' → Run workflow  (또는 node scripts/check-ai-key.mjs)
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, detectProvider } from '../pipeline/ai/client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(await readFile(path.join(root, 'config/ai.json'), 'utf8'));
const env = process.env;
const name = (k) => (env[k] ? `있음 (${env[k].slice(0, 7)}…, ${env[k].length}자)` : '없음');
console.log(`ANTHROPIC_API_KEY: ${name('ANTHROPIC_API_KEY')}`);
console.log(`OPENAI_API_KEY:    ${name('OPENAI_API_KEY')}`);
for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) if (env[k] && env[k] !== env[k].trim()) console.log(`⚠️  ${k} 앞뒤에 공백이 있습니다. 다시 등록해 주세요.`);

const provider = detectProvider(cfg, env);
if (!provider) {
  console.log('\n❌ 등록된 AI 키를 찾지 못했습니다. 비밀값 이름이 정확히 ANTHROPIC_API_KEY 인지 확인해 주세요.');
  process.exit(1);
}
const client = createClient(cfg, env, { log: () => {} });
try {
  const r = await client.callJson({ system: '반드시 JSON 만 출력.', user: '{"ok":true} 를 그대로 출력해.', maxTokens: 20 });
  if (!r?.ok) throw new Error('응답 형식 이상');
  console.log(`\n✅ ${provider === 'anthropic' ? 'Claude' : 'GPT'} 키 정상 동작 (모델 ${cfg[provider].fastModel}). 다음 발행부터 AI 편집으로 운영됩니다.`);
} catch (e) {
  const m = String(e.message);
  const hint = /401|invalid|authentication/i.test(m)
    ? '키가 틀렸습니다. 콘솔에서 새 키를 만들어 다시 등록해 주세요.'
    : /credit|balance|billing|402|400/i.test(m)
      ? '크레딧(잔액)이 없거나 결제가 완료되지 않았습니다. 콘솔 Billing 에서 충전 상태를 확인해 주세요.'
      : /429|rate/i.test(m)
        ? '요청 한도 초과입니다. 잠시 후 다시 실행해 주세요.'
        : '아래 오류 내용을 Claude 에게 보여 주세요.';
  console.log(`\n❌ AI 호출 실패: ${hint}\n   (${m.slice(0, 200)})`);
  process.exit(1);
}
