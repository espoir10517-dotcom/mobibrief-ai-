// 네트워크 요청 도우미: 시간 제한 + 1회 재시도

export async function fetchText(url, { headers = {}, timeoutMs = 15000, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'MobiBriefAI/0.2 (+https://github.com/espoir10517-dotcom/mobibrief-ai-)', ...headers },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // 일부 국내 언론사 RSS 는 EUC-KR 인코딩 → 헤더나 XML 선언에서 문자셋을 찾아 변환
      const buf = new Uint8Array(await res.arrayBuffer());
      const head = new TextDecoder('latin1').decode(buf.slice(0, 300));
      const charset = ((res.headers.get('content-type') || '').match(/charset=([\w-]+)/i) || head.match(/encoding=["']([\w-]+)["']/i) || [])[1];
      const enc = charset && /euc-?kr|ks_c_5601|cp949/i.test(charset) ? 'euc-kr' : 'utf-8';
      return new TextDecoder(enc).decode(buf);
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1500));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
