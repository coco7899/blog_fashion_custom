// 수집된 뉴스/블로그 목록 → Codex로 글감 후보 생성
// (blog_fashion-01 "연예인 뉴스 블로그" 스킬 명세 반영: 분야 확대·최신성·팩트체크·추천)
const codex = require('./codex');
const { isTitleTooSimilarToAny } = require('./titleSimilarity');

// 글감으로 쓸 수 있는 뉴스의 최대 나이(일). 이보다 오래된 기사는 후보에서 제외한다.
// 검색 결과에 몇 년 전 기사가 섞여 들어와 "옛날 소식"이 글감으로 뽑히는 것을 막는다.
const RECENT_PRIORITY_DAYS = 2;
const MAX_SOURCE_AGE_DAYS = 7;
const SPORTS_RE = /스포츠|야구|축구|농구|배구|골프|테니스|KBO|MLB|K리그|프리미어리그|올림픽|월드컵|선수|감독|트레이드|이적시장|경기\s*(결과|일정|분석)/i;

function isCopiedSourceTitle(title, sources) {
  return isTitleTooSimilarToAny(title, sources);
}

async function rewriteCopiedTopicTitles(topics, sources, signal) {
  const copiedIndexes = topics
    .map((topic, index) => (isCopiedSourceTitle(topic && topic.title, sources) ? index : -1))
    .filter((index) => index >= 0);
  if (!copiedIndexes.length) return topics;

  console.log(`[topics] 기사 제목과 지나치게 유사한 글감 ${copiedIndexes.length}건 재작성`);
  const copiedTopics = copiedIndexes.map((index) => ({
    index,
    title: String(topics[index].title || ''),
    fact: String(topics[index].fact || ''),
    angle: String(topics[index].angle || ''),
  }));
  const sourceTitles = (sources || []).map((source) => String(source && source.title || '')).filter(Boolean);
  const rewritten = await codex.invokeJson(`아래 글감 제목은 뉴스 또는 블로그 원문 제목과 지나치게 유사합니다.
확인된 사실과 글의 관점은 유지하면서 네이버 홈판용 제목으로 다시 작성하세요.

규칙:
- 원문 제목을 그대로 복사하지 마세요.
- 공백, 따옴표, 쉼표, 특수기호만 바꾼 제목도 같은 제목으로 봅니다.
- 원문 제목의 앞 절·핵심 구절·어순을 유지한 채 뒷부분만 바꾸는 것도 금지합니다.
- 같은 사실을 다루더라도 글의 독자 관점이나 읽을 이유가 먼저 보이는 완전히 새로운 문장 구조를 사용하세요.
- 사실에 없는 장면·감정·분위기를 새로 만들지 마세요.
- 더 문학적이거나 모호하게 쓰지 말고, 무슨 소식인지 직접 이해되게 쓰세요.
- 각 항목의 index는 그대로 유지하세요.

다시 쓸 글감:
${JSON.stringify(copiedTopics, null, 2)}

피해야 할 원문 제목:
${sourceTitles.map((title) => `- ${title}`).join('\n')}

JSON 배열 형식으로만 출력:
[{"index":0,"title":"원문과 다른 홈판형 제목"}]`, { timeoutMs: 120000, signal });

  if (!Array.isArray(rewritten)) throw new Error('기사 제목과 겹친 글감 제목을 다시 만들지 못했습니다.');
  const next = topics.map((topic) => ({ ...topic }));
  for (const item of rewritten) {
    const index = Number(item && item.index);
    const title = String(item && item.title || '').trim();
    if (!copiedIndexes.includes(index) || !title || isCopiedSourceTitle(title, sources)) continue;
    next[index].title = title;
  }
  const remaining = next.filter((topic) => isCopiedSourceTitle(topic && topic.title, sources));
  if (remaining.length) throw new Error('기사 제목과 다른 글감 제목을 만들지 못했습니다. 다시 찾아주세요.');
  return next;
}

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
async function suggestTopics(
  keyword,
  allSources,
  { avoidTitles = [], allowStale = false, signal } = {}
) {
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

주제 방향: 배우, 아이돌·가수, 방송인·예능, 드라마, 패션·뷰티, 생활 화제 중에서 고르세요.
가능하면 서로 다른 분야를 섞어 한쪽으로 치우치지 않게 구성하세요.
스포츠, 주식·재테크·투자 종목, 자동차 주제는 다루지 마세요.
단순 기사 요약보다 “이 소식에서 독자가 볼 만한 지점은 무엇인가”가 드러나는 홈판형 큐레이션 각도를 우선하세요.

반드시 지킬 것 (안전·품질):
- **최근 2일 이내 자료를 최우선**으로 고르세요. 적합한 후보가 부족할 때만 최근 7일 자료를 사용하세요.
- 기사 발행일과 실제 사건 발생일을 구분하고, 오래된 소식을 새 소식처럼 다루지 마세요.
- 동일 보도를 복제한 기사 여러 건은 하나의 근거로만 취급하세요.
- **출처 있는 보도 사실만** 다루세요. 확인되지 않은 열애설·이혼설·건강 이상설·사생활 추측·신상 폭로·악성 루머는 후보에서 제외하세요.
- **특정인의 명예를 훼손하거나 사생활을 단정·추측하는 자극적 폭로 각도는 금지.** 공개적으로 보도된 사실을 '정리·소개'하는 각도로만 잡으세요.
- 범죄·사고·질병·사망·미성년자 관련 사건을 가벼운 소재로 쓰지 마세요.
- **제목은 네이버 홈판용으로 새로 구성**하세요:
  · 제목만으로 무슨 소식인지 이해되고, 무엇이 새롭거나 달라졌는지 보여야 합니다.
  · 인물 이름을 반드시 맨 앞에 둘 필요는 없습니다.
  · 기사 제목이나 검색어를 나열하지 말고, 독자가 읽을 이유를 한 가지 보여주세요.
  · 위 뉴스·블로그 목록의 제목과 완전히 같은 문장을 쓰지 마세요. 공백·따옴표·쉼표·특수기호만 바꾸는 것도 복사로 봅니다.
  · 확인되지 않은 내용·과장·거짓 낚시는 금지하고, 기사에서 확인되는 사실만 담으세요.
  · "충격", "정체", "결국", "소름", "전부 공개"는 쓰지 마세요.
- 같은 인물·같은 소재가 후보에서 과도하게 반복되지 않게 구성하세요.
- refs 에는 참고할 위 목록의 번호를 2~4개 넣되, **뉴스 기사를 최소 1개 이상 포함**시키세요 (출처로 밝힐 수 있도록).

다음 JSON 배열 형식으로만 출력:
[
  {
    "title": "새로움과 읽을 이유가 보이는 홈판형 제목",
    "field": "짧은 분야 라벨 (예: 드라마, 예능, 핫딜, 건강, 패션, 뷰티)",
    "fact": "확인된 핵심 사실 한 문장",
    "angle": "어떤 관점/구성으로 쓸지 한두 문장 (블로그 포인트)",
    "refs": [0, 3],
    "keywords": ["핵심키워드1", "핵심키워드2"],
    "recommended": true
  }
]`;

  let arr = await codex.invokeJson(prompt, { timeoutMs: 180000, signal });
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error('글감 생성 결과가 비어 있습니다.');
  }
  arr = await rewriteCopiedTopicTitles(arr, kept.map(({ source }) => source), signal);
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

  // 최근 2일을 넘어 7일 범위의 자료를 사용한 경우 화면의 핵심 사실에 표시한다.
  for (const topic of out) {
    const age = ageInDays(topic.date);
    if (age !== null && age > RECENT_PRIORITY_DAYS && age <= MAX_SOURCE_AGE_DAYS) {
      topic.fact = `[최근 7일 범위] ${topic.fact}`;
    }
  }
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

module.exports = { suggestTopics, isSportsTopic, isCopiedSourceTitle };
