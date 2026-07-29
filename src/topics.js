// 수집된 뉴스/블로그 목록 → Codex로 글감 후보 생성
// (blog_fashion-01 "연예인 뉴스 블로그" 스킬 명세 반영: 분야 확대·최신성·팩트체크·추천)
const codex = require('./codex');

// 글감으로 쓸 수 있는 뉴스의 최대 나이(일). 이보다 오래된 기사는 후보에서 제외한다.
// 검색 결과에 몇 년 전 기사가 섞여 들어와 "옛날 소식"이 글감으로 뽑히는 것을 막는다.
const MAX_SOURCE_AGE_DAYS = 5;
const SPORTS_RE = /스포츠|야구|축구|농구|배구|골프|테니스|KBO|MLB|K리그|프리미어리그|올림픽|월드컵|선수|감독|트레이드|이적시장|경기\s*(결과|일정|분석)/i;

function isSportsTopic(topic) {
  const text = [
    topic && topic.field,
    topic && topic.title,
    topic && topic.angle,
    ...(Array.isArray(topic && topic.keywords) ? topic.keywords : []),
  ]
    .filter(Boolean)
    .join(' ');
  return SPORTS_RE.test(text);
}

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
async function suggestTopics(keyword, allSources, { avoidTitles = [], allowStale = false } = {}) {
  // 오래된 기사는 AI에게 아예 넘기지 않는다 (프롬프트 부탁만으로는 걸러지지 않음).
  // kept[i] = { source, originalIndex } — AI에게는 0..n 로 보여주고, refs는 원본 인덱스로 되돌린다.
  let kept = filterStaleSources(allSources);
  if (!kept.length) {
    // 사용자가 직접 키워드로 검색한 경우(allowStale)엔 오래된 기사라도 사용해 관련 글감을 만든다.
    if (allowStale && allSources.length) {
      console.log('[topics] 최신 자료가 없어 오래된 기사까지 포함해 글감 생성(사용자 키워드 검색)');
      kept = allSources.map((source, originalIndex) => ({ source, originalIndex }));
    } else {
      throw new Error('최근 자료가 없습니다. 오래된 기사만 검색되었습니다.');
    }
  }

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

주제 방향: 키워드와 수집 자료에 맞는 분야로 자유롭게 고르세요
(연예·방송/드라마·예능, 쇼핑·핫딜, 건강·생활정보, 패션·뷰티 등. 스포츠, 주식·재테크·투자 종목, 자동차 주제는 다루지 마세요).
당일 화제성과 블로그 확장성이 높은 **정보성 각도**를 우선하세요:
정리·요약, 배경 설명, 비교, 따라 하기, 시청 포인트, 상품 소개, 건강·생활 상식 등 독자에게 실제 정보를 주는 주제.

반드시 지킬 것 (안전·품질):
- **최신 자료 우선**: 게시일이 최근으로 보이는 뉴스를 우선하고, 오래된 소식을 새 소식처럼 다루지 마세요.
- 동일 보도를 복제한 기사 여러 건은 하나의 근거로만 취급하세요.
- **출처 있는 보도 사실만** 다루세요. 확인되지 않은 열애설·이혼설·건강 이상설·사생활 추측·신상 폭로·악성 루머는 후보에서 제외하세요.
- **특정인의 명예를 훼손하거나 사생활을 단정·추측하는 자극적 폭로 각도는 금지.** 공개적으로 보도된 사실을 '정리·소개'하는 각도로만 잡으세요.
- 범죄·사고·질병·사망·미성년자 관련 사건을 가벼운 소재로 쓰지 마세요.
- **제목은 네이버 홈 화제글(홈판) 스타일의 후킹형**으로 지으세요:
  · 궁금증을 남기는 한 구절로 시작하고 '…'로 여운을 주거나, 반응을 유도하는 말투("얼마나 ~길래", "결국", "~더니", "알고 보니", "이게 되네")를 활용.
  · 큰따옴표로 핵심 대사·포인트를 인용하는 형태도 좋습니다. (예: "결국 클래스는 못 이겨"… / "머리 산발인데" 레전드 찍은 공항 패션)
  · **인물·연예인 이름을 반드시 앞에 둘 필요는 없습니다.** 후킹 구절이 앞, 핵심 정보(이름·소재)는 뒤에 와도 됩니다.
  · 단, **확인되지 않은 내용·과장·거짓 낚시는 금지** — 본문으로 실제 확인되는 사실만 제목에 담으세요.
- 같은 인물·같은 소재가 후보에서 과도하게 반복되지 않게 구성하세요.
- refs 에는 참고할 위 목록의 번호를 2~4개 넣되, **뉴스 기사를 최소 1개 이상 포함**시키세요 (출처로 밝힐 수 있도록).

다음 JSON 배열 형식으로만 출력:
[
  {
    "title": "홈판 후킹형 제목 (호기심 구절이 앞, 인물 이름은 앞에 없어도 됨)",
    "field": "짧은 분야 라벨 (예: 드라마, 예능, 핫딜, 건강, 패션, 뷰티)",
    "fact": "확인된 핵심 사실 한 문장",
    "angle": "어떤 관점/구성으로 쓸지 한두 문장 (블로그 포인트)",
    "refs": [0, 3],
    "keywords": ["핵심키워드1", "핵심키워드2"],
    "recommended": true
  }
]`;

  const arr = await codex.invokeJson(prompt, { timeoutMs: 180000 });
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
  // 안전망: AI 응답에 스포츠가 섞여도 대시보드에는 전달하지 않는다.
  const nonSports = out.filter((topic) => {
    if (isSportsTopic(topic)) {
      console.log(`[topics] 스포츠 글감 제외: ${topic.title.slice(0, 40)}`);
      return false;
    }
    return true;
  });
  if (!nonSports.length) {
    throw new Error('스포츠를 제외한 글감을 만들지 못했습니다. 다른 키워드로 다시 찾아주세요.');
  }

  // 안전망: 소스 필터를 통과했더라도 결과 날짜가 오래된 글감은 버린다.
  const fresh = nonSports.filter((t) => {
    const age = ageInDays(t.date);
    if (age !== null && age > MAX_SOURCE_AGE_DAYS) {
      console.log(`[topics] 오래된 글감 제외(${t.date}): ${t.title.slice(0, 30)}`);
      return false;
    }
    return true;
  });
  const result = fresh.length ? fresh : nonSports; // 전부 오래됐으면 스포츠가 아닌 원본만 유지

  // 추천은 정확히 1개만 (없으면 첫 번째)
  if (!result.some((t) => t.recommended) && result.length) result[0].recommended = true;
  let seen = false;
  for (const t of result) {
    if (t.recommended && seen) t.recommended = false;
    if (t.recommended) seen = true;
  }
  return result;
}

module.exports = { suggestTopics, isSportsTopic };
