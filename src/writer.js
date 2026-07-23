// 참고자료 → claude -p 로 자연스러운 블로그 글 재작성 (구조화 블록 출력)
const claude = require('./claude');
const skills = require('./skills');

const BLOCK_TYPES = new Set(['heading', 'paragraph', 'quote', 'divider', 'image']);

const MIN_CHARS = 1300; // 본문 최소 글자 수
const MIN_IMAGES = 4;   // 최소 이미지(사진) 개수

function buildPrompt(topic, refText, retryNote) {
  const skill = skills.loadSkill('01-celebrity-news-blog');
  return `아래는 "연예인 뉴스 블로그" 스킬 지침입니다. 이 지침을 반드시 따라 블로그 글을 작성하세요.

═══════════ 스킬 지침 시작 ═══════════
${skill}
═══════════ 스킬 지침 끝 ═══════════

【이 자동화 환경에 맞춘 조정 — 지침보다 우선】
- 글감 선택은 이미 끝났습니다. 후보 제안 없이 곧바로 "선택 주제 글쓰기"를 실행하세요.
- 이미지는 시스템이 뉴스에서 수집해 image 블록 순서대로 배치합니다. 이미지 다운로드·ZIP·이미지 목록·표 출력은 생략하세요.
- 출처 링크는 시스템이 글 끝에 자동으로 정리합니다. 본문에 출처 목록을 넣지 마세요.
- 이미지 desc/caption은 뉴스에 실제 존재할 사진만 묘사하세요: 주인공(연예인)의 실제 인물 사진, 공개된 현장·행사 장면. 연출된 상품 컷("침대 위 캐리어" 등)은 금지.

【이 블로그의 실제 발행 글 스타일 — 반드시 이 형태로 쓸 것】
1. **글 시작은 image 블록 2개(slot 1, 2 연속)** → 그 다음에 도입 문단이 옵니다.
2. **소제목(heading) 블록을 쓰지 마세요.** 구간 전환은 **quote 블록(8~20자의 짧은 구절)**로 합니다.
   예: "블랙 슈트가 만드는 단정한 존재감", "네일까지 연결하면 완성도가 달라져요"
   quote를 4~6개 써서 글을 4~6구간으로 나누세요.
3. 문단(paragraph 블록)은 **1~2문장, 최대 3줄**. 각 줄은 10~35자에서 줄바꿈 문자(\\n)로 끊으세요.
   **각 quote 구간마다 paragraph 블록을 3~4개씩** 넣어 내용을 충분히 풀어주세요. (전체 paragraph 블록 20개 이상)
4. 이미지는 총 5~7장: 시작 2장 + 각 구간 사이사이에 배치.
5. 제목은 "인물 이름+핵심 아이템, 정보성 부제" 형태.
   예: "김민하 블루 아이섀도우, 네일까지 맞춘 여름 포인트 메이크업"
6. ★**문장 끝맺음을 다양하게 섞으세요.** 한 글이 전부 "~요"로 끝나면 안 됩니다. "~습니다 / ~예요 / ~죠 / ~더라고요 / ~네요 / ~거든요 / ~답니다"처럼 여러 어미를 실제 말하듯 자연스럽게 번갈아 쓰세요. **같은 어미("~요" 포함)를 2번 연속 쓰지 말고**, 특히 "~요"로 끝나는 문장이 전체의 절반을 넘지 않게 하세요. 굵게(**)는 꼭 필요한 1~3곳만.
7. 본문 글자 수는 공백 포함 **1,500~1,800자 (반드시 1,400자 이상)**. 줄이 짧은 만큼 문단 수로 분량을 채우세요. 소재가 부족하면 스타일 분석·따라 하기 팁·비슷한 상황 활용법으로 구체적으로 확장하세요.
8. 도입은 독자의 상황·고민에서 시작(과장·낚시 금지), 마지막은 독자에게 말 거는 1~2줄.

【글감】
제목: ${topic.title}
관점: ${topic.angle || '독자에게 도움이 되는 정리'}
키워드: ${(topic.keywords || []).join(', ')}

【참고자료】
${refText}
${retryNote || ''}
다음 JSON 형식으로만 출력:
{
  "title": "인물+아이템, 정보성 부제 형태의 제목",
  "tags": ["태그1", "태그2"],
  "blocks": [
    {"type": "image", "slot": 1, "caption": "행사장에서 포즈를 취한 ○○○", "desc": "주인공의 실제 인물 사진 — 뉴스 공개 장면"},
    {"type": "image", "slot": 2, "caption": "포인트가 돋보이는 클로즈업", "desc": "주인공의 다른 각도/디테일 사진"},
    {"type": "paragraph", "text": "여름 메이크업은 가볍게 하고 싶지만,\\n너무 무난해 보이면 아쉽습니다.\\n이럴 때 참고할 만한 룩이 있어요."},
    {"type": "quote", "text": "포인트 컬러 하나로 달라지는 인상"},
    {"type": "paragraph", "text": "핵심은 절제입니다.\\n한 곳에만 색을 쓰는 방식이에요."},
    {"type": "image", "slot": 3, "caption": "사진 설명", "desc": "주인공의 현장 사진"},
    {"type": "paragraph", "text": "..."},
    {"type": "quote", "text": "다음 구간의 짧은 구절"},
    {"type": "paragraph", "text": "..."}
  ]
}
소제목 3~5개, 이미지는 글 길이에 비례(최소 ${MIN_IMAGES}개, 400자당 1장 안팎), quote 2~4개, tags 5~10개. 모두 왼쪽 정렬.`;
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

  let article = await claude.invokeJson(buildPrompt(topic, refText), { timeoutMs: 300000 });
  if (!article || !article.title || !Array.isArray(article.blocks)) {
    throw new Error('글 작성 결과 형식이 올바르지 않습니다.');
  }
  article = normalize(article);

  // 최소 글자수/이미지/구간(인용구) 미달 시 1회 보강 재작성
  const m = measure(article);
  if (m.chars < MIN_CHARS || m.images < MIN_IMAGES || m.quotes < 3) {
    console.log(`[writer] 기준 미달(글자 ${m.chars}, 이미지 ${m.images}, 인용구 ${m.quotes}) → 재작성`);
    const note = `\n※ 이전 결과가 기준에 못 미쳤습니다(글자 ${m.chars}자, 이미지 ${m.images}, 인용구 ${m.quotes}). 반드시: 글자 수 1,400자 이상, quote 블록(구간 구절) 4개 이상, 이미지 5장 이상(시작 2장 포함).\n`;
    try {
      let retry = await claude.invokeJson(buildPrompt(topic, refText, note), { timeoutMs: 300000 });
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
  }

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
async function writeProductArticle(product, detail) {
  const skill = skills.loadSkill('02-naver-shopping-connect-blog');
  if (!skill) throw new Error('쇼핑커넥트 스킬(skills/02-naver-shopping-connect-blog/SKILL.md)을 찾을 수 없습니다.');
  const imgCount = Math.min(Math.max((detail.images || []).length, 2), 6);

  const prompt = `아래는 "네이버 쇼핑커넥트 블로그" 스킬 지침입니다. 이 지침을 반드시 따라 상품 소개 글을 작성하세요.

═══════════ 스킬 지침 시작 ═══════════
${skill}
═══════════ 스킬 지침 끝 ═══════════

【이 자동화 환경에 맞춘 조정 — 지침보다 우선】
- 이미지: 상세페이지 원본 이미지는 시스템이 이미 수집해 image 블록 순서대로 배치합니다. image 블록을 ${imgCount}개 넣고, desc는 "대표", "핵심 특징", "사용 장면/디테일" 등 역할만 쓰세요. **AI 연출 이미지는 이 환경에서 생성 불가하므로 만들지 마세요.**
- ZIP·이미지 미리보기·이미지 목록·공식 상세페이지 링크 출력은 시스템이 처리하므로 생략하세요.
- 상품 링크는 시스템이 글 마지막에 자동으로 붙입니다. 마지막 문단에서 "아래 링크에서 확인해보세요"로 자연스럽게 유도만 하세요.

【이 블로그의 실제 발행 글 스타일 — 반드시 이 형태로 쓸 것】
1. 블록 순서: ① image slot 1(대표) → ② **quote 블록 하나에 스펙 요약 전체**. 스펙 quote의 **첫 줄은 반드시 "{상품명} 상품 스펙"** 형태로 쓰세요(상품명은 브랜드+핵심 제품명 위주로 자연스럽게 줄여서. 예: "샤넬 향수 상품 스펙", "토니모리 세라마이드 모찌 토너 상품 스펙"). 그다음 줄부터 "· 상품명: ...\\n· 형태: ...\\n· 핵심 특징: ...\\n· 활용: ...\\n· 가격: ...원 (작성 시점 기준)" 처럼 4~6항목(줄바꿈 \\n). → ③ 문제 상황 도입 문단 → 본문. **광고·제휴 고지 문구는 시스템이 맨 위에 자동 삽입하므로 쓰지 마세요.**
2. **소제목(heading) 블록을 쓰지 마세요.** 구간 전환은 **quote 블록(8~20자 짧은 구절)**로 합니다.
   예: "섬유항균제는 세탁세제와 역할이 달라요", "공간에 따라 다르게 쓸 수 있는 2in1 구조"
   스펙 quote 외에 구간 quote를 3~5개 쓰세요. "구매 전 체크"도 quote 구절 + 항목 문단으로.
3. 문단(paragraph 블록)은 **1~2문장, 최대 3줄**. 각 줄은 10~35자에서 줄바꿈 문자(\\n)로 끊으세요.
   **각 quote 구간마다 paragraph 블록을 3~4개씩** 넣어 내용을 충분히 풀어주세요. (전체 paragraph 블록 20개 이상)
4. 이미지는 대표 1장 + 구간 사이사이 배치.
5. 제목: "독자 문제 + 해결 실마리, 상품명" 흐름. 예: "실내건조 빨래 냄새가 고민이라면, 랩신 섬유항균제 사용법과 구성"
6. ★**문장 끝맺음을 다양하게 섞으세요.** 한 글이 전부 "~요"로 끝나면 안 됩니다. "~습니다 / ~예요 / ~죠 / ~더라고요 / ~네요 / ~거든요 / ~답니다"처럼 여러 어미를 실제 말하듯 자연스럽게 번갈아 쓰세요. **같은 어미("~요" 포함)를 2번 연속 쓰지 말고**, 특히 "~요"로 끝나는 문장이 전체의 절반을 넘지 않게 하세요. 굵게(**)는 꼭 필요한 1~3곳만.
7. 본문 **1,400~1,700자 (반드시 1,300자 이상)**. 줄이 짧은 만큼 문단 수로 분량을 채우세요. 모든 글 왼쪽 정렬.

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
tags는 5~10개. 본문(제목 제외) 1,300자 이상.`;

  let article = await claude.invokeJson(prompt, { timeoutMs: 300000 });
  if (!article || !article.title || !Array.isArray(article.blocks)) {
    throw new Error('상품 글 작성 결과 형식이 올바르지 않습니다.');
  }
  const titleAlternatives = (Array.isArray(article.titleAlternatives) ? article.titleAlternatives : [])
    .map(String)
    .slice(0, 3);
  article = normalize(article);
  article = enforceSpecQuote(article, product); // 스펙 인용구 형식/위치 보장
  article.titleAlternatives = titleAlternatives;
  return article;
}

module.exports = { writeArticle, writeProductArticle, measure };
