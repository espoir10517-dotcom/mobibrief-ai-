// 언론사 RSS 수집기 (API 키 불필요)
// 언론사가 공식 제공하는 RSS/Atom 피드에서 제목·요약·링크·발행시각만 가져옵니다.
// 일반 섹션 피드(경제·산업·IT 등)라 분야와 무관한 기사도 섞여 있으므로,
// 키워드 사전(config/keywords.json)에 해당하는 기사만 남깁니다(collect.mjs 에서 처리).

import { fetchText } from '../lib/http.mjs';
import { decodeEntities, stripHtml, toIso, normalizeUrl } from '../lib/text.mjs';

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return '';
  return m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
}

export function parseFeed(xml, feed = {}) {
  const items = [];
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = isAtom ? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [] : xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const block of blocks) {
    const title = stripHtml(decodeEntities(tag(block, 'title')));
    let link = decodeEntities(tag(block, 'link'));
    if (!link || isAtom) link = (block.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || link;
    const date = tag(block, 'pubDate') || tag(block, 'dc:date') || tag(block, 'published') || tag(block, 'updated');
    const publishedAt = toIso(date);
    const desc = stripHtml(tag(block, 'description') || tag(block, 'summary') || '');
    if (!title || !/^https?:\/\//.test(link) || !publishedAt) continue;
    items.push({
      provider: 'rss',
      lang: feed.lang || 'ko',
      query: feed.name,
      title,
      source: feed.source || feed.name,
      sourceUrl: (() => {
        try {
          return new URL(link).origin;
        } catch {
          return '';
        }
      })(),
      url: normalizeUrl(link),
      publishedAt,
      // 피드가 제공하는 요약문 앞부분만 저장 (기사 전문 저장 안 함)
      description: desc.length > 200 ? `${desc.slice(0, 198)}…` : desc,
    });
  }
  return items;
}

export async function collect(feed) {
  const xml = await fetchText(feed.url, { timeoutMs: 12000 });
  return parseFeed(xml, feed);
}
