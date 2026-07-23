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
  helpClose: '.se-help-panel-close-button',
  fontSizeBtn: '.se-font-size-code-toolbar-button',
  fontSizeOpt: (code) => `.se-toolbar-option-font-size-code-fs${code}-button`,
  quoteBtn: '.se-insert-quotation-default-toolbar-button, .se-blockquote-toolbar-button',
  quoteOpt: '.se-toolbar-option-blockquote-quotation_line-button, button[class*="quotation-quotation_line"], button[class*="se-toolbar-option-blockquote"]',
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
  if (!opened) return false;
  await sleep(300);
  const ok = await clickIfVisible(frame, SEL.fontSizeOpt(code), 2000);
  if (!ok) await page.keyboard.press('Escape');
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

async function insertQuote(frame, page, text) {
  const lines = String(text).split('\n').map((s) => s.trim()).filter(Boolean);
  const opened = await clickIfVisible(frame, SEL.quoteBtn, 2500);
  if (opened) {
    await sleep(300);
    await clickIfVisible(frame, SEL.quoteOpt, 2000);
    await sleep(400);
    // 여러 줄(스펙 요약 등)은 인용구 안에서 Shift+Enter(같은 인용구 내 줄바꿈)로 입력
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) await page.keyboard.press('Shift+Enter');
      await page.keyboard.insertText(lines[i]);
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
async function saveDraftVerified(frame, page) {
  for (let attempt = 1; attempt <= 2; attempt++) {
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
      // "작성 중인 글 이어쓰기" 팝업이 저장을 막고 있으면 취소
      await clickIfVisible(frame, SEL.popupCancel, 600);
      await sleep(600);
    }
    console.log(`[publisher] 저장 확인 실패(시도 ${attempt}) — 재시도`);
  }
  throw new Error('임시저장이 확인되지 않았습니다(저장 신호 없음).');
}

async function insertImage(frame, page, filePath, captionLine) {
  const before = await frame.locator('.se-component.se-image').count().catch(() => 0);
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 15000 });
  const clicked = await clickIfVisible(frame, SEL.imageBtn, 3000);
  if (!clicked) throw new Error('이미지 버튼을 찾지 못했습니다.');
  const chooser = await chooserPromise;
  await chooser.setFiles(filePath);
  // 업로드 완료 대기: 이미지 컴포넌트 수 증가 확인
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const now = await frame.locator('.se-component.se-image').count().catch(() => 0);
    if (now > before) break;
    await sleep(700);
  }
  await sleep(1500);
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
 * @param {object} opts {mode:'draft'|'publish', visibility, imagesDir, errorShotPath, onStep, sources, products}
 * @returns {object} { savedAsDraft, postUrl } — 임시저장이면 savedAsDraft=true, postUrl은 글쓰기 URL
 */
async function publish(article, judgments, opts) {
  const { mode = 'draft', visibility = 'public', imagesDir, errorShotPath, onStep = () => {}, sources = [], products = [] } = opts;

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

    // 제목
    onStep('제목 입력 중');
    await frame.locator(SEL.titleArea).first().click();
    await page.keyboard.insertText(article.title);

    // 본문
    onStep('본문 입력 중');
    await frame.locator(SEL.bodyArea).first().click();
    await sleep(300);
    await setAlign(frame, page, 'left'); // 본문 전체 좌측정렬 강제 (best-effort)
    // 정렬 드롭다운 조작으로 포커스가 본문에서 벗어날 수 있으므로 본문을 다시 클릭
    await frame.locator(SEL.bodyArea).first().click();
    await sleep(200);

    // 공정위 고지 문구 — 제휴 링크가 있는 상품 소개 글에만 본문 맨 위에 삽입
    const hasProducts = (products || []).some((p) => p && p.link);
    if (hasProducts) {
      await typeRich(page, '이 글은 네이버 쇼핑커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
    }

    for (const block of article.blocks) {
      // AI가 고지 문구를 중복으로 넣었으면 건너뛴다 (시스템이 위에서 이미 삽입)
      if (block.type === 'paragraph' && /쇼핑커넥트 활동/.test(block.text || '')) continue;
      if (block.type === 'heading') {
        await insertHeading(frame, page, block.text);
      } else if (block.type === 'paragraph') {
        await typeParagraph(page, block.text); // 문단 안 줄은 붙이고, 빈 줄은 문단 사이에만
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter'); // 문단 사이 빈 줄 하나
      } else if (block.type === 'quote') {
        await insertQuote(frame, page, block.text);
      } else if (block.type === 'divider') {
        await insertDivider(frame, page);
      } else if (block.type === 'image') {
        const j = bySlot.get(block.slot);
        if (j && j.file) {
          onStep(`이미지 ${block.slot} 업로드 중`);
          const cleanCap = String(j.caption || '').replace(/\s*\(AI 연출 이미지\)\s*$/, '').trim();
          let captionLine;
          if (j.ai) {
            // AI 연출 이미지는 출처 대신 "AI 연출 이미지"로 명확히 표시(스킬 규칙)
            captionLine = cleanCap ? `▲ ${cleanCap} · AI 연출 이미지` : '▲ AI 연출 이미지';
          } else {
            captionLine = cleanCap
              ? `▲ ${cleanCap}${j.sourceName ? ` (사진 출처: ${j.sourceName})` : ' (사진 출처: 관련 기사)'}`
              : j.sourceName
                ? `(사진 출처: ${j.sourceName})`
                : '';
          }
          try {
            await insertImage(frame, page, path.join(imagesDir, 'raw', j.file), captionLine);
          } catch (e) {
            console.log(`[publisher] 이미지 슬롯 ${block.slot} 업로드 실패: ${e.message}`);
          }
        }
      }
      await sleep(250);
    }

    // ── 해시태그 (본문 끝) ──────────────────────────
    const tagLine = (article.tags || [])
      .map((t) => '#' + String(t).replace(/^#+/, '').replace(/\s+/g, ''))
      .filter((t) => t.length > 1)
      .slice(0, 10)
      .join(' ');
    if (tagLine) {
      await typeRich(page, tagLine);
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
    }

    // ── 출처 링크 (글 맨 아래) ──────────────────────
    // 뉴스 기사 URL을 그대로 입력하면 스마트에디터가 클릭 가능한 링크로 자동 변환한다.
    const linkSources = (sources || []).filter((s) => s && s.url).slice(0, 8);
    if (linkSources.length) {
      onStep('출처 링크 정리 중');
      await insertDivider(frame, page);
      await insertHeading(frame, page, '📌 출처');
      for (const s of linkSources) {
        if (s.title) {
          await typeRich(page, `· ${String(s.title).replace(/\s+/g, ' ').trim()}`);
          await page.keyboard.press('Shift+Enter');
        }
        await page.keyboard.insertText(s.url);
        await page.keyboard.press('Enter'); // URL 뒤 Enter → 자동 링크화
        await page.keyboard.press('Enter'); // 항목 간 한 줄 띄우기
        await sleep(300);
      }
    }

    // ── 추천 상품 (브랜드커넥트 제휴 링크, 글 맨 끝) ─────────
    const linkProducts = (products || []).filter((p) => p && p.link).slice(0, 5);
    if (linkProducts.length) {
      onStep('추천 상품 링크 삽입 중');
      await insertDivider(frame, page);
      await insertHeading(frame, page, '🛍 함께 보면 좋은 상품');
      for (const p of linkProducts) {
        const nameLine = String(p.name || '상품').replace(/\s+/g, ' ').trim().slice(0, 45);
        await typeRich(page, `· ${nameLine}`);
        await page.keyboard.press('Shift+Enter');
        await page.keyboard.insertText(p.link);
        await page.keyboard.press('Enter'); // URL 뒤 Enter → 자동 링크화
        await page.keyboard.press('Enter');
        await sleep(300);
      }
      // 광고·제휴 고지 문구는 스킬 지침에 따라 글 상단(본문 첫 블록)에 이미 포함됨
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
    await saveDraftVerified(frame, page); // 실제 저장 확인, 실패 시 예외
    console.log('[publisher] 임시저장 확인 완료');
    // 임시저장 글은 글쓰기 화면에서 "이어쓰기"로 열 수 있음
    return { savedAsDraft: true, postUrl: `https://blog.naver.com/${status.blogId}?Redirect=Write` };
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
