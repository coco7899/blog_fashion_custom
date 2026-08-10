// 네이버 스마트에디터 ONE 자동화: 제목/본문/서식/이미지 입력 → 발행
const path = require('path');
const browserHelper = require('./browser');
const auth = require('./naverAuth');

// 스마트에디터 셀렉터 모음 — 네이버 UI 변경 시 여기만 수정
const SEL = {
  iframe: 'iframe#mainFrame',
  titleArea: '.se-section-documentTitle .se-text-paragraph',
  bodyArea: '.se-section-text .se-text-paragraph',
  popupCancel: '.se-popup-button-cancel', // "작성 중인 글" 이어쓰기 팝업 → 취소
  uploadErrorTitle: ':text("파일 전송 오류")',
  popupConfirm: '.se-popup-alert button:has-text("확인"), div[class*="container"] button:has-text("확인")',
  helpClose: '.se-help-panel-close-button',
  fontSizeBtn: '.se-font-size-code-toolbar-button',
  fontSizeOpt: (code) => `.se-toolbar-option-font-size-code-fs${code}-button`,
  quoteBtn: '.se-insert-quotation-default-toolbar-button, .se-blockquote-toolbar-button',
  quoteSelectBtn: 'button:has-text("인용구 선택"), .se-document-toolbar-select-option-button:has-text("인용구 선택")',
  quote2Opt: '.se-insert-menu-sub-panel-button-quotation-quotation_line, .se-toolbar-option-blockquote-quotation_line-button, button[class*="quotation-quotation_line"]',
  hrBtn: '.se-insert-horizontal-line-default-toolbar-button, .se-horizontal-line-toolbar-button',
  hrOpt: '.se-toolbar-option-horizontal-line-line1-button, button[class*="horizontalLine-line1"], button[class*="se-toolbar-option-horizontal-line"]',
  imageBtn: '.se-image-toolbar-button',
  // 정렬 버튼(툴바) — 클릭 시 좌/가운데/우 옵션이 열리는 형태
  alignBtn: '.se-align-toolbar-button, button[class*="align"][class*="toolbar-button"]',
  alignCenterOpt: 'button[class*="toolbar-option-align-center"], button[class*="align-center"]',
  alignLeftOpt: 'button[class*="toolbar-option-align-left"], button[class*="align-left"]',
  // 헤더 발행 버튼: has-text("발행")만 쓰면 숨겨진 예약(reserve_btn) 버튼이 먼저 잡히므로
  // 보이는 버튼만 후보 순서대로 시도한다
  publishOpenCandidates: [
    'button[data-click-area$=".publish"]',
    'button[class*="publish_btn"]',
    'button:has-text("발행")',
  ],
  publishConfirm: '[data-testid="seOnePublishBtn"]',
  tagInput: 'input[id^="tag-input"], input[placeholder*="태그"]',
  privateLabel: 'label:has-text("비공개")',
  // 헤더 "저장"(임시저장) 버튼 후보
  saveCandidates: [
    'button[data-click-area="tpb.save"]',
    'button[data-click-area$=".save"]',
    'button[class*="save_btn"]',
    'button:has-text("저장")',
  ],
  // 임시저장 개수 배지 버튼 (aria-label="임시저장된 글 보기, N개") — 저장 성공 검증에 사용
  saveCountBtn: 'button[class*="save_count_btn"], button[data-click-area$="s.count"]',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOPPING_CONNECT_DISCLOSURE =
  '이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.';
const PRODUCT_POST_FORBIDDEN_RE = /출처|공식\s*스토어/i;
const PRODUCT_PRICE_BENEFIT_RE =
  /판매가|할인가|정가|가격|배송비|무료\s*배송|쿠폰|적립(?:금)?|할인율|할인\s*(?:금액|혜택)|사은품/i;

function cleanProductPostText(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.replace(/\s*\(출처\s*[:：][^)]+\)\s*/gi, '').trim())
    .filter(
      (line) =>
        line &&
        (line === SHOPPING_CONNECT_DISCLOSURE ||
          (!PRODUCT_POST_FORBIDDEN_RE.test(line) && !PRODUCT_PRICE_BENEFIT_RE.test(line)))
    )
    .join('\n');
}

function cleanProductPostArticle(article, products) {
  const productName = String(products?.[0]?.name || '상품').trim().slice(0, 40);
  const title = cleanProductPostText(article.title) || `${productName} 구성과 사용 전 확인할 점`;
  const blocks = (article.blocks || [])
    .map((block) => {
      const cleaned = { ...block };
      if (typeof cleaned.text === 'string') cleaned.text = cleanProductPostText(cleaned.text);
      if (typeof cleaned.caption === 'string') cleaned.caption = cleanProductPostText(cleaned.caption);
      return cleaned;
    })
    .filter((block) => block.type === 'image' || !('text' in block) || String(block.text).trim())
    .filter(
      (block) =>
        !(block.type === 'paragraph' && /쇼핑\s*커넥트\s*활동|판매\s*발생\s*시\s*수수료/.test(block.text || ''))
    );
  blocks.unshift({ type: 'paragraph', text: SHOPPING_CONNECT_DISCLOSURE, disclosure: true });
  const tags = (article.tags || []).filter((tag) => !PRODUCT_POST_FORBIDDEN_RE.test(tag));
  return { ...article, title, blocks, tags };
}

// 후보 셀렉터들을 순서대로 훑어 "화면에 보이는" 버튼만 클릭 (숨겨진 버튼 오매칭 방지)
// pick: 'first' | 'last' — 같은 텍스트 버튼이 여럿일 때 어느 쪽을 누를지
async function clickVisibleCandidate(frame, selectors, { pick = 'first', timeout = 15000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await dismissHelpPanel(frame);
    for (const sel of selectors) {
      const btns = frame.locator(sel);
      const n = await btns.count().catch(() => 0);
      const order = [...Array(n).keys()];
      if (pick === 'last') order.reverse();
      for (const i of order) {
        const b = btns.nth(i);
        if (await b.isVisible().catch(() => false)) {
          try {
            await b.click({ timeout: 4000 });
          } catch {
            // 도움말 패널 등에 가려 클릭이 막혔을 수 있으니 닫고 한 번 더 시도
            await dismissHelpPanel(frame);
            await b.click({ timeout: 4000 });
          }
          return sel;
        }
      }
    }
    await sleep(500);
  }
  return null;
}

// 네이버 에디터의 "도움말" 안내 패널이 버튼 위에 겹쳐 나타나 클릭을 가로막는 경우가 있다.
// 초기 1회만 닫으면 이후 재등장 시 계속 막히므로, 중요한 클릭 직전마다 매번 시도해서 닫는다.
async function dismissHelpPanel(frame) {
  try {
    const btn = frame.locator(SEL.helpClose).first();
    if (await btn.isVisible({ timeout: 300 }).catch(() => false)) {
      await btn.click({ timeout: 1000 }).catch(() => {});
      return true;
    }
  } catch {}
  return false;
}

async function clickIfVisible(frame, selector, timeout = 2500) {
  try {
    await dismissHelpPanel(frame);
    const loc = frame.locator(selector).first();
    await loc.waitFor({ state: 'visible', timeout });
    try {
      await loc.click({ timeout: 4000 });
    } catch {
      // 클릭이 막혔다면 도움말 패널 때문일 수 있으니 다시 닫고 한 번 더 시도
      await dismissHelpPanel(frame);
      await loc.click({ timeout: 4000 });
    }
    return true;
  } catch {
    return false;
  }
}

// **굵게** 마크가 섞인 텍스트를 세그먼트 단위로 입력 (굵게는 Ctrl+B 토글)
async function typeRich(page, text) {
  const parts = String(text).split(/\*\*(.+?)\*\*/g);
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (!seg) continue;
    const bold = i % 2 === 1;
    if (bold) await page.keyboard.press('Control+b');
    await page.keyboard.insertText(seg);
    if (bold) await page.keyboard.press('Control+b');
  }
}

// 문단 입력: 문단 안의 줄들(\n)은 빈 줄 없이 바로 이어 붙이고,
// 빈 줄은 문단(블록) 사이에만 하나 둔다. (발행 글 스타일:
//   "이번 착장의 중심은 / 블랙 프린트 크롭 티셔츠와 / 블랙 랩 스커트였어요." ← 붙은 3줄
//   그 다음 빈 줄 하나 → 다음 문단)
async function typeParagraph(page, text) {
  const lines = String(text).split('\n').map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) await page.keyboard.press('Enter'); // 줄바꿈만 (빈 줄 없음)
    await typeRich(page, lines[i]);
  }
}

async function setFontSize(frame, page, code) {
  const opened = await clickIfVisible(frame, SEL.fontSizeBtn, 2000);
  if (!opened) {
    console.log(`[publisher:format] 글자 크기 버튼을 찾지 못함(fs${code})`);
    return false;
  }
  await sleep(300);
  const ok = await clickIfVisible(frame, SEL.fontSizeOpt(code), 2000);
  if (!ok) await page.keyboard.press('Escape');
  console.log(`[publisher:format] 글자 크기 fs${code}: ${ok ? '적용' : '실패'}`);
  return ok;
}

// 현재 문단 정렬 변경 (best-effort — 버튼 못 찾으면 좌측 유지)
async function setAlign(frame, page, which) {
  const opened = await clickIfVisible(frame, SEL.alignBtn, 1200);
  if (!opened) return false;
  await sleep(200);
  const ok = await clickIfVisible(frame, which === 'center' ? SEL.alignCenterOpt : SEL.alignLeftOpt, 1200);
  if (!ok) await page.keyboard.press('Escape');
  return ok;
}

async function insertHeading(frame, page, text) {
  await page.keyboard.insertText(text);
  // 방금 입력한 줄 전체 선택 → 크게 + 굵게
  await page.keyboard.press('Shift+Home');
  const sized = await setFontSize(frame, page, 24);
  await sleep(200);
  await page.keyboard.press('Control+b');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); // 소제목 아래 여유 있는 빈 줄
  // 다음 문단이 서식을 상속하므로 원복
  await page.keyboard.press('Control+b');
  if (sized) await setFontSize(frame, page, 15);
  await sleep(150);
}

async function insertQuote(frame, page, text, { emphasize = false } = {}) {
  const lines = String(text).split('\n').map((s) => s.trim()).filter(Boolean);
  // 네이버의 분리형 인용구 선택 버튼을 열어 정확히 "인용구2"를 고른다.
  // 선택 메뉴가 보이지 않는 예외 상황에서만 기본 인용구 버튼으로 폴백한다.
  const selectorOpened = await clickIfVisible(frame, SEL.quoteSelectBtn, 2500);
  let quote2Applied = false;
  if (selectorOpened) {
    await sleep(300);
    quote2Applied = await clickIfVisible(frame, SEL.quote2Opt, 2500);
    if (!quote2Applied) await page.keyboard.press('Escape');
  }
  let inserted = quote2Applied;
  if (!inserted) inserted = await clickIfVisible(frame, SEL.quoteBtn, 2500);
  console.log(`[publisher:format] 인용구2: ${quote2Applied ? '적용' : inserted ? '기본 인용구 폴백' : '실패'}`);

  if (inserted) {
    await sleep(400);
    // 여러 줄(스펙 요약 등)은 인용구 안에서 Shift+Enter(같은 인용구 내 줄바꿈)로 입력
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) await page.keyboard.press('Shift+Enter');
      await page.keyboard.insertText(lines[i]);
    }
    if (emphasize) {
      // 쇼핑 글의 핵심 구절은 본문보다 한 단계 크게 보이게 한다.
      // 여러 줄 핵심 요약은 과하게 커지지 않도록 17, 짧은 구절은 19를 사용한다.
      const quoteComponent = frame.locator('.se-component.se-quotation, .se-component.se-blockquote').last();
      const selectQuoteContents = () =>
        quoteComponent.evaluate((element) => {
          const selection = element.ownerDocument.defaultView.getSelection();
          const range = element.ownerDocument.createRange();
          range.selectNodeContents(element);
          selection.removeAllRanges();
          selection.addRange(range);
          return true;
        }).catch(() => false);
      const selected = await selectQuoteContents();
      if (selected) {
        await setFontSize(frame, page, lines.length > 1 ? 17 : 19);
        await page.keyboard.press('End');
      }
    }
    // 인용구 탈출: End → ArrowDown×2(인용구 밖으로) → Enter(깨끗한 새 문단).
    // 실측으로 찾은 조합 — 인용구 안에 빈 줄(행간)을 남기지 않고, 본문이 인용구에 갇히지도 않으며,
    // 다음 문단 첫 줄도 유실되지 않고, 소제목과 본문 사이 여백도 자연스럽게 생김.
    await page.keyboard.press('End');
    await sleep(120);
    await page.keyboard.press('ArrowDown');
    await sleep(150);
    await page.keyboard.press('ArrowDown');
    await sleep(150);
    await page.keyboard.press('Enter');
    await sleep(250);
  } else {
    // 폴백: 따옴표로 감싼 굵은 문단
    await typeRich(page, `**"${lines.join(' ')}"**`);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
  }
}

// 건강 글 소제목은 글자 선택 후 크기를 바꾸는 방식 대신 네이버 인용구2
// 컴포넌트로 직접 만든다. 툴바 클릭 때 선택이 풀려 평문으로 남는 오류를 막는다.
async function insertHealthHeading(frame, page, text) {
  await insertQuote(frame, page, text, { emphasize: true });
}

async function insertDivider(frame, page) {
  const opened = await clickIfVisible(frame, SEL.hrBtn, 2500);
  if (opened) {
    await sleep(300);
    await clickIfVisible(frame, SEL.hrOpt, 2000);
    await sleep(400);
  } else {
    await page.keyboard.insertText('─────────────');
    await page.keyboard.press('Enter');
  }
}

// 임시저장된 글 개수 읽기 (aria-label="임시저장된 글 보기, 137개") — 저장 검증용
async function readSaveCount(frame) {
  try {
    const btn = frame.locator(SEL.saveCountBtn).first();
    const label = (await btn.getAttribute('aria-label', { timeout: 1500 })) || '';
    const m = label.match(/(\d+)\s*개/);
    return m ? parseInt(m[1], 10) : null;
  } catch {
    return null;
  }
}

// 임시저장 실행 + 실제 저장됐는지 검증. 성공 신호:
//   ① "임시저장이 완료되었습니다." 토스트  또는  ② 저장 개수 배지 +1 증가
// 검증 실패 시 한 번 더 시도하고, 그래도 실패면 예외를 던진다(가짜 성공 방지).
async function saveDraftVerified(frame, page, { updatingExisting = false } = {}) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    await dismissUploadError(frame, page);
    const before = await readSaveCount(frame);
    await dismissHelpPanel(frame);
    const clicked = await clickVisibleCandidate(frame, SEL.saveCandidates, { pick: 'first', timeout: 10000 });
    if (!clicked) {
      if (attempt === 2) throw new Error('저장(임시저장) 버튼을 찾지 못했습니다.');
      await sleep(1000);
      continue;
    }
    console.log(`[publisher] 임시저장 버튼 클릭(시도 ${attempt}): ${clicked}`);

    // 성공 신호 폴링 (최대 ~12초)
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      const toast = await frame
        .locator(':text("임시저장이 완료되었습니다")')
        .first()
        .isVisible()
        .catch(() => false);
      if (toast) return true;
      const now = await readSaveCount(frame);
      if (before != null && now != null && now > before) return true;
      // 기존 임시글을 다시 저장하면 개수는 늘지 않는다. 이 경우에는
      // 저장 버튼이 다시 활성 상태로 돌아오고 개수가 유지되는 것도 보조 신호로 사용한다.
      if (updatingExisting && before != null && now === before && Date.now() > deadline - 8000) {
        const clickedButtons = frame.locator(clicked);
        const buttonCount = await clickedButtons.count().catch(() => 0);
        for (let index = 0; index < buttonCount; index += 1) {
          const saveButton = clickedButtons.nth(index);
          if (!(await saveButton.isVisible().catch(() => false))) continue;
          const disabled = await saveButton.isDisabled().catch(() => false);
          if (!disabled) return true;
        }
      }
      // "작성 중인 글 이어쓰기" 팝업이 저장을 막고 있으면 취소
      await clickIfVisible(frame, SEL.popupCancel, 600);
      await sleep(600);
    }
    console.log(`[publisher] 저장 확인 실패(시도 ${attempt}) — 재시도`);
  }
  throw new Error('임시저장이 확인되지 않았습니다(저장 신호 없음).');
}

function normalizeEditorText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function openSavedDraftByTitle(frame, page, title) {
  const expected = normalizeEditorText(title);
  if (!expected) throw new Error('다시 열 임시글 제목이 비어 있습니다.');

  const opened = await clickIfVisible(frame, SEL.saveCountBtn, 10000);
  if (!opened) throw new Error('임시저장 글 목록을 열지 못했습니다.');
  await sleep(1200);

  const titleNodes = frame.locator('button[data-click-area="tpb*s.tlist"] strong');
  const nodeCount = await titleNodes.count().catch(() => 0);
  const exactIndexes = [];
  for (let index = 0; index < nodeCount; index += 1) {
    const itemTitle = normalizeEditorText(await titleNodes.nth(index).innerText().catch(() => ''));
    if (itemTitle === expected) exactIndexes.push(index);
  }
  if (!exactIndexes.length) throw new Error(`1차 임시저장 글을 찾지 못했습니다: ${title}`);

  // 임시저장 목록은 최신순이다. 같은 제목이 있더라도 방금 저장한 첫 항목을 연다.
  await titleNodes.nth(exactIndexes[0]).click({ timeout: 10000 });
  await sleep(1800);
  await frame.waitForSelector(SEL.titleArea, { timeout: 15000 });

  const loadedTitle = normalizeEditorText(
    await frame.locator(SEL.titleArea).first().innerText().catch(() => '')
  );
  if (loadedTitle !== expected) {
    throw new Error(`다른 임시글이 열려 작업을 중단했습니다. 확인된 제목: ${loadedTitle || '없음'}`);
  }
  return { matchCount: exactIndexes.length, title: loadedTitle };
}

async function clearLoadedDraft(frame, page, expectedTitle) {
  const loadedTitle = normalizeEditorText(
    await frame.locator(SEL.titleArea).first().innerText().catch(() => '')
  );
  if (loadedTitle !== normalizeEditorText(expectedTitle)) {
    throw new Error('제목 확인이 달라 기존 임시글 내용을 지우지 않았습니다.');
  }

  // SmartEditor는 DOM Range로 만든 선택을 입력 명령으로 인정하지 않는다.
  // 실제 본문 문단에 포커스를 둔 뒤 키보드 전체 선택을 사용해야 모든 컴포넌트가 지워진다.
  const bodyArea = frame.locator(SEL.bodyArea).first();
  await bodyArea.click({ timeout: 5000 });
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await sleep(700);

  // 빈 문단에는 네이버가 `se-placeholder` 안내문을 표시한다. 안내문은 사용자가 쓴
  // 본문이 아니므로 제외하고 실제 편집 노드(`__se-node`)의 텍스트만 검사한다.
  const remainingBody = normalizeEditorText(
    await frame
      .locator('.se-component:not(.se-documentTitle) .__se-node')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent || '').join(' '))
      .catch(() => '')
  );
  if (remainingBody) throw new Error('기존 본문이 남아 있어 이미지 배치를 중단했습니다.');

  const titleArea = frame.locator(SEL.titleArea).first();
  await titleArea.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await sleep(300);
  const remainingTitle = normalizeEditorText(
    await titleArea
      .locator('.__se-node')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent || '').join(' '))
      .catch(() => '')
  );
  if (remainingTitle) throw new Error('기존 제목을 비우지 못해 이미지 배치를 중단했습니다.');
}

async function verifySavedDraftByTitle(frame, page, title, expectedImageCount) {
  await openSavedDraftByTitle(frame, page, title);
  const actualImageCount = await frame.locator('.se-component.se-image').count();
  if (actualImageCount !== expectedImageCount) {
    throw new Error(
      `2차 임시저장 확인 중 이미지가 ${actualImageCount}장만 보입니다. 기대 ${expectedImageCount}장`
    );
  }
  const bodyText = await frame
    .locator('.se-component:not(.se-documentTitle)')
    .evaluateAll((nodes) => nodes.map((node) => node.innerText || '').join('\n'));
  if (/추천\s*장면\s*:|이미지\s*\d+\s*넣을\s*자리/.test(bodyText)) {
    throw new Error('2차 임시저장 글에 이미지 자리 안내 문구가 남아 있습니다.');
  }
  return actualImageCount;
}

async function dismissUploadError(frame, page) {
  const visible = await frame
    .locator(SEL.uploadErrorTitle)
    .first()
    .isVisible()
    .catch(() => false);
  if (!visible) return false;

  await clickIfVisible(frame, SEL.popupConfirm, 2000);
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(300);
  return true;
}

async function insertImage(frame, page, filePath, captionLine, { alignLeft = false } = {}) {
  const before = await frame.locator('.se-component.se-image').count().catch(() => 0);
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 15000 }).catch(() => null);
  const clicked = await clickIfVisible(frame, SEL.imageBtn, 3000);
  if (!clicked) {
    await chooserPromise;
    throw new Error('이미지 버튼을 찾지 못했습니다.');
  }
  const chooser = await chooserPromise;
  if (!chooser) throw new Error('이미지 파일 선택 창이 열리지 않았습니다.');
  await chooser.setFiles(filePath);
  // 업로드 완료 대기: 이미지 컴포넌트 수 증가 확인
  const deadline = Date.now() + 30000;
  let uploaded = false;
  while (Date.now() < deadline) {
    const now = await frame.locator('.se-component.se-image').count().catch(() => 0);
    if (now > before) {
      uploaded = true;
      break;
    }
    if (await dismissUploadError(frame, page)) {
      throw new Error('네이버가 지원하지 않는 이미지 파일이라 제외했습니다.');
    }
    await sleep(700);
  }
  if (!uploaded) {
    await dismissUploadError(frame, page);
    throw new Error('이미지 업로드가 완료되지 않아 제외했습니다.');
  }
  await sleep(1500);
  if (alignLeft) {
    // 쇼핑 포스팅은 이미지 블록까지 왼쪽에 맞춘다.
    const latestImage = frame.locator('.se-component.se-image').last();
    await latestImage.click({ timeout: 2500 }).catch(() => {});
    await setAlign(frame, page, 'left');
  }
  // 이미지 선택 상태 해제 후 캡션 줄(출처 표기) 입력
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.keyboard.press('ArrowDown');
  await sleep(200);
  if (captionLine) {
    await page.keyboard.insertText(captionLine);
    await page.keyboard.press('Enter');
  }
}

/**
 * 초안을 스마트에디터에 입력하고 임시저장(기본) 또는 발행한다.
 * @param {object} article {title, tags, blocks}
 * @param {Array} judgments [{slot, file, caption, sourceName, sourceUrl}]
 * @param {object} opts {mode:'draft'|'publish', visibility, imagesDir, errorShotPath, onStep, sources, products,
 *   editExistingDraftTitle, insertCover, strictImages, expectedImageCount}
 * @returns {object} { savedAsDraft, postUrl } — 임시저장이면 savedAsDraft=true, postUrl은 글쓰기 URL
 */
async function publish(article, judgments, opts) {
  const {
    mode = 'draft',
    visibility = 'public',
    imagesDir,
    errorShotPath,
    onStep = () => {},
    sources = [],
    products = [],
    editExistingDraftTitle = '',
    insertCover = false,
    strictImages = false,
    expectedImageCount = null,
  } = opts;
  const hasProducts = (products || []).some((product) => product && product.link);
  const publishArticle = hasProducts ? cleanProductPostArticle(article, products) : article;
  // 마지막 행동 제안과 제휴 후보는 본문과 분리하고, 해시태그는 글 전체의 맨 아래에 둔다.
  const publishBlocks = publishArticle.blocks || [];
  const deferredCtaIndex = publishBlocks.reduce(
    (lastIndex, block, index) =>
      block.type === 'paragraph' && !block.disclosure ? index : lastIndex,
    -1
  );
  const deferredCtaBlock = deferredCtaIndex >= 0 ? publishBlocks[deferredCtaIndex] : null;

  const status = await auth.verify(true);
  if (!status.loggedIn || !status.blogId) {
    throw new Error('네이버 로그인이 필요합니다. 대시보드에서 로그인 후 다시 시도하세요.');
  }

  const browser = await browserHelper.launch({ headless: false, args: ['--window-size=1440,960'] });
  const context = await browser.newContext({
    storageState: auth.STATE_PATH,
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();
  const bySlot = new Map(judgments.map((j) => [j.slot, j]));

  try {
    onStep('에디터 여는 중');
    await page.goto(`https://blog.naver.com/${status.blogId}?Redirect=Write&`, {
      waitUntil: 'load',
      timeout: 60000,
    });

    // 에디터 프레임 획득 (iframe이 없으면 본문 프레임 사용)
    await page.waitForSelector(SEL.iframe, { timeout: 20000 }).catch(() => {});
    let frame = page.frames().find((f) => f.name() === 'mainFrame') || page.mainFrame();
    await frame.waitForSelector(SEL.titleArea, { timeout: 30000 });
    await sleep(1500);

    // 팝업 정리
    await clickIfVisible(frame, SEL.popupCancel, 3000);
    await clickIfVisible(frame, SEL.helpClose, 1500);

    if (editExistingDraftTitle) {
      onStep('1차 임시글 다시 여는 중');
      await openSavedDraftByTitle(frame, page, editExistingDraftTitle);
      onStep('기존 이미지 자리 문구 정리 중');
      await clearLoadedDraft(frame, page, editExistingDraftTitle);
      await frame.waitForSelector(SEL.bodyArea, { timeout: 10000 });
    }

    // 제목
    onStep('제목 입력 중');
    await frame.locator(SEL.titleArea).first().click();
    await setAlign(frame, page, 'left');
    await frame.locator(SEL.titleArea).first().click();
    await page.keyboard.insertText(publishArticle.title);

    // 본문
    onStep('본문 입력 중');
    await frame.locator(SEL.bodyArea).first().click();
    await sleep(300);
    await setAlign(frame, page, 'left'); // 본문 전체 좌측정렬 강제 (best-effort)
    // 정렬 드롭다운 조작으로 포커스가 본문에서 벗어날 수 있으므로 본문을 다시 클릭
    await frame.locator(SEL.bodyArea).first().click();
    await sleep(200);

    if (insertCover) {
      const cover = bySlot.get(0);
      if (!cover?.file) throw new Error('대표이미지 파일을 찾지 못했습니다.');
      onStep('대표이미지 업로드 중');
      const cleanCoverCaption = String(cover.caption || '').trim();
      await insertImage(
        frame,
        page,
        path.join(imagesDir, 'raw', cover.file),
        cleanCoverCaption ? `${cleanCoverCaption}(AI 연출 이미지)` : 'AI 연출 이미지'
      );
    }

    for (const [blockIndex, block] of publishBlocks.entries()) {
      if (blockIndex === deferredCtaIndex) continue;
      if (block.type === 'heading') {
        if (hasProducts) await insertHeading(frame, page, block.text);
        else await insertHealthHeading(frame, page, block.text);
      } else if (block.type === 'paragraph') {
        await typeParagraph(page, block.text); // 문단 안 줄은 붙이고, 빈 줄은 문단 사이에만
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter'); // 문단 사이 빈 줄 하나
      } else if (block.type === 'quote') {
        // 연예 글과 상품 글 모두 핵심 인용구를 본문보다 크게 표시해 읽는 리듬을 만든다.
        await insertQuote(frame, page, block.text, { emphasize: true });
      } else if (block.type === 'divider') {
        await insertDivider(frame, page);
      } else if (block.type === 'image') {
        const j = bySlot.get(block.slot);
        if (j && j.file) {
          onStep(`이미지 ${block.slot} 업로드 중`);
          const cleanCap = String(j.caption || '').replace(/\s*\((?:AI 연출|생성) 이미지\)\s*$/, '').trim();
          let captionLine;
          if (j.generated) {
            const generatedLabel = j.ai ? 'AI 연출 이미지' : '생성 이미지';
            captionLine = cleanCap ? `${cleanCap}(${generatedLabel})` : generatedLabel;
          } else if (hasProducts) {
            // 쇼핑커넥트 포스팅은 자연스러운 사진 설명만 쓰고 출처 문구는 붙이지 않는다.
            captionLine = cleanCap;
          } else {
            // 건강 글은 조사 출처를 본문·이미지 캡션에 노출하지 않는다.
            captionLine = cleanCap;
          }
          try {
            await insertImage(frame, page, path.join(imagesDir, 'raw', j.file), captionLine, {
              alignLeft: hasProducts,
            });
          } catch (e) {
            console.log(`[publisher] 이미지 슬롯 ${block.slot} 업로드 실패: ${e.message}`);
            if (strictImages) throw e;
          }
        } else if (!hasProducts) {
          if (strictImages) throw new Error(`본문 이미지 ${block.slot} 파일을 찾지 못했습니다.`);
          const placeholderDesc = String(j?.desc || block.desc || block.caption || '글 내용에 맞는 이미지').trim();
          await typeRich(page, `🖼 이미지 ${block.slot} 넣을 자리`);
          await page.keyboard.press('Shift+Enter');
          await page.keyboard.insertText(`추천 장면: ${placeholderDesc}`);
          await page.keyboard.press('Enter');
          await page.keyboard.press('Enter');
        }
      }
      await sleep(250);
    }

    // 상품 제휴 글에만 건강 기사 링크를 표시한다. 건강 정보 글의 출처는 내부 기록으로만 보관한다.
    const linkSources = (sources || []).filter((source) => source && source.url).slice(0, 8);
    if (hasProducts && linkSources.length) {
      onStep('건강 기사 출처 정리 중');
      await insertDivider(frame, page);
      await insertHeading(frame, page, '📌 참고한 건강 기사');
      for (const source of linkSources) {
        if (source.title) {
          await typeRich(page, `· ${String(source.title).replace(/\s+/g, ' ').trim()}`);
          await page.keyboard.press('Shift+Enter');
        }
        await page.keyboard.insertText(source.url);
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
      }
    }

    // 건강 글은 행동 문단 입력 뒤 이미 Enter를 두 번 눌렀으므로,
    // 별도 제품 후보 블록을 추가로 내리지 않고 그 위치에 바로 입력한다.
    // 상품 글의 마지막 CTA는 기존처럼 앞에 Enter 두 번을 둔다.
    if (deferredCtaBlock?.text) {
      const isHealthAffiliateCandidate = !hasProducts && /이\s*글에\s*제휴하면\s*좋은\s*제품/.test(deferredCtaBlock.text);
      if (!isHealthAffiliateCandidate) {
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
      }
      await typeParagraph(page, deferredCtaBlock.text);
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
    }

    // ── 해시태그 (글 전체 맨 아래) ────────────────────
    const tagLine = (publishArticle.tags || [])
      .map((t) => '#' + String(t).replace(/^#+/, '').replace(/\s+/g, ''))
      .filter((t) => t.length > 1)
      .slice(0, 10)
      .join(' ');
    if (tagLine) {
      await typeRich(page, tagLine);
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
    }

    // ── 주력 상품 제휴 링크 (항상 글의 맨 끝) ──────────────
    const linkProducts = (products || []).filter((p) => p && p.link).slice(0, 5);
    if (linkProducts.length) {
      onStep('주력 상품 링크 삽입 중');
      for (const p of linkProducts) {
        const nameLine = String(p.name || '상품').replace(/\s+/g, ' ').trim().slice(0, 45);
        await typeRich(page, `▶ ${nameLine} 선택 기준 확인하기`);
        await page.keyboard.press('Shift+Enter');
        await page.keyboard.insertText(p.link);
        await page.keyboard.press('Enter'); // URL 뒤 Enter → 자동 링크화
        await page.keyboard.press('Enter');
        await sleep(300);
      }
    }

    if (strictImages) {
      const actualImageCount = await frame.locator('.se-component.se-image').count();
      const requiredImageCount = Number.isInteger(expectedImageCount)
        ? expectedImageCount
        : judgments.filter((item) => item?.file).length;
      if (actualImageCount !== requiredImageCount) {
        throw new Error(`네이버 이미지 배치 수가 맞지 않습니다. 기대 ${requiredImageCount}장, 확인 ${actualImageCount}장`);
      }
      const bodyText = await frame
        .locator('.se-component:not(.se-documentTitle)')
        .evaluateAll((nodes) => nodes.map((node) => node.innerText || '').join('\n'));
      if (/추천\s*장면\s*:|이미지\s*\d+\s*넣을\s*자리/.test(bodyText)) {
        throw new Error('이미지 자리 안내 문구가 본문에 남아 있습니다.');
      }
    }

    if (mode === 'publish') {
      // ── 즉시 발행 ────────────────────────────────
      onStep('발행 설정 중');
      const openedWith = await clickVisibleCandidate(frame, SEL.publishOpenCandidates, { pick: 'first' });
      if (!openedWith) throw new Error('발행 버튼(헤더)을 찾지 못했습니다.');
      await sleep(1500);

      // 태그 입력
      try {
        const tagInput = frame.locator(SEL.tagInput).first();
        await tagInput.waitFor({ state: 'visible', timeout: 4000 });
        for (const tag of (article.tags || []).slice(0, 10)) {
          await tagInput.fill(tag);
          await page.keyboard.press('Enter');
          await sleep(250);
        }
      } catch {
        console.log('[publisher] 태그 입력란을 찾지 못해 건너뜁니다.');
      }

      if (visibility === 'private') {
        await clickIfVisible(frame, SEL.privateLabel, 3000);
        await sleep(300);
      }

      onStep('발행 중');
      const confirmedWith = await clickVisibleCandidate(
        frame,
        [SEL.publishConfirm, 'button[data-click-area$=".publish"]', 'button:has-text("발행")'],
        { pick: 'last', timeout: 10000 }
      );
      if (!confirmedWith) throw new Error('발행 확인 버튼을 찾지 못했습니다.');

      await page.waitForURL(/blog\.naver\.com\/[^/?]+\/\d+/, { timeout: 60000 }).catch(() => {});
      await sleep(2000);
      let postUrl = page.url();
      if (!/\/\d+/.test(postUrl)) {
        const f = page.frames().find((fr) => /logNo=\d+/.test(fr.url()));
        postUrl = f
          ? `https://blog.naver.com/${status.blogId}/${f.url().match(/logNo=(\d+)/)[1]}`
          : `https://blog.naver.com/${status.blogId}`;
      }
      return { savedAsDraft: false, postUrl };
    }

    // ── 임시저장 (기본) ─────────────────────────────
    onStep('임시저장 중');
    await saveDraftVerified(frame, page, { updatingExisting: Boolean(editExistingDraftTitle) });
    let insertedImageCount = strictImages
      ? await frame.locator('.se-component.se-image').count().catch(() => 0)
      : 0;
    if (strictImages && editExistingDraftTitle) {
      onStep('2차 임시저장 결과 확인 중');
      insertedImageCount = await verifySavedDraftByTitle(
        frame,
        page,
        editExistingDraftTitle,
        Number.isInteger(expectedImageCount) ? expectedImageCount : insertedImageCount
      );
    }
    console.log('[publisher] 임시저장 확인 완료');
    // 임시저장 글은 글쓰기 화면에서 "이어쓰기"로 열 수 있음
    return {
      savedAsDraft: true,
      postUrl: `https://blog.naver.com/${status.blogId}?Redirect=Write`,
      updatedExistingDraft: Boolean(editExistingDraftTitle),
      insertedImageCount,
    };
  } catch (e) {
    if (errorShotPath) {
      await page.screenshot({ path: errorShotPath, fullPage: false }).catch(() => {});
    }
    throw e;
  } finally {
    await auth.persistState(context).catch(() => {}); // 갱신된 쿠키 저장 (세션 연장)
    await browser.close().catch(() => {});
  }
}

module.exports = { publish };
