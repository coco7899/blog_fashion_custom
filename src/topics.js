// 수집된 뉴스/블로그 목록 → claude -p 로 글감 후보 생성
// (blog_fashion-01 "연예인 뉴스 블로그" 스킬 명세 반영: 분야 확대·최신성·팩트체크·추천)
const claude = require('./claude');

/**
 * @param {string} keyword 관심분야 키워드
 * @param {Array} sources searchNaver 결과를 합친 목록 [{kind,title,url,source}]
 * @param {object} opts {avoidTitles: 이미 발행한 제목들(중복 회피)}
 * @returns {Array} [{title, field, fact, angle, refs:[index], keywords:[], recommended}]
 */
async function suggestTopics(keyword, sources, { avoidTitles = [] } = {}) {
  const list = sources
    .map((s, i) => `${i}. [${s.kind === 'news' ? '뉴스' : '블로그'}] ${s.title}${s.source ? ` (${s.source})` : ''}`)
    .join('\n');

  const avoid = avoidTitles.length
    ? `\n이미 발행한 글 제목들 (이 주제들과 겹치지 않게 하세요):\n${avoidTitles.map((t) => `- ${t}`).join('\n')}\n`
    : '';

  const prompt = `당신은 네이버 블로그 콘텐츠 기획 전문가입니다.
관심분야 키워드: "${keyword}"

아래는 이 키워드로 방금 수집한 네이버 뉴스 기사와 인기 블로그 글 목록입니다:

${list}
${avoid}
이 자료를 바탕으로, 네이버 블로그에 쓰기 좋은 글감 5개를 제안하세요.
가장 좋은 글감을 배열의 첫 번째에 놓고 "recommended": true 로 표시하세요 (1개만).

분야: 연예인 패션, 뷰티, 생활용품, 건강용품·식품, 방송·SNS 화제, 셀럽 사용 제품 중에서 고르되,
당일 화제성과 블로그 확장성(스타일 분석·제품 특징·따라 하기·계절성 등 독자에게 줄 정보)이 높은 주제를 우선하세요.

반드시 지킬 것:
- **최신 자료 우선**: 게시일이 최근 2일 이내로 보이는 뉴스를 우선하고, 오래된 소식을 새 소식처럼 다루지 마세요.
- 동일 보도를 복제한 기사 여러 건은 하나의 근거로만 취급하세요.
- **확인되지 않은 열애설·건강 이상설·사생활 추측·악성 루머는 후보에서 제외**하세요.
- 범죄·사고·질병·사망·미성년자 관련 사건을 가벼운 소재로 쓰지 마세요.
- 제목 앞부분에 연예인 이름과 핵심 키워드를 배치하고, 제목·핵심 사실에 확인되지 않은 내용(추정 브랜드명·가격 등)을 넣지 마세요.
- 같은 연예인이나 같은 분야가 후보에서 과도하게 반복되지 않게 구성하세요.
- refs 에는 참고할 위 목록의 번호를 2~4개 넣되, **뉴스 기사를 최소 1개 이상 포함**시키세요 (출처로 밝힐 수 있도록).

다음 JSON 배열 형식으로만 출력:
[
  {
    "title": "블로그 글 제목 (연예인 이름+핵심 키워드가 앞에)",
    "field": "패션|뷰티|생활용품|건강·식품|방송·SNS|셀럽 제품 중 하나",
    "fact": "확인된 핵심 사실 한 문장",
    "angle": "어떤 관점/구성으로 쓸지 한두 문장 (블로그 포인트)",
    "refs": [0, 3],
    "keywords": ["핵심키워드1", "핵심키워드2"],
    "recommended": true
  }
]`;

  const arr = await claude.invokeJson(prompt, { timeoutMs: 180000 });
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error('글감 생성 결과가 비어 있습니다.');
  }
  const out = arr
    .filter((t) => t && t.title)
    .slice(0, 5)
    .map((t) => ({
      title: String(t.title),
      field: String(t.field || ''),
      fact: String(t.fact || ''),
      angle: String(t.angle || ''),
      refs: (Array.isArray(t.refs) ? t.refs : [])
        .map(Number)
        .filter((i) => Number.isInteger(i) && i >= 0 && i < sources.length),
      keywords: (Array.isArray(t.keywords) ? t.keywords : []).map(String).slice(0, 8),
      recommended: !!t.recommended,
      // 참고한 뉴스 중 날짜가 있는 첫 항목의 날짜를 표시.
      // refs에서 못 찾으면 뉴스 소스 중 날짜가 있는 첫 항목으로 폴백 → 항상 날짜가 보이게.
      date: (() => {
        const refIdx = Array.isArray(t.refs) ? t.refs.map(Number) : [];
        for (const i of refIdx) {
          if (sources[i] && sources[i].kind === 'news' && sources[i].date) return sources[i].date;
        }
        const anyNews = sources.find((s) => s.kind === 'news' && s.date);
        return anyNews ? anyNews.date : '';
      })(),
    }));
  // 추천은 정확히 1개만 (없으면 첫 번째)
  if (!out.some((t) => t.recommended) && out.length) out[0].recommended = true;
  let seen = false;
  for (const t of out) {
    if (t.recommended && seen) t.recommended = false;
    if (t.recommended) seen = true;
  }
  return out;
}

module.exports = { suggestTopics };
