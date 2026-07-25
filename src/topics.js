// 수집된 뉴스/블로그 목록 → claude -p 로 글감 후보 생성
// (blog_fashion-01 "연예인 뉴스 블로그" 스킬 명세 반영: 분야 확대·최신성·팩트체크·추천)
const claude = require('./claude');

// 글감으로 쓸 수 있는 뉴스의 최대 나이(일). 이보다 오래된 기사는 후보에서 제외한다.
// 검색 결과에 몇 년 전 기사가 섞여 들어와 "옛날 소식"이 글감으로 뽑히는 것을 막는다.
const MAX_SOURCE_AGE_DAYS = 30;

/** 'YYYY.MM.DD' → 오늘 기준 경과 일수. 파싱 불가면 null */
function ageInDays(dateStr) {
  const m = String(dateStr || '').match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  return Math.floor((today - d) / 86400000);
}

/**
 * 오래된 뉴스 소스를 걸러낸다 (날짜 없는 항목과 블로그는 통과 — 판단 근거가 없으므로).
 * refs 인덱스는 호출부에서 "원본 배열" 기준으로 사용하므로 원본 인덱스를 함께 돌려준다.
 * @returns {Array} [{ source, originalIndex }]
 */
function filterStaleSources(sources) {
  const kept = [];
  const dropped = [];
  sources.forEach((s, originalIndex) => {
    const age = s && s.kind === 'news' ? ageInDays(s.date) : null;
    if (age !== null && age > MAX_SOURCE_AGE_DAYS) dropped.push(s);
    else kept.push({ source: s, originalIndex });
  });
  if (dropped.length) {
    console.log(
      `[topics] 오래된 뉴스 ${dropped.length}건 제외(${MAX_SOURCE_AGE_DAYS}일 초과): ` +
        dropped.map((s) => `${s.date} ${String(s.title).slice(0, 24)}`).join(' / ')
    );
  }
  return kept;
}

/**
 * @param {string} keyword 관심분야 키워드
 * @param {Array} sources searchNaver 결과를 합친 목록 [{kind,title,url,source}]
 * @param {object} opts {avoidTitles: 이미 발행한 제목들(중복 회피)}
 * @returns {Array} [{title, field, fact, angle, refs:[index], keywords:[], recommended}]
 */
async function suggestTopics(keyword, allSources, { avoidTitles = [] } = {}) {
  // 오래된 기사는 AI에게 아예 넘기지 않는다 (프롬프트 부탁만으로는 걸러지지 않음).
  // kept[i] = { source, originalIndex } — AI에게는 0..n 로 보여주고, refs는 원본 인덱스로 되돌린다.
  const kept = filterStaleSources(allSources);
  if (!kept.length) throw new Error('최근 자료가 없습니다. 오래된 기사만 검색되었습니다.');

  const list = kept
    .map(
      ({ source: s }, i) =>
        `${i}. [${s.kind === 'news' ? '뉴스' : '블로그'}] ${s.title}${s.source ? ` (${s.source})` : ''}${s.date ? ` — ${s.date}` : ''}`
    )
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
    .map((t) => {
      // AI가 준 번호는 kept 기준 → 실제 원본 배열 인덱스로 변환해서 저장한다.
      const keptIdx = (Array.isArray(t.refs) ? t.refs : [])
        .map(Number)
        .filter((i) => Number.isInteger(i) && i >= 0 && i < kept.length);
      return {
        title: String(t.title),
        field: String(t.field || ''),
        fact: String(t.fact || ''),
        angle: String(t.angle || ''),
        refs: keptIdx.map((i) => kept[i].originalIndex),
        keywords: (Array.isArray(t.keywords) ? t.keywords : []).map(String).slice(0, 8),
        recommended: !!t.recommended,
        // 참고한 뉴스 중 날짜가 있는 첫 항목의 날짜를 표시.
        // refs에서 못 찾으면 남아 있는 뉴스 중 가장 최근 날짜로 폴백 → 항상 날짜가 보이게.
        date: (() => {
          for (const i of keptIdx) {
            const s = kept[i].source;
            if (s && s.kind === 'news' && s.date) return s.date;
          }
          const newsDates = kept
            .map(({ source: s }) => (s && s.kind === 'news' ? s.date : ''))
            .filter(Boolean)
            .sort()
            .reverse();
          return newsDates[0] || '';
        })(),
      };
    });
  // 안전망: 소스 필터를 통과했더라도 결과 날짜가 오래된 글감은 버린다.
  const fresh = out.filter((t) => {
    const age = ageInDays(t.date);
    if (age !== null && age > MAX_SOURCE_AGE_DAYS) {
      console.log(`[topics] 오래된 글감 제외(${t.date}): ${t.title.slice(0, 30)}`);
      return false;
    }
    return true;
  });
  const result = fresh.length ? fresh : out; // 전부 걸리면 빈 목록 대신 원본 유지

  // 추천은 정확히 1개만 (없으면 첫 번째)
  if (!result.some((t) => t.recommended) && result.length) result[0].recommended = true;
  let seen = false;
  for (const t of result) {
    if (t.recommended && seen) t.recommended = false;
    if (t.recommended) seen = true;
  }
  return result;
}

module.exports = { suggestTopics };
