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

// ── 연예·생활 뉴스 큐레이션 관점 5종 ─────────────────────────
// 한 글에는 하나의 관점만 적용한다. 기사 순서를 옮기는 요약문이 아니라
// 독자가 무엇을 눈여겨볼지 알려 주는 홈판형 큐레이션 흐름을 만든다.
const CELEB_FRAMES = [
  {
    key: 'change-discovery',
    label: '변화 발견형',
    weight: 3,
    fits: (ctx) => /이전|과거|기존|그동안|달라|예전|변화|근황|복귀|새로운|처음/.test(ctx.refText || ''),
    skeleton: [
      '① 독자가 익숙하게 기억하는 이미지나 이전 활동을 짧게 짚기',
      '② 이번 소식에서 확인된 변화와 핵심 사실 2~3개 소개',
      '③ 이전과 무엇이 달라졌고 왜 볼 만한지 설명',
      '④ 근거 없는 전망 없이 작성자의 짧은 생각으로 마무리',
    ],
    intro: '인물의 익숙한 이미지나 대표 활동을 짚고 이번 변화가 왜 새로운지 연결',
    quoteStyle: '변화를 드러내는 짧은 구절',
    outro: '변화의 의미를 한 번 짚고 개인 생각 2~4문장을 소제목 없이 자연스럽게 덧붙이기',
  },
  {
    key: 'work-choice',
    label: '작품 선택형',
    weight: 3,
    fits: (ctx) => /드라마|영화|작품|캐스팅|배역|역할|출연|방송|예능|프로그램|공개|첫\s*방송/.test(ctx.refText || ''),
    skeleton: [
      '① 인물의 대표 이미지나 이전 작품 맥락을 짧게 짚기',
      '② 캐스팅·설정·역할·공개 일정 중 핵심 사실 2~3개 소개',
      '③ 이번 선택에서 독자가 눈여겨볼 관전 포인트 설명',
      '④ 흥행이나 전개를 예측하지 않고 짧은 생각으로 마무리',
    ],
    intro: '대표작이나 익숙한 역할을 짚고 이번 작품 선택의 새로움으로 연결',
    quoteStyle: '작품에서 볼 지점을 여는 짧은 구절',
    outro: '확인된 공개 정보 안에서 기대 지점을 말하고 개인 생각을 담백하게 덧붙이기',
  },
  {
    key: 'scene-curation',
    label: '장면 큐레이션형',
    weight: 3,
    fits: (ctx) => /장면|발언|인터뷰|무대|공연|영상|사진|SNS|방송에서|말했|전했|화제/.test(ctx.refText || ''),
    skeleton: [
      '① 인물이나 프로그램의 기존 맥락을 짧게 소개',
      '② 화제가 된 장면·발언과 관련 사실 2~3개 전달',
      '③ 장면이 나온 맥락과 독자가 볼 만한 지점 설명',
      '④ 반응을 부풀리지 않고 작성자의 생각으로 마무리',
    ],
    intro: '대표 활동이나 방송 맥락에서 이번 장면이 왜 눈에 띄는지 연결',
    quoteStyle: '장면이나 발언의 맥락을 여는 짧은 구절',
    outro: '장면에서 확인할 수 있는 의미만 짚고 개인 생각을 자연스럽게 덧붙이기',
  },
  {
    key: 'style-analysis',
    label: '스타일 분석형',
    weight: 2,
    fits: (ctx) => /패션|룩|착용|스타일|의상|드레스|컬러|실루엣|소재|메이크업|헤어|뷰티/.test(ctx.refText || ''),
    skeleton: [
      '① 인물의 평소 스타일 이미지나 행사 맥락을 짧게 소개',
      '② 확인 가능한 착장·컬러·실루엣·소재 특징 설명',
      '③ 독자가 따라 볼 포인트 한 가지를 근거와 함께 제안',
      '④ 미확인 브랜드를 추정하지 않고 짧은 생각으로 마무리',
    ],
    intro: '인물의 익숙한 스타일과 이번 장면에서 달라진 지점을 연결',
    quoteStyle: '컬러·실루엣·소재 중 핵심 포인트를 여는 짧은 구절',
    outro: '확인한 스타일 특징을 정리하고 개인 취향과 생각을 단정 없이 덧붙이기',
  },
  {
    key: 'life-information',
    label: '생활 정보형',
    weight: 3,
    fits: () => true,
    skeleton: [
      '① 독자가 이미 알고 있을 생활 맥락이나 불편을 짧게 짚기',
      '② 새 정보와 공식 기준 등 핵심 사실 2~3개 설명',
      '③ 실제로 확인하거나 주의할 점 한 가지 제안',
      '④ 치료·예방·효과를 단정하지 않고 짧은 생각으로 마무리',
    ],
    intro: '독자의 생활 맥락을 먼저 짚고 이번 정보가 왜 새롭거나 유용한지 연결',
    quoteStyle: '공식 기준이나 확인할 점을 여는 짧은 구절',
    outro: '실질적으로 기억할 지점을 짚고 개인 생각을 자연스럽게 덧붙이기',
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
      '④ 필요한 사람과 실제 생활 장면을 떠올리며 자연스럽게 마무리',
    ],
    intro: '"사고 나서 안 맞았던 경험"이라는 일반적 상황으로 시작(본인 경험 주장 금지)',
    quoteStyle: '확인 항목을 여는 구절 (예: "규격부터 확인하세요")',
    outro: '앞에서 설명한 항목을 다시 나열하지 말고, 어떤 사람에게 잘 맞을지 자연스럽게 마무리',
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
      : '- 위 단계는 내용 흐름을 위한 참고 순서입니다. 단계마다 소제목을 만들지 말고, quote/heading은 글 전체에서 꼭 필요한 경우에만 0~3개 사용하세요.',
    `- 도입: ${frame.intro}`,
    `- 구간 구절(quote) 표현: ${frame.quoteStyle}`,
    `- 마무리: ${frame.outro}`,
    '',
    '【알맹이 규칙 — 뉴스에 충실하게 (프레임보다 우선)】',
    '- **뉴스 내용에 충실하게.** 핵심 사실 2~3개를 골라 완전히 새 문장과 흐름으로 큐레이션하세요. 제목과 본문 내용은 반드시 일치해야 합니다.',
    '- **패션·뷰티·스타일 분석으로 끌고 가지 마세요.** 뉴스가 그 주제가 아니면 옷·메이크업·룩 이야기를 억지로 넣지 마세요.',
    '- 구체 우선: 자료에서 확인된 사실(누가·언제·무엇을·발언·수치·장소)을 먼저 서술하세요. 두루뭉술한 인상평으로 문단을 채우지 마세요.',
    '- 자료에 없는 사실·브랜드·가격·추측을 지어내지 마세요. 확인 안 된 건 "~라고 전해졌습니다", "~로 알려졌어요"처럼 조심스럽게.',
    '- **말투는 "이런 기사가 났더라고요" 하고 뉴스를 소개·큐레이션하듯** 친근하게.',
    '- 마지막 2~4문장에는 글쓴이(나)의 생각을 자연스럽게 녹이세요. 별도 소제목은 붙이지 말고 단정·훈계·과장은 피하세요.',
    '- 기사 문장과 문단 순서를 베끼지 말고, 확인된 사실을 새 문장과 자연스러운 흐름으로 재구성하세요.',
    '- 시청률·흥행·관계 변화·향후 전개를 예측하지 마세요.',
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
