// 네이버 뉴스 검색 API 수집기
// 필요: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET (GitHub 비밀값 또는 .env)
// 무료 한도: 하루 25,000회 (이 앱은 하루 수십 회 사용)
// 제공되는 정보: 제목, 원문 링크, 검색 결과 요약문(description), 발행시각. 언론사명은 원문 주소로 추정합니다.

import { fetchText } from '../lib/http.mjs';
import { stripHtml, toIso } from '../lib/text.mjs';
import { outletFromUrl } from '../lib/outlets.mjs';

export function isConfigured(env = process.env) {
  return Boolean(env.NAVER_CLIENT_ID && env.NAVER_CLIENT_SECRET);
}

export function parseResponse(json, { query } = {}) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  return (data.items || [])
    .map((it) => {
      const url = it.originallink || it.link;
      return {
        provider: 'naver-news',
        lang: 'ko',
        query,
        title: stripHtml(it.title),
        source: outletFromUrl(url),
        sourceUrl: url ? new URL(url).origin : '',
        url,
        naverUrl: it.link && it.link.includes('naver.com') ? it.link : undefined,
        publishedAt: toIso(it.pubDate),
        // 검색 결과로 제공되는 요약문만 저장 (기사 전문은 저장하지 않음)
        description: stripHtml(it.description).slice(0, 300),
      };
    })
    .filter((x) => x.title && x.url && x.publishedAt);
}

export async function collect(query, limit = 20, env = process.env) {
  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=${Math.min(100, limit)}&sort=date`;
  const text = await fetchText(url, {
    headers: { 'X-Naver-Client-Id': env.NAVER_CLIENT_ID, 'X-Naver-Client-Secret': env.NAVER_CLIENT_SECRET },
  });
  return parseResponse(text, { query });
}
