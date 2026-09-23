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

// 제목의 주제를 먼저 본다. 참고자료의 메뉴·관련기사·사진 설명에 우연히 나온
// '스타일', '공개' 같은 단어 때문에 글 전체의 방향이 바뀌지 않도록 한다.
function focusText(ctx) {
  const topic = ctx.topic || {};
  const title = String(topic.title || ctx.title || '').trim();
  if (title) return title;
  const refText = String(ctx.refText || '');
  const titles = [...refText.matchAll(/(?:^|\n)제목:\s*([^\n]+)/g)].map((match) => match[1]);
  return titles.length ? titles.join(' ') : refText.slice(0, 800);
}

function isViewingGuide(ctx) {
  const text = focusText(ctx);
  return /넷플릭스|Netflix|OTT|디즈니\+|디즈니플러스|티빙|웨이브|쿠팡플레이|드라마|영화|작품/i.test(text)
    && /기대작|공개작|신작|추천|장르별|라인업|볼거리|볼\s*만한|뭐\s*볼|무엇을\s*볼|선택|고르/.test(text)
    && !/패션|착장|착용|의상|드레스|메이크업|헤어스타일/.test(text);
}

// ── 주제에 맞는 연예·생활 뉴스 흐름 ─────────────────────────
// 한 글에는 하나의 관점만 적용한다. 기사 순서를 옮기는 요약문이 아니라
// 독자가 무엇을 눈여겨볼지 알려 주는 홈판형 큐레이션 흐름을 만든다.
const CELEB_FRAMES = [
  {
    key: 'viewing-guide',
    label: '장르별 작품 안내형',
    weight: 3,
    priority: 5,
    fits: isViewingGuide,
    skeleton: [
      '① 오늘이나 연휴에 무엇을 볼지 고르는 상황에서 짧게 시작',
      '② 확인된 작품을 장르나 보고 싶은 분위기에 따라 자연스럽게 소개',
      '③ 작품마다 제목·기본 설정·확인된 공개 정보와 서로 다른 점 설명',
      '④ 마지막 작품의 필요한 정보를 전하면 그대로 끝내기. 앞의 작품들을 다시 비교·분류하지 않기',
    ],
    intro: '작품을 고르는 상황에서 시작하고, 배우 이력이나 추상적인 감상으로 돌아가지 않기',
    quoteStyle: '작품 이름이나 고를 때 도움이 되는 짧은 구절',
    outro: '마무리 문단을 억지로 만들지 않고 마지막 작품 설명이나 공개 일정에서 자연스럽게 끝내기',
    guard: '※ 자료에 없는 작품·장르·공개일은 채우지 마세요. 제목의 연휴·주차는 글의 주제이지, 실제 공개일을 입증하는 자료가 아닙니다. 이미 본 것 같은 재미·몰입감·결말 평가는 쓰지 마세요.',
  },
  {
    key: 'change-discovery',
    label: '변화 발견형',
    weight: 3,
    priority: 2,
    fits: (ctx) => /달라|변화|근황|복귀|새로운|처음/.test(focusText(ctx)),
    skeleton: [
      '① 독자가 익숙하게 기억하는 이미지나 이전 활동을 짧게 짚기',
      '② 이번 소식에서 확인된 변화와 핵심 사실 2~3개 소개',
      '③ 이전과 달라진 점이 확인될 때만 필요한 배경을 이어 설명',
      '④ 새 소식을 충분히 전했으면 짧게 마무리',
    ],
    intro: '인물의 익숙한 이미지나 대표 활동을 짚고 이번 변화가 왜 새로운지 연결',
    quoteStyle: '변화를 드러내는 짧은 구절',
    outro: '앞의 사실을 다시 요약하거나 변화의 의미를 부풀리지 않고 1~2문장으로 끝내기',
  },
  {
    key: 'work-choice',
    label: '작품 선택형',
    weight: 3,
    priority: 3,
    fits: (ctx) => !isViewingGuide(ctx) && /드라마|영화|작품|캐스팅|배역|출연|예능|프로그램|첫\s*방송/.test(focusText(ctx)),
    skeleton: [
      '① 이번 작품이나 출연 소식을 바로 소개',
      '② 캐스팅·설정·역할·공개 일정 중 핵심 사실 2~3개 소개',
      '③ 설정·배역을 이해하는 데 필요한 배경과 차이 설명',
      '④ 확인된 공개·방송 정보 등 남은 내용을 전하고 마무리',
    ],
    intro: '이번 작품 이야기를 먼저 꺼내고 이전 작품은 비교가 필요할 때만 짧게 연결',
    quoteStyle: '작품에서 볼 지점을 여는 짧은 구절',
    outro: '작품 이야기를 충분히 전한 뒤 1~2문장으로 끝내며 기대감·흥행 전망을 덧붙이지 않기',
  },
  {
    key: 'scene-curation',
    label: '장면 큐레이션형',
    weight: 3,
    priority: 2,
    fits: (ctx) => /장면|발언|인터뷰|무대|공연|영상|사진|SNS|방송에서|말했|전했/.test(focusText(ctx)),
    skeleton: [
      '① 인물이나 프로그램의 기존 맥락을 짧게 소개',
      '② 화제가 된 장면·발언과 관련 사실 2~3개 전달',
      '③ 장면이 나온 맥락과 독자가 볼 만한 지점 설명',
      '④ 확인되지 않은 대중 반응이나 감상을 덧붙이지 않고 마무리',
    ],
    intro: '대표 활동이나 방송 맥락에서 이번 장면이 왜 눈에 띄는지 연결',
    quoteStyle: '장면이나 발언의 맥락을 여는 짧은 구절',
    outro: '장면과 발언을 과하게 해석하지 않고 짧게 마무리',
  },
  {
    key: 'style-analysis',
    label: '스타일 분석형',
    weight: 2,
    priority: 4,
    fits: (ctx) => !isViewingGuide(ctx) && /패션|착장|착용|의상|드레스|실루엣|메이크업|헤어|뷰티|코디|스타일|룩/.test(focusText(ctx)),
    skeleton: [
      '① 인물의 평소 스타일 이미지나 행사 맥락을 짧게 소개',
      '② 확인 가능한 착장·컬러·실루엣·소재 특징 설명',
      '③ 독자가 따라 볼 포인트 한 가지를 근거와 함께 제안',
      '④ 미확인 브랜드나 가격을 추정하지 않고 마무리',
    ],
    intro: '인물의 익숙한 스타일과 이번 장면에서 달라진 지점을 연결',
    quoteStyle: '컬러·실루엣·소재 중 핵심 포인트를 여는 짧은 구절',
    outro: '이미 설명한 착장을 다시 나열하지 않고 눈에 띄는 조합 한 가지 정도로 마무리',
  },
  {
    key: 'life-information',
    label: '생활 정보형',
    weight: 3,
    priority: 1,
    fits: () => true,
    skeleton: [
      '① 누가 어떤 말을 했거나 무엇을 공개했다는 기사 소식을 바로 꺼내기',
      '② 새 정보와 공식 기준 등 핵심 사실 2~3개 설명',
      '③ 실제로 확인하거나 주의할 점 한 가지 제안',
      '④ 필요한 정보를 전했으면 짧게 마무리',
    ],
    intro: '기사 속 인물과 실제 소식을 바로 말하기. 숫자를 본 독자의 반응이나 가상의 생활 상황을 만들지 않기',
    quoteStyle: '공식 기준이나 확인할 점을 여는 짧은 구절',
    outro: '실제로 도움이 되는 안내 1~2문장으로 마무리하고 교훈이나 감상을 붙이지 않기',
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
      '⑤ 자료에서 확인되는 구매 전 조건을 짧게 설명',
    ],
    intro: '구체적인 불편 상황 묘사로 시작',
    quoteStyle: '문제를 짚는 구절 (예: "세제로는 해결되지 않는 부분")',
    outro: '앞에서 설명한 장점을 되풀이하지 않고 필요한 사람에게 확인할 조건을 짧게 안내',
  },
  {
    key: 'summary-first',
    label: '핵심 요약형',
    weight: 3,
    fits: () => true,
    skeleton: [
      '① 이 제품을 찾는 상황과 가장 필요한 특징부터 소개',
      '② 실제 선택에 필요한 기능·옵션을 서로 연결해 설명',
      '③ 자주 헷갈리는 부분 정리',
      '④ 구매 전 확인할 점',
    ],
    intro: '첫 일반 문단에서 독자가 궁금해할 상황과 핵심 특징을 바로 설명',
    quoteStyle: '고를 때 도움이 되는 짧은 일상 표현',
    outro: '앞의 요약을 반복하지 않고 필요한 옵션을 확인하도록 자연스럽게 연결',
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
      '④ 다른 사용 장면이 실제 선택에 도움이 될 때만 추가',
      '⑤ 구매 전 확인할 점',
    ],
    intro: '생활 속 한 장면을 그리며 시작',
    quoteStyle: '장면을 여는 구절 (예: "출근 준비가 바쁜 아침이라면")',
    outro: '어떤 생활 패턴에 어울리는지 정리하며 마무리',
    // 경험 주장 금지 — 시나리오는 가정법으로만
    guard: '※ 직접 써본 것처럼 쓰지 마세요. "~해봤더니", "제가 써보니" 같은 경험 주장 금지. 자료에서 확인되는 용도를 "~할 때 쓰는 제품이에요"처럼 설명하세요. 생활 장면을 생생하게 만들려고 사용 효과나 체험을 지어내지 마세요.',
  },
  {
    key: 'step-guide',
    label: '단계별 가이드형',
    weight: 2,
    // 설치·조립·세척·사용 절차가 자료에 있을 때만
    fits: (ctx) => /설치|조립|세척|사용법|사용 방법|충전|교체|손질|관리법|세탁|분리|장착/.test(ctx.detailText || ''),
    skeleton: [
      '① 왜 이 과정을 알아야 하는지(개요)',
      '② 자료에 나온 절차를 필요한 만큼 순서대로 설명',
      '③ 단계마다 주의할 점',
      '④ 처음 사용할 때 확인해야 할 조건이 있으면 짧게 설명',
    ],
    intro: '처음 쓸 때 막히는 지점을 짚으며 시작',
    quoteStyle: '단계를 여는 구절 — 표현을 매번 다르게 (예: "먼저 할 일", "두 번째 순서", "마지막으로")',
    outro: '전체 절차를 반복하지 않고 필요한 부품·규격을 확인하는 말로 자연스럽게 마무리',
  },
  {
    key: 'checklist',
    label: '체크리스트형',
    weight: 2,
    // 규격·호환·성분 확인이 중요한 제품
    fits: (ctx) => /호환|규격|성분|주의|사양|스펙|재질|용량|무게|크기|치수|인증|KC/.test(ctx.detailText || ''),
    skeleton: [
      '① 구매 전에 헷갈릴 수 있는 구체적인 조건 소개',
      '② 항목별로 무엇을 어떻게 확인하는지',
      '③ 이 제품은 각 항목에서 어떤지',
      '④ 필요한 사람과 실제 생활 장면을 떠올리며 자연스럽게 마무리',
    ],
    intro: '모델·규격·용량을 고를 때 생기는 구체적인 궁금증에서 시작(본인 경험 주장 금지)',
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
 * 프레임 선택: 부적합 제외 → 주제 적합도 우선 → 같은 적합도 안에서 최근 사용분 회피
 * @param {'celeb'|'product'} type
 * @param {object} ctx 판정 근거 {topic, refText, detailText}
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

  // 2) 구성의 다양성보다 주제 적합성이 우선이다. 작품 안내 글을 최근에
  // 썼다는 이유로 이번 OTT 글에 생활·패션 프레임을 배정하지 않는다.
  const bestPriority = Math.max(...usable.map((frame) => frame.priority || 1));
  usable = usable.filter((frame) => (frame.priority || 1) === bestPriority);

  // 3) 같은 적합도 안에서 최근 글과 같은 프레임은 회피 (전부 걸리면 회피 포기)
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
    '아래는 내용 순서의 참고안입니다. 제목과 자료에 맞게 연결하고, 각 단계를 정해진 분량으로 채우거나 단계 이름을 본문에 쓰지 마세요.',
    ...frame.skeleton.map((s) => `  ${s}`),
    isProduct
      ? '- 단계마다 소제목을 붙이지 마세요. 상단 스펙을 포함해 quote는 글 전체 3~4개만 사용하고 나머지는 문단으로 자연스럽게 연결하세요.'
      : '- 위 단계는 내용 흐름을 위한 참고 순서입니다. 단계마다 소제목을 만들지 말고, quote/heading은 글 전체에서 꼭 필요한 경우에만 0~3개 사용하세요.',
    `- 도입: ${frame.intro}`,
    `- 구간 구절(quote) 표현: ${frame.quoteStyle}`,
    `- 마무리: ${frame.outro}`,
    '',
    '【내용과 말투 — 프레임보다 우선】',
    isProduct
      ? '- 자료에서 확인한 상품 특징과 실제 선택 조건을 설명하세요. 모든 특징에 구매 이유를 기계적으로 덧붙이거나 같은 장점을 다시 말하지 마세요.'
      : '- 제목에서 약속한 소식을 충분히 설명하세요. 장르별 작품 안내라면 작품마다 필요한 정보를 주고, 패션이 주제가 아니면 착장·뷰티 이야기를 넣지 마세요.',
    '- 확인된 사실을 쉬운 해요체로 전달하세요. "~예요", "~있어요", "~했어요"가 자연스러우면 그대로 쓰고, 친근함을 꾸미려고 반문이나 "~더라고요"를 반복하지 마세요.',
    '- 문단은 앞에서 꺼낸 내용에 이어지게 쓰세요. 추상적인 평가·의미·교훈을 덧붙이지 말고, 직접 시청하거나 사용한 것 같은 경험을 꾸미지 마세요.',
    '- 자료에 없는 사실·브랜드·일정·성능·반응은 쓰지 마세요. "~라고 해요", "~로 알려졌어요"를 붙여도 미확인 정보가 사실이 되지는 않습니다.',
    '- 본문·소제목·인용구·캡션은 공백과 문장부호 포함 한 줄 최대 28자로 쓰고 의미가 이어지는 곳에서 줄을 나누세요.',
    '- 마지막에 개인 생각을 반드시 넣을 필요는 없습니다. 앞의 내용을 반복하는 요약이나 상투적인 응원 없이 1~2문장으로 자연스럽게 끝내세요.',
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
