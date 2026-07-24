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

// ── 연예인 뉴스 글 프레임 6종 ────────────────────────────────
const CELEB_FRAMES = [
  {
    key: 'style-analysis',
    label: '스타일 분석형',
    weight: 3,
    fits: () => true,
    skeleton: [
      '① 전체적인 첫인상(무엇이 눈에 들어오는지)',
      '② 컬러 — 색 조합과 그 색이 주는 인상',
      '③ 실루엣·핏 — 옷의 라인과 비율',
      '④ 포인트 요소 — 액세서리·헤어·메이크업 중 하나',
      '⑤ 이 스타일이 잘 맞는 상황 정리',
    ],
    intro: '사진에서 가장 먼저 눈에 들어온 인상을 한두 줄로 서술하며 시작',
    quoteStyle: '분석 대상을 짚는 명사형 구절 (예: "컬러 조합이 만든 여름 인상")',
    outro: '어떤 자리에 어울리는 스타일인지 정리하며 마무리',
  },
  {
    key: 'key-points',
    label: '핵심 포인트형',
    weight: 3,
    fits: () => true,
    skeleton: [
      '① 이 룩의 핵심을 3가지로 먼저 제시(짧은 문단 3개)',
      '② 각 포인트를 하나씩 자세히 풀어서 설명',
      '③ 따라 할 때 흔히 하는 실수와 주의점',
      '④ 정리',
    ],
    intro: '결론부터 — "이번 룩의 핵심은 세 가지예요" 식으로 요약을 먼저 제시',
    quoteStyle: '포인트를 세는 표현 (예: "첫 번째, 톤을 낮춘 베이스")',
    outro: '세 포인트를 다시 한 줄로 압축하며 마무리',
  },
  {
    key: 'compare-change',
    label: '비교·변화형',
    weight: 2,
    // 참고자료에 과거·변화·비교를 말할 근거가 있을 때만
    fits: (ctx) => /이전|과거|기존|전작|그동안|변신|달라|최근 몇|예전/.test(ctx.refText || ''),
    skeleton: [
      '① 이전에 보여준 스타일 정리',
      '② 이번 스타일 소개',
      '③ 무엇이 달라졌는지 구체적으로 비교',
      '④ 이번 스타일이 더 잘 어울리는 이유',
    ],
    intro: '"예전과 분위기가 달라졌다"는 관찰에서 시작',
    quoteStyle: '변화를 드러내는 대비 표현 (예: "무채색에서 컬러로")',
    outro: '변화의 방향을 한 줄로 짚으며 마무리',
  },
  {
    key: 'scene-story',
    label: '장면 스토리형',
    weight: 3,
    fits: () => true,
    skeleton: [
      '① 사진이 공개된 장면·상황 서술',
      '② 그 장면에서 받은 첫인상',
      '③ 특히 눈에 띈 요소 두세 가지',
      '④ 장면 전체에 대한 총평',
    ],
    intro: '언제 어디서 공개된 모습인지 장면 묘사로 시작',
    quoteStyle: '장면을 짚는 서술형 구절 (예: "카메라 앞에서 보여준 여유")',
    outro: '그 장면이 남긴 인상으로 마무리',
  },
  {
    key: 'get-the-look',
    label: '따라 입기형',
    weight: 3,
    fits: () => true,
    skeleton: [
      '① 이 룩을 이루는 핵심 요소 정리',
      '② 일상에서 적용하는 방법 (가격대·난이도 현실적으로)',
      '③ 체형·계절별로 조정하는 팁',
      '④ 시작하기 좋은 한 가지 제안',
    ],
    intro: '"따라 하고 싶은데 부담스럽다"는 독자 고민에서 시작',
    quoteStyle: '실행을 권하는 구절 (예: "한 가지만 바꿔도 충분해요")',
    outro: '가장 쉬운 것 하나를 권하며 마무리',
  },
  {
    key: 'item-focus',
    label: '아이템 집중형',
    weight: 2,
    // 브랜드/아이템이 자료에서 확인될 때만 (없으면 추측성 서술이 됨)
    fits: (ctx) =>
      /브랜드|제품|착용|가방|재킷|자켓|드레스|슈즈|구두|워치|시계|주얼리|목걸이|귀걸이|립|섀도우|향수/.test(
        ctx.refText || ''
      ),
    skeleton: [
      '① 화제가 된 아이템 하나를 특정',
      '② 그 아이템의 특징과 왜 눈에 띄는지',
      '③ 다른 옷과 매치하는 방법',
      '④ 비슷한 느낌을 낼 수 있는 대안 방향(특정 상품 단정 금지)',
    ],
    intro: '한 가지 아이템에 시선이 갔다는 관찰로 시작',
    quoteStyle: '아이템을 지목하는 구절 (예: "가방 하나가 만든 차이")',
    outro: '그 아이템을 활용하는 방향을 제안하며 마무리',
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

/** 가중치 기반 무작위 1개 선택 */
function weightedPick(list) {
  const total = list.reduce((s, f) => s + (f.weight || 1), 0);
  let r = Math.random() * total;
  for (const f of list) {
    r -= f.weight || 1;
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

  const picked = weightedPick(pool);
  console.log(
    `[frames] ${type} 프레임 선택: ${picked.label} (후보 ${pool.length}/${all.length}, 최근 회피 ${recent.length}건)`
  );
  return picked;
}

/** 선택된 프레임을 프롬프트에 넣을 지시문으로 변환 */
function renderFrameInstruction(frame) {
  const lines = [
    `【이번 글의 구성 프레임 — "${frame.label}"】`,
    '이 글은 아래 흐름으로 쓰세요. 매번 같은 틀로 쓰지 않기 위해 이번 글에만 적용되는 구성입니다.',
    ...frame.skeleton.map((s) => `  ${s}`),
    `- 위 각 단계는 quote 구절 1개 + 문단(paragraph) 3~4개로 충분히 풀어서 쓰세요. 한 단계를 한 문단으로 끝내지 마세요.`,
    `- 도입: ${frame.intro}`,
    `- 구간 구절(quote) 표현: ${frame.quoteStyle}`,
    `- 마무리: ${frame.outro}`,
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
