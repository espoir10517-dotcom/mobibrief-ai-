// AI 호출 모듈 — Claude(Anthropic) 와 GPT(OpenAI) 를 같은 방식으로 부릅니다.
// - API 키는 환경변수(GitHub 비밀값)에서만 읽습니다. 앱 화면 코드에는 절대 들어가지 않습니다.
// - 공개 뉴스의 제목·요약문만 보내며, 사용자 정보(즐겨찾기·키워드 등)는 보내지 않습니다.
// - 한 번 실행에서 호출 횟수·예상 비용 상한을 넘으면 멈춥니다(config/ai.json).

const ENDPOINTS = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/chat/completions',
};

export function detectProvider(cfg, env = process.env) {
  const want = cfg.provider || 'auto';
  if (want === 'anthropic') return env.ANTHROPIC_API_KEY ? 'anthropic' : null;
  if (want === 'openai') return env.OPENAI_API_KEY ? 'openai' : null;
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  if (env.OPENAI_API_KEY) return 'openai';
  return null;
}

export function extractJson(text) {
  const s = String(text);
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 응답에서 JSON을 찾지 못했습니다');
  return JSON.parse(s.slice(start, end + 1));
}

export function createClient(cfg, env = process.env, { log = console.log } = {}) {
  const provider = detectProvider(cfg, env);
  if (!provider) return null;
  const pc = cfg[provider];
  const usage = { calls: 0, input: 0, output: 0, costUSD: 0 };

  async function callJson({ system, user, tier = 'fast', maxTokens = 4000 }) {
    if (usage.calls >= (cfg.maxCallsPerRun || 25)) throw new Error('이번 실행의 AI 호출 횟수 상한에 도달했습니다');
    if (usage.costUSD >= (cfg.maxCostPerRunUSD || 0.6)) throw new Error('이번 실행의 AI 비용 상한에 도달했습니다');
    const model = tier === 'deep' ? env.AI_MODEL_DEEP || pc.deepModel : env.AI_MODEL_FAST || pc.fastModel;
    let req;
    if (provider === 'anthropic') {
      req = {
        headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] },
      };
    } else {
      req = {
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: {
          model,
          max_completion_tokens: maxTokens,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        },
      };
    }

    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        usage.calls++;
        const res = await fetch(ENDPOINTS[provider], { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) });
        const raw = await res.text();
        if (!res.ok) {
          const err = new Error(`${provider} API ${res.status}: ${raw.slice(0, 200)}`);
          err.status = res.status;
          throw err;
        }
        const data = JSON.parse(raw);
        const text = provider === 'anthropic' ? (data.content || []).map((c) => c.text || '').join('') : data.choices?.[0]?.message?.content || '';
        const inT = provider === 'anthropic' ? data.usage?.input_tokens || 0 : data.usage?.prompt_tokens || 0;
        const outT = provider === 'anthropic' ? data.usage?.output_tokens || 0 : data.usage?.completion_tokens || 0;
        usage.input += inT;
        usage.output += outT;
        const price = pc.prices?.[model];
        if (price) usage.costUSD += (inT * price[0] + outT * price[1]) / 1e6;
        return extractJson(text);
      } catch (e) {
        lastErr = e;
        // 키 오류·잔액 부족 같은 문제는 재시도해도 소용없으므로 바로 중단
        if (e.status && [400, 401, 403, 404].includes(e.status)) break;
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  log(`🤖 AI 사용: ${provider} (${pc.fastModel}${pc.deepModel !== pc.fastModel ? ` / ${pc.deepModel}` : ''})`);
  return { provider, callJson, usage };
}
