// 참고자료 → Codex로 자연스러운 블로그 글 재작성 (구조화 블록 출력)
const codex = require('./codex');
const skills = require('./skills');
const frames = require('./frames');

const BLOCK_TYPES = new Set(['heading', 'paragraph', 'quote', 'divider', 'image']);

// AI 글쓰기 제한 시간. 이 프롬프트(스킬 지침+참고자료+구조화 JSON 출력)는 실측 4~7분이
// 걸려서 5분 제한으로는 절반 가까이 실패했다. 여유를 둬 타임아웃 실패를 없앤다.
const WRITE_TIMEOUT_MS = 600000; // 10분

const MIN_CHARS = 1500;         // 건강 전문 글의 권장 분량 하한
const MIN_IMAGES = 4;           // 문제 상황·식재료·실천 장면을 포함한 이미지 슬롯
const MAX_IMAGES = 6;           // 글 흐름상 필요한 경우 이미지 자리를 더 만들 수 있다.

function buildPrompt(topic, refText, frame, retryNote) {
  const skill = skills.loadSkill('03-health-affiliate-blog');
  return `아래 건강 전문 스킬을 핵심 지침으로 삼아 사실 기반 생활 건강 정보 글을 작성하세요.

═══════════ 건강 전문 스킬 시작 ═══════════
${skill}
═══════════ 건강 전문 스킬 끝 ═══════════

【이 자동화 환경에 맞춘 조정 — 최우선】
- 글감 선택은 이미 끝났습니다. 후보 제안 없이 곧바로 선택 주제 글쓰기를 실행하세요.
- 이 뉴스 글 모드에는 제휴 상품 링크가 없으므로 쇼핑커넥트 고지와 상품 링크는 넣지 마세요. 다만 마지막에는 독자가 자신의 반복 습관을 점검하고, 필요한 식재료·도구·건강식품을 기준에 맞춰 직접 고를 마음이 들도록 생활형 CTA를 쓰세요. "무조건 사야 한다"처럼 밀어붙이거나 치료 효과를 약속하지는 마세요.
- 이미지는 생성하지 않고 image 블록 위치와 장면 설명만 임시글에 표시합니다. 이미지 다운로드·생성 과정·ZIP·목록·표는 글에 쓰지 마세요.
- 출처 링크는 시스템이 글 끝에 자동으로 정리합니다. 본문에 출처 목록을 넣지 마세요.
- image desc/caption은 기사 속 건강 주제, 식재료, 생활 실천 장면과 직접 관련되게 쓰세요.

【글 작성 방식 — 생활 건강 정보】
1. 첫 3문단 안에 독자가 겪는 구체적인 건강 생활 문제 하나를 보여주세요.
2. 참고자료의 핵심은 2~4문단으로 새롭게 풀고 발표 기관과 날짜를 본문에 명시하세요.
3. 연구 결과를 모든 사람에게 적용되는 사실처럼 단정하지 말고, 질병 치료·예방 효과를 약속하지 마세요.
4. 비용 없이 먼저 할 수 있는 실천 방법과 식재료·건강식품을 고를 때 확인할 기준을 함께 안내하세요.
5. 잘 맞을 수 있는 사람과 알레르기·식사 제한 등 주의가 필요한 사람을 균형 있게 설명하세요.
6. 친근한 존댓말, 문단당 1~3문장, 공백 포함 ${MIN_CHARS}~2,200자 안팎으로 충분히 쓰세요.
7. 소제목(heading)은 5~7개, quote는 최대 1개, 굵은 핵심 구절은 2~4곳만 사용하세요.
8. 나중에 이미지를 넣을 image 블록은 4~6개 사용하고 대표 이미지, 문제 상황, 식재료·건강식품, 실천 장면의 역할이 겹치지 않게 하세요. desc는 그대로 이미지 생성 프롬프트로 쓸 수 있을 만큼 구체적으로 작성하세요.
9. 해시태그는 건강 키워드·생활 문제·식재료를 섞어 정확히 6개 작성하세요.
10. "충격", "정체", "결국", "소름", "전부 공개"와 공포·과장 표현을 쓰지 마세요.
11. 마지막 일반 문단은 요약으로 끝내지 말고, **반복되는 생활 문제 → 오늘 바로 해볼 점검 또는 준비 → 나에게 필요한 선택** 순서의 2~3문장 CTA로 마무리하세요. 예: 포장지의 1회 제공량 확인, 식사 기록 시작, 필요한 식재료를 미리 준비하기처럼 구체적인 행동을 제안하세요.

【글감】
제목: ${topic.title}
관점: ${topic.angle || '최신 건강정보를 생활 실천으로 연결'}
키워드: ${(topic.keywords || []).join(', ')}

【참고자료(뉴스·공식정보)】
${refText}
${retryNote || ''}
다음 JSON 형식으로만 출력:
{
  "title": "독자의 생활 문제와 실천 방향이 함께 보이는 건강정보형 제목",
  "tags": ["건강태그1", "건강태그2", "생활태그1", "생활태그2", "식재료태그1", "식재료태그2"],
  "blocks": [
    {"type": "image", "slot": 1, "caption": "건강 주제 대표 이미지", "desc": "기사의 핵심 건강 주제를 보여주는 대표 장면"},
    {"type": "paragraph", "text": "독자가 일상에서 겪는 구체적인 문제를 자연스럽게 보여줍니다."},
    {"type": "heading", "text": "문제가 반복되는 현실적인 이유"},
    {"type": "paragraph", "text": "공식 자료와 기사 핵심을 쉬운 말로 설명하고 **과장 없는 핵심 정보**를 강조합니다."},
    {"type": "image", "slot": 2, "caption": "생활 속 문제 상황", "desc": "독자의 현실적인 건강 생활 문제"},
    {"type": "heading", "text": "공식 자료에서 확인된 핵심"},
    {"type": "quote", "text": "오늘 바꿀 수 있는 한 가지"},
    {"type": "image", "slot": 3, "caption": "식재료 또는 건강식품", "desc": "글에서 설명한 식재료나 건강식품"},
    {"type": "heading", "text": "비용 없이 먼저 해볼 일"},
    {"type": "paragraph", "text": "비용 없이 먼저 실천할 방법을 구체적으로 안내합니다."},
    {"type": "heading", "text": "식재료와 건강식품을 고르는 기준"},
    {"type": "paragraph", "text": "광고가 아니라 성분과 표시사항을 확인하는 기준을 안내합니다."},
    {"type": "image", "slot": 4, "caption": "건강한 활용 장면", "desc": "실생활에서 적용하는 구체적인 장면"},
    {"type": "heading", "text": "특히 주의해서 볼 사람"},
    {"type": "paragraph", "text": "알레르기, 복용 약, 식사 제한 등 주의가 필요한 사람과 한계를 설명합니다."},
    {"type": "paragraph", "text": "오늘 바로 점검할 한 가지와 생활에 맞게 준비하거나 고를 기준을 연결하는 2~3문장 CTA로 마무리합니다."}
  ]
}
각 paragraph에는 하나의 중심 내용만 담고 내용이 바뀌면 새 paragraph로 나누세요. 위 예시는 image 4개이지만 글 흐름상 서로 다른 장면이 더 필요하면 slot 5와 slot 6까지 추가할 수 있습니다. 첫 image는 blocks 배열 맨 앞에 두고 나머지는 관련 단락 사이에 놓으세요. tags는 정확히 6개이며 모두 왼쪽 정렬입니다.`;
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
    .slice(0, 6);
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

// 건강 글은 소제목 5~7개, 이미지 4~6개, 인용구 최대 1개로 최종 구조를 정리한다.
function simplifyNewsStructure(article) {
  let headingCount = 0;
  let quoteCount = 0;
  let imageCount = 0;
  article.blocks = article.blocks.filter((block) => {
    if (block.type === 'heading') {
      headingCount += 1;
      return headingCount <= 7;
    }
    if (block.type === 'quote') {
      quoteCount += 1;
      return quoteCount <= 1;
    }
    if (block.type === 'image') {
      imageCount += 1;
      return imageCount <= MAX_IMAGES;
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

// 연예 뉴스 글의 내용은 그대로 두고 화면에서만 짧은 줄로 보이게 한다.
// 단어 중간을 자르지 않으며, 굵게(**) 구간 안에서는 줄을 나누지 않는다.
function wrapNewsLine(value, targetLength = 36) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = [];

  for (const word of words) {
    const currentText = current.join(' ');
    const candidate = current.length ? `${currentText} ${word}` : word;
    const visibleLength = candidate.replace(/\*\*/g, '').length;
    const insideBold = ((currentText.match(/\*\*/g) || []).length % 2) === 1;

    if (current.length && visibleLength > targetLength && !insideBold) {
      lines.push(currentText);
      current = [word];
    } else {
      current.push(word);
    }
  }

  if (current.length) lines.push(current.join(' '));
  return lines;
}

function formatNewsParagraphs(article) {
  article.blocks = (article.blocks || []).map((block) => {
    if (block.type !== 'paragraph' || block.disclosure) return block;
    const lines = String(block.text || '')
      .split(/\n+/)
      .flatMap((line) => wrapNewsLine(line))
      .map((line) => line.trim())
      .filter(Boolean);
    return { ...block, text: lines.join('\n') };
  });

  // 어떤 생성 결과에서도 최소 대표 이미지 자리는 유지한다.
  if (!article.blocks.some((block) => block.type === 'image')) {
    article.blocks.unshift({
      type: 'image',
      slot: 1,
      caption: '기사의 대표 장면',
      desc: `${article.title || '이 소식'}의 핵심 인물·현장·장면`,
    });
  }

  // 첫 번째 이미지 슬롯은 항상 본문보다 앞에 둬 대표 이미지로 사용한다.
  const firstImageIndex = article.blocks.findIndex((block) => block.type === 'image');
  if (firstImageIndex > 0) {
    const [coverImage] = article.blocks.splice(firstImageIndex, 1);
    article.blocks.unshift(coverImage);
  }

  // 생성 결과가 이미지 1장뿐이어도 기본 두 번째 사진을 검토할 수 있도록
  // 본문 중간에 관련 사진 슬롯을 하나 마련한다. 실제 관련 후보가 없으면 판정 단계에서 비운다.
  if (article.blocks.filter((block) => block.type === 'image').length === 1) {
    let paragraphSeen = 0;
    let insertAt = article.blocks.length;
    for (let i = 1; i < article.blocks.length; i++) {
      if (article.blocks[i].type === 'paragraph') paragraphSeen += 1;
      if (paragraphSeen >= 2) {
        insertAt = i + 1;
        break;
      }
    }
    article.blocks.splice(insertAt, 0, {
      type: 'image',
      slot: 2,
      caption: '기사 내용과 관련된 장면',
      desc: `${article.title || '이 소식'}의 핵심 내용과 직접 관련된 다른 인물·현장·장면`,
    });
  }
  return article;
}

function wrapProductLine(value, targetLength = 34) {
  const lines = wrapNewsLine(value, targetLength);
  const dependentStart = /^(?:뒤(?:까지)?|때(?:문에)?|경우|만큼|정도|후|전|중|위해|통해|따라|덕분에|사이|안에서)(?:\s|$|[,.?!])/;

  for (let index = 1; index < lines.length; index += 1) {
    if (!dependentStart.test(lines[index])) continue;
    const previousWords = lines[index - 1].split(/\s+/).filter(Boolean);
    if (previousWords.length < 2) continue;
    const moved = previousWords.pop();
    // 굵은 구절 경계를 옮기면 마크다운 범위가 깨질 수 있으므로 그대로 둔다.
    if (((moved.match(/\*\*/g) || []).length % 2) === 1) continue;
    lines[index - 1] = previousWords.join(' ');
    lines[index] = `${moved} ${lines[index]}`;
  }
  return lines.filter(Boolean);
}

// 쇼핑 글도 내용은 줄이지 않고 모바일에서 읽기 좋은 의미 단위로 줄을 나눈다.
// 공백에서만 자르며 **굵게** 구간 중간에는 줄바꿈을 만들지 않는다.
function formatProductParagraphs(article) {
  article.blocks = (article.blocks || []).map((block) => {
    if (block.type !== 'paragraph' || block.disclosure) return block;
    const lines = String(block.text || '')
      .split(/\n+/)
      .flatMap((line) => wrapProductLine(line, 34))
      .map((line) => line.trim())
      .filter(Boolean);
    return { ...block, text: lines.join('\n') };
  });
  return article;
}

const NEWS_TITLE_FORBIDDEN_RE = /충격|정체|결국|소름|전부\s*공개/;
const NEWS_PREDICTION_RE =
  /시청률.{0,12}(?:오르|나오|기록|예상)|흥행.{0,12}(?:하|성공|예상)|관계.{0,12}(?:변하|달라질|발전)|향후\s*전개|앞으로.{0,16}(?:전개|관계)|될\s*것으로\s*보|기대해도\s*좋/;
const NEWS_CTA_ACTION_RE = /확인|점검|기록|준비|골라|고르|덜어|바꿔|바꾸|챙겨|시작|비교|살펴/;

// 생성 결과를 코드에서도 한 번 더 점검한다. 의미 판단은 프롬프트에 맡기되,
// 글자 수·금지어·소제목·이미지·근거 없는 전망처럼 명확한 위반은 재작성을 요청한다.
function inspectNewsArticle(article) {
  const m = measure(article);
  const text = (article.blocks || []).map((block) => block.text || '').join(' ');
  const issues = [];
  const boldCount = (text.match(/\*\*(.+?)\*\*/g) || []).length;

  if (m.chars < MIN_CHARS) issues.push(`본문 ${m.chars}자(최소 ${MIN_CHARS}자)`);
  if (m.images < MIN_IMAGES || m.images > MAX_IMAGES) issues.push(`이미지 슬롯 ${m.images}개(허용 ${MIN_IMAGES}~${MAX_IMAGES}개)`);
  if (m.headings < 5 || m.headings > 7) issues.push(`소제목 ${m.headings}개(허용 5~7개)`);
  if (m.quotes > 1) issues.push(`인용구 ${m.quotes}개(최대 1개)`);
  if (boldCount < 2 || boldCount > 4) issues.push(`굵은 핵심 구절 ${boldCount}개(허용 2~4개)`);
  if (!Array.isArray(article.tags) || article.tags.length !== 6) issues.push(`해시태그 ${(article.tags || []).length}개(정확히 6개 필요)`);
  // 소제목 바로 아래 핵심 인용구는 정상적인 건강 글 구성이다.
  // 내용 없이 소제목만 두 번 연속 나오는 경우에만 재작성을 요청한다.
  if ((article.blocks || []).some((block, index, blocks) =>
    index > 0 &&
    block.type === 'heading' &&
    blocks[index - 1].type === 'heading'
  )) issues.push('소제목이 본문 없이 연속으로 배치됨');
  if (NEWS_TITLE_FORBIDDEN_RE.test(article.title || '')) issues.push('제목 금지 표현 포함');
  if (NEWS_TITLE_FORBIDDEN_RE.test(text)) issues.push('본문 금지 표현 포함');
  if (NEWS_PREDICTION_RE.test(text)) issues.push('흥행·관계·향후 전개 예측 표현 포함');
  if (!(article.blocks || []).some((block) => block.type === 'paragraph')) issues.push('본문 문단 없음');
  const paragraphs = (article.blocks || []).filter((block) => block.type === 'paragraph');
  const lastParagraph = paragraphs.at(-1)?.text || '';
  if (!NEWS_CTA_ACTION_RE.test(lastParagraph)) issues.push('마지막 생활형 CTA에 구체적인 행동 제안 없음');

  return issues;
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

  // 기존 UI의 프레임 메타데이터 자리는 유지하되 건강정보형으로 고정한다.
  const frame = { key: 'health-information', label: '생활 건강정보형', check: null };

  let article = await codex.invokeJson(buildPrompt(topic, refText, frame), { timeoutMs: WRITE_TIMEOUT_MS });
  if (!article || !article.title || !Array.isArray(article.blocks)) {
    throw new Error('글 작성 결과 형식이 올바르지 않습니다.');
  }
  article = formatNewsParagraphs(simplifyNewsStructure(normalize(article)));

  const m = measure(article);
  const frameIssue = frame.check ? frame.check(article) : null;
  const qaIssues = inspectNewsArticle(article);
  if (frameIssue) qaIssues.push(frameIssue);
  if (qaIssues.length) {
    console.log(
      `[writer] 뉴스 글 QA 미달(${qaIssues.join(', ')}) → 재작성`
    );
    const note = `\n※ QA 검수에서 다음 문제가 발견됐습니다: ${qaIssues.join(', ')}.
생활 건강 문제 하나에 집중하고 기사 문장을 복사하지 마세요. 본문은 ${MIN_CHARS}~2,200자 안팎으로 쓰고, 발표 기관과 날짜, 비용 없이 실천할 방법, 선택 기준, 주의가 필요한 사람을 포함하세요. 질병 치료·예방을 단정하지 마세요. 소제목 5~7개, quote 최대 1개, 굵은 핵심 구절 2~4곳, 이미지 슬롯 4~6개, 해시태그 6개를 지키세요. 소제목끼리는 본문 없이 연속 배치하지 마세요. 소제목 바로 아래 핵심 quote를 두는 것은 허용합니다. 첫 이미지는 본문 맨 위, 나머지는 관련 단락 사이에 배치하고 과장·공포 표현을 쓰지 마세요. 마지막 일반 문단은 반복 습관을 짚은 뒤 오늘 점검·준비·선택할 한 가지를 제안하는 자연스러운 CTA로 끝내세요.\n`;
    try {
      let retry = await codex.invokeJson(buildPrompt(topic, refText, frame, note), { timeoutMs: WRITE_TIMEOUT_MS });
      if (retry && retry.title && Array.isArray(retry.blocks)) {
        retry = formatNewsParagraphs(simplifyNewsStructure(normalize(retry)));
        const rm = measure(retry);
        const retryIssues = inspectNewsArticle(retry);
        const retryFrameIssue = frame.check ? frame.check(retry) : null;
        if (retryFrameIssue) retryIssues.push(retryFrameIssue);
        if (!retryIssues.length || (retryIssues.length < qaIssues.length && rm.chars >= m.chars)) {
          article = retry;
          console.log(`[writer] 뉴스 글 재작성 채택(글자 ${rm.chars}, 남은 QA ${retryIssues.length}건)`);
        }
      }
    } catch (e) {
      console.log(`[writer] 재작성 실패(원본 사용): ${e.message}`);
    }
  }

  const finalIssues = inspectNewsArticle(article);
  if (finalIssues.length) {
    throw new Error(`건강 원고 최종 검수 미달: ${finalIssues.join(', ')}`);
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

const SHOPPING_CONNECT_DISCLOSURE =
  '이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.';
const PRODUCT_POST_FORBIDDEN_RE = /출처|공식\s*스토어/i;
const PRODUCT_PRICE_BENEFIT_RE =
  /판매가|할인가|정가|가격|배송비|무료\s*배송|쿠폰|적립(?:금)?|할인율|할인\s*(?:금액|혜택)|사은품/i;

// 쇼핑커넥트 글에는 출처와 변동 가격·혜택 정보가 남지 않도록 마지막 안전망을 적용한다.
function sanitizeProductArticle(article, product) {
  const cleanLines = (value) =>
    String(value || '')
      .split('\n')
      .map((line) => line.replace(/\s*\(출처\s*[:：][^)]+\)\s*/gi, '').trim())
      .filter(
        (line) =>
          line &&
          line === SHOPPING_CONNECT_DISCLOSURE ||
          (line && !PRODUCT_POST_FORBIDDEN_RE.test(line) && !PRODUCT_PRICE_BENEFIT_RE.test(line))
      )
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

function enforceShoppingConnectDisclosure(article) {
  article.blocks = (article.blocks || []).filter(
    (block) =>
      !(
        block.type === 'paragraph' &&
        (/쇼핑\s*커넥트\s*활동|판매\s*발생\s*시\s*수수료/.test(block.text || '') || block.disclosure)
      )
  );
  article.blocks.unshift({
    type: 'paragraph',
    text: SHOPPING_CONNECT_DISCLOSURE,
    disclosure: true,
  });
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
    lines[0] = `${head} 한눈에 보는 상품 스펙`;
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
    const specText = [`${derived} 한눈에 보는 상품 스펙`, `· 상품명: ${derived}`].join('\n');
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

// 구매 이유는 글의 방향과 본문 설득에만 사용한다.
// 상단 상품 스펙에는 제품 정보만 남기고 긴 `구매 이유` 문장을 넣지 않는다.
function preservePurchaseReasonContext(article, purchaseReason) {
  const reason = String(purchaseReason || '').replace(/\s+/g, ' ').trim();
  const spec = article.blocks.find(
    (block) => block.type === 'quote' && /(핵심만\s*보기|상품\s*스펙)/.test(block.text || '')
  );
  if (spec) {
    spec.text = String(spec.text || '')
      .split('\n')
      .filter((line) => !/^·\s*구매\s*이유\s*[:：]/.test(line.trim()))
      .join('\n');
  }
  if (reason) article.purchaseReason = reason;
  return article;
}

function ensureProductImageSlots(article, minImages) {
  const target = Math.max(1, Math.min(Number(minImages) || 1, 5));
  const roles = ['대표', '핵심 특징', '구성과 디테일', '실제 사용 장면', '관리와 보관'];
  while (article.blocks.filter((block) => block.type === 'image').length < target) {
    const count = article.blocks.filter((block) => block.type === 'image').length;
    const lastParagraph = article.blocks.map((block) => block.type).lastIndexOf('paragraph');
    const insertAt = lastParagraph > 0 ? lastParagraph : article.blocks.length;
    article.blocks.splice(insertAt, 0, {
      type: 'image',
      slot: count + 1,
      caption: roles[count] || '상품 관련 이미지',
      desc: roles[count] || '상품 관련 이미지',
    });
  }
  let slot = 0;
  for (const block of article.blocks) {
    if (block.type === 'image') block.slot = ++slot;
  }
  return article;
}

function automaticProductAuditPrompt(article, product, detail, healthContext = null) {
  const healthAudit = healthContext
    ? `\n건강 제휴 글 추가 검수:\n- 기사·공식자료의 발표 기관과 날짜가 본문에 명확히 있는가?\n- 기사 요약이 2~4문단 이내이며 생활 문제 해결로 확장되는가?\n- 상품 전에 비용 없이 실천할 방법 3~5개가 있는가?\n- 활용 장면이 3~6개이며 실제로 따라 하기 쉬운가?\n- 소제목이 5~7개이고 각 소제목에 새로운 정보가 있는가?\n- 해시태그가 정확히 6개인가?\n- 치료·예방·효과를 단정하지 않고 알레르기·식사 제한·한계를 안내하는가?\n위 항목 중 하나라도 빠지면 passed=false로 평가하세요.\n`
    : '';
  return `당신은 쇼핑커넥트 블로그의 최종 품질 검수자입니다.
아래 초안을 호의적으로 추측하지 말고 실제 구매 설득력과 사실성만으로 엄격하게 평가하세요.
${healthAudit}

상품명: ${product.name || ''}
확인된 상품 자료:
${String(detail.description || '').slice(0, 6000)}

초안 JSON:
${JSON.stringify(article)}

검수 질문(하나라도 부족하면 passed=false):
1. 경제적 이해관계 문구가 본문 최상단에 정확히 한 번 있는가?
2. 첫 3개 일반 문단 안에 독자의 문제가 구체적으로 제시됐는가?
3. 중심 문제가 하나로 좁혀졌는가?
4. 주력 상품이 하나로 정해졌는가?
5. 상품을 구매해야 하는 현실적인 이유가 한 문장으로 설명되는가?
6. 상품이 없을 때 생기는 불편이 보이는가?
7. 구매 후 언제, 어디서, 어떻게 사용하는지 떠오르는가?
8. 생활 속 편의성과 활용성이 강조됐는가?
9. 같은 장점이 3회 이상 반복되지 않았는가?
10. 각 인용구와 구간 전환마다 새로운 정보가 있는가?
11. 상단 상품 스펙에 가격·배송·쿠폰·적립·기본 수량·수량별 옵션이 빠져 있는가?
12. 기존 방법의 불편과 이 상품만의 차이가 생활 언어로 구분되는가?
13. 잘 맞는 사람과 다른 방식이 더 맞을 수 있는 사람이 함께 제시됐는가?
14. CTA가 독자의 반복 불편, 다른 선택, 상품 페이지에서 확인할 구체적인 항목을 연결하는가?
15. 직접 사용한 것처럼 꾸민 문장과 치료·개선·예방 단정이 없는가?
16. 기사와 상품의 연결이 자연스럽고 기사 요약만으로 끝나지 않는가?
17. 소제목 5~7개, 해시태그 정확히 6개, 공정위 문구와 마지막 형식이 모두 지켜졌는가?
18. 관련 이미지 역할이 4개 이상이며 ZIP 준비를 위한 이미지 블록이 빠짐없이 있는가?

100점 배점:
- 제목의 클릭 유도력 10
- 독자 문제의 구체성 15
- 상품과 생활 문제 연결의 자연스러움 10
- 상품 구매 이유의 명확성 20
- 실제 활용 장면 10
- 대상 독자의 구체성 10
- 정보 신뢰성과 과장 방지 10
- 반복과 늘어지는 문장 제거 5
- CTA의 자연스러움 5
- 고지·해시태그·마지막 형식 5

최종 질문: 상품 링크를 지워도 독자가 이 상품을 직접 검색해서 사고 싶을 만큼 구매 이유가 충분히 설득됐는가?

JSON 형식:
{
  "score": 0,
  "passed": false,
  "checks": [{"id":1,"passed":false,"reason":"구체적인 근거"}],
  "scoreBreakdown": {"title":0,"problem":0,"connection":0,"purchaseReason":0,"usage":0,"audience":0,"trust":0,"repetition":0,"cta":0,"format":0},
  "finalQuestionPassed": false,
  "weaknesses": ["수정할 점"],
  "revisionInstructions": ["구체적인 수정 지시"]
}`;
}

function automaticProductRevisionPrompt(article, audit, product, detail, imgCount, healthContext = null) {
  const healthRevision = healthContext
    ? `\n- 건강 기사·공식자료의 발표 기관과 날짜를 밝히고 기사 요약은 2~4문단 이내로 제한하세요.\n- 상품 소개 전에 비용 없이 실천할 방법 3~5개를 제시하세요.\n- 쉬운 활용 장면 3~6개, 잘 맞는 사람과 주의할 사람, 정확한 선택 기준을 포함하세요.\n- 소제목 5~7개, 본문 1,200자 이상, 해시태그 정확히 6개를 지키세요.\n- 질병 치료·예방·효과를 단정하지 마세요.\n`
    : '';
  return `쇼핑커넥트 상품 글 초안이 자체 검수에서 통과하지 못했습니다. 검수 지시를 모두 반영해 완성본 전체를 다시 작성하세요.

상품명: ${product.name || ''}
확인된 상품 자료(여기에 없는 효능·성능·수치를 만들지 말 것):
${String(detail.description || '').slice(0, 6000)}

기존 초안:
${JSON.stringify(article)}

검수 결과:
${JSON.stringify(audit)}

필수 수정 기준:
- 첫 3문단 안에서 한 명확한 독자 문제를 구체적인 생활 장면으로 보여주세요.
- 제품이 없을 때의 불편과 제품을 산 뒤 언제·어디서·어떻게 쓰는지 대비되게 쓰세요.
- 확인된 특징마다 "그래서 왜 살 만한가"를 실제 편의와 연결하되 같은 장점을 반복하지 마세요.
- 가장 큰 구매 이유를 한 문장으로 분명히 쓰고 purchaseReason에도 담으세요.
- CTA 직전 문장은 링크를 누를 이유를 완성하고, 마지막 문단은 시스템이 붙일 상품 링크로 자연스럽게 이어지게 쓰세요.
- 리뷰·평점·과장 표현·상세페이지 해설체·직접 사용한 척하는 표현은 금지합니다.
- 본문 최상단에는 정확한 쇼핑커넥트 경제적 이해관계 문구를 한 번 넣으세요.
- 상단 스펙에는 확인된 선택 정보만 쓰고 가격·배송·쿠폰·적립·기본 수량·수량별 옵션은 넣지 마세요.
- 기존 방법의 불편, 상품만의 차이, 사용 장면, 잘 맞는 사람과 맞지 않는 사람, 구체적인 CTA를 빠뜨리지 마세요.
- image 블록은 글 내용과 직접 연결되는 역할로 ${imgCount}개 넣으세요.
${healthRevision}

JSON 형식:
{
  "title":"후킹 제목",
  "titleAlternatives":["대안1","대안2","대안3"],
  "purchaseReason":"현실적인 핵심 구매 이유 한 문장",
  "tags":["건강태그1","건강태그2","생활태그1","생활태그2","상품태그1","상품태그2"],
  "blocks":[{"type":"paragraph","text":"${SHOPPING_CONNECT_DISCLOSURE}"},{"type":"image","slot":1,"caption":"사진 설명","desc":"대표"},{"type":"paragraph","text":"본문"},{"type":"quote","text":"상품명 한눈에 보는 상품 스펙\\n· 제품 형태: ...\\n· 사용 방식: ..."},{"type":"heading","text":"생활 문제"},{"type":"heading","text":"기사 핵심"},{"type":"heading","text":"먼저 실천할 방법"},{"type":"heading","text":"활용 장면"},{"type":"heading","text":"선택 기준과 주의점"}]
}`;
}

async function selfReviewAutomaticProductArticle(article, product, detail, imgCount, healthContext = null) {
  let current = article;
  let lastAudit = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const audit = await codex.invokeJson(automaticProductAuditPrompt(current, product, detail, healthContext), {
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    const checks = Array.isArray(audit?.checks) ? audit.checks : [];
    const paragraphs = current.blocks.filter(
      (block) => block.type === 'paragraph' && block.text !== SHOPPING_CONNECT_DISCLOSURE
    );
    const firstThree = paragraphs.slice(0, 3).map((block) => block.text || '').join(' ');
    const lastParagraph = [...current.blocks].reverse().find((block) => block.type === 'paragraph');
    const currentMeasure = measure(current);
    const healthChecksPassed = !healthContext || (
      currentMeasure.chars >= 1200 &&
      currentMeasure.headings >= 5 &&
      currentMeasure.headings <= 7 &&
      Array.isArray(current.tags) &&
      current.tags.length === 6
    );
    const localChecksPassed =
      /고민|불편|번거|어렵|부담|헷갈|필요/.test(firstThree) &&
      Boolean(current.purchaseReason) &&
      /링크|확인|살펴|골라|선택/.test(lastParagraph?.text || '') &&
      current.blocks.filter((block) => block.type === 'image').length >= imgCount &&
      current.blocks[0]?.text === SHOPPING_CONNECT_DISCLOSURE &&
      current.blocks.some((block) => block.type === 'quote' && /상품\s*스펙/.test(block.text || '')) &&
      healthChecksPassed;
    const passed =
      Number(audit?.score) >= 90 &&
      audit?.passed === true &&
      audit?.finalQuestionPassed === true &&
      checks.length >= 18 &&
      checks.every((check) => check && check.passed === true) &&
      localChecksPassed;
    lastAudit = { ...audit, attempt, localChecksPassed, passed };
    console.log(`[writer] 자동 상품 글 자체 검수 ${attempt}차: ${Number(audit?.score) || 0}점 / ${passed ? '통과' : '재작성 필요'}`);
    if (passed) {
      current.qualityReview = lastAudit;
      return current;
    }
    if (attempt === 3) break;

    const revised = await codex.invokeJson(
      automaticProductRevisionPrompt(current, lastAudit, product, detail, imgCount, healthContext),
      { timeoutMs: WRITE_TIMEOUT_MS }
    );
    if (!revised || !revised.title || !Array.isArray(revised.blocks)) {
      throw new Error('자동 상품 글의 자체 수정 결과 형식이 올바르지 않습니다.');
    }
    const normalized = ensureProductImageSlots(normalize(revised), imgCount);
    const reason = String(revised.purchaseReason || '').trim();
    current = enforceShoppingConnectDisclosure(
      sanitizeProductArticle(
        preservePurchaseReasonContext(enforceSpecQuote(normalized, product), reason),
        product
      )
    );
  }
  throw new Error(`자동 상품 글 자체 검수 90점 기준을 통과하지 못했습니다${lastAudit?.score ? ` (${lastAudit.score}점)` : ''}. 낮은 품질의 글은 저장하지 않았습니다.`);
}

/**
 * 쇼핑커넥트 상품 소개 글 작성 — skills/02-naver-shopping-connect-blog 스킬 지침 구동.
 * @param {object} product {name, price, commission, reviews, rating, query}
 * @param {object} detail {description, images}
 * @returns {object} {title, titleAlternatives, tags, blocks}
 */
function buildProductPrompt(product, detail, frame, imgCount, retryNote, selectedHook, healthContext = null) {
  const skill = skills.loadSkill('03-health-affiliate-blog');
  if (!skill) throw new Error('건강 블로그 스킬(skills/03-health-affiliate-blog/SKILL.md)을 찾을 수 없습니다.');

  const healthReferences = (healthContext?.refs || [])
    .map((ref, index) => `--- 건강 참고자료 ${index + 1} (${ref.source || ref.title || '자료'}) ---\n제목: ${ref.title || ''}\n${String(ref.text || '').slice(0, 2500)}`)
    .join('\n\n');
  const healthTopic = healthContext?.topic || {};
  const healthInstruction = healthContext
    ? `【건강 기사 기반 제휴 포스팅 — 아래 기준이 최우선】
- 글감 제목: ${healthTopic.title || ''}
- 독자의 생활 문제: ${healthTopic.problem || ''}
- 주력 상품: ${healthTopic.primaryProduct || product.name || ''}
- 상품이 필요한 현실적인 이유: ${healthTopic.productReason || ''}
- 첫 3개 일반 문단 안에 생활 문제 하나만 구체적으로 보여주세요.
- 기사·공식자료 핵심은 2~4문단 이내로 새 문장으로 설명하고 발표 기관과 날짜를 명확히 쓰세요.
- 상품을 소개하기 전에 돈을 쓰지 않고 먼저 실천할 방법을 3~5개 제시하세요.
- 상품의 효능보다 준비·손질·보관·활용의 현실적인 편의를 설명하고, 사용 장면을 3~6개 제시하세요.
- 잘 맞을 수 있는 사람과 알레르기·식사 제한·이미 충분히 섭취하는 사람 등 주의할 사람을 함께 안내하세요.
- 일반 식재료 또는 건강기능식품에 맞는 원산지·내용량·손질 여부·기능성 원료·섭취량·알레르기·보관법 중 확인된 선택 기준만 쓰세요.
- 질병 치료·예방·수치 개선을 단정하지 말고 직접 먹어본 후기처럼 쓰지 마세요.
- 소제목은 5~7개, 본문은 최소 1,200자·권장 1,500~2,200자, 해시태그는 정확히 6개로 작성하세요.
- image 블록은 문제 상황, 주력 상품, 활용 장면 1, 활용 장면 2 역할을 포함해 ${imgCount}개 작성하세요.
- 마지막 일반 문단은 구체적인 CTA 문장으로 끝내고, 그 뒤에는 시스템이 제휴 상품 링크를 붙입니다.

【건강 기사·공식자료】
${healthReferences}
`
    : '';

  return `아래는 "네이버 쇼핑커넥트 블로그" 스킬 지침입니다. 이 지침을 반드시 따라 상품 소개 글을 작성하세요.

═══════════ 스킬 지침 시작 ═══════════
${skill}
═══════════ 스킬 지침 끝 ═══════════

【이 자동화 환경에 맞춘 조정 — 지침보다 우선】
- 이미지: 상세페이지 원본 이미지는 시스템이 이미 수집해 image 블록 순서대로 배치합니다. image 블록을 ${imgCount}개 넣고, desc는 "대표", "핵심 특징", "사용 장면/디테일" 등 역할만 쓰세요. **AI 연출 이미지는 이 환경에서 생성 불가하므로 만들지 마세요.**
- ZIP·이미지 미리보기·이미지 목록 출력은 시스템이 처리하므로 생략하세요.
- 상품 링크는 시스템이 글 마지막에 자동으로 붙입니다. 마지막 문단에서 "아래 링크에서 확인해보세요"로 자연스럽게 유도만 하세요.
- 본문 최상단 첫 paragraph는 반드시 "${SHOPPING_CONNECT_DISCLOSURE}"로 정확히 쓰세요. 다른 광고 고지 문구를 덧붙이지 마세요.
- 출처·공식 스토어·상세페이지 주소는 제목·본문·요약·캡션에 쓰지 마세요.
- 가격·판매가·할인가·배송비·쿠폰·적립·무료배송·사은품처럼 변동 가능한 금액과 혜택은 본문 어디에도 쓰지 마세요.

${healthInstruction}

【생활밀착형 소개 글 스타일 — 반드시 이 형태로 쓸 것】
1. 첫 문단은 상품 설명이 아니라 **이 상품이 필요한 사람의 실제 고민과 생활 장면**으로 시작하세요.
   - "이런 거 필요하신 분들 계시죠?", "정품과 호환품 사이에서 헷갈리는 분들 많으시죠?", "막상 사려니 뭘 봐야 할지 어렵더라고요"처럼 독자가 자기 이야기라고 느끼는 자연스러운 질문을 활용하세요.
   - 직접 사용한 척하거나 효과를 경험한 척하지 마세요. 조사하며 알게 된 선택 기준을 친근하게 소개하는 입장으로 쓰세요.
   - 그렇다고 "직접 사용한 후기가 아니라", "확인된 자료를 토대로"처럼 글쓴이의 작성 방식을 해명하지 마세요. 직접 써봤다는 표현만 피하고, "저도 뭐가 다른지 궁금해서 구성을 하나씩 봤는데요"처럼 바로 이야기하세요.
2. **절대 금지 표현**: "상세페이지에는", "상세페이지에서는", "안내됩니다/안내됐습니다", "표시됩니다/표시돼 있습니다", "소개됩니다", "기재되어 있습니다".
   - 사실 근거를 밝힐 필요가 있을 때는 "상세페이지에서 확인되는 특징은"을 한 번 정도 사용할 수 있지만, 페이지를 읽어주는 식으로 반복하지 마세요.
   - 상품 정보를 출처 화면의 문구처럼 설명하지 말고, "10장이 한 묶음이라 여유분을 두고 싶은 분에게 맞아요", "A9·A9S 올인원타워를 쓴다면 먼저 모델을 확인해보세요"처럼 **생활 속 의미와 선택 기준**으로 바꾸세요.
   - "선택 이유가 될 수 있어요", "~라고 전했어요", "생활 패턴에 어울려요", "참고하는 자료일 뿐" 같은 분석 보고서 말투도 쓰지 마세요.
   - **리뷰·평점·재구매 수·구매자 반응은 본문에 쓰지 마세요.** "후기 중에는", "구매자는", "자주 묻는 질문", "질문에는", "의견도 있었어요" 같은 리뷰 해설 형식도 금지합니다.
   - 리뷰에서 발견한 주의점이 있더라도 리뷰를 인용하거나 경험담처럼 소개하지 마세요. 확인이 필요한 내용만 "호환품은 정품과 모양이나 장착감이 다를 수 있으니 처음 끼운 뒤 잘 고정됐는지 봐주세요"처럼 **가능성과 확인 방법**으로 짧게 바꾸세요.
   - 본문은 상품의 구성, 수량, 호환 모델, 형태, 선택 옵션, 교체 방법처럼 공식 상품 자료에서 확인되는 특징을 중심으로 풀어주세요.
3. 블록 순서: ① 경제적 이해관계 paragraph → ② image slot 1(대표) → ③ 공감형 도입 paragraph 2~3개 → ④ **quote 블록 하나에 상품 스펙**.
   - 스펙 첫 줄은 반드시 "{상품명} 한눈에 보는 상품 스펙"으로 쓰세요.
   - 스펙 안에는 "· 구매 이유:" 항목을 넣지 마세요. 구매 이유는 도입과 본문에서 자연스럽게 설명하세요.
   - 형태·소재·크기/용량·색상·사이즈·사용 방식·선택 옵션·핵심 기능·추천 환경·구매 전 확인사항 중 실제 구매 판단에 필요한 항목 4~7개만 고르세요.
   - 확인되지 않은 항목은 만들지 말고 "사이즈 옵션은 판매 페이지에서 확인"처럼 표시하세요.
   - 가격·배송비·쿠폰·적립·기본 구성 수량·세트별 개수·수량별 구매 옵션은 상단 스펙에 넣지 마세요. 기본 구성이나 수량이 핵심이라면 본문 중간에서 한 번만 자연스럽게 설명하세요.
4. **소제목(heading) 블록을 쓰지 마세요.** 구간 전환은 **quote 블록(8~20자 짧은 구절)**로 합니다.
   예: "섬유항균제는 세탁세제와 역할이 달라요", "공간에 따라 다르게 쓸 수 있는 2in1 구조"
   핵심 요약을 포함해 quote는 전체 3~4개만 사용하세요.
5. 문단은 **1~3문장**으로 자연스럽게 이어 쓰세요. 짧은 문장을 기계적으로 잘라 나열하지 말고, 전체 paragraph 블록은 10~15개 정도면 충분합니다.
6. 상품 특징을 말할 때마다 "그래서 어떤 사람에게 편한지", "어떤 생활 상황에서 선택 이유가 되는지"를 함께 설명하세요.
   - 본문 흐름은 고객의 문제 → 기존 방법의 한계 → 상품만의 차이 → 실제 활용 장면 → 구매 전 확인사항 → 잘 맞는 사람과 다른 방식이 더 맞을 수 있는 사람 순서를 기본으로 합니다.
   - 기능 이름만 적지 말고 "기능 → 쓰는 장면 → 얻는 편의" 순서로 생활 언어로 바꾸세요.
   - 자연스러운 생활형 흐름은 유지하면서, 상세 자료로 확인된 핵심 사양·수치·기능 2~4개는 구체적으로 쓰세요. 용량·크기·모델명·작동 방식·충전 방식처럼 실제 선택에 도움이 되는 정보만 고르세요.
   - 핵심 사양 바로 뒤에는 그 정보가 어떤 사람과 생활 장면에서 왜 중요한지 연결하세요. 사양을 별도 목록으로 반복하지 마세요.
   - 사용 후 관리나 주의점은 꼭 필요한 1~2개만 본문에 자연스럽게 넣고, 사용설명서처럼 길게 나열하지 마세요.
   - "Pro Tip", "중요 참고", "FAQ", "자주 묻는 질문" 섹션을 만들지 마세요.
   - "혁신적/획기적/전문가 수준/극대화/필수템/패러다임/체력 소모 제로/만능 해결사/검증된 내구성" 같은 과장 광고 표현을 쓰지 마세요.
7. 이미지는 대표 1장 + 구간 사이사이 배치.
8. 제목: 이번 글의 구성 프레임 성격에 맞게 짓되 상품명이 들어가게 하세요. 매번 같은 "~라면, 상품명" 틀을 반복하지 말고 프레임에 맞춰 변형하세요.
   (문제 해결형 예: "실내건조 빨래 냄새가 고민이라면, 랩신 섬유항균제 사용법과 구성" / 비교·선택형 예: "○○ 사이즈 어떤 걸 골라야 할까, 모델별 차이 정리" / 체크리스트형 예: "○○ 구매 전 확인할 5가지")
9. 말투는 **친한 사람에게 알아본 내용을 설명해 주는 대화체**로 쓰세요.
   - "~다고 해요 / ~더라고요 / ~하면 좋겠습니다 / ~봐주세요 / ~거든요 / ~죠"를 문맥에 맞게 섞으세요.
   - 같은 어미를 연달아 반복하지 말고, 지나치게 조심스러운 "~할 수 있어요 / ~될 수 있어요"도 반복하지 마세요.
   - 상품을 평가하는 해설자 말투보다 "저도 처음엔 헷갈렸는데 하나씩 보니 어렵지 않았어요", "이 부분만 먼저 봐주세요"처럼 사람이 옆에서 알려주는 느낌을 내세요.
   - "정리하면 세 가지만 기억하세요"처럼 글 전체를 보고서식으로 요약하며 끝내지 마세요. 마지막에는 이 상품이 필요한 사람을 한 번 더 떠올려주고 자연스럽게 링크로 이어주세요.
   - 글 마지막에 "마지막 체크", "구매 전 체크", "체크리스트" 같은 인용구나 글머리표 요약을 만들지 마세요. 이미 본문에서 설명한 모델명·구성·사용법·주의점을 다시 나열하지 말고, 마지막 1~2문단은 이 상품이 필요한 생활 장면과 독자의 마음을 자연스럽게 이어 마무리하세요.
   - 핵심 구성, 꼭 확인할 조건, 독자가 기억해야 할 선택 기준 가운데 1~3곳은 반드시 **굵게** 표시하세요.
   - 문장 전체를 계속 굵게 만들지 말고 짧은 핵심 구절만 강조하세요. 핵심 요약과 내용 전환은 quote 3~4개로 구분하고, 같은 내용을 굵게와 quote로 중복 강조하지 마세요.
   - 짧은 quote는 편집기에서 본문보다 큰 글자로 표시되므로, 독자가 기억할 핵심을 8~20자의 자연스러운 구절로 쓰세요. 여러 줄 핵심 요약에는 긴 문장을 넣지 마세요.
   - 마지막 CTA는 반복되는 불편 → 기존 방식과 다른 선택 → 상품 페이지에서 바로 확인할 옵션이나 조건 순서로 1~2문단만 쓰세요. "한번 살펴보세요"처럼 모호하게 끝내지 마세요.
10. 본문 글자 수에는 최소·목표·최대 제한이 없습니다. 상품 정보가 단순하면 간결하게 쓰고, 사이즈·색상·옵션·구성·기능·사용법이 많으면 구매 판단에 필요한 정보가 충분히 전달될 때까지 유연하게 쓰세요. 숫자 목표에 맞추려고 내용을 늘리거나 줄이지 말고 같은 설명을 반복하지 마세요. 제목·이미지·인용구·본문·캡션·해시태그·상품 링크를 포함한 포스팅 전체를 왼쪽 정렬합니다.
   - 문장 내용은 줄이지 말고 약 25~40자의 자연스러운 의미 단위로 줄바꿈하세요. 띄어쓰기·쉼표·접속 표현처럼 호흡이 쉬는 곳에서 나누고, 단어·조사·**굵은 구절** 중간은 자르지 마세요.

${selectedHook ? `【사용자가 고른 고민과 제목 — 다른 제목으로 바꾸지 말 것】
- 최종 제목: ${selectedHook.title}
- 구매자가 가진 고민: ${selectedHook.concern}
- 이 상품을 찾는 상황: ${selectedHook.situation}
- 이 방향에서의 핵심 구매 이유: ${selectedHook.purchaseReason || ''}
- 글의 중심 방향: ${selectedHook.angle}
제목은 위 최종 제목을 글자 하나까지 그대로 사용하고, 도입과 본문 전체를 선택된 고민·상황에 맞춰 쓰세요. 다른 고민을 중심으로 바꾸거나 제목 대안을 새로 만들지 마세요.` : ''}

【구매 이유를 명확하게 쓰는 기준 — 반드시 적용】
- 독자가 글을 읽고 "그래서 왜 이 제품을 사야 하지?"라는 의문이 남지 않게 하세요.
- 구매 이유는 막연한 편리함이 아니라 "확인된 제품 특징 → 줄어드는 불편 또는 얻는 실용성 → 잘 맞는 사람·상황" 순서로 설명하세요.
- 글 초반 2~4문단 안에서 가장 큰 구매 이유를 한 번 분명히 말하고, 본문에는 서로 겹치지 않는 구체적인 구매 이유 2~4개를 제품 정보와 함께 풀어주세요.
- "무조건 사야 해요", "필수예요"처럼 밀어붙이지 말고, 다른 제품에도 붙일 수 있는 두루뭉술한 장점은 쓰지 마세요.
- 구매 이유는 상단 스펙에 별도 항목으로 반복하지 말고 도입과 본문 흐름에서 자연스럽게 전달하세요.

${frames.renderFrameInstruction(frame, 'product')}
※ 위 구성 프레임은 이번 글에만 적용됩니다. 도입 문구·구간 구절·마무리 표현을 상투적인 틀 대신 이 프레임 흐름에 맞게 새로 지으세요.
※ 상세페이지에서 확인되지 않는 성능·효과·수치는 단정하지 마세요.

【상품 정보 (상세페이지에서 수집)】
상품명: ${product.name}
카테고리: ${product.query || ''}

확인된 상품 자료(사실 확인용이며, 본문에서 '상세페이지'라고 부르지 마세요):
${String(detail.description || '').slice(0, 6000)}
※ 위 자료에 리뷰·평점·구매자 질문이나 반응이 섞여 있어도 본문에는 사용하지 마세요. 공식적으로 확인되는 상품 구성과 특징만 골라 쓰세요.

【출력 형식 — 이 JSON으로만】
{
  "title": "독자 문제 + 해결 실마리, 상품명 흐름의 제목",
  "titleAlternatives": ["제목 대안1", "제목 대안2", "제목 대안3"],
  "purchaseReason": "확인된 제품 특징과 구매자의 고민을 연결한 핵심 구매 이유 한 문장",
  "tags": ["건강태그1", "건강태그2", "생활태그1", "생활태그2", "상품태그1", "상품태그2"],
  "blocks": [
    {"type":"paragraph","text":"${SHOPPING_CONNECT_DISCLOSURE}"},
    {"type":"image","slot":1,"caption":"건강 주제 대표 장면","desc":"독자의 문제 상황 대표 이미지"},
    {"type":"paragraph","text":"독자가 실제 생활에서 겪는 건강 문제 하나를 구체적으로 보여주는 도입입니다."},
    {"type":"heading","text":"이 문제가 반복되는 현실적인 이유"},
    {"type":"paragraph","text":"독자를 탓하지 않고 준비 시간과 생활 환경을 설명합니다."},
    {"type":"heading","text":"최근 건강 기사에서 확인할 핵심"},
    {"type":"paragraph","text":"발표 기관과 날짜를 밝히고 기사 핵심을 2~4문단 안에서 쉽게 설명합니다."},
    {"type":"heading","text":"돈을 쓰기 전에 먼저 실천할 방법"},
    {"type":"paragraph","text":"비용 없이 할 수 있는 방법 3~5개를 제시합니다."},
    {"type":"image","slot":2,"caption":"주력 상품 또는 식재료","desc":"주력 상품 또는 식재료 중심 이미지"},
    {"type":"quote","text":"○○○ 한눈에 보는 상품 스펙\\n· 형태: ...\\n· 크기/용량: ...\\n· 선택 옵션: ...\\n· 이런 분께: ..."},
    {"type":"heading","text":"이 상품이 생활에서 유용한 이유"},
    {"type":"paragraph","text":"상품이 없을 때의 불편과 준비했을 때 달라지는 점을 설명합니다."},
    {"type":"image","slot":3,"caption":"첫 번째 활용 장면","desc":"실제 활용 장면 1"},
    {"type":"paragraph","text":"쉽게 따라 할 수 있는 활용 장면을 3~6개 제시합니다."},
    {"type":"image","slot":4,"caption":"두 번째 활용 장면","desc":"실제 활용 장면 2"},
    {"type":"heading","text":"이런 분께 맞고 이런 분은 주의하세요"},
    {"type":"paragraph","text":"잘 맞는 사람과 알레르기·식사 제한 등 한계를 함께 안내합니다."},
    {"type":"heading","text":"구매 전에 확인할 선택 기준"},
    {"type":"paragraph","text":"확인된 상품 정보만으로 구체적인 선택 기준을 설명합니다."},
    {"type":"paragraph","text":"반복되는 불편과 상품 페이지에서 확인할 항목을 연결한 자연스러운 CTA 문장"}
  ]
}
tags는 정확히 6개. 건강 기사 기반 글은 소제목 5~7개와 본문 1,200자 이상을 지키고, 상품 정보량과 구매 판단에 필요한 설명을 충분히 담으세요.
${retryNote || ''}`;
}

/**
 * 쇼핑커넥트 상품 소개 글 작성 — skills/02-naver-shopping-connect-blog 스킬 지침 구동.
 * @param {object} product {name, price, commission, reviews, rating, query}
 * @param {object} detail {description, images}
 * @returns {object} {title, titleAlternatives, tags, blocks}
 */
async function writeProductArticle(product, detail, selectedHook = null, options = {}) {
  const minimumImages = Math.max(2, Number(options.minImages) || 2);
  const imgCount = Math.min(Math.max((detail.images || []).length, minimumImages), 5);

  // 이번 글의 구성 프레임 선택 — 상세페이지 내용으로 적합성을 판정한다
  const detailText = `${product.name || ''}\n${String(detail.description || '')}`;
  const frame = options.healthContext
    ? { key: 'health-affiliate', label: '건강 생활문제 해결형', check: null }
    : frames.pickFrame('product', { detailText });

  const run = async (note) => {
    const raw = await codex.invokeJson(buildProductPrompt(product, detail, frame, imgCount, note, selectedHook, options.healthContext), {
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    if (!raw || !raw.title || !Array.isArray(raw.blocks)) {
      throw new Error('상품 글 작성 결과 형식이 올바르지 않습니다.');
    }
    const alts = (Array.isArray(raw.titleAlternatives) ? raw.titleAlternatives : []).map(String).slice(0, 3);
    const purchaseReason = String(selectedHook?.purchaseReason || raw.purchaseReason || '').trim();
    const normalized = preservePurchaseReasonContext(
      enforceSpecQuote(ensureProductImageSlots(normalize(raw), minimumImages), product),
      purchaseReason
    );
    if (selectedHook && selectedHook.title) {
      normalized.title = String(selectedHook.title).trim();
      normalized.titleAlternatives = [];
    } else {
      normalized.titleAlternatives = alts;
    }
    return enforceShoppingConnectDisclosure(
      sanitizeProductArticle(normalized, product)
    ); // 스펙 위치·고지 보장 + 출처·가격·혜택 제거
  };

  let article = await run();

  // 프레임·문체 요건 미달 시에만 1회 보강 재작성한다. 글자 수 자체는 재작성 조건이 아니다.
  const m = measure(article);
  const frameIssue = frame.check ? frame.check(article) : null;
  const text = article.blocks.map((block) => block.text || '').join(' ');
  const paragraphText = article.blocks
    .filter((block) => block.type === 'paragraph')
    .map((block) => block.text || '')
    .join(' ');
  const stiffLanguage = /상세\s*페이지(?:에는|에서는)|안내(?:됩니다|됐|되어)|표시(?:됩니다|됐|돼|되어)|소개(?:됩니다|됐|되어)|기재(?:됩니다|됐|돼|되어)/.test(text);
  const aiReportLanguage = /직접\s*사용한\s*후기가\s*아니라|확인된\s*(?:구성|자료).{0,20}토대로|선택\s*이유가\s*될\s*수\s*있어요|(?:라고\s*)?전했어요|작성\s*시점인?\s*\d{4}년|생활\s*패턴에\s*어울려요|참고하는\s*자료일\s*뿐/.test(paragraphText);
  const reviewSummaryLanguage = /후기(?:를|가|는|도|에서|중에는?)|리뷰|구매자(?:가|는|의|들)|자주\s*묻는\s*질문|질문에는|의견도\s*(?:있|보)|정리하면.{0,30}(?:세|몇)\s*(?:가지|순서)/.test(paragraphText);
  const manualStructure = /Pro\s*Tip|중요\s*참고|자주\s*묻는\s*질문|\bFAQ\b/i.test(text);
  const promotionalLanguage = /혁신적|획기적|전문가\s*수준|효과.{0,8}극대화|필수템|패러다임|체력\s*소모.{0,6}제로|만능\s*해결사|검증된\s*내구성/.test(text);
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
    : manualStructure
      ? 'FAQ·Pro Tip 등 사용설명서형 구조 포함'
    : promotionalLanguage
      ? '근거 없는 과장 광고 표현 포함'
    : !empatheticIntro
      ? '독자 고민에 공감하는 도입 부족'
      : null;
  if (frameIssue || styleIssue) {
    console.log(`[writer] 상품 글 기준 미달(글자 ${m.chars}${frameIssue ? `, ${frameIssue}` : ''}${styleIssue ? `, ${styleIssue}` : ''}) → 재작성`);
    const note = `\n※ 이전 결과가 기준에 못 미쳤습니다(본문 ${m.chars}자${frameIssue ? `, ${frameIssue}` : ''}${styleIssue ? `, ${styleIssue}` : ''}). 본문 최상단에는 지정된 쇼핑커넥트 경제적 이해관계 문구를 정확히 한 번 넣고, 그 다음 대표 이미지와 독자의 구체적인 생활 고민으로 시작하세요. "상세페이지에는/상세페이지에서는/안내됩니다/표시됩니다/소개됩니다", "직접 사용한 후기가 아니라", "확인된 자료를 토대로", "선택 이유가 될 수 있어요", "~라고 전했어요", "생활 패턴에 어울려요" 같은 해설·보고서 표현은 쓰지 마세요. 리뷰·평점·구매자 반응·자주 묻는 질문·FAQ·Pro Tip과 과장 광고 표현은 모두 제외하세요. 가격·배송·할인·쿠폰·적립·사은품은 쓰지 마세요. 상품의 사이즈·색상·옵션·구성·기능·사용법·관리법 중 확인된 정보를 구매 판단에 충분하도록 생활 장면과 연결하세요. 기존 방법의 불편, 상품만의 차이, 실제 활용 장면, 잘 맞는 사람과 맞지 않는 사람, 구체적인 CTA를 빠뜨리지 마세요. 본문 분량은 상품 정보량에 따라 정하고 반복해서 늘리지 마세요.\n`;
    try {
      const retry = await run(note);
      const rm = measure(retry);
      article = retry;
      console.log(`[writer] 상품 글 재작성 채택(글자 ${rm.chars})`);
    } catch (e) {
      console.log(`[writer] 상품 글 재작성 실패(원본 사용): ${e.message}`);
    }
  }

  // 어떤 프레임으로 썼는지 기록 (이력 표시 + 다음 글의 중복 회피에 사용)
  article.frameKey = frame.key;
  article.frameLabel = frame.label;
  article = formatProductParagraphs(article);
  if (options.selfReview) {
    article = await selfReviewAutomaticProductArticle(article, product, detail, minimumImages, options.healthContext);
    article.frameKey = frame.key;
    article.frameLabel = frame.label;
    article = formatProductParagraphs(article);
  }
  return article;
}

/**
 * 상품 링크를 받은 뒤 글을 쓰기 전에 구매 고민이 담긴 후킹 제목 3개를 만든다.
 * 사용자가 이 중 하나를 골라야 본문 생성이 시작된다.
 */
async function suggestProductHooks(product, detail) {
  const prompt = `아래 상품을 실제로 구매하려는 사람이 가질 만한 서로 다른 고민 3가지를 찾고,
각 고민이 제목만 읽어도 드러나는 네이버 블로그용 후킹 제목 3개를 제안하세요.

상품명: ${product.name || '상품'}
카테고리: ${product.query || ''}
확인된 상품 정보:
${String(detail.description || '').slice(0, 5000)}

규칙:
- 세 제목은 고민과 사용 상황이 서로 달라야 합니다.
- 이 제품이 왜 필요한지 또는 어떤 상황에서 선택하는지가 제목에 보여야 합니다.
- 각 방향마다 확인된 제품 특징과 고민을 연결한 핵심 구매 이유를 한 문장으로 쓰세요.
- 구매 이유는 "편리해서", "실용적이라서"처럼 두루뭉술하게 쓰지 말고, 구체적인 구성·크기·기능·사용 방식이 어떤 불편을 줄이는지 밝혀야 합니다.
- 상품명을 자연스럽게 포함하세요.
- 과장, 공포 조장, 확인되지 않은 효과, 가격, 리뷰, 평점은 쓰지 마세요.
- 직접 사용한 것처럼 쓰지 마세요.
- '충격', '정체', '결국', '소름', '전부 공개' 같은 낚시 표현은 금지합니다.

JSON 형식:
{
  "choices": [
    {"title":"고민이 포함된 후킹 제목", "concern":"구매자의 구체적인 고민", "situation":"이 제품을 선택하는 생활 상황", "purchaseReason":"확인된 특징이 이 고민을 해결해 구매할 이유", "angle":"글에서 풀어갈 중심 방향"},
    {"title":"...", "concern":"...", "situation":"...", "purchaseReason":"...", "angle":"..."},
    {"title":"...", "concern":"...", "situation":"...", "purchaseReason":"...", "angle":"..."}
  ]
}`;
  const raw = await codex.invokeJson(prompt, { timeoutMs: WRITE_TIMEOUT_MS });
  const choices = Array.isArray(raw && raw.choices) ? raw.choices : [];
  const normalized = choices
    .map((choice) => ({
      title: String(choice && choice.title || '').trim(),
      concern: String(choice && choice.concern || '').trim(),
      situation: String(choice && choice.situation || '').trim(),
      purchaseReason: String(choice && choice.purchaseReason || '').trim(),
      angle: String(choice && choice.angle || '').trim(),
    }))
    .filter((choice) => choice.title && choice.concern && choice.situation && choice.purchaseReason)
    .slice(0, 3);
  if (normalized.length !== 3) throw new Error('구매 고민 제목 3개를 만들지 못했습니다. 다시 시도해주세요.');
  return normalized;
}

module.exports = {
  writeArticle,
  writeProductArticle,
  suggestProductHooks,
  measure,
  inspectNewsArticle,
  wrapNewsLine,
  wrapProductLine,
  formatNewsParagraphs,
  formatProductParagraphs,
  sanitizeProductArticle,
  enforceShoppingConnectDisclosure,
  enforceSpecQuote,
  preservePurchaseReasonContext,
};
