// 텍스트 정리 도구: HTML 제거, 엔티티 해제, 제목 정규화, 유사도, 한국시간 날짜

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—' };

export function decodeEntities(s = '') {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

export function stripHtml(s = '') {
  // 엔티티로 감싼 태그(&lt;b&gt;)도 처리하기 위해 해제 → 태그 제거 → 다시 해제
  return decodeEntities(
    decodeEntities(String(s))
      .replace(/<\/?(b|strong|i|em|u|span|font|mark)\b[^>]*>/gi, '') // 강조 태그는 글자 사이에 공백 없이 제거
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

// 중복 판단용 제목: 언론사 꼬리표·[단독] 같은 머리말·기호 제거
export function normalizeTitle(title = '') {
  return String(title)
    .replace(/\s[-|–]\s[^-|–]{1,40}$/, '') // "제목 - 언론사"
    .replace(/^\s*(\[[^\]]{1,12}\]|【[^】]{1,12}】|\([^)]{1,8}\))\s*/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function bigrams(s) {
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  if (s.length === 1) set.add(s);
  return set;
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// 한국시간 기준 YYYY-MM-DD
export function kstDate(d = new Date()) {
  const k = new Date(d.getTime() + 9 * 3600000);
  return k.toISOString().slice(0, 10);
}

export function toIso(dateStr) {
  const t = Date.parse(dateStr);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
