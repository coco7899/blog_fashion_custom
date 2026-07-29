// 글 구조 프레임 — 자동 생성 글의 "구조적 유사도"를 낮추기 위한 뼈대 선택기.
//
// 왜 코드에 두는가:
//   writer.js 의 프롬프트는 스킬 지침보다 우선하는 고정 골격을 갖고 있어서,
//   SKILL.md 만 바꿔서는 모든 글이 같은 뼈대로 나온다. 그래서 골격 자체를
//   글마다 갈아끼울 수 있도록 이 모듈에서 프레임을 정의하고 선택한다.
//
// 고정(항상 유지): 어미 다양화, 좌측 정렬, 분량 기준, 팩트체크, 광고 표시, 출처 규칙
// 변경(프레임별): 정보 배열 골격 / 도입 방식 / 구간 구절 표현 / 이미지 배치 / 마무리
const store = require('./store');

// 최근 글에서 같은 프레임이 연속되지 않도록 회피할 개수
const RECENT_AVOID = 5;

// ── 뉴스 큐레이션(소개) 글 프레임 6종 ────────────────────────
// "이런 기사가 났어요" 하고 뉴스를 소개·정리하는 흐름. 패션·뷰티 분석 틀은 쓰지 않는다.
const CELEB_FRAMES = [
  {
    key: 'news-summary',
    label: '뉴스 요약 소개형',
    weight: 3,
    thinWeight: 5,
    fits: () => true,
    skeleton: [
      '① 무슨 소식인지 핵심부터 한두 문장으로 소개',
      '② 언제·어디서·누가 등 사실관계 정리',
      '③ 세부 내용·발언·수치 등 자료에 나온 알맹이',
      '④ 이 소식이 왜 화제가 됐는지',
      '⑤ 글쓴이 생각을 자연스럽게 한두 문장',
    ],
    intro: '"얼마 전 이런 소식이 전해졌는데요" 하고 무슨 뉴스인지 먼저 밝히며 시작',
    quoteStyle: '사실을 짚는 명사형 구절 (예: "무슨 일이 있었나")',
    outro: '핵심을 한 줄로 정리하고, 글쓴이 생각을 담백하게 한두 문장 덧붙이며 마무리',
  },
  {
    key: 'timeline',
    label: '시간 흐름형',
    weight: 3,
    fits: () => true,
    skeleton: [
      '① 예전(화제였던 시절·이전 상황)을 짧게 떠올림',
      '② 그동안의 경과',
      '③ 지금의 근황·이번 소식',
      '④ 앞으로 남은 이야기나 전망',
      '⑤ 글쓴이 생각을 자연스럽게 한두 문장',
    ],
    intro: '예전 모습·상황을 짧게 떠올리며 시작',
    quoteStyle: '시점을 짚는 구절 (예: "그때 그 시절", "그리고 지금은")',
    outro: '흐름을 짧게 정리하고, 글쓴이 생각을 담백하게 덧붙이며 마무리',
  },
  {
    key: 'curiosity',
    label: '궁금증 해소형',
    weight: 3,
    thinWeight: 3,
    fits: () => true,
    skeleton: [
      '① 제목이 던진 궁금증을 다시 짚으며 시작',
      '② 실제로 무슨 일인지 사실 공개',
      '③ 자세한 내막·배경 설명',
      '④ 정리',
      '⑤ 글쓴이 생각을 자연스럽게 한두 문장',
    ],
    intro: '"제목만 보면 궁금하실 텐데요" 식으로 궁금증을 이어받아 시작',
    quoteStyle: '궁금증을 여는 구절 (예: "사실은 이랬습니다")',
    outro: '궁금증을 풀어준 뒤, 글쓴이 생각을 담백하게 덧붙이며 마무리',
  },
  {
    key: 'reaction',
    label: '반응 정리형',
    weight: 2,
    // 반응·여론을 말할 근거가 자료에 있을 때만
    fits: (ctx) => /반응|누리꾼|화제|댓글|여론|갑론을박|논란|응원|호평|혹평|시청자/.test(ctx.refText || ''),
    skeleton: [
      '① 어떤 소식인지 간단히 소개',
      '② 왜 화제가 됐는지',
      '③ 사람들 반응·여론을 자료 근거로 정리',
      '④ 짚어볼 점',
      '⑤ 글쓴이 생각을 자연스럽게 한두 문장',
    ],
    intro: '"이 소식에 반응이 뜨거웠다"는 관찰에서 시작',
    quoteStyle: '반응을 짚는 구절 (예: "사람들이 주목한 이유")',
    outro: '반응을 정리하고, 글쓴이 생각을 담백하게 덧붙이며 마무리',
  },
  {
    key: 'compare-change',
    label: '비교·변화형',
    weight: 2,
    fits: (ctx) => /이전|과거|기존|그동안|달라|예전|변화|근황|달라진/.test(ctx.refText || ''),
    skeleton: [
      '① 예전 상황을 짧게 정리',
      '② 지금 상황·이번 소식',
      '③ 무엇이 달라졌는지 구체적으로',
      '④ 변화가 주는 의미',
      '⑤ 글쓴이 생각을 자연스럽게 한두 문장',
    ],
    intro: '"예전과 많이 달라졌다"는 관찰에서 시작',
    quoteStyle: '변화를 드러내는 대비 표현 (예: "그때와 지금")',
    outro: '변화의 방향을 짚고, 글쓴이 생각을 담백하게 덧붙이며 마무리',
  },
  {
    key: 'context-explain',
    label: '배경 설명형',
    weight: 2,
    fits: () => true,
    skeleton: [
      '① 이번 소식이 무엇인지',
      '② 이 일이 왜 생겼는지·어떤 맥락인지 배경 설명',
      '③ 관련된 사실·이전 사례 정리',
      '④ 앞으로 어떻게 될지',
      '⑤ 글쓴이 생각을 자연스럽게 한두 문장',
    ],
    intro: '이번 소식을 한 줄로 소개하며 시작',
    quoteStyle: '배경을 여는 구절 (예: "왜 이런 일이", "알고 보면")',
    outro: '배경을 정리하고, 글쓴이 생각을 담백하게 덧붙이며 마무리',
  },
];

// ── 쇼핑커넥트 상품 글 프레임 6종 ─────────────────────────────
// ※ '실제 후기형'은 의도적으로 제외한다.
//    이 자동화는 상세페이지만 수집하므로 실사용 경험이 존재하지 않는다.
//    후기형을 배정하면 겪지 않은 경험을 지어내게 되어 표시광고 기준에 어긋난다.
//    대신 경험을 주장하지 않는 '생활 시나리오형'과 '체크리스트형'을 쓴다.
const SHOP_FRAMES = [
  {
    key: 'problem-solving',
    label: '문제 해결형',
    weight: 3,
    fits: () => true,
    skeleton: [
      '① 독자가 겪는 불편한 상황',
      '② 그 불편이 생기는 이유',
      '③ 이 제품의 구조가 그 지점을 어떻게 다루는지',
      '④ 실제로 쓰게 되는 장면',
      '⑤ 구매 전 확인할 점',
    ],
    intro: '구체적인 불편 상황 묘사로 시작',
    quoteStyle: '문제를 짚는 구절 (예: "세제로는 해결되지 않는 부분")',
    outro: '어떤 사람에게 맞는지 정리하며 마무리',
  },
  {
    key: 'summary-first',
    label: '핵심 요약형',
    weight: 3,
    fits: () => true,
    skeleton: [
      '① 이 제품의 핵심을 3줄로 먼저 요약',
      '② 기능·옵션을 항목별로 상세 설명',
      '③ 자주 헷갈리는 부분 정리',
      '④ 구매 전 확인할 점',
    ],
    intro: '결론부터 — 핵심 세 가지를 먼저 제시',
    quoteStyle: '항목을 여는 명사형 구절 (예: "기능은 크게 세 가지")',
    outro: '요약을 한 번 더 압축하며 마무리',
  },
  {
    key: 'compare-choose',
    label: '비교·선택형',
    weight: 2,
    // 사이즈·모델·옵션 등 고를 거리가 자료에 있을 때만
    fits: (ctx) => /사이즈|size|옵션|모델|타입|종류|용량|색상|컬러|세트|구성|[0-9]+\s*(종|가지|개입)/i.test(ctx.detailText || ''),
    skeleton: [
      '① 어떤 선택지가 있는지 정리',
      '② 선택지별 차이와 장단점',
      '③ 상황별로 어떤 쪽이 맞는지',
      '④ 고르는 기준 한 줄 정리',
    ],
    intro: '"어떤 걸 골라야 할지 모르겠다"는 선택 상황에서 시작',
    quoteStyle: '선택 기준을 드러내는 구절 (예: "용량부터 정하면 쉬워요")',
    outro: '상황별 추천 대상을 정리하며 마무리',
  },
  {
    key: 'life-scenario',
    label: '생활 시나리오형',
    weight: 3,
    fits: () => true,
    skeleton: [
      '① 하루 중 특정 장면 설정 (아침 준비, 퇴근 후 등)',
      '② 그 장면에서 걸리는 지점',
      '③ 제품 특징을 그 장면에 연결해 설명',
      '④ 다른 생활 장면으로 확장',
      '⑤ 구매 전 확인할 점',
    ],
    intro: '생활 속 한 장면을 그리며 시작',
    quoteStyle: '장면을 여는 구절 (예: "출근 준비가 바쁜 아침이라면")',
    outro: '어떤 생활 패턴에 어울리는지 정리하며 마무리',
    // 경험 주장 금지 — 시나리오는 가정법으로만
    guard: '※ 직접 써본 것처럼 쓰지 마세요. "~해봤더니", "제가 써보니" 같은 경험 주장 금지. "~한 상황이라면", "~할 때 쓰기 좋아요"처럼 가정·용도 설명으로만 쓰세요.',
  },
  {
    key: 'step-guide',
    label: '단계별 가이드형',
    weight: 2,
    // 설치·조립·세척·사용 절차가 자료에 있을 때만
    fits: (ctx) => /설치|조립|세척|사용법|사용 방법|충전|교체|손질|관리법|세탁|분리|장착/.test(ctx.detailText || ''),
    skeleton: [
      '① 왜 이 과정을 알아야 하는지(개요)',
      '② 단계별 과정 — 3단계 이상으로 나눠 설명',
      '③ 단계마다 주의할 점',
      '④ 자주 묻는 질문 2~3개',
    ],
    intro: '처음 쓸 때 막히는 지점을 짚으며 시작',
    quoteStyle: '단계를 여는 구절 — 표현을 매번 다르게 (예: "먼저 할 일", "두 번째 순서", "마지막으로")',
    outro: '전체 과정을 한 줄로 정리하며 마무리',
    // 프레임 고유 검증: 단계 구절이 충분히 나왔는지
    check: (article) => {
      const quotes = article.blocks.filter((b) => b.type === 'quote').length;
      return quotes >= 4 ? null : '단계 구간(quote)이 4개 미만';
    },
  },
  {
    key: 'checklist',
    label: '체크리스트형',
    weight: 2,
    // 규격·호환·성분 확인이 중요한 제품
    fits: (ctx) => /호환|규격|성분|주의|사양|스펙|재질|용량|무게|크기|치수|인증|KC/.test(ctx.detailText || ''),
    skeleton: [
      '① 사기 전에 확인하지 않으면 후회하는 항목 제시',
      '② 항목별로 무엇을 어떻게 확인하는지',
      '③ 이 제품은 각 항목에서 어떤지',
      '④ 최종 체크리스트 정리',
    ],
    intro: '"사고 나서 안 맞았던 경험"이라는 일반적 상황으로 시작(본인 경험 주장 금지)',
    quoteStyle: '확인 항목을 여는 구절 (예: "규격부터 확인하세요")',
    outro: '체크 항목을 다시 짚으며 마무리',
  },
];

// ── 선택 로직 ────────────────────────────────────────────────

/** 최근 글에서 사용된 프레임 key 목록 (같은 종류의 글만) */
function recentFrameKeys(type, limit = RECENT_AVOID) {
  try {
    return store
      .listDrafts()
      .filter((d) => d && d.frameKey && (type === 'product' ? d.type === 'product' : d.type !== 'product'))
      .slice(0, limit)
      .map((d) => d.frameKey);
  } catch {
    return [];
  }
}

/** 참고자료가 얇은지 판정 — 얇으면 감성 위주 프레임을 피하고 구체형을 우선한다 */
function isThinMaterial(type, ctx) {
  const text = type === 'product' ? ctx.detailText : ctx.refText;
  return String(text || '').length < 800;
}

/** 프레임의 유효 가중치 — 자료가 얇으면 thinWeight를 우선 사용 */
function effectiveWeight(f, thin) {
  if (thin && typeof f.thinWeight === 'number') return f.thinWeight;
  return f.weight || 1;
}

/** 가중치 기반 무작위 1개 선택 */
function weightedPick(list, thin) {
  const total = list.reduce((s, f) => s + effectiveWeight(f, thin), 0);
  let r = Math.random() * total;
  for (const f of list) {
    r -= effectiveWeight(f, thin);
    if (r <= 0) return f;
  }
  return list[list.length - 1];
}

/**
 * 프레임 선택: 부적합 제외 → 최근 사용분 회피 → 가중 랜덤
 * @param {'celeb'|'product'} type
 * @param {object} ctx 판정 근거 {refText, detailText}
 */
function pickFrame(type, ctx = {}) {
  const all = type === 'product' ? SHOP_FRAMES : CELEB_FRAMES;

  // 1) 주제·자료에 맞지 않는 프레임 제외
  let usable = all.filter((f) => {
    try {
      return f.fits(ctx);
    } catch {
      return false;
    }
  });
  if (!usable.length) usable = all.filter((f) => f.fits === undefined || f.weight >= 3);
  if (!usable.length) usable = all;

  // 2) 최근 글과 같은 프레임은 회피 (전부 걸리면 회피 포기)
  const recent = recentFrameKeys(type);
  const fresh = usable.filter((f) => !recent.includes(f.key));
  const pool = fresh.length ? fresh : usable;

  const thin = isThinMaterial(type, ctx);
  const picked = weightedPick(pool, thin);
  console.log(
    `[frames] ${type} 프레임 선택: ${picked.label} (후보 ${pool.length}/${all.length}, 최근 회피 ${recent.length}건${thin ? ', 자료 얇음→구체형 우선' : ''})`
  );
  return picked;
}

/** 선택된 프레임을 프롬프트에 넣을 지시문으로 변환 */
function renderFrameInstruction(frame, type = 'celeb') {
  const isProduct = type === 'product';
  const lines = [
    `【이번 글의 구성 프레임 — "${frame.label}"】`,
    '이 글은 아래 흐름으로 쓰세요. 매번 같은 틀로 쓰지 않기 위해 이번 글에만 적용되는 구성입니다.',
    ...frame.skeleton.map((s) => `  ${s}`),
    isProduct
      ? '- 위 각 단계는 quote 구절과 문단으로 충분히 풀어서 쓰세요.'
      : '- 위 단계는 내용 흐름을 위한 참고 순서입니다. 단계마다 소제목을 만들지 말고, quote/heading은 글 전체에서 꼭 필요한 1~3개만 사용하세요.',
    `- 도입: ${frame.intro}`,
    `- 구간 구절(quote) 표현: ${frame.quoteStyle}`,
    `- 마무리: ${frame.outro}`,
    '',
    '【알맹이 규칙 — 뉴스에 충실하게 (프레임보다 우선)】',
    '- **뉴스 내용에 충실하게.** 참고자료(뉴스)에 나온 사실을 그대로 소개·정리하세요. 제목과 본문 내용이 반드시 일치해야 합니다.',
    '- **패션·뷰티·스타일 분석으로 끌고 가지 마세요.** 뉴스가 그 주제가 아니면 옷·메이크업·룩 이야기를 억지로 넣지 마세요.',
    '- 구체 우선: 자료에서 확인된 사실(누가·언제·무엇을·발언·수치·장소)을 먼저 서술하세요. 두루뭉술한 인상평으로 문단을 채우지 마세요.',
    '- 자료에 없는 사실·브랜드·가격·추측을 지어내지 마세요. 확인 안 된 건 "~라고 전해졌습니다", "~로 알려졌어요"처럼 조심스럽게.',
    '- **말투는 "이런 기사가 났더라고요" 하고 뉴스를 소개·큐레이션하듯** 친근하게.',
    '- 필요하면 마지막에 글쓴이(나)의 생각을 자연스럽게 한두 문장 덧붙이세요. 단, 단정·훈계·과장은 금지.',
    '- 기사 문장과 문단 순서를 베끼지 말고, 확인된 사실을 새 문장과 자연스러운 흐름으로 재구성하세요.',
  ];
  if (frame.guard) lines.push(frame.guard);
  return lines.join('\n');
}

module.exports = {
  CELEB_FRAMES,
  SHOP_FRAMES,
  pickFrame,
  renderFrameInstruction,
  recentFrameKeys,
};
