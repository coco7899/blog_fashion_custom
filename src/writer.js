// 참고자료 → claude -p 로 자연스러운 블로그 글 재작성 (구조화 블록 출력)
const claude = require('./claude');
const skills = require('./skills');
const frames = require('./frames');

const BLOCK_TYPES = new Set(['heading', 'paragraph', 'quote', 'divider', 'image']);

// AI 글쓰기 제한 시간. 이 프롬프트(스킬 지침+참고자료+구조화 JSON 출력)는 실측 4~7분이
// 걸려서 5분 제한으로는 절반 가까이 실패했다. 여유를 둬 타임아웃 실패를 없앤다.
const WRITE_TIMEOUT_MS = 600000; // 10분

// 재작성을 건너뛰는 여유폭. 기준에 이만큼 이내로 근접했으면 굳이 다시 쓰지 않는다.
// (재작성은 한 번에 수 분이 더 들고, 대개 원본과 큰 차이가 없다)
const CHARS_TOLERANCE = 150;

const MIN_CHARS = 1300;         // 연예인 글 본문 최소 글자 수
// 상품 글은 짧은 줄바꿈 문체라 자연 분량이 ~1,000~1,200자다. 목표를 너무 높이면
// 매 글마다 재작성(5분+타임아웃)이 걸리므로, 잘리거나 깨진 결과만 걸러내는 안전선으로 둔다.
const MIN_PRODUCT_CHARS = 1000;
const MIN_IMAGES = 4;           // 최소 이미지(사진) 개수

function buildPrompt(topic, refText, frame, retryNote) {
  const skill = skills.loadSkill('01-celebrity-news-blog');
  return `아래는 블로그 글쓰기 "형식 참고용" 스킬 지침입니다. **말투·문단 길이·구간 나누기 같은 '형식'만 참고**하고,
글의 **주제와 내용 흐름은 아래 【글 작성 방식】과 【참고자료(뉴스)】에 충실히** 따르세요.
(스킬의 패션·뷰티 예시에 억지로 끼워 맞추지 마세요.)

═══════════ 스킬 지침(형식 참고용) 시작 ═══════════
${skill}
═══════════ 스킬 지침 끝 ═══════════

【이 자동화 환경에 맞춘 조정 — 최우선】
- 글감 선택은 이미 끝났습니다. 후보 제안 없이 곧바로 "선택 주제 글쓰기"를 실행하세요.
- 이미지는 시스템이 뉴스에서 수집해 image 블록 순서대로 배치합니다. 이미지 다운로드·ZIP·목록·표는 생략하세요.
- 출처 링크는 시스템이 글 끝에 자동으로 정리합니다. 본문에 출처 목록을 넣지 마세요.
- image desc/caption은 **그 뉴스에 실제로 있을 법한 사진**만 묘사하세요(뉴스 속 인물·현장·장면). 연출 상품 컷은 금지.

【글 작성 방식 — 뉴스 큐레이션(소개)형】 ★가장 중요
1. **뉴스 내용에 충실하게 쓰세요.** 참고자료(뉴스)에 나온 사실을 그대로 소개·정리하는 글입니다.
   - **패션·뷰티·스타일 분석으로 억지로 끌고 가지 마세요.** 제목과 본문 내용이 **반드시 일치**해야 합니다.
   - 자료에 없는 사실·브랜드·가격·추측은 지어내지 마세요. 확인 안 된 건 "~라고 전해졌습니다", "~로 알려졌어요"처럼 조심스럽게.
2. **말투는 "이런 기사가 났더라고요" 하고 독자에게 뉴스를 소개·큐레이션하듯** 친근하게 쓰세요.
   예: "얼마 전 이런 소식이 있었는데요", "정리해서 소개해드릴게요".
3. 흐름:
   ① 시작 image 1~2장 + 도입 (제목의 궁금증을 이어받아 '무슨 뉴스인지' 한두 문장으로).
   ② 무슨 일이 있었는지 → 배경/경과 → 세부 내용·반응 순서로, 뉴스를 차근차근 소개.
   ③ **마지막 구간에 글쓴이(나)의 생각을 자연스럽게 조금** 담으세요.
      ("개인적으로는~", "저는 ~하게 느껴졌어요" 정도로 담백하게. 단정·훈계·과장 금지, 1~3문장.)
4. 구간은 **소제목(heading) 대신 quote 블록(8~20자 짧은 구절)**로 나눕니다. quote 3~5개.
5. 문단(paragraph)은 1~2문장, 최대 3줄. 각 줄은 10~35자에서 \\n으로 끊으세요. 각 구간마다 문단 3~4개.
6. 이미지는 총 ${MIN_IMAGES}~7장: 시작 1~2장 + 구간 사이사이.
7. ★**문장 끝맺음을 다양하게 섞으세요.** "~습니다 / ~예요 / ~죠 / ~더라고요 / ~네요 / ~거든요 / ~답니다"를 번갈아. 같은 어미 2번 연속 금지, "~요"가 절반을 넘지 않게. 굵게(**)는 1~3곳만.
8. 본문 글자 수 공백 포함 **1,400~1,800자**. 분량이 부족하면 스타일 분석이 아니라 **뉴스의 배경·경과·맥락·반응·비슷한 사례**로 채우세요.
9. 과장·낚시 금지. **제목과 다른 내용 금지.**

${frames.renderFrameInstruction(frame)}
※ 위 구성 프레임은 이번 글에만 적용됩니다. 상투적 도입("오늘은 ~에 대해 알아볼게요") 대신 뉴스 소개 흐름에 맞게 새로 지으세요.

【글감】
제목: ${topic.title}
관점: ${topic.angle || '뉴스를 독자에게 소개·정리'}
키워드: ${(topic.keywords || []).join(', ')}

【참고자료(뉴스)】
${refText}
${retryNote || ''}
다음 JSON 형식으로만 출력:
{
  "title": "홈판 후킹형 제목 (제목과 본문 내용이 일치해야 함)",
  "tags": ["태그1", "태그2"],
  "blocks": [
    {"type": "image", "slot": 1, "caption": "뉴스 속 장면 설명", "desc": "이 뉴스에 실제로 있을 법한 사진 — 인물/현장"},
    {"type": "paragraph", "text": "얼마 전 이런 소식이 전해졌는데요.\\n한번 정리해서 소개해드릴게요."},
    {"type": "quote", "text": "무슨 일이 있었나"},
    {"type": "paragraph", "text": "뉴스의 핵심 사실을\\n차근차근 풀어서."},
    {"type": "image", "slot": 2, "caption": "관련 장면", "desc": "뉴스 속 다른 사진"},
    {"type": "paragraph", "text": "배경과 경과를\\n덧붙여서."},
    {"type": "quote", "text": "이번 소식을 보며"},
    {"type": "paragraph", "text": "개인적으로는 ~하게 느껴졌어요."}
  ]
}
quote 3~5개, 이미지 최소 ${MIN_IMAGES}개(400자당 1장 안팎), tags 5~10개. 모두 왼쪽 정렬.`;
}

function normalize(article) {
  let slotNo = 0;
  article.blocks = article.blocks
    .filter((b) => b && BLOCK_TYPES.has(b.type))
    .map((b) => {
      if (b.type === 'image') {
        slotNo += 1;
        return { type: 'image', slot: slotNo, caption: String(b.caption || ''), desc: String(b.desc || '') };
      }
      if (b.type === 'divider') return { type: 'divider' };
      // 좌측 정렬만 사용 — align 필드는 무시
      return { type: b.type, text: String(b.text || '').trim() };
    })
    .filter((b) => b.type === 'divider' || b.type === 'image' || b.text);

  article.tags = (Array.isArray(article.tags) ? article.tags : [])
    .map((t) => String(t).replace(/[#\s]+/g, ''))
    .filter(Boolean)
    .slice(0, 10);
  return article;
}

function measure(article) {
  const chars = article.blocks
    .filter((b) => b.text)
    .reduce((s, b) => s + b.text.replace(/\*\*/g, '').length, 0);
  const images = article.blocks.filter((b) => b.type === 'image').length;
  const headings = article.blocks.filter((b) => b.type === 'heading').length;
  const quotes = article.blocks.filter((b) => b.type === 'quote').length;
  return { chars, images, headings, quotes };
}

/**
 * @param {object} topic {title, angle, keywords}
 * @param {Array} refs collectReferences 결과 [{title, url, source, text}]
 * @returns {object} {title, tags, blocks}
 */
async function writeArticle(topic, refs) {
  const refText = refs
    .map(
      (r, i) =>
        `--- 참고자료 ${i + 1} (${r.kind === 'news' ? '뉴스' : '블로그'}: ${r.source || r.title}) ---\n제목: ${r.title}\n${r.text.slice(0, 4000)}`
    )
    .join('\n\n');

  // 이번 글의 구성 프레임 선택 (부적합 제외 → 최근 사용 회피 → 가중 랜덤)
  const frame = frames.pickFrame('celeb', { refText });

  let article = await claude.invokeJson(buildPrompt(topic, refText, frame), { timeoutMs: WRITE_TIMEOUT_MS });
  if (!article || !article.title || !Array.isArray(article.blocks)) {
    throw new Error('글 작성 결과 형식이 올바르지 않습니다.');
  }
  article = normalize(article);

  // 보강 재작성 판단.
  // 글자 수가 기준에 근접(오차 CHARS_TOLERANCE 이내)하면 재작성하지 않는다 —
  // 재작성은 수 분이 더 걸리는데 결과가 원본과 크게 다르지 않은 경우가 많다.
  // 이미지·인용구 부족이나 프레임 요건 미달은 글의 형태 자체가 어긋난 것이므로 그대로 재작성한다.
  const m = measure(article);
  const frameIssue = frame.check ? frame.check(article) : null;
  const charsTooShort = m.chars < MIN_CHARS - CHARS_TOLERANCE;
  if (charsTooShort || m.images < MIN_IMAGES || m.quotes < 3 || frameIssue) {
    console.log(
      `[writer] 기준 미달(글자 ${m.chars}, 이미지 ${m.images}, 인용구 ${m.quotes}${frameIssue ? `, ${frameIssue}` : ''}) → 재작성`
    );
    const note = `\n※ 이전 결과가 기준에 못 미쳤습니다(글자 ${m.chars}자, 이미지 ${m.images}, 인용구 ${m.quotes}${frameIssue ? `, ${frameIssue}` : ''}). 반드시: 글자 수 1,400자 이상, quote 블록(구간 구절) 4개 이상, 이미지 5장 이상(시작 2장 포함).\n`;
    try {
      let retry = await claude.invokeJson(buildPrompt(topic, refText, frame, note), { timeoutMs: WRITE_TIMEOUT_MS });
      if (retry && retry.title && Array.isArray(retry.blocks)) {
        retry = normalize(retry);
        const rm = measure(retry);
        const meets = (x) => x.chars >= MIN_CHARS && x.images >= MIN_IMAGES && x.quotes >= 3;
        // 재작성이 기준을 충족하거나, 원본이 미달인데 재작성이 더 길면 채택
        if (meets(rm) || (!meets(m) && rm.chars > m.chars && rm.images >= MIN_IMAGES)) {
          article = retry;
          console.log(`[writer] 재작성 채택(글자 ${rm.chars}, 이미지 ${rm.images}, 인용구 ${rm.quotes})`);
        }
      }
    } catch (e) {
      console.log(`[writer] 재작성 실패(원본 사용): ${e.message}`);
    }
  } else if (m.chars < MIN_CHARS) {
    console.log(`[writer] 글자 ${m.chars}자 — 기준(${MIN_CHARS})에 근접해 재작성 생략`);
  }

  // 어떤 프레임으로 썼는지 기록 (이력 표시 + 다음 글의 중복 회피에 사용)
  article.frameKey = frame.key;
  article.frameLabel = frame.label;
  return article;
}

// 상품명에서 브랜드+핵심 제품명만 간결히 뽑는다 (스펙 인용구 첫 줄용 폴백)
function deriveProductName(name) {
  let s = String(name || '').trim();
  s = s.replace(/^\[[^\]]*\]\s*/, ''); // 앞의 [2개] 등 제거
  s = s.replace(/\s*(공식\s*스토어|브랜드\s*스토어|스토어|공식몰).*$/i, '').trim(); // 스토어명 제거
  // 용량/수량 앞까지 (50mlX2개 처럼 단위+수량이 붙어도 자르도록 경계 대신 룩어헤드 사용)
  const m = s.match(/^(.*?)\s*\d+\s*(ml|mL|g|kg|개|매|정|캡슐|포|스틱|장)(?=[\sxX*×\d]|$)/);
  if (m && m[1].trim().length >= 3) s = m[1].trim();
  s = s.replace(/\s*[xX*×]\s*\d+\s*(개|팩|세트)?$/, '').trim(); // 끝의 x2개 등 제거
  return s.slice(0, 40);
}

/**
 * 스펙 인용구 블록을 보장한다 — 모든 상품 글이 첨부 영상처럼
 * "① 대표 이미지 → ② 스펙 인용구( '{상품명} 상품 스펙' + 항목 )" 형태를 갖도록 강제.
 * AI가 스펙 인용구를 빠뜨리거나 제목 형식이 어긋나도 코드에서 교정/삽입한다.
 */
function enforceSpecQuote(article, product) {
  const blocks = article.blocks;
  const isSpec = (b) => b.type === 'quote' && (/상품\s*스펙/.test(b.text) || /·\s*상품명/.test(b.text));
  const derived = deriveProductName(product.name);
  const idx = blocks.findIndex(isSpec);
  if (idx >= 0) {
    // 이미 스펙 인용구가 있으면 첫 줄 형식만 "{상품명} 상품 스펙" 으로 정규화
    const lines = blocks[idx].text.split('\n');
    let head = String(lines[0] || '').trim();
    head = head.replace(/한눈에\s*보는\s*/g, '').replace(/\s*상품\s*스펙\s*$/, '').trim();
    if (!head || /^·/.test(head)) head = derived; // 첫 줄이 항목(·)이면 파생 상품명 사용
    lines[0] = `${head} 상품 스펙`;
    blocks[idx].text = lines.join('\n');
    // 대표 이미지 바로 다음(없으면 맨 앞)으로 위치 이동
    const spec = blocks.splice(idx, 1)[0];
    const imgIdx = blocks.findIndex((b) => b.type === 'image');
    blocks.splice(imgIdx >= 0 ? imgIdx + 1 : 0, 0, spec);
  } else {
    // 스펙 인용구가 아예 없으면 상품 정보로 최소 스펙을 만들어 삽입
    const priceLine = product.price
      ? `· 가격: ${Number(product.price).toLocaleString()}원 (작성 시점 기준)`
      : '';
    const specText = [`${derived} 상품 스펙`, `· 상품명: ${derived}`, priceLine].filter(Boolean).join('\n');
    const imgIdx = blocks.findIndex((b) => b.type === 'image');
    blocks.splice(imgIdx >= 0 ? imgIdx + 1 : 0, 0, { type: 'quote', text: specText });
  }
  return article;
}

/**
 * 쇼핑커넥트 상품 소개 글 작성 — skills/02-naver-shopping-connect-blog 스킬 지침 구동.
 * @param {object} product {name, price, commission, reviews, rating, query}
 * @param {object} detail {description, images}
 * @returns {object} {title, titleAlternatives, tags, blocks}
 */
function buildProductPrompt(product, detail, frame, imgCount, retryNote) {
  const skill = skills.loadSkill('02-naver-shopping-connect-blog');
  if (!skill) throw new Error('쇼핑커넥트 스킬(skills/02-naver-shopping-connect-blog/SKILL.md)을 찾을 수 없습니다.');

  return `아래는 "네이버 쇼핑커넥트 블로그" 스킬 지침입니다. 이 지침을 반드시 따라 상품 소개 글을 작성하세요.

═══════════ 스킬 지침 시작 ═══════════
${skill}
═══════════ 스킬 지침 끝 ═══════════

【이 자동화 환경에 맞춘 조정 — 지침보다 우선】
- 이미지: 상세페이지 원본 이미지는 시스템이 이미 수집해 image 블록 순서대로 배치합니다. image 블록을 ${imgCount}개 넣고, desc는 "대표", "핵심 특징", "사용 장면/디테일" 등 역할만 쓰세요. **AI 연출 이미지는 이 환경에서 생성 불가하므로 만들지 마세요.**
- ZIP·이미지 미리보기·이미지 목록·공식 상세페이지 링크 출력은 시스템이 처리하므로 생략하세요.
- 상품 링크는 시스템이 글 마지막에 자동으로 붙입니다. 마지막 문단에서 "아래 링크에서 확인해보세요"로 자연스럽게 유도만 하세요.

【이 블로그의 실제 발행 글 스타일 — 반드시 이 형태로 쓸 것】
1. 블록 순서: ① image slot 1(대표) → ② **quote 블록 하나에 스펙 요약 전체**. 스펙 quote의 **첫 줄은 반드시 "{상품명} 상품 스펙"** 형태로 쓰세요(상품명은 브랜드+핵심 제품명 위주로 자연스럽게 줄여서. 예: "샤넬 향수 상품 스펙", "토니모리 세라마이드 모찌 토너 상품 스펙"). 그다음 줄부터 "· 상품명: ...\\n· 형태: ...\\n· 핵심 특징: ...\\n· 활용: ...\\n· 가격: ...원 (작성 시점 기준)" 처럼 4~6항목(줄바꿈 \\n). → ③ 그 다음부터는 아래 【이번 글의 구성 프레임】의 흐름을 따르세요. **광고·제휴 고지 문구는 시스템이 맨 위에 자동 삽입하므로 쓰지 마세요.**
2. **소제목(heading) 블록을 쓰지 마세요.** 구간 전환은 **quote 블록(8~20자 짧은 구절)**로 합니다.
   예: "섬유항균제는 세탁세제와 역할이 달라요", "공간에 따라 다르게 쓸 수 있는 2in1 구조"
   스펙 quote 외에 구간 quote를 3~5개 쓰세요. "구매 전 체크"도 quote 구절 + 항목 문단으로.
3. 문단(paragraph 블록)은 **1~2문장, 최대 3줄**. 각 줄은 10~35자에서 줄바꿈 문자(\\n)로 끊으세요.
   **각 quote 구간마다 paragraph 블록을 3~4개씩** 넣어 내용을 충분히 풀어주세요. (전체 paragraph 블록 20개 이상)
4. 이미지는 대표 1장 + 구간 사이사이 배치.
5. 제목: 이번 글의 구성 프레임 성격에 맞게 짓되 상품명이 들어가게 하세요. 매번 같은 "~라면, 상품명" 틀을 반복하지 말고 프레임에 맞춰 변형하세요.
   (문제 해결형 예: "실내건조 빨래 냄새가 고민이라면, 랩신 섬유항균제 사용법과 구성" / 비교·선택형 예: "○○ 사이즈 어떤 걸 골라야 할까, 모델별 차이 정리" / 체크리스트형 예: "○○ 구매 전 확인할 5가지")
6. ★**문장 끝맺음을 다양하게 섞으세요.** 한 글이 전부 "~요"로 끝나면 안 됩니다. "~습니다 / ~예요 / ~죠 / ~더라고요 / ~네요 / ~거든요 / ~답니다"처럼 여러 어미를 실제 말하듯 자연스럽게 번갈아 쓰세요. **같은 어미("~요" 포함)를 2번 연속 쓰지 말고**, 특히 "~요"로 끝나는 문장이 전체의 절반을 넘지 않게 하세요. 굵게(**)는 꼭 필요한 1~3곳만.
7. 본문 **1,400~1,700자 (반드시 1,300자 이상)**. 줄이 짧은 만큼 문단 수로 분량을 채우세요. 모든 글 왼쪽 정렬.

${frames.renderFrameInstruction(frame)}
※ 위 구성 프레임은 이번 글에만 적용됩니다. 도입 문구·구간 구절·마무리 표현을 상투적인 틀 대신 이 프레임 흐름에 맞게 새로 지으세요.
※ 상세페이지에서 확인되지 않는 성능·효과·수치는 단정하지 마세요.

【상품 정보 (상세페이지에서 수집)】
상품명: ${product.name}
가격: ${product.price ? Number(product.price).toLocaleString() + '원 (작성 시점 기준)' : '상세페이지 확인'}
리뷰: ${product.reviews || 0}개${product.rating ? ` (평점 ${product.rating})` : ''}
카테고리: ${product.query || ''}

상세페이지 내용:
${String(detail.description || '').slice(0, 2200)}

【출력 형식 — 이 JSON으로만】
{
  "title": "독자 문제 + 해결 실마리, 상품명 흐름의 제목",
  "titleAlternatives": ["제목 대안1", "제목 대안2", "제목 대안3"],
  "tags": ["해시태그1", "해시태그2"],
  "blocks": [
    {"type":"image","slot":1,"caption":"자연스러운 사진 설명","desc":"대표"},
    {"type":"quote","text":"○○○ 상품 스펙\\n· 상품명: ...\\n· 형태: ...\\n· 핵심 특징: ...\\n· 활용: ...\\n· 가격: ...원 (작성 시점 기준)"},
    {"type":"paragraph","text":"문제 상황으로 시작하는 도입부.\\n다음 줄이에요."},
    {"type":"quote","text":"구간을 여는 짧은 구절"},
    {"type":"paragraph","text":"본문 1~2문장.\\n다음 줄."},
    {"type":"image","slot":2,"caption":"사진 설명","desc":"핵심 특징"},
    {"type":"paragraph","text":"..."},
    {"type":"quote","text":"구매 전 체크"},
    {"type":"paragraph","text":"· 체크1\\n· 체크2\\n· 체크3"},
    {"type":"paragraph","text":"마무리와 링크 유도 문단"}
  ]
}
tags는 5~10개. 본문(제목 제외) 1,300자 이상.
${retryNote || ''}`;
}

/**
 * 쇼핑커넥트 상품 소개 글 작성 — skills/02-naver-shopping-connect-blog 스킬 지침 구동.
 * @param {object} product {name, price, commission, reviews, rating, query}
 * @param {object} detail {description, images}
 * @returns {object} {title, titleAlternatives, tags, blocks}
 */
async function writeProductArticle(product, detail) {
  const imgCount = Math.min(Math.max((detail.images || []).length, 2), 6);

  // 이번 글의 구성 프레임 선택 — 상세페이지 내용으로 적합성을 판정한다
  const detailText = `${product.name || ''}\n${String(detail.description || '')}`;
  const frame = frames.pickFrame('product', { detailText });

  const run = async (note) => {
    const raw = await claude.invokeJson(buildProductPrompt(product, detail, frame, imgCount, note), {
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    if (!raw || !raw.title || !Array.isArray(raw.blocks)) {
      throw new Error('상품 글 작성 결과 형식이 올바르지 않습니다.');
    }
    const alts = (Array.isArray(raw.titleAlternatives) ? raw.titleAlternatives : []).map(String).slice(0, 3);
    const a = enforceSpecQuote(normalize(raw), product); // 스펙 인용구 형식/위치 보장
    a.titleAlternatives = alts;
    return a;
  };

  let article = await run();

  // 분량·프레임 요건 미달 시 1회 보강 재작성 (연예인 글과 동일한 품질 기준 적용)
  const m = measure(article);
  const frameIssue = frame.check ? frame.check(article) : null;
  if (m.chars < MIN_PRODUCT_CHARS - CHARS_TOLERANCE || frameIssue) {
    console.log(`[writer] 상품 글 기준 미달(글자 ${m.chars}${frameIssue ? `, ${frameIssue}` : ''}) → 재작성`);
    const note = `\n※ 이전 결과가 기준에 못 미쳤습니다(본문 ${m.chars}자${frameIssue ? `, ${frameIssue}` : ''}). 반드시 본문 ${MIN_PRODUCT_CHARS}자 이상으로, 각 구간마다 문단을 3~4개씩 넣어 충분히 풀어서 쓰세요.\n`;
    try {
      const retry = await run(note);
      const rm = measure(retry);
      if (rm.chars > m.chars) {
        article = retry;
        console.log(`[writer] 상품 글 재작성 채택(글자 ${rm.chars})`);
      }
    } catch (e) {
      console.log(`[writer] 상품 글 재작성 실패(원본 사용): ${e.message}`);
    }
  } else if (m.chars < MIN_PRODUCT_CHARS) {
    console.log(`[writer] 상품 글 ${m.chars}자 — 기준(${MIN_PRODUCT_CHARS})에 근접해 재작성 생략`);
  }

  // 어떤 프레임으로 썼는지 기록 (이력 표시 + 다음 글의 중복 회피에 사용)
  article.frameKey = frame.key;
  article.frameLabel = frame.label;
  return article;
}

module.exports = { writeArticle, writeProductArticle, measure };
