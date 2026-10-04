// 휴대폰(브라우저) 안에만 저장되는 개인 데이터: 즐겨찾기 · 관심 키워드 · 설정
// 외부 서버로 전송하지 않습니다. 저장소를 쓸 수 없는 환경에서도 앱이 동작하도록 메모리 대체본을 둡니다.

const memory = {};
function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw != null) return JSON.parse(raw);
  } catch {
    /* 저장소 사용 불가 */
  }
  return key in memory ? memory[key] : fallback;
}
function write(key, value) {
  memory[key] = value;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 저장소 사용 불가 — 메모리에만 유지 */
  }
}

const KEYS = { saved: 'mb.saved', keywords: 'mb.keywords', settings: 'mb.settings', admin: 'mb.admin' };

export const DEFAULT_SETTINGS = {
  theme: 'light', // light | dark
  pushOn: false, // 주간 브리핑 알림
  pushHour: 8, // 월요일 받을 시간 (7~22시)
};
// 관심 키워드는 사용자마다 각자 휴대폰에만 저장되며, 처음에는 비어 있습니다.
// 아래는 MY NEWS 화면에서 한 번 눌러 추가할 수 있게 보여주는 '추천' 목록일 뿐, 자동 등록되지 않습니다.
export const SUGGESTED_KEYWORDS = ['자율주행', '로보택시', '손해율', '보험사기', 'AI Agent', '전기차', 'Physical AI'];

// 관리자 모드 (이 휴대폰에서만 MY NEWS 탭 표시)
export function isAdmin() {
  return read(KEYS.admin, false) === true;
}
export function setAdmin(on) {
  write(KEYS.admin, Boolean(on));
}

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
}
export function setSettings(patch) {
  const next = { ...getSettings(), ...patch };
  write(KEYS.settings, next);
  return next;
}

// 즐겨찾기: 기사 데이터가 나중에 사라져도 Saved 에서 볼 수 있도록 스냅샷을 함께 저장
export function getSaved() {
  return read(KEYS.saved, []);
}
export function isSaved(id) {
  return getSaved().some((s) => s.id === id);
}
export function toggleSaved(article) {
  const list = getSaved();
  const idx = list.findIndex((s) => s.id === article.id);
  if (idx >= 0) {
    list.splice(idx, 1);
    write(KEYS.saved, list);
    return false;
  }
  const { _tokens, ...snap } = article;
  list.unshift({ ...snap, savedAt: new Date().toISOString() });
  write(KEYS.saved, list);
  return true;
}

export function getKeywords() {
  return read(KEYS.keywords, []);
}
export function addKeyword(k) {
  const v = String(k).trim().slice(0, 30);
  if (!v) return false;
  const list = getKeywords();
  if (list.some((x) => x.toLowerCase() === v.toLowerCase())) return false;
  list.push(v);
  write(KEYS.keywords, list);
  return true;
}
export function removeKeyword(k) {
  write(
    KEYS.keywords,
    getKeywords().filter((x) => x !== k),
  );
}

export function resetAll() {
  for (const k of Object.values(KEYS)) {
    delete memory[k];
    try {
      localStorage.removeItem(k);
    } catch {
      /* noop */
    }
  }
}
