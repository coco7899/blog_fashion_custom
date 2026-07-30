// 참고자료 → Codex로 자연스러운 블로그 글 재작성 (구조화 블록 출력)
const codex = require('./codex');
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
const MIN_PRODUCT_CHARS = 1200;
const MIN_IMAGES = 1;           // 기사에 적합한 대표 이미지가 1장이면 충분

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
   ① 상단 대표 image 1장 + 도입 (제목의 궁금증을 이어받아 '무슨 뉴스인지' 자연스럽게 소개).
   ② 무슨 일이 있었는지 → 배경/경과 → 세부 내용·반응 순서로, 뉴스를 차근차근 소개.
   ③ 필요하면 마지막에 **글쓴이(나)의 생각을 자연스럽게 조금** 담으세요.
      ("개인적으로는~", "저는 ~하게 느껴졌어요" 정도로 담백하게. 단정·훈계·과장 금지, 1~3문장.)
4. 소제목이나 quote는 꼭 필요한 전환점에만 **전체 1~3개** 사용하세요. 모든 내용을 잘게 나누지 말고 문단끼리 자연스럽게 이어지게 하세요.
5. 문단(paragraph)은 1~3문장으로 쓰되, 문장을 기계적으로 짧게 끊지 마세요. 읽었을 때 한 편의 이야기처럼 술술 이어져야 합니다.
6. 이미지는 기사 자료에 따라 **총 1~4장**만 사용하세요. 상단에는 대표 이미지 1장만 두고, 추가 이미지가 필요할 때만 본문 흐름에 맞춰 배치하세요.
7. ★**문장 끝맺음을 다양하게 섞으세요.** "~습니다 / ~예요 / ~죠 / ~더라고요 / ~네요 / ~거든요 / ~답니다"를 번갈아. 같은 어미 2번 연속 금지, "~요"가 절반을 넘지 않게. 굵게(**)는 1~3곳만.
8. 본문 글자 수 공백 포함 **1,300~1,700자**. 분량은 반복 문장이나 억지 해석이 아니라 **기사에서 확인된 배경·경과·맥락**으로 채우세요.
9. 과장·낚시 금지. **제목과 다른 내용 금지.**
10. 기사 문장과 문단 순서를 그대로 따라 쓰지 마세요. 여러 기사에서 사실만 추려 완전히 새로운 문장과 흐름으로 재구성하세요. 직접 인용은 꼭 필요한 짧은 표현만 쓰고 나머지는 풀어 쓰세요.

${frames.renderFrameInstruction(frame, 'celeb')}
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
    {"type": "paragraph", "text": "얼마 전 이런 소식이 전해졌는데요. 기사에서 확인된 핵심부터 자연스럽게 소개해드릴게요."},
    {"type": "paragraph", "text": "뉴스의 핵심 사실과 배경을 독자가 이해하기 쉬운 새 문장으로 차근차근 풀어 씁니다."},
    {"type": "quote", "text": "이 소식의 핵심"},
    {"type": "image", "slot": 2, "caption": "관련 장면", "desc": "뉴스 속 다른 사진"},
    {"type": "paragraph", "text": "기사에 나온 배경과 경과를 연결해 설명하고, 필요하면 마지막에 개인적인 생각을 짧게 덧붙입니다."}
  ]
}
quote/heading 합계 1~3개, 이미지는 기사에 따라 ${MIN_IMAGES}~4개, tags 5~10개. 모두 왼쪽 정렬.`;
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

// 뉴스 글은 소제목과 이미지가 과하게 늘어나지 않도록 최종 구조를 정리한다.
function simplifyNewsStructure(article) {
  let sectionCount = 0;
  let imageCount = 0;
  article.blocks = article.blocks.filter((block) => {
    if (block.type === 'quote' || block.type === 'heading') {
      sectionCount += 1;
      return sectionCount <= 3;
    }
    if (block.type === 'image') {
      imageCount += 1;
      return imageCount <= 4;
    }
    return true;
  });

  // 상단 이미지가 연속으로 2장 이상이면 대표 1장만 남기고 다음 이미지를 본문 뒤로 이동한다.
  const leadingImages = [];
  while (article.blocks[0] && article.blocks[0].type === 'image') {
    leadingImages.push(article.blocks.shift());
  }
  if (leadingImages.length) article.blocks.unshift(leadingImages.shift());
  if (leadingImages.length) {
    let paragraphSeen = 0;
    let insertAt = article.blocks.length;
    for (let i = 1; i < article.blocks.length; i++) {
      if (article.blocks[i].type === 'paragraph') paragraphSeen += 1;
      if (paragraphSeen >= 2) {
        insertAt = i + 1;
        break;
      }
    }
    article.blocks.splice(insertAt, 0, ...leadingImages);
  }
  return article;
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

  let article = await codex.invokeJson(buildPrompt(topic, refText, frame), { timeoutMs: WRITE_TIMEOUT_MS });
  if (!article || !article.title || !Array.isArray(article.blocks)) {
    throw new Error('글 작성 결과 형식이 올바르지 않습니다.');
  }
  article = simplifyNewsStructure(normalize(article));

  // 보강 재작성 판단.
  // 글자 수가 기준에 근접(오차 CHARS_TOLERANCE 이내)하면 재작성하지 않는다 —
  // 재작성은 수 분이 더 걸리는데 결과가 원본과 크게 다르지 않은 경우가 많다.
  // 이미지·인용구 부족이나 프레임 요건 미달은 글의 형태 자체가 어긋난 것이므로 그대로 재작성한다.
  const m = measure(article);
  const frameIssue = frame.check ? frame.check(article) : null;
  const charsTooShort = m.chars < MIN_CHARS - CHARS_TOLERANCE;
  if (charsTooShort || m.images < MIN_IMAGES || frameIssue) {
    console.log(
      `[writer] 기준 미달(글자 ${m.chars}, 이미지 ${m.images}, 인용구 ${m.quotes}${frameIssue ? `, ${frameIssue}` : ''}) → 재작성`
    );
    const note = `\n※ 이전 결과가 기준에 못 미쳤습니다(글자 ${m.chars}자, 이미지 ${m.images}, 구간 표시 ${m.quotes}${frameIssue ? `, ${frameIssue}` : ''}). 반드시: 기사 사실 중심 1,300자 이상, quote/heading 1~3개, 이미지 1~4개(상단 대표 1장).\n`;
    try {
      let retry = await codex.invokeJson(buildPrompt(topic, refText, frame, note), { timeoutMs: WRITE_TIMEOUT_MS });
      if (retry && retry.title && Array.isArray(retry.blocks)) {
        retry = simplifyNewsStructure(normalize(retry));
        const rm = measure(retry);
        const meets = (x) => x.chars >= MIN_CHARS && x.images >= MIN_IMAGES && x.quotes <= 3;
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

const PRODUCT_POST_FORBIDDEN_RE =
  /\d[\d,]*\s*원|가격|판매가|정가|할인|쿠폰|적립|배송비|무료\s*배송|혜택|수수료|공정위|광고|제휴|협찬|경제적\s*이해관계|쇼핑커넥트\s*활동|판매\s*발생\s*시|출처|공식\s*스토어/i;

// 쇼핑커넥트 글에는 가격·광고 고지·출처가 남지 않도록 생성 결과에도 마지막 안전망을 적용한다.
function sanitizeProductArticle(article, product) {
  const cleanLines = (value) =>
    String(value || '')
      .split('\n')
      .map((line) => line.replace(/\s*\(출처\s*[:：][^)]+\)\s*/gi, '').trim())
      .filter((line) => line && !PRODUCT_POST_FORBIDDEN_RE.test(line))
      .join('\n');

  article.blocks = (article.blocks || [])
    .map((block) => {
      const cleaned = { ...block };
      if (typeof cleaned.text === 'string') cleaned.text = cleanLines(cleaned.text);
      if (typeof cleaned.caption === 'string') cleaned.caption = cleanLines(cleaned.caption);
      return cleaned;
    })
    .filter((block) => block.type === 'image' || !('text' in block) || String(block.text).trim());

  if (PRODUCT_POST_FORBIDDEN_RE.test(article.title || '')) {
    article.title = `${deriveProductName(product.name)} 구성과 사용 전 확인할 점`;
  }
  article.titleAlternatives = (article.titleAlternatives || []).filter(
    (title) => !PRODUCT_POST_FORBIDDEN_RE.test(title)
  );
  article.tags = (article.tags || []).filter((tag) => !PRODUCT_POST_FORBIDDEN_RE.test(tag));
  return article;
}

/**
 * 핵심 요약 블록을 보장한다.
 * 대표 이미지와 공감형 도입 뒤에 꼭 필요한 상품 사실만 짧게 보여준다.
 * AI가 스펙 인용구를 빠뜨리거나 제목 형식이 어긋나도 코드에서 교정/삽입한다.
 */
function enforceSpecQuote(article, product) {
  const blocks = article.blocks;
  const isSpec = (b) =>
    b.type === 'quote' && (/상품\s*스펙|핵심만\s*보기/.test(b.text) || /·\s*상품명/.test(b.text));
  const derived = deriveProductName(product.name);
  const idx = blocks.findIndex(isSpec);
  if (idx >= 0) {
    // 이미 스펙 인용구가 있으면 첫 줄 형식만 "{상품명} 상품 스펙" 으로 정규화
    const lines = blocks[idx].text.split('\n');
    let head = String(lines[0] || '').trim();
    head = head
      .replace(/한눈에\s*보는\s*/g, '')
      .replace(/\s*(상품\s*스펙|핵심만\s*보기)\s*$/, '')
      .trim();
    if (!head || /^·/.test(head)) head = derived; // 첫 줄이 항목(·)이면 파생 상품명 사용
    lines[0] = `${head} 핵심만 보기`;
    blocks[idx].text = lines.join('\n');
    // 대표 이미지 뒤 공감형 도입 문단 2개가 나온 다음으로 위치 이동
    const spec = blocks.splice(idx, 1)[0];
    const imgIdx = blocks.findIndex((b) => b.type === 'image');
    let insertAt = imgIdx >= 0 ? imgIdx + 1 : 0;
    let paragraphs = 0;
    for (let i = insertAt; i < blocks.length; i++) {
      if (blocks[i].type === 'paragraph') paragraphs += 1;
      if (paragraphs >= 2) {
        insertAt = i + 1;
        break;
      }
    }
    blocks.splice(insertAt, 0, spec);
  } else {
    // 스펙 인용구가 아예 없으면 상품 정보로 최소 스펙을 만들어 삽입
    const specText = [`${derived} 핵심만 보기`, `· 상품명: ${derived}`].join('\n');
    const imgIdx = blocks.findIndex((b) => b.type === 'image');
    let insertAt = imgIdx >= 0 ? imgIdx + 1 : 0;
    let paragraphs = 0;
    for (let i = insertAt; i < blocks.length; i++) {
      if (blocks[i].type === 'paragraph') paragraphs += 1;
      if (paragraphs >= 2) {
        insertAt = i + 1;
        break;
      }
    }
    blocks.splice(insertAt, 0, { type: 'quote', text: specText });
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
- ZIP·이미지 미리보기·이미지 목록 출력은 시스템이 처리하므로 생략하세요.
- 상품 링크는 시스템이 글 마지막에 자동으로 붙입니다. 마지막 문단에서 "아래 링크에서 확인해보세요"로 자연스럽게 유도만 하세요.
- 가격·할인·쿠폰·적립·배송비·수수료, 공정위·광고·제휴 고지, 출처·공식 스토어·상세페이지 주소는 제목·본문·요약·캡션에 절대 쓰지 마세요.

【생활밀착형 소개 글 스타일 — 반드시 이 형태로 쓸 것】
1. 첫 문단은 상품 설명이 아니라 **이 상품이 필요한 사람의 실제 고민과 생활 장면**으로 시작하세요.
   - "이런 거 필요하신 분들 계시죠?", "정품과 호환품 사이에서 헷갈리는 분들 많으시죠?", "막상 사려니 뭘 봐야 할지 어렵더라고요"처럼 독자가 자기 이야기라고 느끼는 자연스러운 질문을 활용하세요.
   - 직접 사용한 척하거나 효과를 경험한 척하지 마세요. 조사하며 알게 된 선택 기준을 친근하게 소개하는 입장으로 쓰세요.
   - 그렇다고 "직접 사용한 후기가 아니라", "확인된 자료를 토대로"처럼 글쓴이의 작성 방식을 해명하지 마세요. 직접 써봤다는 표현만 피하고, "저도 뭐가 다른지 궁금해서 구성을 하나씩 봤는데요"처럼 바로 이야기하세요.
2. **절대 금지 표현**: "상세페이지에는", "상세페이지에서", "안내됩니다/안내됐습니다", "표시됩니다/표시돼 있습니다", "소개됩니다", "기재되어 있습니다".
   - 상품 정보를 출처 화면의 문구처럼 설명하지 말고, "10장이 한 묶음이라 여유분을 두고 싶은 분에게 맞아요", "A9·A9S 올인원타워를 쓴다면 먼저 모델을 확인해보세요"처럼 **생활 속 의미와 선택 기준**으로 바꾸세요.
   - "선택 이유가 될 수 있어요", "~라고 전했어요", "생활 패턴에 어울려요", "참고하는 자료일 뿐" 같은 분석 보고서 말투도 쓰지 마세요.
   - **리뷰·평점·재구매 수·구매자 반응은 본문에 쓰지 마세요.** "후기 중에는", "구매자는", "자주 묻는 질문", "질문에는", "의견도 있었어요" 같은 리뷰 해설 형식도 금지합니다.
   - 리뷰에서 발견한 주의점이 있더라도 리뷰를 인용하거나 경험담처럼 소개하지 마세요. 확인이 필요한 내용만 "호환품은 정품과 모양이나 장착감이 다를 수 있으니 처음 끼운 뒤 잘 고정됐는지 봐주세요"처럼 **가능성과 확인 방법**으로 짧게 바꾸세요.
   - 본문은 상품의 구성, 수량, 호환 모델, 형태, 선택 옵션, 교체 방법처럼 공식 상품 자료에서 확인되는 특징을 중심으로 풀어주세요.
3. 블록 순서: ① image slot 1(대표) → ② 공감형 도입 paragraph 2~3개 → ③ **quote 블록 하나에 핵심 요약**.
   - 요약 첫 줄은 반드시 "{상품명} 핵심만 보기"로 쓰고, 구성·호환 조건·용도 등 확인된 정보 3~4개만 짧게 넣으세요. 딱딱한 사양표처럼 모든 정보를 나열하지 마세요.
   - 공정위 문구, 광고·제휴·경제적 이해관계 표시 문구와 출처 표기는 쓰지 마세요.
4. **소제목(heading) 블록을 쓰지 마세요.** 구간 전환은 **quote 블록(8~20자 짧은 구절)**로 합니다.
   예: "섬유항균제는 세탁세제와 역할이 달라요", "공간에 따라 다르게 쓸 수 있는 2in1 구조"
   핵심 요약을 포함해 quote는 전체 3~4개만 사용하세요.
5. 문단은 **1~3문장**으로 자연스럽게 이어 쓰세요. 짧은 문장을 기계적으로 잘라 나열하지 말고, 전체 paragraph 블록은 10~15개 정도면 충분합니다.
6. 상품 특징을 말할 때마다 "그래서 어떤 사람에게 편한지", "어떤 생활 상황에서 선택 이유가 되는지"를 함께 설명하세요.
7. 이미지는 대표 1장 + 구간 사이사이 배치.
8. 제목: 이번 글의 구성 프레임 성격에 맞게 짓되 상품명이 들어가게 하세요. 매번 같은 "~라면, 상품명" 틀을 반복하지 말고 프레임에 맞춰 변형하세요.
   (문제 해결형 예: "실내건조 빨래 냄새가 고민이라면, 랩신 섬유항균제 사용법과 구성" / 비교·선택형 예: "○○ 사이즈 어떤 걸 골라야 할까, 모델별 차이 정리" / 체크리스트형 예: "○○ 구매 전 확인할 5가지")
9. 말투는 **친한 사람에게 알아본 내용을 설명해 주는 대화체**로 쓰세요.
   - "~다고 해요 / ~더라고요 / ~하면 좋겠습니다 / ~봐주세요 / ~거든요 / ~죠"를 문맥에 맞게 섞으세요.
   - 같은 어미를 연달아 반복하지 말고, 지나치게 조심스러운 "~할 수 있어요 / ~될 수 있어요"도 반복하지 마세요.
   - 상품을 평가하는 해설자 말투보다 "저도 처음엔 헷갈렸는데 하나씩 보니 어렵지 않았어요", "이 부분만 먼저 봐주세요"처럼 사람이 옆에서 알려주는 느낌을 내세요.
   - "정리하면 세 가지만 기억하세요"처럼 글 전체를 보고서식으로 요약하며 끝내지 마세요. 마지막에는 이 상품이 필요한 사람을 한 번 더 떠올려주고 자연스럽게 링크로 이어주세요.
   - 굵게(**)는 꼭 필요한 1~3곳만 사용하세요.
10. 본문 **1,300~1,600자 (반드시 1,200자 이상)**. 반복 설명 대신 생활 장면, 선택 기준, 사용 대상의 마음을 충분히 풀어주세요. 모든 글 왼쪽 정렬.

${frames.renderFrameInstruction(frame, 'product')}
※ 위 구성 프레임은 이번 글에만 적용됩니다. 도입 문구·구간 구절·마무리 표현을 상투적인 틀 대신 이 프레임 흐름에 맞게 새로 지으세요.
※ 상세페이지에서 확인되지 않는 성능·효과·수치는 단정하지 마세요.

【상품 정보 (상세페이지에서 수집)】
상품명: ${product.name}
카테고리: ${product.query || ''}

확인된 상품 자료(사실 확인용이며, 본문에서 '상세페이지'라고 부르지 마세요):
${String(detail.description || '').slice(0, 2200)}
※ 위 자료에 리뷰·평점·구매자 질문이나 반응이 섞여 있어도 본문에는 사용하지 마세요. 공식적으로 확인되는 상품 구성과 특징만 골라 쓰세요.

【출력 형식 — 이 JSON으로만】
{
  "title": "독자 문제 + 해결 실마리, 상품명 흐름의 제목",
  "titleAlternatives": ["제목 대안1", "제목 대안2", "제목 대안3"],
  "tags": ["해시태그1", "해시태그2"],
  "blocks": [
    {"type":"image","slot":1,"caption":"자연스러운 사진 설명","desc":"대표"},
    {"type":"paragraph","text":"정품과 호환품 사이에서 헷갈리는 분들 많으시죠? 내 생활 속 고민을 먼저 꺼내는 도입입니다."},
    {"type":"paragraph","text":"왜 이 상품을 찾아보게 되는지 공감하며 선택 기준을 자연스럽게 예고합니다."},
    {"type":"quote","text":"○○○ 핵심만 보기\\n· 구성: ...\\n· 호환 조건: ...\\n· 이런 분께: ..."},
    {"type":"quote","text":"구간을 여는 짧은 구절"},
    {"type":"paragraph","text":"본문 1~2문장.\\n다음 줄."},
    {"type":"image","slot":2,"caption":"사진 설명","desc":"핵심 특징"},
    {"type":"paragraph","text":"..."},
    {"type":"quote","text":"구매 전 체크"},
    {"type":"paragraph","text":"· 체크1\\n· 체크2\\n· 체크3"},
    {"type":"paragraph","text":"마무리와 링크 유도 문단"}
  ]
}
tags는 5~10개. 본문(제목 제외) 1,200자 이상.
${retryNote || ''}`;
}

/**
 * 쇼핑커넥트 상품 소개 글 작성 — skills/02-naver-shopping-connect-blog 스킬 지침 구동.
 * @param {object} product {name, price, commission, reviews, rating, query}
 * @param {object} detail {description, images}
 * @returns {object} {title, titleAlternatives, tags, blocks}
 */
async function writeProductArticle(product, detail) {
  const imgCount = Math.min(Math.max((detail.images || []).length, 2), 5);

  // 이번 글의 구성 프레임 선택 — 상세페이지 내용으로 적합성을 판정한다
  const detailText = `${product.name || ''}\n${String(detail.description || '')}`;
  const frame = frames.pickFrame('product', { detailText });

  const run = async (note) => {
    const raw = await codex.invokeJson(buildProductPrompt(product, detail, frame, imgCount, note), {
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    if (!raw || !raw.title || !Array.isArray(raw.blocks)) {
      throw new Error('상품 글 작성 결과 형식이 올바르지 않습니다.');
    }
    const alts = (Array.isArray(raw.titleAlternatives) ? raw.titleAlternatives : []).map(String).slice(0, 3);
    const normalized = enforceSpecQuote(normalize(raw), product);
    normalized.titleAlternatives = alts;
    return sanitizeProductArticle(normalized, product); // 스펙 인용구 형식/위치 보장 + 가격·고지·출처 제거
  };

  let article = await run();

  // 분량·프레임 요건 미달 시 1회 보강 재작성 (연예인 글과 동일한 품질 기준 적용)
  const m = measure(article);
  const frameIssue = frame.check ? frame.check(article) : null;
  const text = article.blocks.map((block) => block.text || '').join(' ');
  const paragraphText = article.blocks
    .filter((block) => block.type === 'paragraph')
    .map((block) => block.text || '')
    .join(' ');
  const stiffLanguage = /상세\s*페이지|안내(?:됩니다|됐|되어)|표시(?:됩니다|됐|돼|되어)|소개(?:됩니다|됐|되어)|기재(?:됩니다|됐|돼|되어)/.test(text);
  const aiReportLanguage = /직접\s*사용한\s*후기가\s*아니라|확인된\s*(?:구성|자료).{0,20}토대로|선택\s*이유가\s*될\s*수\s*있어요|(?:라고\s*)?전했어요|작성\s*시점인?\s*\d{4}년|생활\s*패턴에\s*어울려요|참고하는\s*자료일\s*뿐/.test(paragraphText);
  const reviewSummaryLanguage = /후기(?:를|가|는|도|에서|중에는?)|리뷰|구매자(?:가|는|의|들)|자주\s*묻는\s*질문|질문에는|의견도\s*(?:있|보)|정리하면.{0,30}(?:세|몇)\s*(?:가지|순서)/.test(paragraphText);
  const introText = article.blocks
    .filter((block) => block.type === 'paragraph')
    .slice(0, 3)
    .map((block) => block.text)
    .join(' ');
  const empatheticIntro = /필요|계시죠|많으시죠|헷갈|고민|어렵|번거|귀찮|부담|당황|저만/.test(introText);
  const styleIssue = stiffLanguage
    ? '상세페이지 해설체 표현 포함'
    : aiReportLanguage
      ? 'AI 보고서처럼 들리는 표현 포함'
    : reviewSummaryLanguage
      ? '리뷰·질문답변 해설 형식 포함'
    : !empatheticIntro
      ? '독자 고민에 공감하는 도입 부족'
      : null;
  if (m.chars < MIN_PRODUCT_CHARS - CHARS_TOLERANCE || frameIssue || styleIssue) {
    console.log(`[writer] 상품 글 기준 미달(글자 ${m.chars}${frameIssue ? `, ${frameIssue}` : ''}${styleIssue ? `, ${styleIssue}` : ''}) → 재작성`);
    const note = `\n※ 이전 결과가 기준에 못 미쳤습니다(본문 ${m.chars}자${frameIssue ? `, ${frameIssue}` : ''}${styleIssue ? `, ${styleIssue}` : ''}). 독자의 생활 고민에 공감하는 질문으로 시작하세요. "상세페이지/안내됩니다/표시됩니다/소개됩니다", "직접 사용한 후기가 아니라", "확인된 자료를 토대로", "선택 이유가 될 수 있어요", "~라고 전했어요", "생활 패턴에 어울려요" 같은 해설·보고서 표현은 쓰지 마세요. 리뷰·평점·구매자 반응·자주 묻는 질문은 모두 제외하고, 상품의 구성·수량·호환 모델·형태·옵션·교체 방법을 친한 사람에게 알려주듯 자연스럽게 풀어 본문 ${MIN_PRODUCT_CHARS}자 이상 작성하세요. 가격·혜택·공정위 문구·광고 고지·출처 표기는 어떤 블록에도 넣지 마세요.\n`;
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

module.exports = { writeArticle, writeProductArticle, measure, sanitizeProductArticle };
