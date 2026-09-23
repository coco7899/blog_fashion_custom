// Public data endpoints used by Naver Enter home and latest-news pages (no API key).
const BASE = 'https://api-gw.entertain.naver.com';
function kstDay(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
function normalize(item, section) {
  const match = String(item.url || '').match(/^https:\/\/m\.entertain\.naver\.com\/(?:now\/)?article\/(\d+)\/(\d+)/);
  if (!match || !item.title) return null;
  const publishedAt = item.articleDateTime || '';
  return {
    kind: 'news', title: String(item.title).trim(),
    url: `https://m.entertain.naver.com/article/${match[1]}/${match[2]}`,
    source: String(item.officeName || item.subTitle || '').trim(),
    date: publishedAt.slice(0, 10).replace(/-/g, '.'), publishedAt,
    summary: String(item.subContent || '').slice(0, 650),
    sections: [section], rank: section === 'ranking' ? Number(item.rank) || null : null,
  };
}
async function collectEnter({ signal, now = new Date(), fetchImpl = fetch } = {}) {
  signal?.throwIfAborted();
  const day = kstDay(now);
  const endpoints = [
    `${BASE}/cms/templates/enter_vertical_home`,
    `${BASE}/news/articles?date=${day.replace(/-/g, '')}&page=1&pageSize=50`,
  ];
  const results = await Promise.allSettled(endpoints.map(async (url, index) => {
    const response = await fetchImpl(url, {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache', Referer: 'https://m.entertain.naver.com/' },
    });
    if (!response.ok) throw new Error('네이버 응답 오류');
    const data = await response.json();
    const rows = index === 0
      ? data.result?.templates?.find(t => t.templateId === 'enter_ranking')?.json?.newsRankingList
      : data.result?.newsList;
    if (!Array.isArray(rows) || !rows.length) throw new Error('기사 목록이 비어 있습니다.');
    const list = rows.map(row => normalize(row, index === 0 ? 'ranking' : 'latest')).filter(Boolean)
      .filter(row => index === 0 || row.publishedAt.startsWith(day));
    if (!list.length) throw new Error('오늘의 기사 목록이 없습니다.');
    return list;
  }));
  signal?.throwIfAborted();
  const warnings = [], counts = { ranking: 0, latest: 0 }, map = new Map();
  results.forEach((result, i) => {
    const section = i === 0 ? 'ranking' : 'latest';
    if (result.status === 'rejected') {
      warnings.push(`${i === 0 ? '오늘의 엔터 랭킹' : '최신뉴스'}를 불러오지 못해 나머지 목록만 사용했습니다.`);
      return;
    }
    counts[section] = result.value.length;
    for (const source of result.value) {
      const prior = map.get(source.url);
      if (prior) map.set(source.url, { ...prior, ...source, rank: prior.rank, sections: [...prior.sections, section] });
      else map.set(source.url, source);
    }
  });
  if (!map.size) throw new Error('네이버 엔터 랭킹과 최신뉴스를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  return { sources: [...map.values()], counts, warnings, collectedAt: now.toISOString() };
}
module.exports = { collectEnter, kstDay, normalize };
