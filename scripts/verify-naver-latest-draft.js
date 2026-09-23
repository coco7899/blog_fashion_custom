// 저장된 네이버 최신 임시글을 다시 열어 로컬 미리보기 본문과 비교한다.
// BLOG_FASHION_DATA_DIR 환경 변수와 초안 ID가 필요하다.
const { chromium } = require('playwright');
const auth = require('../src/naverAuth');
const store = require('../src/store');
const { verifyBodyBlocks } = require('../src/publisher');

async function main() {
  const id = process.argv[2];
  const meta = store.getMeta(id);
  const article = store.getArticle(id);
  if (!meta || !article) throw new Error('초안 ID에 해당하는 글이 없습니다.');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState: auth.STATE_PATH });
    const page = await context.newPage();
    await page.goto('https://blog.naver.com/beauyonce?Redirect=Write&', {
      waitUntil: 'load', timeout: 60000,
    });
    const frame = page.frames().find(f => f.name() === 'mainFrame') || page.mainFrame();
    const titleArea = frame.locator('.se-section-documentTitle .se-text-paragraph').first();
    await titleArea.waitFor({ timeout: 30000 });
    const resume = frame.locator('.se-popup-alert').filter({ hasText: '작성 중인 글이 있습니다' });
    if (await resume.isVisible().catch(() => false)) {
      await resume.getByRole('button', { name: '확인', exact: true }).click();
      await page.waitForTimeout(1200);
    }
    if ((await titleArea.innerText()) !== article.title) {
      const list = frame.locator('button[class*="save_count_btn"], button[data-click-area$="s.count"]').first();
      await list.click();
      const latest = frame.getByRole('button', { name: new RegExp(article.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first();
      await latest.click();
      await page.waitForTimeout(1200);
    }
    if ((await titleArea.innerText()) !== article.title) throw new Error('네이버 임시글 제목이 일치하지 않습니다.');
    await verifyBodyBlocks(frame, article);
    const imageCount = await frame.locator('.se-component.se-image').count();
    const expectedImages = article.blocks.filter(block => block.type === 'image').length;
    if (imageCount < expectedImages) throw new Error(`네이버 이미지 누락: ${imageCount}/${expectedImages}`);
    console.log(JSON.stringify({ ok: true, title: article.title, imageCount, expectedImages }));
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
