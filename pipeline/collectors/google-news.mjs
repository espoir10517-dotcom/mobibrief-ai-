// Google News RSS 수집기 (API 키 불필요)
// 한국어: hl=ko&gl=KR, 영어: hl=en-US&gl=US
// 제공되는 정보: 제목, 언론사, 발행시각, 링크(구글뉴스 경유 원문 연결). 기사 본문·요약은 제공되지 않습니다.

import { fetchText } from '../lib/http.mjs';
import { decodeEntities, stripHtml, toIso } from '../lib/text.mjs';

const EDITIONS = {
  ko: 'hl=ko&gl=KR&ceid=KR:ko',
  en: 'hl=en-US&gl=US&ceid=US:en',
};

export function buildUrl(query, lang) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:2d`)}&${EDITIONS[lang]}`;
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return '';
  return m[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1').trim();
}

export function parseRss(xml, { lang, query } = {}) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const rawTitle = decodeEntities(tag(block, 'title'));
    const source = decodeEntities(tag(block, 'source'));
    const sourceUrl = (block.match(/<source[^>]*url="([^"]+)"/) || [])[1] || '';
    // 구글뉴스 제목 끝의 " - 언론사" 제거
    const title = source && rawTitle.endsWith(` - ${source}`) ? rawTitle.slice(0, -(source.length + 3)) : rawTitle;
    const link = decodeEntities(tag(block, 'link'));
    const publishedAt = toIso(tag(block, 'pubDate'));
    if (!title || !link || !publishedAt) continue;
    items.push({
      provider: 'google-news',
      lang,
      query,
      title: stripHtml(title),
      source: source || 'Google News',
      sourceUrl,
      url: link,
      publishedAt,
      description: '', // 구글뉴스 RSS 설명란은 제목 반복이라 저장하지 않음
    });
  }
  return items;
}

export async function collect(query, lang, limit = 20) {
  const xml = await fetchText(buildUrl(query, lang));
  return parseRss(xml, { lang, query }).slice(0, limit);
}
