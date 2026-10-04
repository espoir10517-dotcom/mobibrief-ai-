// Cloudflare API 도우미 (알림 서버 배포·구독 목록 읽기용)
// 필요한 환경변수: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID (GitHub 비밀값)

const API = 'https://api.cloudflare.com/client/v4';
export const KV_TITLE = 'mobibrief-subs';
export const SCRIPT_NAME = 'mobibrief-push';

export function cfClient(env = process.env, fetchImpl = fetch) {
  const token = env.CLOUDFLARE_API_TOKEN;
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) return null;

  async function call(path, { method = 'GET', body, raw = false, headers = {} } = {}) {
    const res = await fetchImpl(`${API}${path.replace('{acc}', `accounts/${account}`)}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body && !(body instanceof FormData) && !raw ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body && !(body instanceof FormData) && !raw ? JSON.stringify(body) : body,
    });
    if (raw) return res;
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      const msg = (data.errors || []).map((e) => `${e.code}: ${e.message}`).join(' / ') || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.errors = data.errors || [];
      throw err;
    }
    return data;
  }

  return {
    account,
    call,
    async findOrCreateKv() {
      const list = await call(`/{acc}/storage/kv/namespaces?per_page=100`);
      const found = (list.result || []).find((n) => n.title === KV_TITLE);
      if (found) return found.id;
      const made = await call(`/{acc}/storage/kv/namespaces`, { method: 'POST', body: { title: KV_TITLE } });
      return made.result.id;
    },
    async kvGet(ns, key) {
      const res = await call(`/{acc}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`, { raw: true });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`KV 읽기 실패 ${res.status}`);
      return JSON.parse(await res.text());
    },
    async kvPut(ns, key, value) {
      const res = await call(`/{acc}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`, { method: 'PUT', raw: true, body: JSON.stringify(value), headers: { 'content-type': 'text/plain' } });
      if (!res.ok) throw new Error(`KV 쓰기 실패 ${res.status}`);
    },
    async kvDelete(ns, key) {
      await call(`/{acc}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`, { method: 'DELETE', raw: true });
    },
    async kvKeys(ns, prefix) {
      const keys = [];
      let cursor = '';
      do {
        const r = await call(`/{acc}/storage/kv/namespaces/${ns}/keys?prefix=${encodeURIComponent(prefix)}&limit=1000${cursor ? `&cursor=${cursor}` : ''}`);
        keys.push(...(r.result || []).map((k) => k.name));
        cursor = r.result_info?.cursor || '';
      } while (cursor);
      return keys;
    },
  };
}
