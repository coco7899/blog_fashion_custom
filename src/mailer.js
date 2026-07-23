// 발행 알림 메일: 저장된 네이버 세션으로 mail.naver.com 메일쓰기 화면을 자동 조작해 발송
// (비밀번호/SMTP 불필요 — 블로그와 같은 로그인 세션 재사용)
const path = require('path');
const { chromium } = require('playwright');
const auth = require('./naverAuth');
const store = require('./store');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function firstVisible(page, selectors, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.isVisible({ timeout: 300 })) return loc;
      } catch {}
    }
    await sleep(400);
  }
  return null;
}

/**
 * 네이버 메일 발송. 실패 시 예외 (호출부에서 best-effort 처리).
 */
async function sendMail(to, subject, body) {
  if (!auth.hasState()) throw new Error('네이버 로그인 세션이 없어 메일을 보낼 수 없습니다.');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: auth.STATE_PATH, locale: 'ko-KR' });
  const page = await context.newPage();
  try {
    await page.goto('https://mail.naver.com/v2/new', { waitUntil: 'domcontentloaded', timeout: 40000 });
    await sleep(3500); // 메일 앱 로딩 대기

    if (/nid\.naver\.com/.test(page.url())) {
      throw new Error('네이버 세션이 만료되어 메일 화면에 접근할 수 없습니다.');
    }

    // 받는사람 입력 (네이버 메일 v2: #recipient_input_element)
    const rcpt = await firstVisible(page, [
      '#recipient_input_element',
      'input[aria-label*="받는사람"]',
      '.recipient_area input',
    ], 8000);
    if (!rcpt) throw new Error('받는사람 입력란을 찾지 못했습니다.');
    await rcpt.click();
    await page.keyboard.insertText(to);
    await page.keyboard.press('Enter');
    await sleep(500);

    // 제목 입력 (#subject_title)
    const subj = await firstVisible(page, [
      '#subject_title',
      'input[aria-label*="제목"]',
      'input[placeholder*="제목"]',
    ], 6000);
    if (!subj) throw new Error('제목 입력란을 찾지 못했습니다.');
    await subj.click();
    await page.keyboard.insertText(subject);
    await sleep(300);

    // 본문 입력 — 에디터는 하위 iframe 안의 [contenteditable="true"] 요소
    let wrote = false;
    for (const frame of page.frames()) {
      try {
        const editor = frame.locator('[contenteditable="true"]').first();
        if (await editor.isVisible({ timeout: 1200 }).catch(() => false)) {
          await editor.click();
          await page.keyboard.insertText(body);
          wrote = true;
          break;
        }
      } catch {}
    }
    if (!wrote) throw new Error('본문 입력란을 찾지 못했습니다.');
    await sleep(500);

    // 보내기 (button.button_write_task = 상단 "보내기")
    const send = await firstVisible(page, [
      'button.button_write_task',
      'button:has-text("보내기")',
      'a:has-text("보내기")',
    ], 6000);
    if (!send) throw new Error('보내기 버튼을 찾지 못했습니다.');
    await send.click();

    // 발송 완료 화면 대기 ("메일을 보냈습니다" 등)
    await Promise.race([
      page.waitForURL(/send|done/i, { timeout: 15000 }).catch(() => {}),
      page.locator(':text("보냈습니다"), :text("발송"), :text("전송")').first().waitFor({ timeout: 15000 }).catch(() => {}),
    ]);
    await sleep(2000);
    return true;
  } catch (e) {
    await page
      .screenshot({ path: path.join(store.DATA_DIR, 'mail-error.png'), fullPage: false })
      .catch(() => {});
    throw e;
  } finally {
    await auth.persistState(context).catch(() => {}); // 갱신된 쿠키 저장 (세션 연장)
    await browser.close().catch(() => {});
  }
}

module.exports = { sendMail };
